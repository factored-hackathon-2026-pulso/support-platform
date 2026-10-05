"""Use cases of the platform context (slice 18)."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.platform.settings import AiSwitch, GetPlatformSettings, SetAiEnabled


@dataclass(frozen=True, slots=True)
class PlatformUseCases:
    settings: GetPlatformSettings
    set_ai_enabled: SetAiEnabled
    ai_switch: AiSwitch
    """Read by the routers that gate an AI route (the builder, the copilot)."""
