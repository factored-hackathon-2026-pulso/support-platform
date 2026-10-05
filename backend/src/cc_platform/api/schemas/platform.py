"""Schemas of the platform settings (slice 18): the AI switch ("Funciones de IA")."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.platform.settings import PlatformSettingsView, SetAiResultView


class PlatformSettings(ApiModel):
    """What every client reads (staff in ``/auth/me``, the simulator in
    ``/customer/platform``, both live as ``platform.updated`` on ``platform:settings``)."""

    ai_enabled: bool = Field(
        description="The AI switch. Off: hide every AI element; the platform is people-only "
        "(new chats go to people, no copilot, no builder)."
    )

    @classmethod
    def from_view(cls, view: PlatformSettingsView) -> PlatformSettings:
        return cls(ai_enabled=view.ai_enabled)


class AdminPlatformSettings(ApiModel):
    """Administración's view of the settings ("Plataforma")."""

    ai_enabled: bool
    agent_core_configured: bool = Field(
        description="Whether agent-core is wired. With AI on but no agent-core, the assistant, "
        "the copilot and the builder stay unavailable (the platform behaves as today)."
    )
    version: int = Field(description="0 while the deployment default (`CC_AI_ENABLED`) applies.")
    updated_at: datetime | None = Field(description="The last change; null: never changed.")
    updated_by_name: str | None = Field(description="Who made the last change.")

    @classmethod
    def from_view(cls, view: PlatformSettingsView) -> AdminPlatformSettings:
        return cls(
            ai_enabled=view.ai_enabled,
            agent_core_configured=view.agent_core_configured,
            version=view.version,
            updated_at=view.updated_at,
            updated_by_name=view.updated_by_name,
        )


class SetAiEnabledRequest(RequestModel):
    enabled: bool = Field(description="The desired state of the AI switch.")


class SetAiEnabledResult(ApiModel):
    changed: bool = Field(description="false: the switch was already in that state (no event).")
    settings: AdminPlatformSettings

    @classmethod
    def from_view(cls, view: SetAiResultView) -> SetAiEnabledResult:
        return cls(changed=view.changed, settings=AdminPlatformSettings.from_view(view.settings))
