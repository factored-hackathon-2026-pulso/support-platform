"""``StaffPreferences`` (slice 23): a person's own UI language; a change records
``staff.ui_language_changed`` with the actor, the same value is a no-op."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from cc_platform.domain.people.events import StaffUiLanguageChanged
from cc_platform.domain.people.preferences import (
    DEFAULT_UI_LANGUAGE,
    StaffPreferences,
    UiLanguage,
)
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError

NOW = datetime(2026, 10, 4, 15, tzinfo=UTC)
STAFF_ID = "STF-" + "0" * 25 + "1"
HERSELF = ActorRef(ActorRole.ANALYST, STAFF_ID)


def test_the_default_is_spanish() -> None:
    preferences = StaffPreferences.default(STAFF_ID)
    assert preferences.ui_language is UiLanguage.SPANISH is DEFAULT_UI_LANGUAGE
    assert [language.value for language in UiLanguage] == ["es", "pt-BR"]


def test_a_change_records_the_event() -> None:
    preferences = StaffPreferences.default(STAFF_ID)
    assert preferences.set_ui_language(UiLanguage.PORTUGUESE_BRAZIL, now=NOW, actor=HERSELF)
    assert preferences.ui_language is UiLanguage.PORTUGUESE_BRAZIL
    (event,) = preferences.pull_events()
    assert isinstance(event, StaffUiLanguageChanged)
    assert event.event_type == "staff.ui_language_changed"
    assert (event.entity, event.entity_id, event.case_id) == ("staff", STAFF_ID, None)
    assert (event.actor, event.occurred_at) == (HERSELF, NOW)
    assert event.payload() == {"from_language": "es", "to_language": "pt-BR"}


def test_the_same_language_is_a_no_op() -> None:
    preferences = StaffPreferences.default(STAFF_ID)
    assert preferences.set_ui_language(UiLanguage.SPANISH, now=NOW, actor=HERSELF) is False
    assert preferences.pull_events() == []


def test_it_belongs_to_a_staff_member() -> None:
    with pytest.raises(InvalidValueError):
        StaffPreferences.default("CUS-" + "0" * 26)
