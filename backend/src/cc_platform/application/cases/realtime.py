"""``CaseRealtimeProjector``: realtime envelopes of the cases and customers contexts.

Replaces the raw forwarding of ``RealtimeProjector`` for these events (``TopicMapper``
suppresses them) and publishes only the envelopes of the slice 2 contract (§7), with
camelCase payloads equal to the REST schemas. The payload shapes come from a
``CaseRealtimePresenter`` (implemented by the API layer with the very same Pydantic
schemas the REST endpoints return), so socket and REST cannot drift.

- ``turn.created`` → ``case:<id>`` (``Turn``), and ``customer:<cus>`` (``CustomerTurn``)
  for ``everyone`` turns only.
- ``case.updated`` → ``case:<id>`` and ``inbox:<assignee>`` (``CaseSummary``), after
  turn.created, case.assigned, case.status_changed, case.read, case.first_responded,
  case.closed (a close moves the card to Cerrados: ``inboxStatus = closed``), case.rated
  (slice 7: the closed card and the read-only footer show the customer's rating),
  case.priority_changed (slice 8: the card flag, the ficha, the supervisor view). One envelope
  published to both topics at once, so a socket subscribed to both receives it once.
- ``case.assigned`` → ``inbox:<assignee>`` (``CaseSummary``). A reassignment (slice 3) also
  sends ``case.unassigned`` (``CaseSummary``), ``case.updated`` and her fresh
  ``inbox.counts`` to ``inbox:<previous assignee>``: the case leaves her lists.
- ``inbox.counts`` → ``inbox:<assignee>`` (``InboxCounts``, incl. ``closed`` in the 7-day
  window), with each inbox ``case.updated``.
- ``availability.updated`` → ``inbox:<staff>`` (``Availability``).
- Slice 9, escalations: every ``escalation.*`` event sends ``case.updated`` like above (the
  "Escalado" marker, ``CaseSummary.escalated``) and ``escalation.updated`` (``Escalation``)
  to ``case:<id>``, ``inbox:<who escalated>`` (she sees supervision's answer live, even
  after the case left her) and ``supervision:escalations``. Never to the customer.
- Slice 12, calls: every ``call.*`` event sends ``case.updated`` (``activeCallId``, the status
  and the first response an answer sets) and ``call.updated`` (``Call``) to ``case:<id>`` and
  ``inbox:<assignee>`` (and ``inbox:<analyst on the line>`` if another), and ``call.updated``
  (``CustomerCall``: no reason, no staff ids) to ``customer:<cus>``. Transcript lines, emails
  and internal notes are turns: ``turn.created`` as above (a note is staff-only, so it never
  reaches the customer topic).
- ``conversation.updated`` → ``customer:<cus>`` (``CustomerConversation``), after
  case.opened, case.queued, case.assigned, case.status_changed, case.closed, case.rated
  (the simulator stops asking for a rating in every open tab). A new case
  after a close carries a different ``caseId``: the simulator switches conversations.

Envelope ``id`` = the source event id (unique per ``type``); clients dedupe on
``(type, id)``: within one kind of principal (staff or customer) a ``(type, id)`` pair
always carries the same payload. On
``customer:`` topics the actor id is hidden unless the actor is that customer, and a
supervisor or admin shows as ``system`` (the customer never learns who reassigned).
"""

from __future__ import annotations

from typing import Protocol

from cc_platform.application.cases.dto import (
    CallView,
    CaseSummaryView,
    CustomerCallView,
    CustomerConversationView,
    CustomerTurnView,
    EscalationView,
    InboxCountsView,
    TurnView,
)
from cc_platform.application.cases.queries import CLOSED_INBOX_WINDOW
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.events import EventRecord
from cc_platform.application.people.availability import AvailabilityView
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.events import (
    CALL_EVENTS,
    CASE_EVENTS,
    ESCALATION_EVENTS,
    CaseAssigned,
    CaseClosed,
    CaseFirstResponded,
    CaseOpened,
    CasePriorityChanged,
    CaseQueued,
    CaseRated,
    CaseRead,
    CaseStatusChanged,
    CaseViewed,
    TurnCreated,
)
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import TurnAudience, TurnAuthorRole, TurnKind
from cc_platform.domain.customers.events import CustomerSessionStarted
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.events import StaffAvailabilityChanged
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject

