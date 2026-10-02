from __future__ import annotations

from datetime import UTC, datetime

from cc_platform.application.ports.realtime import RealtimeEnvelope
from cc_platform.infrastructure.realtime.in_memory_hub import InMemoryRealtimeHub

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)


def envelope(n: int) -> RealtimeEnvelope:
    return RealtimeEnvelope(type="case.updated", id=f"EVT-{n}", occurred_at=NOW, data={"n": n})


async def test_publish_reaches_only_topic_subscribers() -> None:
    hub = InMemoryRealtimeHub()
    a = hub.connect(connection_id="CON-A", staff_id="STF-1", session_id="SES-1")
    b = hub.connect(connection_id="CON-B", staff_id="STF-2", session_id="SES-2")
    hub.subscribe(a.id, "case:1")
    hub.subscribe(b.id, "case:2")

    assert await hub.publish("case:1", envelope(1)) == 1
    assert await hub.publish("case:nobody", envelope(2)) == 0

    assert (await a.next_envelope()) == envelope(1)
    assert a.topics == frozenset({"case:1"})


async def test_unsubscribe_and_disconnect_clean_up() -> None:
    hub = InMemoryRealtimeHub()
    a = hub.connect(connection_id="CON-A", staff_id="STF-1", session_id="SES-1")
    hub.subscribe(a.id, "case:1")
    hub.unsubscribe(a.id, "case:1")
    assert hub.subscriber_count("case:1") == 0
    assert await hub.publish("case:1", envelope(1)) == 0

    hub.subscribe(a.id, "case:1")
    hub.disconnect(a.id)
    hub.disconnect(a.id)  # idempotent
    assert hub.connection_count == 0
    assert await a.next_envelope() is None
    assert a.close_reason == "disconnected"


async def test_slow_consumer_is_disconnected() -> None:
    hub = InMemoryRealtimeHub(queue_size=2)
    slow = hub.connect(connection_id="CON-S", staff_id="STF-1", session_id="SES-1")
    hub.subscribe(slow.id, "case:1")

    delivered = [await hub.publish("case:1", envelope(n)) for n in range(3)]

    assert delivered == [1, 1, 0]
    assert hub.connection_count == 0
    assert slow.close_reason == "slow_consumer"
    assert await slow.next_envelope() is None


async def test_close_session_closes_every_socket_of_the_session() -> None:
    hub = InMemoryRealtimeHub()
    tab1 = hub.connect(connection_id="CON-1", staff_id="STF-1", session_id="SES-1")
    tab2 = hub.connect(connection_id="CON-2", staff_id="STF-1", session_id="SES-1")
    other = hub.connect(connection_id="CON-3", staff_id="STF-1", session_id="SES-2")

    assert hub.close_session("SES-1") == 2

    assert tab1.close_reason == tab2.close_reason == "session_ended"
    assert other.close_reason is None
    assert hub.connection_count == 1
