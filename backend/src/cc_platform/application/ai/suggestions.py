"""The copilot's suggestions (ADR 0005): ask for one, read the latest, decide, purge.

A suggestion is one ``task`` run of agent-core as the analyst (an ``advisor`` credential with a
10-minute delegation on this one customer), fed with the recent turns and the case facts. It
answers a typed list that may be empty. Nothing here sends or executes anything.

Like the Q&A copilot, a call is short transactions around a long wait:

1. one Unit of Work stores the suggestion as ``preparing`` and builds the input;
2. agent-core answers with no transaction open (it takes as long as the model);
3. another stores the answer, or the failure.

``SuggestionService`` is the shared engine: the manual request (``RequestSuggestion``) and the
automatic ones (``SuggestionProcess``: a customer message, a hand-over) both prepare and produce.
An automatic one skips quietly when there is nothing to propose (a greeting, nothing new, a case
nobody holds); a manual one answers errors.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial

from cc_platform.application.ai.credentials import AgentCredentialIssuer, AgentCredentials
from cc_platform.application.ai.errors import AgentCoreRejectedError, AgentCoreUnavailableError
from cc_platform.application.ai.runtime import (
    AgentRun,
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
)
from cc_platform.application.ai.staff import advisor_credentials
from cc_platform.application.ai.suggestion_filter import is_trivial
from cc_platform.application.cases.queries import load_case_for
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.errors import CopilotBusyError, CopilotUnavailableError
from cc_platform.domain.ai.suggestion import (
    DRAFT_TTL,
    CopilotSuggestion,
    SuggestionStatus,
    SuggestionTrigger,
)
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import CaseClosedError
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import (
    CONVERSATION_KINDS,
    OPEN_ASSIGNED_STATUSES,
    CaseStatus,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

#: The turns the agent reads, the newest ones (the transcript of the case, not a summary).
CONTEXT_TURNS = 12
MAX_TURN_CHARS = 1000

#: A suggestion still ``preparing`` after this long is taken as lost (the process died): a new
#: request replaces it instead of answering ``copilot_busy`` forever.
PREPARING_TIMEOUT = timedelta(seconds=90)

#: An automatic suggestion is not made when the previous one is this fresh (a burst of messages).
MIN_GAP = timedelta(seconds=10)

#: Turns that carry what the customer or the analyst said (chat, email, a line of a call).
_SPEECH_KINDS = CONVERSATION_KINDS | {TurnKind.TRANSCRIPT}
_ROLE = {
    TurnAuthorRole.CUSTOMER: "cliente",
    TurnAuthorRole.ANALYST: "analista",
    TurnAuthorRole.ASSISTANT: "asistente",
}


@dataclass(frozen=True, slots=True)
class SuggestionView:
    suggestion: CopilotSuggestion
    stale: bool
    """The customer wrote after the turns it read: it may no longer fit."""
    replayed: bool = False
    """A retry of a request that already had its answer: nothing was asked."""


@dataclass(frozen=True, slots=True)
class LatestSuggestionView:
    available: bool
    """False while agent-core is not configured or the customer is not linked: hide the panel."""
    latest: SuggestionView | None


# ----------------------------------------------------------------------------------- the input
def _speech(turns: Sequence[Turn]) -> list[Turn]:
    return [t for t in turns if t.kind in _SPEECH_KINDS and t.author_role in _ROLE]


def customer_waiting_seconds(turns: Sequence[Turn], now: datetime) -> int:
    """How long the customer has waited for an answer: since the first of the customer's last
    consecutive messages (0 when the analyst or the assistant spoke last)."""
    waiting_since: datetime | None = None
    for turn in reversed(_speech(turns)):
        if turn.author_role is not TurnAuthorRole.CUSTOMER:
            break
        waiting_since = turn.created_at
    return max(0, int((now - waiting_since).total_seconds())) if waiting_since else 0


def sla_state(case: Case, now: datetime) -> dict[str, object]:
    if case.first_response_at is not None:
        return {"estado": "respondida", "minutos_restantes": None}
    remaining = int((case.sla_due_at - now).total_seconds() // 60)
    if remaining < 0:
        return {"estado": "vencido", "minutos_restantes": None}
    return {"estado": "en_riesgo" if remaining <= 5 else "a_tiempo", "minutos_restantes": remaining}


def previous_state(previous: CopilotSuggestion | None) -> dict[str, object] | None:
    """What happened to the last suggestion, so the agent does not repeat a draft that was
    discarded."""
    if previous is None or previous.status is not SuggestionStatus.READY:
        return None
    if previous.reply_decision is not None:
        reply: str | None = previous.reply_decision.value
    else:
        reply = "pendiente" if previous.reply_pending else None
    return {"borrador": reply, "escalacion_aceptada": previous.escalation_accepted}


def build_input(
    *,
    case: Case,
    turns: Sequence[Turn],
    arrival: str | None,
    previous: CopilotSuggestion | None,
    now: datetime,
) -> dict[str, object]:
    """The ``input`` of a suggestion run: the recent turns and the facts of the case. The turns'
    text is the customer's and the analyst's own words: agent-core treats it as untrusted."""
    spoken = _speech(turns)[-CONTEXT_TURNS:]
    return {
        "idioma": case.language.value,
        "canal": case.channel.value,
        "prioridad": case.priority.value,
        "sla": sla_state(case, now),
        "motivo_llegada": arrival,
        "espera_del_cliente_segundos": customer_waiting_seconds(turns, now),
        "sugerencia_anterior": previous_state(previous),
        "turnos": [
            {
                "rol": _ROLE[t.author_role],
                "texto": t.text[:MAX_TURN_CHARS],
                "hora": t.created_at.isoformat(),
            }
            for t in spoken
        ],
    }


# ----------------------------------------------------------------------------------- the engine
@dataclass(frozen=True, slots=True)
class Prepared:
    """A suggestion stored as ``preparing``, ready to ask agent-core, or an answer to give back."""

    suggestion_id: str
    credentials: AgentCredentials
    input: dict[str, object]
    language: str
    replay: CopilotSuggestion | None = None
    """A manual retry of a request that already has its answer: nothing to ask."""


@dataclass(frozen=True, slots=True)
class SuggestionService:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer
    agent: str
    """The suggestions agent (``id@alias``), e.g. ``copiloto-sugerencias@prod``."""

    # ------------------------------------------------------------------ 1. prepare
    async def prepare_manual(self, actor: Actor, case_id: str, *, request_key: str) -> Prepared:
        """The analyst asked (``Idempotency-Key`` = ``request_key``): errors are answered."""
        ensure_any_role(actor, {StaffRole.ANALYST})
        return await retry_on_conflict(partial(self._prepare_manual, actor, case_id, request_key))

    async def prepare_automatic(self, case_id: str, trigger: SuggestionTrigger) -> Prepared | None:
        """A customer message or a hand-over: ``None`` when there is nothing to propose."""
        return await retry_on_conflict(partial(self._prepare_automatic, case_id, trigger))

    async def _prepare_manual(self, actor: Actor, case_id: str, request_key: str) -> Prepared:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            analyst = actor.staff_id
            if await uow.bank_links.get(case.customer_id) is None:
                raise CopilotUnavailableError()
            now = self.clock.now()
            existing = await uow.copilot_suggestions.get_by_request_key(
                case.id, analyst, request_key
            )
            latest = await uow.copilot_suggestions.latest_for(case.id, analyst)
            if existing is not None and existing.status in (
                SuggestionStatus.READY,
                SuggestionStatus.NONE,
            ):
                return await self._prepared(uow, case, existing, analyst, now, replay=existing)
            if case.is_closed:
                raise CaseClosedError()
            if any(s is not None and self._preparing(s, now) for s in (latest, existing)):
                raise CopilotBusyError()  # one at a time (a lost one times out)
            suggestion = await self._start(
                uow,
                case,
                analyst,
                SuggestionTrigger.MANUAL,
                request_key,
                existing=existing,
                latest=latest,
                now=now,
            )
            await uow.commit()
            return await self._prepared(uow, case, suggestion, analyst, now)

    async def _prepare_automatic(self, case_id: str, trigger: SuggestionTrigger) -> Prepared | None:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            analyst = case.assigned_analyst_id if case is not None else None
            if (
                case is None
                or analyst is None
                or case.is_closed
                or case.status not in OPEN_ASSIGNED_STATUSES
                or case.status is CaseStatus.WITH_ASSISTANT
                or await uow.bank_links.get(case.customer_id) is None
            ):
                return None
            now = self.clock.now()
            latest = await uow.copilot_suggestions.latest_for(case.id, analyst)
            if latest is not None and (
                self._preparing(latest, now)
                or now - latest.created_at < MIN_GAP
                or (
                    latest.based_on_sequence == case.last_sequence
                    and latest.status is not SuggestionStatus.FAILED
                )
            ):
                return None  # a burst, or nothing new since the last one
            turns = await uow.turns.page(case.id, limit=CONTEXT_TURNS * 2)
            if self._nothing_to_answer(case, turns, now, trigger):
                return None
            suggestion = await self._start(
                uow, case, analyst, trigger, None, existing=None, latest=latest, now=now
            )
            await uow.commit()
            return await self._prepared(uow, case, suggestion, analyst, now)

    @staticmethod
    def _preparing(suggestion: CopilotSuggestion, now: datetime) -> bool:
        return (
            suggestion.status is SuggestionStatus.PREPARING
            and now - suggestion.updated_at < PREPARING_TIMEOUT
        )

    @staticmethod
    def _nothing_to_answer(
        case: Case, turns: Sequence[Turn], now: datetime, trigger: SuggestionTrigger
    ) -> bool:
        """A customer message needs a customer message that is not a greeting. A hand-over also
        proposes when the assistant spoke last (the analyst takes the conversation over), but
        not when the customer's last word is a greeting or there is nothing to read."""
        spoken = _speech(turns)
        if not spoken:
            return True
        if spoken[-1].author_role is not TurnAuthorRole.CUSTOMER:
            return trigger is SuggestionTrigger.CUSTOMER_MESSAGE
        return is_trivial(
            spoken[-1].text,
            waited_seconds=customer_waiting_seconds(turns, now),
            sla_overdue=sla_state(case, now)["estado"] == "vencido",
        )

    async def _start(
        self,
        uow: UnitOfWork,
        case: Case,
        analyst: str,
        trigger: SuggestionTrigger,
        request_key: str | None,
        *,
        existing: CopilotSuggestion | None,
        latest: CopilotSuggestion | None,
        now: datetime,
    ) -> CopilotSuggestion:
        if existing is not None:  # a failed request asked again with the same key
            existing.restart(based_on_sequence=case.last_sequence, at=now)
            await uow.copilot_suggestions.save(existing)
            return existing
        if latest is not None and latest.ignore_reply(at=now):  # a newer one replaces it
            await uow.copilot_suggestions.save(latest)
        suggestion = CopilotSuggestion.request(
            suggestion_id=self.ids.new_id(IdPrefix.COPILOT_SUGGESTION),
            case_id=case.id,
            analyst_id=analyst,
            agent=self.agent,
            trigger=trigger,
            based_on_sequence=case.last_sequence,
            request_key=request_key,
            at=now,
        )
        await uow.copilot_suggestions.add(suggestion)
        return suggestion

    async def _prepared(
        self,
        uow: UnitOfWork,
        case: Case,
        suggestion: CopilotSuggestion,
        analyst: str,
        now: datetime,
        *,
        replay: CopilotSuggestion | None = None,
    ) -> Prepared:
        turns = await uow.turns.page(case.id, limit=CONTEXT_TURNS * 2)
        assignment = await uow.assignments.latest_for_case(case.id)
        previous = await uow.copilot_suggestions.latest_for(case.id, analyst)
        previous = previous if previous is not None and previous.id != suggestion.id else None
        return Prepared(
            suggestion_id=suggestion.id,
            credentials=await advisor_credentials(uow, self.issuer, self.clock, case, analyst),
            input=build_input(
                case=case,
                turns=turns,
                arrival=assignment.reason.value if assignment is not None else None,
                previous=previous,
                now=now,
            ),
            language=case.language.value,
            replay=replay,
        )

    # ------------------------------------------------------------------ 2 and 3. produce
    async def produce(self, prepared: Prepared, *, raise_errors: bool) -> CopilotSuggestion:
        """Ask agent-core and store what it answered. With ``raise_errors`` False (automatic) a
        failure is stored and swallowed: the analyst can press *Sugerir*."""
        if prepared.replay is not None:
            return prepared.replay
        try:
            run = await self.runtime.start_run(
                prepared.credentials,
                agent=self.agent,
                idempotency_key=prepared.suggestion_id,
                lang=prepared.language,
                input=prepared.input,
            )
        except AgentRuntimeUnavailableError:
            await self._fail(prepared.suggestion_id, "agent_core_unavailable")
            if raise_errors:
                raise AgentCoreUnavailableError() from None
            return await self._read(prepared.suggestion_id)
        except AgentRuntimeError as error:
            await self._fail(prepared.suggestion_id, error.code)
            if raise_errors:
                raise AgentCoreRejectedError(
                    agent_core_code=error.code, agent_core_status=error.status
                ) from None
            return await self._read(prepared.suggestion_id)
        return await retry_on_conflict(partial(self._store_answer, prepared.suggestion_id, run))

    async def _store_answer(self, suggestion_id: str, run: AgentRun) -> CopilotSuggestion:
        async with self.uow() as uow:
            suggestion = await uow.copilot_suggestions.get(suggestion_id)
            if suggestion is None:
                raise NotFoundError("No encontramos la sugerencia.")
            if suggestion.status is SuggestionStatus.PREPARING:
                suggestion.record_answer(
                    raw=run.suggestions,
                    run_id=run.run_id,
                    trace_id=run.trace_id,
                    at=self.clock.now(),
                )
                await uow.copilot_suggestions.save(suggestion)
                await uow.commit()
            return suggestion

    async def _fail(self, suggestion_id: str, code: str) -> None:
        await retry_on_conflict(partial(self._store_failure, suggestion_id, code))

    async def _store_failure(self, suggestion_id: str, code: str) -> None:
        async with self.uow() as uow:
            suggestion = await uow.copilot_suggestions.get(suggestion_id)
            if suggestion is None or suggestion.status is not SuggestionStatus.PREPARING:
                return
            suggestion.record_failure(code=code, at=self.clock.now())
            await uow.copilot_suggestions.save(suggestion)
            await uow.commit()

    async def _read(self, suggestion_id: str) -> CopilotSuggestion:
        async with self.uow() as uow:
            suggestion = await uow.copilot_suggestions.get(suggestion_id)
        if suggestion is None:
            raise NotFoundError("No encontramos la sugerencia.")
        return suggestion


