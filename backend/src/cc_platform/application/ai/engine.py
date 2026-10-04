"""``AssistantEngine``: runs the conversation of a case with agent-core (ADR 0003 §3-5).

``run_case`` is a job: it sends the customer's pending inputs to the agent, one at a time,
and applies each answer to the case. Three rules shape it:

- **No Unit of Work spans a call to agent-core.** A turn takes as long as the model. The job
  claims an input in a short unit (a compare-and-set on the session makes the claim exclusive),
  calls agent-core with no transaction open, then applies the answer in another unit.
- **A call that goes wrong never leaves the customer in silence.** agent-core unreachable,
  refusing, or ending its run without resolving: the case goes to the language queue and
  ``AssignCase`` places it like any arrival (rule 3), with a staff banner that says why.
- **Replays are harmless.** The ``client_turn_id`` is the platform turn id (and the run's
  idempotency key the session id): agent-core answers a repeated call from its own record.

The agent's answer becomes ``assistant`` turns (public). They are never a first response: the
first-response SLA is a person's and starts when the case reaches the queue.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from datetime import datetime
from functools import partial

from cc_platform.application.ai.config import AssistantConfig
from cc_platform.application.ai.credentials import AgentCredentialIssuer
from cc_platform.application.ai.runtime import (
    AgentOutcome,
    AgentRun,
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    AgentTurn,
)
from cc_platform.application.cases import copy
from cc_platform.application.cases.assignment import AssignCase
from cc_platform.application.cases.sla import SlaPolicy
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.ai.errors import AssistantBusyError
from cc_platform.domain.ai.session import (
    AgentInput,
    AssistantSession,
    PendingConfirmation,
    PendingStepUp,
)
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.turn import MAX_TURN_TEXT
from cc_platform.domain.cases.values import (
    AssignmentReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.ids import IdPrefix

#: How many unanswered customer messages one claim looks at (a flood is answered in rounds).
_PENDING_WINDOW = 50


@dataclass(frozen=True, slots=True)
class _Work:
    """One input claimed for agent-core, with everything the call needs (no UoW)."""

    session_id: str
    case_id: str
    bank_customer_id: str
    language: Language
    channel: str
    entry_agent: str
    agent_session_id: str | None
    chosen: AgentInput
    text: str
    step_up_at: datetime | None


@dataclass(frozen=True, slots=True)
class _Result:
    turn: AgentTurn | None = None
    started: AgentRun | None = None
    failure: str | None = None


def _agent_ref(session: AssistantSession) -> str:
    return session.agent or session.entry_agent


@dataclass(frozen=True, slots=True)
class AssistantHandover:
    """Takes a case out of the agent's hands: ``with_assistant → queued``, a staff banner, a
    notice for the customer when the agent did not already say it, and ``AssignCase``."""

    clock: Clock
    ids: IdGenerator
    sla: SlaPolicy
    assign_case: AssignCase

    async def to_people(
        self,
        uow: UnitOfWork,
        case: Case,
        *,
        reason: str,
        actor: ActorRef,
        ref: str | None = None,
        code: str | None = None,
        who: str | None = None,
        notify_customer: bool = True,
    ) -> bool:
        """Release ``case`` and place it. Returns True when an analyst got it now."""
        now = self.clock.now()
        case.release_from_assistant(
            actor=actor,
            at=now,
            sla_due_at=self.sla.due_at(opened_at=now),
            reason=reason,
            handoff_ref=ref,
        )
        banner = case.append_turn(
            turn_id=self.ids.new_id(IdPrefix.TURN),
            kind=TurnKind.ROUTING,
            audience=TurnAudience.STAFF,
            author_role=TurnAuthorRole.SYSTEM,
            author_id=None,
            text=copy.assistant_released(reason, ref=ref, code=code, who=who),
            created_at=now,
        )
        await uow.turns.add(banner)
        if notify_customer:
            notice = case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.NOTICE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.SYSTEM,
                author_id=None,
                text=copy.assistant_handover_notice(case.language),
                created_at=now,
            )
            await uow.turns.add(notice)
        await uow.cases.save(case)
        return await self.assign_case.place(uow, case, reason=AssignmentReason.ASSISTANT_HANDOFF)


@dataclass(frozen=True, slots=True)
class AssistantEngine:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer
    handover: AssistantHandover
    config: AssistantConfig

    # ------------------------------------------------------------------ the job
    async def run_case(self, case_id: str) -> int:
        """Send every pending input of the case to the agent; returns how many were sent."""
        sent = 0
        for _ in range(self.config.max_agent_rounds):
            work = await retry_on_conflict(partial(self._claim, case_id))
            if work is None:
                break
            sent += 1
            try:
                result = await self._call_agent(work)
                await retry_on_conflict(partial(self._apply, work, result))
            except Exception:  # never leave the customer waiting on a bug
                await self._recover(case_id, code="internal_error")
                raise  # and let the background runner log it
        return sent

    # ------------------------------------------------------------------ claim
    async def _claim(self, case_id: str) -> _Work | None:
        async with self.uow() as uow:
            session = await uow.assistant_sessions.get_by_case(case_id)
            case = await uow.cases.get(case_id)
            if (
                session is None
                or case is None
                or not (session.is_active and case.is_with_assistant)
            ):
                return None
            now = self.clock.now()
            pending = await self._unprocessed(uow, case_id, session.processed_sequence)
            chosen = session.select_input(
                [(turn_sequence, turn_id) for turn_sequence, turn_id, _ in pending],
                now=now,
                claim_timeout=self.config.claim_timeout,
            )
            if chosen is None:
                return None
            bank_id = await uow.bank_links.get(session.customer_id)
            text = await self._text_of(uow, case_id, chosen, pending)
            if bank_id is None:  # linked at open; a missing link now is a configuration fault
                await self._fail_in_unit(uow, session, case, code="no_bank_link")
                await uow.commit()
                return None
            session.claim_input(chosen, now=now)
            await uow.assistant_sessions.save(session)
            work = _Work(
                session_id=session.id,
                case_id=case_id,
                bank_customer_id=bank_id,
                language=case.language,
                channel=case.channel.value,
                entry_agent=session.entry_agent,
                agent_session_id=session.agent_session_id,
                chosen=chosen,
                text=text,
                step_up_at=session.step_up_verified_at if session.step_up_valid(now) else None,
            )
            await uow.commit()
        return work

    async def _unprocessed(
        self, uow: UnitOfWork, case_id: str, after: int
    ) -> list[tuple[int, str, str]]:
        """The customer's messages after ``after`` as ``(sequence, turn id, text)``."""
        turns = await uow.turns.page(
            case_id, limit=_PENDING_WINDOW, after=after, audience=TurnAudience.EVERYONE
        )
        return [
            (turn.sequence, turn.id, turn.text)
            for turn in turns
            if turn.author_role is TurnAuthorRole.CUSTOMER and turn.kind is TurnKind.MESSAGE
        ]

    async def _text_of(
        self,
        uow: UnitOfWork,
        case_id: str,
        chosen: AgentInput,
        pending: list[tuple[int, str, str]],
    ) -> str:
        if chosen.kind != "text" or chosen.sequence is None:
            return ""
        for sequence, _turn_id, text in pending:
            if sequence == chosen.sequence:
                return text
        # a message already processed once (resent after a step-up): read it back
        turns = await uow.turns.page(case_id, limit=1, after=chosen.sequence - 1)
        return turns[0].text if turns and turns[0].sequence == chosen.sequence else ""

    # ------------------------------------------------------------------ the call (no UoW)
    async def _call_agent(self, work: _Work) -> _Result:
        credentials = self.issuer.customer(
            bank_customer_id=work.bank_customer_id,
            session_id=work.session_id,
            step_up_at=work.step_up_at,
        )
        try:
            started: AgentRun | None = None
            agent_session_id = work.agent_session_id
            if agent_session_id is None:
                started = await self.runtime.start_run(
                    credentials,
                    agent=work.entry_agent,
                    idempotency_key=work.session_id,
                    lang=work.language.value,
                )
                if started.session_id is None:
                    return _Result(failure="no_agent_session")
                agent_session_id = started.session_id
            turn = await self.runtime.post_turn(
                credentials,
                session_id=agent_session_id,
                client_turn_id=work.chosen.client_turn_id,
                channel=work.channel,
                text=work.text,
                confirm_token=work.chosen.token,
                confirm_answer=work.chosen.answer,
                lang=work.language.value,
            )
        except AgentRuntimeUnavailableError:
            return _Result(failure="unavailable")
        except AgentRuntimeError as error:
            return _Result(failure=error.code)
        return _Result(turn=turn, started=started)

    # ------------------------------------------------------------------ apply the answer
    async def _apply(self, work: _Work, result: _Result) -> None:
        async with self.uow() as uow:
            session = await uow.assistant_sessions.get(work.session_id)
            case = await uow.cases.get(work.case_id)
            if session is None or case is None:
                return
            if not (session.is_active and case.is_with_assistant):
                return  # a supervisor took the case meanwhile: the answer is moot
            if result.failure is not None or result.turn is None:
                await self._fail_in_unit(uow, session, case, code=result.failure or "no_answer")
                await uow.commit()
                return
            try:
                await self._apply_answer(
                    uow, session, case, work=work, turn=result.turn, started=result.started
                )
            except AssistantBusyError:
                return  # a job that took over a stale claim already applied this answer
            await uow.commit()

    async def _apply_answer(
        self,
        uow: UnitOfWork,
        session: AssistantSession,
        case: Case,
        *,
        work: _Work,
        turn: AgentTurn,
        started: AgentRun | None,
    ) -> None:
        now = self.clock.now()
        if started is not None and started.session_id is not None:
            session.link_run(
                agent_session_id=started.session_id,
                run_id=started.run_id,
                agent=work.entry_agent,
                at=now,
            )
        agent = turn.agent or _agent_ref(session)
        written = 0
        # agent-core may ask for a confirmation with no message of its own (the question is the
        # confirmation's summary): the transcript still records what was asked.
        texts = [m.text for m in turn.messages]
        if not any(t.strip() for t in texts) and turn.confirmation is not None:
            texts = [turn.confirmation.action_summary]
        for raw in texts:
            text = raw.strip()[:MAX_TURN_TEXT]
            if not text:
                continue
            reply = case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.MESSAGE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.ASSISTANT,
                author_id=agent,
                text=text,
                created_at=now,
            )
            await uow.turns.add(reply)
            written += 1
        session.apply_answer(
            turn_id=work.chosen.turn_id,
            at=now,
            awaiting=turn.awaiting.value,
            status=turn.status,
            trace_id=turn.trace_id,
            messages=written,
            run_id=turn.run_id,
            agent=agent,
            outcome=turn.outcome.value if turn.outcome else None,
            confirmation=(
                None
                if turn.confirmation is None
                else PendingConfirmation(
                    token=turn.confirmation.token,
                    summary=turn.confirmation.action_summary,
                    expires_at=turn.confirmation.expires_at,
                )
            ),
            step_up=(
                None
                if turn.step_up is None
                else PendingStepUp(reason=turn.step_up.reason, simulated=turn.step_up.simulated)
            ),
        )
        await uow.cases.save(case)
        await self._dispose(uow, session, case, turn, agent=agent)
        await uow.assistant_sessions.save(session)

    async def _dispose(
        self,
        uow: UnitOfWork,
        session: AssistantSession,
        case: Case,
        turn: AgentTurn,
        *,
        agent: str,
    ) -> None:
        """What the agent's answer means for the case: carry on, close it, or hand it over."""
        now = self.clock.now()
        actor = ActorRef(ActorRole.ASSISTANT, agent)
        if turn.escalated and turn.handoff_ref is not None:
            session.escalate(handoff_ref=turn.handoff_ref, at=now)
            await self.handover.to_people(
                uow,
                case,
                reason="escalated",
                actor=actor,
                ref=turn.handoff_ref,
                notify_customer=False,
            )
            return
        if turn.status == "open":
            return
        if turn.outcome is AgentOutcome.RESOLVED:
            session.resolve(at=now)
            notice = case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.NOTICE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.SYSTEM,
                author_id=None,
                text=copy.NOTICE_CLOSED[case.language],
                created_at=now,
            )
            await uow.turns.add(notice)
            case.close_by_assistant(actor=actor, at=now)
            await uow.cases.save(case)
            slot = await uow.case_slots.get(case.customer_id)
            if slot is not None and slot.open_case_id == case.id:
                slot.release(case.id)
                await uow.case_slots.save(slot)
            return
        code = turn.outcome.value if turn.outcome else turn.status
        session.end_without_resolution(at=now, outcome=code)
        await self.handover.to_people(uow, case, reason="ended", actor=actor, code=code)

    # ------------------------------------------------------------------ failures
    async def _fail_in_unit(
        self, uow: UnitOfWork, session: AssistantSession, case: Case, *, code: str
    ) -> None:
        """agent-core could not serve the case: it goes to people (inside ``uow``)."""
        session.fail(at=self.clock.now(), code=code)
        await uow.assistant_sessions.save(session)
        await self.handover.to_people(
            uow,
            case,
            reason="failed",
            actor=ActorRef(ActorRole.ASSISTANT, _agent_ref(session)),
            code=code,
        )

    async def _recover(self, case_id: str, *, code: str) -> None:
        """Last resort after an unexpected error: hand the case to people, best effort."""
        with contextlib.suppress(Exception):  # the original error is the one worth logging
            await retry_on_conflict(partial(self._recover_once, case_id, code))

    async def _recover_once(self, case_id: str, code: str) -> None:
        async with self.uow() as uow:
            session = await uow.assistant_sessions.get_by_case(case_id)
            case = await uow.cases.get(case_id)
            if session is None or case is None:
                return
            if not (session.is_active and case.is_with_assistant):
                return
            await self._fail_in_unit(uow, session, case, code=code)
            await uow.commit()
