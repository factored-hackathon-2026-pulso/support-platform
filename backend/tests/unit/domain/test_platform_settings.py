"""``PlatformSettings`` (slice 18 contract §2): the AI switch is a singleton; a change records
``platform.ai_toggled`` and who made it, the same value is a no-op."""

from __future__ import annotations

from datetime import UTC, datetime

from cc_platform.domain.platform import (
    PLATFORM_EVENTS,
    SETTINGS_ID,
    PlatformAiToggled,
    PlatformSettings,
)
from cc_platform.domain.shared.actor import ActorRef, ActorRole

NOW = datetime(2026, 10, 4, 15, tzinfo=UTC)
ADMIN = ActorRef(ActorRole.ADMIN, "STF-" + "0" * 25 + "9")


def test_a_change_records_who_and_when() -> None:
    settings = PlatformSettings(ai_enabled=True)
    assert (settings.id, settings.version, settings.updated_at) == (SETTINGS_ID, 0, None)
    assert settings.set_ai_enabled(enabled=False, actor=ADMIN, at=NOW) is True
    assert (settings.ai_enabled, settings.updated_at, settings.updated_by_id) == (
        False,
        NOW,
        ADMIN.actor_id,
    )
    (event,) = settings.pull_events()
    assert isinstance(event, PlatformAiToggled)
    assert event.event_type == "platform.ai_toggled"
    assert (event.entity, event.entity_id, event.case_id) == ("platform", SETTINGS_ID, None)
    assert (event.actor, event.occurred_at) == (ADMIN, NOW)
    assert event.payload() == {"enabled": False}
    assert PlatformAiToggled in PLATFORM_EVENTS


def test_the_same_value_is_a_no_op() -> None:
    settings = PlatformSettings(ai_enabled=False)
    assert settings.set_ai_enabled(enabled=False, actor=ADMIN, at=NOW) is False
    assert settings.pull_events() == []
    assert settings.updated_at is None
