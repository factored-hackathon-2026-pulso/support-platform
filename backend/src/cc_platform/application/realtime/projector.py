"""Event bus subscribers that feed the realtime hub.

``RealtimeProjector`` turns committed domain events into envelopes and fans them out to the
topics each event maps to. Mapping is a registry (``TopicMapper``): by default an event with
a ``case_id`` goes to ``case:<id>``; contexts register extra rules for their events (e.g.
an assignment change also goes to ``inbox:<analyst>``).

``SessionTerminator`` closes the sockets of a session as soon as it ends (logout).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.realtime import RealtimeEnvelope, RealtimeHub
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.people.events import SessionEnded
from cc_platform.domain.shared.events import DomainEvent

type TopicRule = Callable[[DomainEvent], Iterable[Topic]]


class TopicMapper:
    def __init__(self) -> None:
        self._rules: list[tuple[type[DomainEvent], TopicRule]] = []

    def register(self, event_type: type[DomainEvent], rule: TopicRule) -> None:
        self._rules.append((event_type, rule))

    def topics_for(self, event: DomainEvent) -> list[Topic]:
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


class RealtimeProjector:
    def __init__(self, hub: RealtimeHub, mapper: TopicMapper) -> None:
        self._hub = hub
        self._mapper = mapper

    async def __call__(self, record: EventRecord) -> None:
        topics = self._mapper.topics_for(record.event)
        if not topics:
            return
        envelope = envelope_for(record)
        for topic in topics:
            await self._hub.publish(str(topic), envelope)


class SessionTerminator:
    def __init__(self, hub: RealtimeHub) -> None:
        self._hub = hub

    async def __call__(self, record: EventRecord) -> None:
        if isinstance(record.event, SessionEnded):
            self._hub.close_session(record.entity_id)
