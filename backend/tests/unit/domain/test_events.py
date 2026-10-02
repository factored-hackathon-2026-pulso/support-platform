from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

import pytest

from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import iso_utc, to_json_value

NOW = datetime(2026, 10, 2, 14, 30, tzinfo=UTC)


class Channel(StrEnum):
    APP = "app_chat"


@dataclass(frozen=True, kw_only=True, slots=True)
class SampleEvent(DomainEvent):
    event_type = "sample.happened"
    entity = "case"

    channel: Channel
    tags: frozenset[str]
    due_at: datetime


def make_event() -> SampleEvent:
    return SampleEvent(
        occurred_at=NOW,
        actor=ActorRef(ActorRole.ANALYST, "STF-" + "0" * 25 + "1"),
        entity_id="CASE-" + "0" * 25 + "1",
        case_id="CASE-" + "0" * 25 + "1",
        channel=Channel.APP,
        tags=frozenset({"b", "a"}),
        due_at=NOW,
    )


def test_payload_excludes_envelope_fields_and_is_json_safe() -> None:
    event = make_event()
    assert event.event_type == "sample.happened"
    assert event.entity == "case"
    assert event.payload() == {
        "channel": "app_chat",
        "tags": ["a", "b"],
        "due_at": "2026-10-02T14:30:00Z",
    }


def test_to_json_value_rejects_unknown_objects() -> None:
    with pytest.raises(TypeError):
        to_json_value(object())


def test_iso_utc_requires_aware_datetimes() -> None:
    assert iso_utc(NOW) == "2026-10-02T14:30:00Z"
    with pytest.raises(ValueError, match="naive"):
        iso_utc(datetime(2026, 1, 1))


def test_actor_ref_requires_id() -> None:
    with pytest.raises(InvalidValueError):
        ActorRef(ActorRole.SYSTEM, "  ")
    assert ActorRef.system().role is ActorRole.SYSTEM


def test_aggregate_root_collects_and_drains_events() -> None:
    class Thing(AggregateRoot):
        def touch(self) -> None:
            self._record(make_event())

    thing = Thing()
    assert not thing.has_pending_events
    thing.touch()
    thing.touch()
    assert thing.has_pending_events
    assert len(thing.pull_events()) == 2
    assert thing.pull_events() == []
