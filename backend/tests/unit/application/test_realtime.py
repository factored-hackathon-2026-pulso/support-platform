"""Topics, access policy and the event-bus → hub projection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from cc_platform.application.errors import InvalidTopicError
from cc_platform.application.events import EventRecord
from cc_platform.application.realtime.projector import (
    RealtimeProjector,
    SessionTerminator,
    TopicMapper,
)
from cc_platform.application.realtime.topics import Topic, TopicAccessPolicy, TopicKind
from cc_platform.domain.people.events import SessionEnded
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.realtime.in_memory_hub import InMemoryRealtimeHub
from tests.support import make_actor

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
CASE_ID = "CASE-" + "0" * 25 + "1"
STAFF_ID = "STF-" + "0" * 25 + "7"


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseAssigned(DomainEvent):
    event_type = "case.assigned"
    entity = "case"
    analyst_id: str


def record(event: DomainEvent, event_id: str = "EVT-" + "0" * 25 + "1") -> EventRecord:
    return EventRecord(event_id=event_id, event=event, ingested_at=NOW)


def assigned() -> CaseAssigned:
    return CaseAssigned(
        occurred_at=NOW,
        actor=ActorRef(ActorRole.SUPERVISOR, STAFF_ID),
        entity_id=CASE_ID,
        case_id=CASE_ID,
        analyst_id=STAFF_ID,
    )


@pytest.mark.parametrize(
    ("raw", "kind"),
    [
        (f"case:{CASE_ID}", TopicKind.CASE),
        (f"inbox:{STAFF_ID}", TopicKind.INBOX),
        ("approvals", TopicKind.APPROVALS),
    ],
)
def test_topic_parse_round_trips(raw: str, kind: TopicKind) -> None:
    topic = Topic.parse(raw)
    assert topic.kind is kind
    assert str(topic) == raw


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "case",
        "case:",
        "case:CASE-1",
        f"case:{STAFF_ID}",
        "approvals:x",
        "chat:1",
        f"inbox:{CASE_ID}",
    ],
)
def test_topic_parse_rejects_bad_topics(raw: str) -> None:
    with pytest.raises(InvalidTopicError):
        Topic.parse(raw)


def test_access_policy() -> None:
    policy = TopicAccessPolicy()
    analyst = make_actor(StaffRole.ANALYST)
    supervisor = make_actor(StaffRole.SUPERVISOR)
    admin = make_actor(StaffRole.ADMIN)
    other_inbox = Topic.inbox("STF-" + "0" * 25 + "9")

    assert policy.can_subscribe(analyst, Topic.case(CASE_ID))
    assert not policy.can_subscribe(admin, Topic.case(CASE_ID))
    assert policy.can_subscribe(analyst, Topic.inbox(analyst.staff_id))
    assert not policy.can_subscribe(analyst, other_inbox)
    assert policy.can_subscribe(supervisor, other_inbox)
    assert policy.can_subscribe(supervisor, Topic.approvals())
    assert not policy.can_subscribe(analyst, Topic.approvals())


def test_topic_mapper_uses_case_by_default_and_registered_rules() -> None:
    mapper = TopicMapper()
    assert [str(t) for t in mapper.topics_for(assigned())] == [f"case:{CASE_ID}"]

    mapper.register(CaseAssigned, lambda e: [Topic.inbox(e.analyst_id), Topic.case(CASE_ID)])  # type: ignore[attr-defined]
    assert [str(t) for t in mapper.topics_for(assigned())] == [
        f"case:{CASE_ID}",
        f"inbox:{STAFF_ID}",
    ]


async def test_projector_fans_out_envelopes_to_topic_subscribers() -> None:
    hub = InMemoryRealtimeHub()
    listener = hub.connect(connection_id="CON-1", staff_id=STAFF_ID, session_id="SES-1")
    bystander = hub.connect(connection_id="CON-2", staff_id=STAFF_ID, session_id="SES-2")
    hub.subscribe(listener.id, f"case:{CASE_ID}")
    hub.subscribe(bystander.id, "approvals")

    await RealtimeProjector(hub, TopicMapper())(record(assigned()))

    envelope = await listener.next_envelope()
    assert envelope is not None
    assert envelope.to_wire() == {
        "type": "case.assigned",
        "id": "EVT-" + "0" * 25 + "1",
        "occurredAt": "2026-10-02T14:00:00Z",
        "data": {
            "entity": "case",
            "entityId": CASE_ID,
            "caseId": CASE_ID,
            "actor": {"role": "supervisor", "id": STAFF_ID},
            "payload": {"analyst_id": STAFF_ID},
        },
    }
    assert hub.subscriber_count("approvals") == 1
    hub.disconnect(bystander.id)
    assert await bystander.next_envelope() is None


async def test_events_without_topics_are_not_published() -> None:
    hub = InMemoryRealtimeHub()
    event = SessionEnded(
        occurred_at=NOW, actor=ActorRef(ActorRole.ANALYST, STAFF_ID), entity_id="SES-1",
        staff_id=STAFF_ID, reason="logout",
    )  # fmt: skip
    connection = hub.connect(connection_id="CON-1", staff_id=STAFF_ID, session_id="SES-1")
    hub.subscribe(connection.id, f"inbox:{STAFF_ID}")
    await RealtimeProjector(hub, TopicMapper())(record(event))
    await SessionTerminator(hub)(record(event))
    assert await connection.next_envelope() is None
    assert connection.close_reason == "session_ended"
