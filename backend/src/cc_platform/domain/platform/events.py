"""Domain events of the platform context (slice 18)."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.shared.events import DomainEvent


@dataclass(frozen=True, kw_only=True, slots=True)
class PlatformAiToggled(DomainEvent):
    """Administración turned the AI functions on or off ("Funciones de IA", ADR 0006).
    Payload ``{"enabled": true}``."""

    event_type = "platform.ai_toggled"
    entity = "platform"

    enabled: bool


#: Every event type of the platform context.
PLATFORM_EVENTS: tuple[type[DomainEvent], ...] = (PlatformAiToggled,)