# ----------------------------------------------------------------------------------- use cases
@dataclass(frozen=True, slots=True)
class RequestSuggestion:
    """``POST /cases/{caseId}/copilot/suggestions``: the analyst asks for one. It waits for the
    model. Idempotent on the request key: a retry of a request with an answer asks nothing."""

    service: SuggestionService
    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, case_id: str, *, request_key: str) -> SuggestionView:
        prepared = await self.service.prepare_manual(actor, case_id, request_key=request_key)
        suggestion = await self.service.produce(prepared, raise_errors=True)
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            stale = await _is_stale(uow, case, suggestion)
        return SuggestionView(suggestion, stale, replayed=prepared.replay is not None)


@dataclass(frozen=True, slots=True)
class GetLatestSuggestion:
    """``GET /cases/{caseId}/copilot/suggestions/latest``: the newest, or ``None`` (never made,
    or its texts expired). ``available`` False means hide the panel."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, case_id: str) -> LatestSuggestionView:
        ensure_any_role(actor, {StaffRole.ANALYST})
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            if await uow.bank_links.get(case.customer_id) is None:
                return LatestSuggestionView(available=False, latest=None)
            latest = await uow.copilot_suggestions.latest_for(case.id, actor.staff_id)
            if latest is None or latest.purged_at is not None:
                return LatestSuggestionView(available=True, latest=None)
            if latest.is_expired(self.clock.now()):
                return LatestSuggestionView(available=True, latest=None)
            stale = await _is_stale(uow, case, latest)
        return LatestSuggestionView(available=True, latest=SuggestionView(latest, stale))


@dataclass(frozen=True, slots=True)
class DecideSuggestion:
    """``POST …/suggestions/{id}/feedback``: the analyst dismissed the draft."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, case_id: str, suggestion_id: str, *, decision: str
    ) -> SuggestionView:
        ensure_any_role(actor, {StaffRole.ANALYST})
        if decision not in ("discarded", "ignored"):
            raise InvalidValueError("Elige descartar o ignorar.", field="decision")
        return await retry_on_conflict(
            partial(self._attempt, actor, case_id, suggestion_id, decision)
        )

    async def _attempt(
        self, actor: Actor, case_id: str, suggestion_id: str, decision: str
    ) -> SuggestionView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            suggestion = await _mine(uow, case, actor, suggestion_id)
            now = self.clock.now()
            changed = (
                suggestion.discard_reply(at=now)
                if decision == "discarded"
                else suggestion.ignore_reply(at=now)
            )
            if changed:
                await uow.copilot_suggestions.save(suggestion)
                await uow.commit()
            stale = await _is_stale(uow, case, suggestion)
        return SuggestionView(suggestion, stale)