#: Events this projection owns (the generic projector must not forward them raw).
OWNED_EVENTS: tuple[type[DomainEvent], ...] = (
    *CASE_EVENTS,
    CustomerSessionStarted,
    StaffAvailabilityChanged,
)

#: Actor roles a customer topic may show as they are (anyone else shows as ``system``).
_CUSTOMER_VISIBLE_ROLES = frozenset(
    {ActorRole.CUSTOMER.value, ActorRole.ANALYST.value, ActorRole.SYSTEM.value}
)

#: Audited reads: recorded in the event log, never sent on any socket.
SILENT_EVENTS: tuple[type[DomainEvent], ...] = (CaseViewed,)

_CASE_UPDATING = (
    TurnCreated,
    CaseAssigned,
    CaseStatusChanged,
    CaseRead,
    CaseFirstResponded,
    CaseClosed,
    CaseRated,
    CasePriorityChanged,
    *ESCALATION_EVENTS,
    *CALL_EVENTS,
)
_CONVERSATION_UPDATING = (
    CaseOpened,
    CaseQueued,
    CaseAssigned,
    CaseStatusChanged,
    CaseClosed,
    CaseRated,
)


class CaseRealtimePresenter(Protocol):
    """Serialises views exactly like the REST schemas (camelCase JSON)."""

    def case_summary(self, view: CaseSummaryView) -> JsonObject: ...

    def turn(self, view: TurnView) -> JsonObject: ...

    def customer_turn(self, view: CustomerTurnView) -> JsonObject: ...

    def conversation(self, view: CustomerConversationView) -> JsonObject: ...

    def inbox_counts(self, view: InboxCountsView) -> JsonObject: ...

    def availability(self, view: AvailabilityView) -> JsonObject: ...

    def escalation(self, view: EscalationView) -> JsonObject: ...

    def call(self, view: CallView) -> JsonObject: ...

    def customer_call(self, view: CustomerCallView) -> JsonObject: ...


def turn_from_event(event: TurnCreated) -> Turn:
    """The turn exactly as committed (the event carries every field)."""
    return Turn(
        id=event.entity_id,
        case_id=event.case_id or "",
        sequence=event.sequence,
        kind=TurnKind(event.kind),
        audience=TurnAudience(event.audience),
        author_role=TurnAuthorRole(event.author_role),
        author_id=event.author_id,
        text=event.text,
        language=Language(event.language),
        created_at=event.occurred_at,
        client_message_id=event.client_message_id,
        subject=event.subject,
    )


