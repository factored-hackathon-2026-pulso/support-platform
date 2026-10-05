"""Escalations to supervision (slice 9 contract): the assignee asks supervision for help on a
case she holds; supervision answers, takes the case, or reassigns it.

Grounded only in the dataset's ``was_escalated`` (yes/no): a motive and what supervision did.
No escalation types, amounts, limits, levels or deadlines.

Commands (each one a ``retry_on_conflict`` body that re-checks its rules on fresh state; the
case and the escalation are both saved with their compare-and-set, and every command that
opens or ends an escalation writes a staff banner in the transcript, so concurrent commands
on the same case serialise on the case's ``version``):

- ``EscalateCase``: the assignee (Analista), on an open assigned case without an open
  escalation (409 ``escalation_open``); a required motive (≤ 500). The case stays hers.
  ``Idempotency-Key``: a retry of the same request replays the escalation it created.
- ``WithdrawEscalation``: the assignee, while it is open (409 ``escalation_not_open``).
- ``RespondEscalation``: Supervisión, while it is open, with a required note (≤ 500): the
  case stays with the analyst, who sees the answer live.
- ``TakeEscalatedCase``: Supervisión takes the case herself, **only** if she also holds
  Analista, is active and speaks the case language (rule 3): otherwise 422
  ``analyst_not_eligible`` / ``language_mismatch`` (the UI does not offer it). It is a
  reassignment to her (``hand_over``: banner, customer notice, ``case.assigned``); a paused
  supervisor needs no confirmation (she chose herself).
- Reassigning the case (``SetCaseAssignee``) ends an open escalation as ``reassigned``.
- ``AcknowledgeEscalation``: the analyst who escalated read what supervision did
  ("Entendido"); repeating it is a no-op.

Query: ``GetEscalationOverview`` ("Escalados"): the open escalations (the longest waiting
first) and the ones supervision attended in the last 24 hours (the most recent first).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from cc_platform.application.cases import staff_lines
from cc_platform.application.cases.dto import CaseSummaryView, EscalationView
from cc_platform.application.cases.errors import AnalystNotEligibleError, CaseNotAssignedError
from cc_platform.application.cases.manual_assignment import eligible_analyst, hand_over
from cc_platform.application.cases.queries import load_case_for
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.cases.staff_lines import Banner
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.assignment import ensure_speaks_case_language
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import CaseClosedError, EscalationNotOpenError
from cc_platform.domain.cases.escalation import (
    ATTENDED_STATES,
    Escalation,
    EscalationState,
    normalize_escalation_text,
)
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import TurnAudience, TurnAuthorRole, TurnKind
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

#: Team-generated: "Atendidos hoy" lists what supervision attended in the last 24 hours
#: (the screen keeps the viewer's own day).
ATTENDED_WINDOW = timedelta(hours=24)


@dataclass(frozen=True, slots=True)
class EscalateCommand:
    motive: str
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class EscalationResult:
    escalation: EscalationView
    case: CaseSummaryView
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class EscalationItemView:
    """A row of "Escalados": the escalation, its case and who holds the case now."""

    escalation: EscalationView
    case: CaseSummaryView
    assignee_name: str | None
    can_take: bool
    """The viewer may take the case herself (Supervisión + Analista + speaks its language,
    the escalation is open and the case is someone else's)."""


@dataclass(frozen=True, slots=True)
class EscalationOverviewView:
    items: tuple[EscalationItemView, ...]
    open_count: int
    server_time: datetime


async def _load_escalation(
    uow: UnitOfWork, case_id: str | None, escalation_id: str
) -> tuple[Escalation, Case]:
    """The escalation and its case; unknown or mismatched ids → 404 ``not_found``."""
    escalation = (
        await uow.escalations.get(escalation_id)
        if is_valid_id(escalation_id, IdPrefix.ESCALATION)
        else None
    )
    if escalation is None or (case_id is not None and escalation.case_id != case_id):
        raise NotFoundError("No encontramos ese escalamiento.", escalationId=escalation_id)
    case = await uow.cases.get(escalation.case_id)
    if case is None:  # pragma: no cover - foreign key
        raise NotFoundError("No encontramos ese caso.", caseId=escalation.case_id)
    return escalation, case


async def _result(
    reader: CaseReader, escalation: Escalation, case: Case, *, replayed: bool = False
) -> EscalationResult:
    return EscalationResult(
        escalation=await reader.escalation_view(escalation, case),
        case=await reader.summary(case),
        replayed=replayed,
    )


def _staff_banner(case: Case, ids: IdGenerator, banner: Banner, at: datetime) -> Turn:
    """A staff-only line in the transcript (never sent to the customer), with its facts."""
    return case.append_turn(
        turn_id=ids.new_id(IdPrefix.TURN),
        kind=TurnKind.ROUTING,
        audience=TurnAudience.STAFF,
        author_role=TurnAuthorRole.SYSTEM,
        author_id=None,
        text=banner.text,
        created_at=at,
        staff_line=banner.line,
    )


async def _store(uow: UnitOfWork, case: Case, escalation: Escalation, turn: Turn) -> None:
    await uow.cases.save(case)
    await uow.escalations.save(escalation)
    await uow.turns.add(turn)


# ----------------------------------------------------------------------------- analyst side
@dataclass(frozen=True, slots=True)
class EscalateCase:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, case_id: str, command: EscalateCommand
    ) -> EscalationResult:
        motive = normalize_escalation_text(command.motive, field="motive")
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, motive, command))

    async def _attempt(
        self, actor: Actor, case_id: str, motive: str, command: EscalateCommand
    ) -> EscalationResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            reader = CaseReader(uow)
            replay = await uow.escalations.get_by_creation_key(command.idempotency_key)
            if replay is not None:
                if replay.case_id != case.id or replay.escalated_by_id != actor.staff_id:
                    raise InvalidValueError(
                        "Esa clave ya se usó para otro escalamiento.", field="Idempotency-Key"
                    )
                return await _result(reader, replay, case, replayed=True)
            now = self.clock.now()
            escalation = Escalation.open(
                escalation_id=self.ids.new_id(IdPrefix.ESCALATION),
                case_id=case.id,
                motive=motive,
                actor=actor.acting_as({StaffRole.ANALYST}),
                at=now,
                creation_key=command.idempotency_key,
            )
            case.escalate(escalation.id)  # closed, queued or already escalated → error
            turn = _staff_banner(case, self.ids, staff_lines.escalated(actor.name), now)
            await uow.cases.save(case)
            await uow.escalations.add(escalation)
            await uow.turns.add(turn)
            result = await _result(reader, escalation, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class WithdrawEscalation:
    """The assignee withdraws her open escalation ("Retirar escalamiento")."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, case_id: str, escalation_id: str) -> EscalationResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, escalation_id))

    async def _attempt(self, actor: Actor, case_id: str, escalation_id: str) -> EscalationResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            escalation, case = await _load_escalation(uow, case.id, escalation_id)
            if not case.is_assignee(actor.staff_id):  # pragma: no cover - re-read guard
                raise CaseNotAssignedError()
            now = self.clock.now()
            escalation.withdraw(actor=actor.acting_as({StaffRole.ANALYST}), at=now)
            case.clear_escalation(escalation.id)
            turn = _staff_banner(case, self.ids, staff_lines.escalation_withdrawn(actor.name), now)
            await _store(uow, case, escalation, turn)
            result = await _result(CaseReader(uow), escalation, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class AcknowledgeEscalation:
    """The analyst who escalated read what supervision did ("Entendido"). Idempotent."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, case_id: str, escalation_id: str) -> EscalationResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, escalation_id))

    async def _attempt(self, actor: Actor, case_id: str, escalation_id: str) -> EscalationResult:
        async with self.uow() as uow:
            await load_case_for(uow, actor, case_id, write=False)
            escalation, case = await _load_escalation(uow, case_id, escalation_id)
            if escalation.escalated_by_id != actor.staff_id:
                raise CaseNotAssignedError("Solo quien escaló el caso puede marcarlo como leído.")
            changed = escalation.acknowledge(
                actor=actor.acting_as({StaffRole.ANALYST}), at=self.clock.now()
            )
            if changed:
                await uow.escalations.save(escalation)
            result = await _result(CaseReader(uow), escalation, case)
            await uow.commit()
        return result


# ----------------------------------------------------------------------------- supervision side
@dataclass(frozen=True, slots=True)
class RespondEscalation:
    """Supervisión answers with a note; the case stays with the analyst."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, escalation_id: str, note: str) -> EscalationResult:
        clean = normalize_escalation_text(note, field="note")
        return await retry_on_conflict(lambda: self._attempt(actor, escalation_id, clean))

    async def _attempt(self, actor: Actor, escalation_id: str, note: str) -> EscalationResult:
        async with self.uow() as uow:
            escalation, case = await _load_escalation(uow, None, escalation_id)
            if not escalation.is_open:
                raise EscalationNotOpenError(escalation.state.value)
            now = self.clock.now()
            escalation.answer(actor=actor.acting_as({StaffRole.SUPERVISOR}), note=note, at=now)
            case.clear_escalation(escalation.id)
            turn = _staff_banner(case, self.ids, staff_lines.escalation_answered(actor.name), now)
            await _store(uow, case, escalation, turn)
            result = await _result(CaseReader(uow), escalation, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class TakeEscalatedCase:
    """Supervisión takes the escalated case herself: only someone who also holds Analista,
    is active and speaks the case language (rule 3). A reassignment to her."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, escalation_id: str) -> EscalationResult:
        return await retry_on_conflict(lambda: self._attempt(actor, escalation_id))

    async def _attempt(self, actor: Actor, escalation_id: str) -> EscalationResult:
        async with self.uow() as uow:
            escalation, case = await _load_escalation(uow, None, escalation_id)
            if case.is_closed:
                raise CaseClosedError()
            if not escalation.is_open:
                raise EscalationNotOpenError(escalation.state.value)
            me = await eligible_analyst(uow, actor.staff_id)
            ensure_speaks_case_language(case.language, me.id, me.languages)
            if case.is_assignee(me.id):
                raise AnalystNotEligibleError(me.id)  # her own case: nothing to take
            availability = await uow.availability.get(me.id)
            paused = availability is None or not availability.is_available
            reader = CaseReader(uow)
            await hand_over(
                uow, reader, actor, case, me, paused=paused, now=self.clock.now(),
                ids=self.ids, take=True,
            )  # fmt: skip
            taken = await uow.escalations.get(escalation.id)
            if taken is None:  # pragma: no cover - saved just above
                raise NotFoundError("No encontramos ese escalamiento.", escalationId=escalation_id)
            result = await _result(reader, taken, case)
            await uow.commit()
        return result


def can_take(actor: Actor, languages: frozenset[str], escalation: Escalation, case: Case) -> bool:
    """Whether ``TakeEscalatedCase`` would accept the viewer (the "Tomar el caso" button)."""
    return (
        escalation.is_open
        and actor.has_any_role({StaffRole.ANALYST})
        and case.language.value in languages
        and not case.is_assignee(actor.staff_id)
    )


@dataclass(frozen=True, slots=True)
class GetEscalationOverview:
    """ "Escalados": open first (the longest waiting first), then the ones supervision
    attended in the last 24 hours (the most recent first). Withdrawn ones and those that
    ended with the case are not listed (they stay in the audit)."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor) -> EscalationOverviewView:
        now = self.clock.now()
        async with self.uow() as uow:
            found = await uow.escalations.list_open_or_resolved_since(now - ATTENDED_WINDOW)
            listed = [e for e in found if e.is_open or e.state in ATTENDED_STATES]
            cases = await uow.cases.get_many({e.case_id for e in listed})
            me = await uow.staff.get(actor.staff_id)
            languages = (
                frozenset(lang.value for lang in me.languages)
                if me is not None and me.active
                else frozenset()
            )
            reader = CaseReader(uow)
            items = []
            for escalation in sorted(listed, key=_overview_order):
                case = cases.get(escalation.case_id)
                if case is None:  # pragma: no cover - foreign key
                    continue
                assignee = case.assigned_analyst_id
                items.append(
                    EscalationItemView(
                        escalation=await reader.escalation_view(escalation, case),
                        case=await reader.summary(case),
                        assignee_name=await reader.staff_name(assignee) if assignee else None,
                        can_take=can_take(actor, languages, escalation, case),
                    )
                )
        open_count = sum(item.escalation.state is EscalationState.OPEN for item in items)
        return EscalationOverviewView(items=tuple(items), open_count=open_count, server_time=now)


def _overview_order(escalation: Escalation) -> tuple[int, float, str]:
    if escalation.is_open:
        return (0, escalation.escalated_at.timestamp(), escalation.id)
    resolved = escalation.resolved_at or escalation.escalated_at
    return (1, -resolved.timestamp(), escalation.id)
