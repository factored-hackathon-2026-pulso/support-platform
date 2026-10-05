"""Manual assignment by a supervisor (slice 3 contract §3.3–§3.5): take a case out of the
language queue, or reassign an open case to another analyst.

``SetCaseAssignee`` is a ``PUT`` that sets a state, so it is safe to repeat: the whole body
runs in ``retry_on_conflict`` and every rule is re-evaluated, **in this order**, on the
freshly loaded case:

1. the case exists (404 ``not_found``);
2. it is not closed (409 ``case_closed``);
3. the target is an active analyst (422 ``analyst_not_eligible``);
4. the target speaks the case language (rule 3, ``H1``; 422 ``language_mismatch``);
5. the target already holds it → **no-op** (``changed: false``, no events, no save), which
   makes a network retry or two supervisors choosing the same person harmless;
6. the holder is still who the supervisor saw (``expected_analyst_id``; 409
   ``assignment_changed``);
7. a paused target needs ``confirm_paused`` (409 ``analyst_paused``).

Then, in one Unit of Work: an ``Assignment`` (``manual``, who assigned it, the previous
analyst, ``paused_override``), ``Case.assign`` (from the queue) or ``Case.reassign``, a
staff-only ``routing`` banner and, on a reassignment only, a customer ``notice`` in the case
language ("Ahora te atiende {Nombre}…"). From the queue the customer only sees the header
change ("Te atiende {nombre}") through ``conversation.updated``. The SLA is untouched.
Slice 9: reassigning a case with an open escalation ends it as ``reassigned`` (the analyst
who escalated no longer holds it); ``TakeEscalatedCase`` reuses ``hand_over`` (``taken``).

Races (contract §3.9) are settled by the case's compare-and-set: a customer message, a
reply, a close, the queue drain or a second supervisor either commits first (and this
command re-runs on fresh state) or loses to it and re-runs itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.cases import copy, staff_lines
from cc_platform.application.cases.assignment import language_rule
from cc_platform.application.cases.dto import AssignmentView, CaseSummaryView
from cc_platform.application.cases.errors import (
    AnalystNotEligibleError,
    AnalystPausedError,
    AssignmentChangedError,
)
from cc_platform.application.cases.read_model import CaseReader, first_name
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.assignment import Assignment, ensure_speaks_case_language
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import CaseClosedError
from cc_platform.domain.cases.escalation import Escalation
from cc_platform.domain.cases.values import (
    OPEN_ASSIGNED_STATUSES,
    AssignmentReason,
    CaseStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Staff, StaffRole
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

#: ``Assignment.strategy`` of a supervisor's choice (no strategy picked the analyst).
MANUAL_STRATEGY = "manual"


@dataclass(frozen=True, slots=True)
class SetAssigneeCommand:
    analyst_id: str
    expected_analyst_id: str | None
    """Who the supervisor saw holding the case (``None`` = it was queued)."""
    confirm_paused: bool = False


@dataclass(frozen=True, slots=True)
class AssignmentResultView:
    changed: bool
    case: CaseSummaryView
    assignment: AssignmentView


@dataclass(frozen=True, slots=True)
class SetCaseAssignee:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, case_id: str, command: SetAssigneeCommand
    ) -> AssignmentResultView:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, command))

    async def _attempt(
        self, actor: Actor, case_id: str, command: SetAssigneeCommand
    ) -> AssignmentResultView:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id) if is_valid_id(case_id, IdPrefix.CASE) else None
            if case is None:
                raise NotFoundError("No encontramos ese caso.", caseId=case_id)
            if case.is_closed:
                raise CaseClosedError()
            target = await eligible_analyst(uow, command.analyst_id)
            ensure_speaks_case_language(case.language, target.id, target.languages)
            reader = CaseReader(uow)
            if case.assigned_analyst_id == target.id:
                return await _unchanged(reader, case)
            if case.assigned_analyst_id != command.expected_analyst_id:
                raise AssignmentChangedError(case.assigned_analyst_id)
            availability = await uow.availability.get(target.id)
            paused = availability is None or not availability.is_available
            if paused and not command.confirm_paused:
                raise AnalystPausedError(target.id)

            assignment = await self._apply(uow, reader, actor, case, target, paused=paused)
            result = AssignmentResultView(
                changed=True,
                case=await reader.summary(case),
                assignment=await reader.assignment_view(case, assignment),
            )
            await uow.commit()
        return result

    async def _apply(
        self,
        uow: UnitOfWork,
        reader: CaseReader,
        actor: Actor,
        case: Case,
        target: Staff,
        *,
        paused: bool,
    ) -> Assignment:
        return await hand_over(
            uow, reader, actor, case, target, paused=paused, now=self.clock.now(), ids=self.ids
        )


async def hand_over(
    uow: UnitOfWork,
    reader: CaseReader,
    actor: Actor,
    case: Case,
    target: Staff,
    *,
    paused: bool,
    now: datetime,
    ids: IdGenerator,
    take: bool = False,
) -> Assignment:
    """Assign (from the queue) or reassign ``case`` to ``target`` as supervision, in the
    caller's Unit of Work: the ``Assignment`` row, the staff banner, the customer notice on a
    reassignment, and (slice 9) the end of an open escalation: ``reassigned`` or, when the
    supervisor takes it herself (``take``), ``taken``."""
    supervisor = actor.acting_as({StaffRole.SUPERVISOR})
    loads = await uow.cases.assignee_loads(OPEN_ASSIGNED_STATUSES)
    load = loads.get(target.id)
    from_queue = case.status is CaseStatus.QUEUED
    previous = case.assigned_analyst_id
    waited = (
        max(0, int((now - (case.queued_at or case.opened_at)).total_seconds()))
        if from_queue
        else None
    )
    assignment = Assignment(
        id=ids.new_id(IdPrefix.ASSIGNMENT),
        case_id=case.id,
        staff_id=target.id,
        reason=AssignmentReason.MANUAL,
        policy_rule_id=language_rule(case.language),
        open_cases_at_assignment=load.open_cases if load else 0,
        strategy=MANUAL_STRATEGY,
        assigned_at=now,
        assigned_by=supervisor,
        waited_seconds=waited,
        previous_staff_id=previous,
        paused_override=paused,
    )
    paused_name = first_name(target.name) if paused else None
    if waited is not None:
        case.assign(assignment)
        label = case.queue_label or copy.QUEUE_LABEL[case.language]
        banner = staff_lines.manually_assigned_from_queue(
            actor.name,
            target.name,
            copy.queue_wait_minutes(waited),
            label,
            case.language,
            paused_first_name=paused_name,
        )
    else:
        case.reassign(assignment)
        previous_name = (await reader.staff_name(previous) if previous else None) or ""
        if take:
            banner = staff_lines.escalation_taken(actor.name, previous_name)
        else:
            banner = staff_lines.reassigned(
                actor.name, previous_name, target.name, paused_first_name=paused_name
            )
    escalation = await _end_open_escalation(uow, case, supervisor, target, now=now, take=take)
    turns = [
        case.append_turn(
            turn_id=ids.new_id(IdPrefix.TURN),
            kind=TurnKind.ROUTING,
            audience=TurnAudience.STAFF,
            author_role=TurnAuthorRole.SYSTEM,
            author_id=None,
            text=banner.text,
            created_at=now,
            staff_line=banner.line,
        )
    ]
    if waited is None:
        turns.append(
            case.append_turn(
                turn_id=ids.new_id(IdPrefix.TURN),
                kind=TurnKind.NOTICE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.SYSTEM,
                author_id=None,
                text=copy.reassigned_notice(case.language, first_name(target.name)),
                created_at=now,
            )
        )
    await uow.cases.save(case)
    if escalation is not None:
        await uow.escalations.save(escalation)
    for turn in turns:
        await uow.turns.add(turn)
    await uow.assignments.add(assignment)
    return assignment


async def _end_open_escalation(
    uow: UnitOfWork,
    case: Case,
    supervisor: ActorRef,
    target: Staff,
    *,
    now: datetime,
    take: bool,
) -> Escalation | None:
    """Slice 9: the analyst who escalated no longer holds the case, so its open escalation
    ends here (``taken`` or ``reassigned``)."""
    escalation_id = case.open_escalation_id
    if escalation_id is None:
        return None
    escalation = await uow.escalations.get(escalation_id)
    case.clear_escalation(escalation_id)
    if escalation is None or not escalation.is_open:  # pragma: no cover - pointer drift guard
        return None
    if take:
        escalation.take(actor=supervisor, at=now)
    else:
        escalation.mark_reassigned(actor=supervisor, to_staff_id=target.id, at=now)
    return escalation


async def eligible_analyst(uow: UnitOfWork, analyst_id: str) -> Staff:
    """Rule 3 of §3.3: an existing, active staff member holding ``analyst``."""
    staff = await uow.staff.get(analyst_id) if is_valid_id(analyst_id, IdPrefix.STAFF) else None
    if staff is None or not staff.active or not staff.has_role(StaffRole.ANALYST):
        raise AnalystNotEligibleError(analyst_id)
    return staff


async def _unchanged(reader: CaseReader, case: Case) -> AssignmentResultView:
    """The target already holds the case: a harmless no-op (no events, no save)."""
    assignment = await reader.assignment(case)
    if assignment is None:  # pragma: no cover - an assigned case always has its row
        raise NotFoundError("El caso no tiene asignación.", caseId=case.id)
    return AssignmentResultView(
        changed=False, case=await reader.summary(case), assignment=assignment
    )