class CaseRealtimeProjector:
    def __init__(
        self,
        hub: RealtimeHub,
        uow: UnitOfWorkFactory,
        presenter: CaseRealtimePresenter,
        clock: Clock,
    ) -> None:
        self._hub = hub
        self._uow = uow
        self._present = presenter
        self._clock = clock

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if isinstance(event, StaffAvailabilityChanged):
            view = AvailabilityView(
                status=AvailabilityStatus(event.to_status), since=event.occurred_at
            )
            await self._send(
                record,
                Topic.inbox(event.entity_id),
                "availability.updated",
                self._present.availability(view),
            )
            return
        if event.case_id is None or not isinstance(event, CASE_EVENTS):
            return  # customer sessions: read through REST
        async with self._uow() as uow:
            case = await uow.cases.get(event.case_id)
            if case is None:
                return
            await self._project(uow, record, event, case)

    async def _project(
        self, uow: UnitOfWork, record: EventRecord, event: DomainEvent, case: Case
    ) -> None:
        reader = CaseReader(uow)
        case_topic = Topic.case(case.id)
        customer_topic = Topic.customer(case.customer_id)
        if isinstance(event, TurnCreated):
            turn = turn_from_event(event)
            (staff_view,) = await reader.turn_views([turn])
            await self._send(record, case_topic, "turn.created", self._present.turn(staff_view))
            if turn.is_public:
                (public,) = await reader.customer_turn_views([turn], case.customer_id)
                await self._send(
                    record,
                    customer_topic,
                    "turn.created",
                    self._present.customer_turn(public),
                    customer_id=case.customer_id,
                )
        if isinstance(event, _CASE_UPDATING):
            summary = self._present.case_summary(await reader.summary(case))
            assignee = case.assigned_analyst_id
            previous = (
                event.previous_analyst_id
                if isinstance(event, CaseAssigned) and event.previous_analyst_id != assignee
                else None
            )
            # One envelope for every topic: a socket on several (the assignee with the case
            # open) receives it once (``RealtimeHub.publish_many``).
            topics = [case_topic, *(Topic.inbox(s) for s in (assignee, previous) if s)]
            await self._send(record, tuple(topics), "case.updated", summary)
            if assignee is not None:
                if isinstance(event, CaseAssigned):
                    await self._send(record, Topic.inbox(assignee), "case.assigned", summary)
                await self._send_counts(record, reader, assignee)
            if previous is not None:
                await self._send(record, Topic.inbox(previous), "case.unassigned", summary)
                await self._send_counts(record, reader, previous)
        if isinstance(event, ESCALATION_EVENTS):
            await self._escalation(uow, reader, record, event, case)
        if isinstance(event, CALL_EVENTS):
            await self._call(uow, reader, record, event, case)
        if isinstance(event, _CONVERSATION_UPDATING):
            conversation = await reader.conversation(case)
            await self._send(
                record,
                customer_topic,
                "conversation.updated",
                self._present.conversation(conversation),
                customer_id=case.customer_id,
            )

    async def _escalation(
        self,
        uow: UnitOfWork,
        reader: CaseReader,
        record: EventRecord,
        event: DomainEvent,
        case: Case,
    ) -> None:
        escalation = await uow.escalations.get(event.entity_id)
        if escalation is None:
            return
        payload = self._present.escalation(await reader.escalation_view(escalation, case))
        topics = (
            Topic.case(case.id),
            Topic.inbox(escalation.escalated_by_id),
            Topic.supervision_escalations(),
        )
        await self._send(record, topics, "escalation.updated", payload)

    async def _call(
        self,
        uow: UnitOfWork,
        reader: CaseReader,
        record: EventRecord,
        event: DomainEvent,
        case: Case,
    ) -> None:
        call = await uow.calls.get(event.entity_id)
        if call is None:
            return
        on_the_line = {s for s in (case.assigned_analyst_id, call.analyst_id) if s}
        topics = (Topic.case(case.id), *(Topic.inbox(s) for s in sorted(on_the_line)))
        await self._send(
            record, topics, "call.updated", self._present.call(await reader.call_view(call))
        )
        await self._send(
            record,
            Topic.customer(case.customer_id),
            "call.updated",
            self._present.customer_call(await reader.customer_call_view(call)),
            customer_id=case.customer_id,
        )

    async def _send_counts(self, record: EventRecord, reader: CaseReader, staff_id: str) -> None:
        now = self._clock.now()
        counts = await reader.inbox_counts(
            staff_id, closed_since=now - CLOSED_INBOX_WINDOW, computed_at=now
        )
        await self._send(
            record, Topic.inbox(staff_id), "inbox.counts", self._present.inbox_counts(counts)
        )

    async def _send(
        self,
        record: EventRecord,
        topic: Topic | tuple[Topic, ...],
        kind: str,
        payload: JsonObject,
        *,
        customer_id: str | None = None,
    ) -> None:
        actor_id: str | None = record.actor_id
        actor_role = record.actor_role
        if customer_id is not None:
            if not (actor_role == ActorRole.CUSTOMER.value and record.actor_id == customer_id):
                actor_id = None  # customers never learn staff ids
            if actor_role not in _CUSTOMER_VISIBLE_ROLES:
                actor_role = ActorRole.SYSTEM.value  # nor that a supervisor acted
        envelope = derived_envelope(record, kind, payload, actor_role=actor_role, actor_id=actor_id)
        topics = topic if isinstance(topic, tuple) else (topic,)
        await self._hub.publish_many((str(t) for t in topics), envelope)