@dataclass(frozen=True, slots=True)
class LinkSuggestion:
    """What the analyst did with a suggestion, derived from what she sent: a message that came
    from the draft (``used`` or ``edited``), or an escalation that took the recommendation.
    Best effort by design: a wrong or already decided id never fails the send or the escalation."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def reply_sent(
        self, actor: Actor, case_id: str, suggestion_id: str, *, sent_text: str
    ) -> bool:
        return await retry_on_conflict(
            partial(self._attempt, actor, case_id, suggestion_id, sent_text)
        )

    async def escalated(self, actor: Actor, case_id: str, suggestion_id: str) -> bool:
        return await retry_on_conflict(partial(self._attempt, actor, case_id, suggestion_id, None))

    async def _attempt(
        self, actor: Actor, case_id: str, suggestion_id: str, sent_text: str | None
    ) -> bool:
        async with self.uow() as uow:
            suggestion = await uow.copilot_suggestions.get(suggestion_id)
            if (
                suggestion is None
                or suggestion.case_id != case_id
                or suggestion.analyst_id != actor.staff_id
            ):
                return False
            now = self.clock.now()
            changed = (
                suggestion.escalation_taken(at=now)
                if sent_text is None
                else suggestion.reply_sent(sent_text=sent_text, at=now)
            )
            if changed:
                await uow.copilot_suggestions.save(suggestion)
                await uow.commit()
            return changed


@dataclass(frozen=True, slots=True)
class PurgeSuggestionDrafts:
    """The sweep (ADR 0005 §7): a draft is kept 24 hours at most; then every text goes."""

    uow: UnitOfWorkFactory
    clock: Clock
    batch: int = 100

    async def execute(self) -> int:
        now = self.clock.now()
        async with self.uow() as uow:
            due = await uow.copilot_suggestions.list_expired(
                created_before=now - DRAFT_TTL, limit=self.batch
            )
            purged = 0
            for suggestion in due:
                if suggestion.purge(at=now):
                    await uow.copilot_suggestions.save(suggestion)
                    purged += 1
            if purged:
                await uow.commit()
        return purged


# ----------------------------------------------------------------------------------- helpers
async def _mine(uow: UnitOfWork, case: Case, actor: Actor, suggestion_id: str) -> CopilotSuggestion:
    suggestion = await uow.copilot_suggestions.get(suggestion_id)
    if (
        suggestion is None
        or suggestion.case_id != case.id
        or suggestion.analyst_id != actor.staff_id
    ):
        raise NotFoundError("No encontramos la sugerencia.")
    return suggestion


async def _is_stale(uow: UnitOfWork, case: Case, suggestion: CopilotSuggestion) -> bool:
    """The customer wrote after the last turn the suggestion read."""
    if case.last_sequence <= suggestion.based_on_sequence:
        return False
    newer = await uow.turns.page(case.id, limit=50, after=suggestion.based_on_sequence)
    return any(t.author_role is TurnAuthorRole.CUSTOMER and t.kind in _SPEECH_KINDS for t in newer)
