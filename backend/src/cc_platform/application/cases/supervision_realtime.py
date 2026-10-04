"""``SupervisionRealtimeProjector``: realtime signals of "Equipo y colas" (slice 3 §7).

Subscribed to the bus like ``CaseRealtimeProjector`` and built the same way (payloads come
from a presenter that renders the REST schemas). Sockets only *signal*: clients refetch
``GET /supervision/team`` and ``/supervision/queues``.

- ``queue.updated`` → ``supervision:queues`` (``QueueCounts``): after any committed case
  event whose case is ``queued`` after commit (a new message in a queued case changes the
  row), and after a ``case.assigned`` that took a case out of the queue (drained or assigned
  by hand, no previous analyst). A new case assigned on arrival never entered a queue and
  sends none.
- ``queue.case_queued`` → ``supervision:queues`` (``CaseSummary``): a case entered a queue
  (drives the "Un caso espera…" notice).
- ``team.updated`` → ``supervision:team`` (``{staffIds}``, the analysts whose row may have
  changed): a message in an assigned case, an assignment (new and previous analyst), a
  status change, a first response, a close, an availability change, an analyst's session
  starting or ending, (slice 7) a customer rating, for the analyst who closed the case
  ("Calificación 7 días"), (slice 8) a priority change, for the case's assignee (her open
  cases show it), and (slice 9) an escalation that opens or ends (the "Escalado" marker).
  A priority change of a queued case sends ``queue.updated`` like any other event of a
  queued case.

Slice 4 (administration) adds signals, no new envelope:

- ``team.updated`` after every administration event about an analyst (``staff.*``; an
  analyst before or after a roles change) and after ``team.renamed``/``team.deactivated``/
  ``team.reactivated`` (the team's active analysts; ``staffIds`` may be empty: clients
  refetch anyway);
- ``queue.updated`` after ``staff.roles_changed``, ``staff.languages_changed``,
  ``staff.deactivated`` and ``staff.reactivated`` (who could take a queued case changed:
  ``speakers``/``availableSpeakers``).

``case.viewed`` never reaches a socket, and ``auth.*`` events are never forwarded raw: they
only turn into ``team.updated`` ids.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from cc_platform.application.cases.dto import CaseSummaryView
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.cases.supervision import QueueCountsView, queue_counts
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.events import (
    CASE_EVENTS,
    ESCALATION_EVENTS,
    CaseAssigned,
    CaseClosed,
    CaseFirstResponded,
    CasePriorityChanged,
    CaseQueued,
    CaseRated,
    CaseStatusChanged,
    EscalationAcknowledged,
    TurnCreated,
)
from cc_platform.domain.cases.values import AssignmentReason, CaseStatus, TurnKind
from cc_platform.domain.people.events import (
    STAFF_ADMIN_EVENTS,
    SessionEnded,
    SessionStarted,
    StaffAvailabilityChanged,
    StaffDeactivated,
    StaffLanguagesChanged,
    StaffReactivated,
    StaffRolesChanged,
    TeamDeactivated,
    TeamReactivated,
    TeamRenamed,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject

#: Team events that change "Equipo y colas" (the team pills and names).
_TEAM_ROW_EVENTS: tuple[type[DomainEvent], ...] = (TeamRenamed, TeamDeactivated, TeamReactivated)

#: Administration events that change who could take a queued case.
_SPEAKER_EVENTS: tuple[type[DomainEvent], ...] = (
    StaffRolesChanged,
    StaffLanguagesChanged,
    StaffDeactivated,
    StaffReactivated,
)

#: Events this projection listens to.
SUPERVISION_EVENTS: tuple[type[DomainEvent], ...] = (
    *CASE_EVENTS,
    StaffAvailabilityChanged,
    SessionStarted,
    SessionEnded,
    *STAFF_ADMIN_EVENTS,
    *_TEAM_ROW_EVENTS,
)

_ASSIGNEE_ROW_EVENTS = (CaseStatusChanged, CaseFirstResponded, CaseClosed, CasePriorityChanged)


class SupervisionRealtimePresenter(Protocol):
    """Serialises views exactly like the REST schemas (camelCase JSON)."""

    def case_summary(self, view: CaseSummaryView) -> JsonObject: ...

    def queue_counts(self, view: QueueCountsView) -> JsonObject: ...


def _unique(ids: Iterable[str | None]) -> list[str]:
    seen: dict[str, None] = {}
    for staff_id in ids:
        if staff_id:
            seen.setdefault(staff_id, None)
    return list(seen)


def team_rows_of(event: DomainEvent, case: Case) -> list[str]:
    """The analysts whose "Equipo y colas" row a committed case event may have changed."""
    if isinstance(event, TurnCreated):
        is_message = event.kind == TurnKind.MESSAGE.value
        return _unique([case.assigned_analyst_id]) if is_message else []
    if isinstance(event, CaseAssigned):
        return _unique([event.assigned_analyst_id, event.previous_analyst_id])
    if isinstance(event, _ASSIGNEE_ROW_EVENTS):
        return _unique([case.assigned_analyst_id])
    if isinstance(event, CaseRated):
        return _unique([event.analyst_id])
    if isinstance(event, ESCALATION_EVENTS) and not isinstance(event, EscalationAcknowledged):
        return _unique([case.assigned_analyst_id])  # slice 9: the "Escalado" marker
    return []


_FROM_QUEUE_REASONS = frozenset({AssignmentReason.QUEUE_DRAINED, AssignmentReason.MANUAL})


def left_queue(event: DomainEvent) -> bool:
    """A ``case.assigned`` that took the case out of a language queue: drained or assigned by
    hand from it (no previous analyst). A new case assigned on arrival never entered a queue,
    so it changes no queue count and sends no ``queue.updated``."""
    return (
        isinstance(event, CaseAssigned)
        and event.previous_analyst_id is None
        and event.reason in _FROM_QUEUE_REASONS
    )


class SupervisionRealtimeProjector:
    def __init__(
        self,
        hub: RealtimeHub,
        uow: UnitOfWorkFactory,
        presenter: SupervisionRealtimePresenter,
        clock: Clock,
    ) -> None:
        self._hub = hub
        self._uow = uow
        self._present = presenter
        self._clock = clock

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if isinstance(event, StaffAvailabilityChanged):
            await self._team(record, [event.entity_id])
            return
        if isinstance(event, SessionStarted | SessionEnded):
            await self._session(record, event.staff_id)
            return
        if isinstance(event, STAFF_ADMIN_EVENTS):
            await self._administration(record, event)
            return
        if isinstance(event, _TEAM_ROW_EVENTS):
            await self._team_record(record, event.entity_id)
            return
        if event.case_id is None or not isinstance(event, CASE_EVENTS):
            return
        async with self._uow() as uow:
            case = await uow.cases.get(event.case_id)
            if case is None:
                return
            if isinstance(event, CaseQueued):
                summary = await CaseReader(uow).summary(case)
                await self._queues(record, "queue.case_queued", self._present.case_summary(summary))
            if case.status is CaseStatus.QUEUED or left_queue(event):
                counts = await queue_counts(uow, self._clock.now())
                await self._queues(record, "queue.updated", self._present.queue_counts(counts))
        await self._team(record, team_rows_of(event, case))

    async def _session(self, record: EventRecord, staff_id: str) -> None:
        """Only an analyst's session changes a row ("En pausa" ↔ "Desconectada")."""
        async with self._uow() as uow:
            staff = await uow.staff.get(staff_id)
        if staff is not None and staff.active and staff.has_role(StaffRole.ANALYST):
            await self._team(record, [staff_id])

    async def _administration(self, record: EventRecord, event: DomainEvent) -> None:
        """A person changed (slice 4): her row if she is (or was) an analyst, and the queue
        speakers when roles, languages or her active state changed."""
        async with self._uow() as uow:
            staff = await uow.staff.get(event.entity_id)
            was_analyst = isinstance(event, StaffRolesChanged) and (
                StaffRole.ANALYST.value in (*event.from_roles, *event.to_roles)
            )
            if was_analyst or (staff is not None and staff.has_role(StaffRole.ANALYST)):
                await self._team(record, [event.entity_id], always=True)
            if isinstance(event, _SPEAKER_EVENTS):
                counts = await queue_counts(uow, self._clock.now())
                await self._queues(record, "queue.updated", self._present.queue_counts(counts))

    async def _team_record(self, record: EventRecord, team_id: str) -> None:
        """A team was renamed, deactivated or reactivated: its active analysts' rows."""
        async with self._uow() as uow:
            members = [
                person.id
                for person in await uow.staff.list(role=StaffRole.ANALYST)
                if person.active and person.team_id == team_id
            ]
        await self._team(record, members, always=True)

    async def _queues(self, record: EventRecord, kind: str, payload: JsonObject) -> None:
        envelope = derived_envelope(record, kind, payload, actor_id=record.actor_id)
        await self._hub.publish(str(Topic.supervision_queues()), envelope)

    async def _team(
        self, record: EventRecord, staff_ids: list[str], *, always: bool = False
    ) -> None:
        """``always``: send even without ids (a team-level change: clients refetch)."""
        if not staff_ids and not always:
            return
        payload: JsonObject = {"staffIds": list(staff_ids)}
        envelope = derived_envelope(record, "team.updated", payload, actor_id=record.actor_id)
        await self._hub.publish(str(Topic.supervision_team()), envelope)
