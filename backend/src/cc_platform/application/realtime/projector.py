"""Event bus subscribers that feed the realtime hub.

``RealtimeProjector`` turns committed domain events into envelopes and fans them out to the
topics each event maps to. Mapping is a registry (``TopicMapper``): by default an event with
a ``case_id`` goes to ``case:<id>``; contexts register extra rules for their events (e.g.
an assignment change also goes to ``inbox:<analyst>``). A context that publishes its own,
richer envelopes (the cases context: ``CaseRealtimeProjector``) ``suppress``es its event
types here so they are not forwarded raw as well.

``SessionTerminator`` closes the sockets of a session as soon as it ends (logout,
deactivation, password reset: close code 4401). ``AccessTerminator`` closes every socket of
a person whose roles changed (close code 4409, ``access_changed``): a socket keeps the
roles it authenticated with and topics are checked at subscribe time, so it reconnects
right away and its subscriptions are re-checked with the new roles (slice 4 §9.3).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.realtime import RealtimeEnvelope, RealtimeHub
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.people.events import SessionEnded, StaffRolesChanged
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject

type TopicRule = Callable[[DomainEvent], Iterable[Topic]]

#: Hub close reason (and WebSocket close reason) after a roles change.
ACCESS_CHANGED = "access_changed"


class TopicMapper:
    def __init__(self) -> None:
        self._rules: list[tuple[type[DomainEvent], TopicRule]] = []
        self._suppressed: tuple[type[DomainEvent], ...] = ()

    def register(self, event_type: type[DomainEvent], rule: TopicRule) -> None:
        self._rules.append((event_type, rule))

    def suppress(self, *event_types: type[DomainEvent]) -> None:
        """Never forward these events raw (another projection owns their envelopes)."""
        self._suppressed = (*self._suppressed, *event_types)

    def topics_for(self, event: DomainEvent) -> list[Topic]:
        if isinstance(event, self._suppressed):
            return []
        topics: dict[str, Topic] = {}
        if event.case_id is not None:
            case_topic = Topic.case(event.case_id)
            topics[str(case_topic)] = case_topic
        for event_type, rule in self._rules:
            if isinstance(event, event_type):
                for topic in rule(event):
                    topics.setdefault(str(topic), topic)
        return list(topics.values())


def envelope_for(record: EventRecord) -> RealtimeEnvelope:
    return RealtimeEnvelope(
        type=record.event_type,
        id=record.event_id,
        occurred_at=record.event_time,
        data={
            "entity": record.entity,
            "entityId": record.entity_id,
            "caseId": record.case_id,
            "actor": {"role": record.actor_role, "id": record.actor_id},
            "payload": record.payload(),
        },
    )


def derived_envelope(
    record: EventRecord,
    kind: str,
    payload: JsonObject,
    *,
    actor_role: str | None = None,
    actor_id: str | None,
) -> RealtimeEnvelope:
    """An envelope a context projection derives from a committed event (``id`` = the source
    event id, payload = a REST-shaped view). ``actor_role``/``actor_id`` let the caller hide
    who acted (customer topics never learn staff ids)."""
    return RealtimeEnvelope(
        type=kind,
        id=record.event_id,
        occurred_at=record.event_time,
        data={
            "entity": record.entity,
            "entityId": record.entity_id,
            "caseId": record.case_id,
            "actor": {"role": actor_role or record.actor_role, "id": actor_id},
            "payload": payload,
        },
    )


class RealtimeProjector:
    def __init__(self, hub: RealtimeHub, mapper: TopicMapper) -> None:
        self._hub = hub
        self._mapper = mapper

    async def __call__(self, record: EventRecord) -> None:
        topics = self._mapper.topics_for(record.event)
        if not topics:
            return
        await self._hub.publish_many((str(topic) for topic in topics), envelope_for(record))


class SessionTerminator:
    def __init__(self, hub: RealtimeHub) -> None:
        self._hub = hub

    async def __call__(self, record: EventRecord) -> None:
        if isinstance(record.event, SessionEnded):
            self._hub.close_session(record.entity_id)


class AccessTerminator:
    def __init__(self, hub: RealtimeHub) -> None:
        self._hub = hub

    async def __call__(self, record: EventRecord) -> None:
        if isinstance(record.event, StaffRolesChanged):
            self._hub.close_principal(record.entity_id, ACCESS_CHANGED)
