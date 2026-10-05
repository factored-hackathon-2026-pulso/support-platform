"""``PlatformRealtimeProjector`` (slice 18 §5): the AI switch, live on every client.

``platform.ai_toggled`` → ``platform.updated`` on ``platform:settings`` with the public
``PlatformSettings`` (``{aiEnabled}``). Every signed-in staff member and every customer
simulator session may follow that topic, so the SPA shows or hides its AI elements and the
simulator follows at once. The actor id is not sent (customers listen too).
"""

from __future__ import annotations

from typing import Protocol

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.platform.events import PlatformAiToggled
from cc_platform.domain.shared.json import JsonObject


class PlatformRealtimePresenter(Protocol):
    """Serialises the public settings exactly like the REST schema (camelCase JSON)."""

    def platform_settings(self, *, ai_enabled: bool) -> JsonObject: ...


class PlatformRealtimeProjector:
    def __init__(self, hub: RealtimeHub, presenter: PlatformRealtimePresenter) -> None:
        self._hub = hub
        self._present = presenter

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if not isinstance(event, PlatformAiToggled):
            return
        payload = self._present.platform_settings(ai_enabled=event.enabled)
        envelope = derived_envelope(record, "platform.updated", payload, actor_id=None)
        await self._hub.publish(str(Topic.platform_settings()), envelope)
