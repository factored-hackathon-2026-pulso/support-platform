from __future__ import annotations

from datetime import UTC, datetime

from cc_platform.application.ports.realtime import RealtimeEnvelope
from cc_platform.infrastructure.realtime.in_memory_hub import InMemoryRealtimeHub

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)


def envelope(n: int) -> RealtimeEnvelope:
    return RealtimeEnvelope(type="case.updated", id=f"EVT-{n}", occurred_at=NOW, data={"n": n})


async def test_publish_reaches_only_topic_subscribers() -> None:
    hub = InMemoryRealtimeHub()
    a = hub.connect(connection_id="CON-A", principal_id="STF-1", session_id="SES-1")
    b = hub.connect(connection_id="CON-B", principal_id="STF-2", session_id="SES-2")
    hub.subscribe(a.id, "case:1")
    hub.subscribe(b.id, "case:2")

    assert await hub.publish("case:1", envelope(1)) == 1
    assert await hub.publish("case:nobody", envelope(2)) == 0

    assert (await a.next_envelope()) == envelope(1)
    assert a.topics == frozenset({"case:1"})


async def test_publish_many_delivers_once_per_connection() -> None:
    hub = InMemoryRealtimeHub()
    both = hub.connect(connection_id="CON-A", principal_id="STF-1", session_id="SES-1")
    inbox_only = hub.connect(connection_id="CON-B", principal_id="STF-1", session_id="SES-2")
    hub.subscribe(both.id, "case:1")
    hub.subscribe(both.id, "inbox:STF-1")
    hub.subscribe(inbox_only.id, "inbox:STF-1")

    assert await hub.publish_many(["case:1", "inbox:STF-1", "case:nobody"], envelope(1)) == 2
    assert await hub.publish("case:1", envelope(2)) == 1

    assert [await both.next_envelope(), await both.next_envelope()] == [envelope(1), envelope(2)]
    assert await inbox_only.next_envelope() == envelope(1)
    assert await hub.publish_many([], envelope(3)) == 0


async def test_unsubscribe_and_disconnect_clean_up() -> None:
    hub = InMemoryRealtimeHub()
    a = hub.connect(connection_id="CON-A", principal_id="STF-1", session_id="SES-1")
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
    slow = hub.connect(connection_id="CON-S", principal_id="STF-1", session_id="SES-1")
    hub.subscribe(slow.id, "case:1")

    delivered = [await hub.publish("case:1", envelope(n)) for n in range(3)]

    assert delivered == [1, 1, 0]
    assert hub.connection_count == 0
    assert slow.close_reason == "slow_consumer"
    assert await slow.next_envelope() is None


async def test_close_session_closes_every_socket_of_the_session() -> None:
    hub = InMemoryRealtimeHub()
    tab1 = hub.connect(connection_id="CON-1", principal_id="STF-1", session_id="SES-1")
    tab2 = hub.connect(connection_id="CON-2", principal_id="STF-1", session_id="SES-1")
    other = hub.connect(connection_id="CON-3", principal_id="STF-1", session_id="SES-2")

    assert hub.close_session("SES-1") == 2

    assert tab1.close_reason == tab2.close_reason == "session_ended"
    assert other.close_reason is None
    assert hub.connection_count == 1


async def test_close_principal_closes_every_connection_of_that_person() -> None:
    from cc_platform.infrastructure.realtime.in_memory_hub import InMemoryRealtimeHub

    hub = InMemoryRealtimeHub()
    first = hub.connect(connection_id="CON-1", principal_id="STF-A", session_id="SES-1")
    second = hub.connect(connection_id="CON-2", principal_id="STF-A", session_id="SES-2")
    other = hub.connect(connection_id="CON-3", principal_id="STF-B", session_id="SES-3")
    hub.subscribe("CON-1", "inbox:STF-A")
    assert hub.close_principal("STF-A", "access_changed") == 2
    assert await first.next_envelope() is None
    assert (first.close_reason, second.close_reason, other.close_reason) == (
        "access_changed",
        "access_changed",
        None,
    )
    assert hub.connection_count == 1
    assert hub.subscriber_count("inbox:STF-A") == 0
