"""``NotificationProjector``: notifications derived from committed domain events (slice 10).

An event-bus subscriber like the realtime projectors. Each rule reads the event (and, when
needed, the case or the escalation as committed) and hands ``NotificationDraft``s to the
``NotificationWriter``; the source event id is the idempotency key, so a fact never notifies
the same person twice. Nobody is notified of her own action (``actor_id`` = recipient), and
only active people receive anything. No AI: every rule is a fixed mapping.

Rules (event → kind → recipients):

- ``case.assigned``, first assignment, ``language_least_loaded`` → ``assigned_on_arrival``
  (``customer_returned`` when the case continues a closed one) → the new assignee;
- ``case.assigned``, first assignment, ``queue_drained`` → ``assigned_from_queue`` (or
  ``customer_returned``) → the new assignee;
- ``case.assigned``, ``manual`` (from the queue or a reassignment) →
  ``assigned_by_supervisor`` → the new assignee;
- ``case.assigned`` with a previous analyst → ``reassigned_away`` → the previous analyst
  (not when an escalation of hers ended with it: the escalation kinds say it);
- ``escalation.answered`` / ``.taken`` / ``.reassigned`` → ``escalation_answered`` /
  ``escalation_taken`` / ``escalation_reassigned`` → who escalated;
- ``case.rated`` → ``case_rated`` → who closed the case;
- ``escalation.opened`` → ``case_escalated`` → every active Supervisión;
- ``case.queued`` → ``case_queued`` → every active Supervisión, only while the case still
  waits and no older case of its language waits (one per language until the queue empties);
- ``auth.account_locked`` → ``account_locked`` → every active Administración (not the
  locked person);
- ``staff.invitation_accepted`` (recorded by part 4) → ``invitation_accepted`` → every
  active Administración (not the new person).

``sla_at_risk`` has no source event: ``SweepSlaRisk`` (``sweep.py``) writes it.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import replace

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.events import EventRecord
from cc_platform.application.notifications.dto import people_of
from cc_platform.application.notifications.writer import (
    NotificationDraft,
    NotificationWriter,
    WrittenNotification,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.escalation import EscalationState
from cc_platform.domain.cases.events import (
    CaseAssigned,
    CaseQueued,
    CaseRated,
    EscalationAnswered,
    EscalationOpened,
    EscalationReassigned,
    EscalationTaken,
)
from cc_platform.domain.cases.values import AssignmentReason, CaseStatus
from cc_platform.domain.notifications.notification import NotificationKind
from cc_platform.domain.people.events import AccountLocked
from cc_platform.domain.people.staff import StaffRole

#: Recorded by part 4 (invitations) when an invited person activates her account;
#: ``entity_id`` is her staff id.
INVITATION_ACCEPTED_EVENT = "staff.invitation_accepted"

type Rule = Callable[[UnitOfWork, EventRecord], Awaitable[list[NotificationDraft]]]

_ARRIVAL_KIND: dict[str, NotificationKind] = {
    AssignmentReason.LANGUAGE_LEAST_LOADED.value: NotificationKind.ASSIGNED_ON_ARRIVAL,
    AssignmentReason.QUEUE_DRAINED.value: NotificationKind.ASSIGNED_FROM_QUEUE,
}

#: Escalation endings that move the case: the analyst hears it through the escalation kind.
_MOVING_ENDINGS = frozenset({EscalationState.TAKEN, EscalationState.REASSIGNED})


class NotificationProjector:
    def __init__(self, uow: UnitOfWorkFactory, writer: NotificationWriter) -> None:
        self._uow = uow
        self._writer = writer
        self._rules: dict[str, Rule] = {
            CaseAssigned.event_type: self._assigned,
            CaseQueued.event_type: self._queued,
            CaseRated.event_type: self._rated,
            EscalationOpened.event_type: self._escalated,
            EscalationAnswered.event_type: self._escalation_outcome,
            EscalationTaken.event_type: self._escalation_outcome,
            EscalationReassigned.event_type: self._escalation_outcome,
            AccountLocked.event_type: self._account_locked,
            INVITATION_ACCEPTED_EVENT: self._invitation_accepted,
        }

    @property
    def event_types(self) -> frozenset[str]:
        return frozenset(self._rules)

    async def __call__(self, record: EventRecord) -> None:
        rule = self._rules.get(record.event_type)
        if rule is None:
            return
        written = await retry_on_conflict(lambda: self._attempt(rule, record))
        await self._writer.publish(written)

    async def _attempt(self, rule: Rule, record: EventRecord) -> list[WrittenNotification]:
        """One Unit of Work: read what the rule needs, then write (a race re-runs both)."""
        async with self._uow() as uow:
            drafts = [await _deliverable(uow, record, draft) for draft in await rule(uow, record)]
            written = await self._writer.stage(uow, [d for d in drafts if d.recipients])
            if written:
                await uow.commit()
        return written

    # ------------------------------------------------------------------ analyst
    async def _assigned(self, uow: UnitOfWork, record: EventRecord) -> list[NotificationDraft]:
        event = record.event
        if not isinstance(event, CaseAssigned):  # pragma: no cover - routed by event type
            return []
        case = await uow.cases.get(event.entity_id)
        if case is None:
            return []
        assignee, previous = event.assigned_analyst_id, event.previous_analyst_id
        drafts: list[NotificationDraft] = []
        if previous is None and event.reason in _ARRIVAL_KIND:
            returned = case.previous_case_id is not None
            kind = NotificationKind.CUSTOMER_RETURNED if returned else _ARRIVAL_KIND[event.reason]
            drafts.append(case_draft(kind, (assignee,), record, case))
        elif event.reason == AssignmentReason.MANUAL.value:
            drafts.append(
                case_draft(
                    NotificationKind.ASSIGNED_BY_SUPERVISOR,
                    (assignee,),
                    record,
                    case,
                    actor_id=record.actor_id,
                )
            )
        if previous is not None and previous != assignee:
            escalation = await uow.escalations.latest_for_case(case.id)
            ended_with_it = (
                escalation is not None
                and escalation.state in _MOVING_ENDINGS
                and escalation.escalated_by_id == previous
                and escalation.resolved_at == event.occurred_at
            )
            if not ended_with_it:
                drafts.append(
                    case_draft(
                        NotificationKind.REASSIGNED_AWAY,
                        (previous,),
                        record,
                        case,
                        actor_id=record.actor_id,
                        target_id=assignee,
                    )
                )
        return drafts

    async def _escalation_outcome(
        self, uow: UnitOfWork, record: EventRecord
    ) -> list[NotificationDraft]:
        event = record.event
        kind: NotificationKind
        target: str | None = None
        if isinstance(event, EscalationAnswered):
            kind, analyst = NotificationKind.ESCALATION_ANSWERED, event.analyst_id
        elif isinstance(event, EscalationTaken):
            kind, analyst = NotificationKind.ESCALATION_TAKEN, event.previous_analyst_id
            target = event.analyst_id
        elif isinstance(event, EscalationReassigned):
            kind, analyst = NotificationKind.ESCALATION_REASSIGNED, event.previous_analyst_id
            target = event.analyst_id
        else:  # pragma: no cover - only the three outcomes are routed here
            return []
        case = await uow.cases.get(event.case_id) if event.case_id else None
        if case is None:
            return []
        return [
            case_draft(
                kind,
                (analyst,),
                record,
                case,
                actor_id=record.actor_id,
                target_id=target,
                escalation_id=event.entity_id,
            )
        ]

    async def _rated(self, uow: UnitOfWork, record: EventRecord) -> list[NotificationDraft]:
        event = record.event
        if not isinstance(event, CaseRated):  # pragma: no cover - routed by event type
            return []
        case = await uow.cases.get(event.entity_id)
        if case is None:
            return []
        return [
            case_draft(
                NotificationKind.CASE_RATED, (event.analyst_id,), record, case, score=event.score
            )
        ]

    # ------------------------------------------------------------------ supervision
    async def _escalated(self, uow: UnitOfWork, record: EventRecord) -> list[NotificationDraft]:
        event = record.event
        if not isinstance(event, EscalationOpened):  # pragma: no cover - routed by event type
            return []
        case = await uow.cases.get(event.case_id) if event.case_id else None
        if case is None:
            return []
        return [
            case_draft(
                NotificationKind.CASE_ESCALATED,
                await active_with_role(uow, StaffRole.SUPERVISOR),
                record,
                case,
                actor_id=event.analyst_id,
                escalation_id=event.entity_id,
            )
        ]

    async def _queued(self, uow: UnitOfWork, record: EventRecord) -> list[NotificationDraft]:
        """One per language while its queue is not empty: only the oldest waiting case of
        the language notifies (a case already assigned again notifies nobody)."""
        event = record.event
        if not isinstance(event, CaseQueued):  # pragma: no cover - routed by event type
            return []
        queued = await uow.cases.list_by_status(CaseStatus.QUEUED)
        case = next((c for c in queued if c.id == event.entity_id), None)
        if case is None:
            return []
        same_language = [c for c in queued if c.language is case.language]
        oldest = min(same_language, key=lambda c: (c.queued_at or c.opened_at, c.id))
        if oldest.id != case.id:
            return []
        recipients = await active_with_role(uow, StaffRole.SUPERVISOR)
        return [case_draft(NotificationKind.CASE_QUEUED, recipients, record, case)]

    # ------------------------------------------------------------------ administration
    async def _account_locked(
        self, uow: UnitOfWork, record: EventRecord
    ) -> list[NotificationDraft]:
        event = record.event
        if not isinstance(event, AccountLocked):  # pragma: no cover - routed by event type
            return []
        person = await uow.staff.get(event.entity_id)
        if person is None:  # unknown emails get lockout answers too, without an account
            return []
        return [
            NotificationDraft(
                kind=NotificationKind.ACCOUNT_LOCKED,
                recipients=await active_with_role(uow, StaffRole.ADMIN, besides=(person.id,)),
                created_at=record.event_time,
                source_key=record.event_id,
                target_id=person.id,
                failed_attempts=event.failed_attempts,
            )
        ]

    async def _invitation_accepted(
        self, uow: UnitOfWork, record: EventRecord
    ) -> list[NotificationDraft]:
        person = await uow.staff.get(record.entity_id)
        if person is None:
            return []
        return [
            NotificationDraft(
                kind=NotificationKind.INVITATION_ACCEPTED,
                recipients=await active_with_role(uow, StaffRole.ADMIN, besides=(person.id,)),
                created_at=record.event_time,
                source_key=record.event_id,
                actor_id=person.id,
                target_id=person.id,
            )
        ]


def case_draft(
    kind: NotificationKind,
    recipients: tuple[str, ...],
    record: EventRecord,
    case: Case,
    *,
    actor_id: str | None = None,
    target_id: str | None = None,
    escalation_id: str | None = None,
    score: int | None = None,
) -> NotificationDraft:
    """A draft about ``case`` from ``record`` (the event id is the idempotency key)."""
    return NotificationDraft(
        kind=kind,
        recipients=recipients,
        created_at=record.event_time,
        source_key=record.event_id,
        case_id=case.id,
        customer_id=case.customer_id,
        actor_id=actor_id,
        target_id=target_id,
        escalation_id=escalation_id,
        language=case.language,
        score=score,
    )


async def active_with_role(
    uow: UnitOfWork, role: StaffRole, *, besides: Iterable[str] = ()
) -> tuple[str, ...]:
    """Every active person holding ``role`` (staff order), minus ``besides``."""
    excluded = set(besides)
    return tuple(
        person.id
        for person in await people_of(uow)
        if person.active and person.has_role(role) and person.id not in excluded
    )


async def _deliverable(
    uow: UnitOfWork, record: EventRecord, draft: NotificationDraft
) -> NotificationDraft:
    """Only active people, never the actor of the fact."""
    if not draft.recipients:
        return draft
    active = {person.id for person in await people_of(uow) if person.active}
    recipients = tuple(
        staff_id
        for staff_id in draft.recipients
        if staff_id != record.actor_id and staff_id in active
    )
    return draft if recipients == draft.recipients else replace(draft, recipients=recipients)
