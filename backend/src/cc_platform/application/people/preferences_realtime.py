"""``PreferencesRealtimeProjector`` (slice 23): her own settings, live on her other sessions.

``staff.ui_language_changed`` → ``preferences.updated`` on ``staff:<id>`` with her
``Preferences`` (``{uiLanguage}``): every open tab of hers switches language without a
reload. Only that person listens to ``staff:<id>``.
"""

from __future__ import annotations

from typing import Protocol

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.people.events import StaffUiLanguageChanged
from cc_platform.domain.people.preferences import UiLanguage
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject

#: Events this projection owns (their raw envelopes never reach a socket).
PREFERENCES_EVENTS: tuple[type[DomainEvent], ...] = (StaffUiLanguageChanged,)


class PreferencesRealtimePresenter(Protocol):
    """Serialises the preferences exactly like the REST schema (camelCase JSON)."""

    def preferences(self, *, ui_language: UiLanguage) -> JsonObject: ...


class PreferencesRealtimeProjector:
    def __init__(self, hub: RealtimeHub, presenter: PreferencesRealtimePresenter) -> None:
        self._hub = hub
        self._present = presenter

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if not isinstance(event, StaffUiLanguageChanged):
            return
        payload = self._present.preferences(ui_language=UiLanguage(event.to_language))
        envelope = derived_envelope(
            record, "preferences.updated", payload, actor_id=record.actor_id
        )
        await self._hub.publish(str(Topic.staff(event.entity_id)), envelope)
