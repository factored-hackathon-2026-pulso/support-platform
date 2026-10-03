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
  case.closed (a close moves the card to Cerrados: ``inboxStatus = closed``). One envelope
  published to both topics at once, so a socket subscribed to both receives it once.
- ``case.assigned`` → ``inbox:<assignee>`` (``CaseSummary``).
- ``inbox.counts`` → ``inbox:<assignee>`` (``InboxCounts``, incl. ``closed`` in the 7-day
  window), with each inbox ``case.updated``.
- ``availability.updated`` → ``inbox:<staff>`` (``Availability``).
- ``conversation.updated`` → ``customer:<cus>`` (``CustomerConversation``), after
  case.opened, case.queued, case.assigned, case.status_changed, case.closed. A new case
  after a close carries a different ``caseId``: the simulator switches conversations.

Envelope ``id`` = the source event id (unique per ``type``); clients dedupe on
``(type, id)``: within one kind of principal (staff or customer) a ``(type, id)`` pair
always carries the same payload. On
``customer:`` topics the actor id is hidden unless the actor is that customer.
"""

from __future__ import annotations

from typing import Protocol

from cc_platform.application.cases.dto import (
    CaseSummaryView,
    CustomerConversationView,
    CustomerTurnView,
    InboxCountsView,
    TurnView,
)
from cc_platform.application.cases.queries import CLOSED_INBOX_WINDOW
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.events import EventRecord
from cc_platform.application.people.availability import AvailabilityView
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.realtime import RealtimeEnvelope, RealtimeHub
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.events import (
    CASE_EVENTS,
    CaseAssigned,
    CaseClosed,
    CaseFirstResponded,
    CaseOpened,
    CaseQueued,
    CaseRead,
    CaseStatusChanged,
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

_CASE_UPDATING = (
    TurnCreated,
    CaseAssigned,
    CaseStatusChanged,
    CaseRead,
    CaseFirstResponded,
    CaseClosed,
)
_CONVERSATION_UPDATING = (CaseOpened, CaseQueued, CaseAssigned, CaseStatusChanged, CaseClosed)


class CaseRealtimePresenter(Protocol):
    """Serialises views exactly like the REST schemas (camelCase JSON)."""

    def case_summary(self, view: CaseSummaryView) -> JsonObject: ...

    def turn(self, view: TurnView) -> JsonObject: ...

    def customer_turn(self, view: CustomerTurnView) -> JsonObject: ...

    def conversation(self, view: CustomerConversationView) -> JsonObject: ...

    def inbox_counts(self, view: InboxCountsView) -> JsonObject: ...

    def availability(self, view: AvailabilityView) -> JsonObject: ...


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
            if assignee is None:
                await self._send(record, case_topic, "case.updated", summary)
            else:
                inbox = Topic.inbox(assignee)
                # One envelope for both topics: a socket on both (the assignee with the
                # case open) receives it once (``RealtimeHub.publish_many``).
                await self._send(record, (case_topic, inbox), "case.updated", summary)
                if isinstance(event, CaseAssigned):
                    await self._send(record, inbox, "case.assigned", summary)
                now = self._clock.now()
                counts = await reader.inbox_counts(
                    assignee, closed_since=now - CLOSED_INBOX_WINDOW, computed_at=now
                )
                await self._send(record, inbox, "inbox.counts", self._present.inbox_counts(counts))
        if isinstance(event, _CONVERSATION_UPDATING):
            conversation = await reader.conversation(case)
            await self._send(
                record,
                customer_topic,
                "conversation.updated",
                self._present.conversation(conversation),
                customer_id=case.customer_id,
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
        if customer_id is not None and not (
            record.actor_role == ActorRole.CUSTOMER.value and record.actor_id == customer_id
        ):
            actor_id = None  # customers never learn staff ids
        envelope = RealtimeEnvelope(
            type=kind,
            id=record.event_id,
            occurred_at=record.event_time,
            data={
                "entity": record.entity,
                "entityId": record.entity_id,
                "caseId": record.case_id,
                "actor": {"role": record.actor_role, "id": actor_id},
                "payload": payload,
            },
        )
        topics = topic if isinstance(topic, tuple) else (topic,)
        await self._hub.publish_many((str(t) for t in topics), envelope)
