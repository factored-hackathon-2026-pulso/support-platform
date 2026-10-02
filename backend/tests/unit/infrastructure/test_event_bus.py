from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from cc_platform.application.events import EventRecord
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from tests.support import RecordingHandler

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)


@dataclass(frozen=True, kw_only=True, slots=True)
class Parent(DomainEvent):
    event_type = "test.parent"
    entity = "test"


@dataclass(frozen=True, kw_only=True, slots=True)
class Child(Parent):
    event_type = "test.child"


@dataclass(frozen=True, kw_only=True, slots=True)
class Other(DomainEvent):
    event_type = "test.other"
    entity = "test"


def rec(event_type: type[DomainEvent], n: int) -> EventRecord:
    event = event_type(occurred_at=NOW, actor=ActorRef.system(), entity_id=f"X-{n}")
    return EventRecord(event_id=f"EVT-{n}", event=event, ingested_at=NOW)


async def test_publishes_in_order_to_all_subscribers() -> None:
    bus = InProcessEventBus()
    first, second = RecordingHandler(), RecordingHandler()
    bus.subscribe(first)
    bus.subscribe(second)

    await bus.publish([rec(Parent, 1), rec(Other, 2)])

    assert first.event_types == ["test.parent", "test.other"]
    assert second.event_types == ["test.parent", "test.other"]


async def test_filters_by_event_type_including_subclasses() -> None:
    bus = InProcessEventBus()
    parents = RecordingHandler()
    bus.subscribe(parents, event_types=[Parent])

    await bus.publish([rec(Parent, 1), rec(Child, 2), rec(Other, 3)])

    assert parents.event_types == ["test.parent", "test.child"]


async def test_failing_handler_is_isolated() -> None:
    bus = InProcessEventBus()
    survivor = RecordingHandler()

    async def explode(_record: EventRecord) -> None:
        raise RuntimeError("boom")

    bus.subscribe(explode)
    bus.subscribe(survivor)

    await bus.publish([rec(Parent, 1)])

    assert survivor.event_types == ["test.parent"]


async def test_unsubscribe_stops_delivery() -> None:
    bus = InProcessEventBus()
    handler = RecordingHandler()
    unsubscribe = bus.subscribe(handler)
    unsubscribe()
    unsubscribe()  # idempotent

    await bus.publish([rec(Parent, 1)])

    assert handler.records == []
    assert bus.subscriber_count == 0
