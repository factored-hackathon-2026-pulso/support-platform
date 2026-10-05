"""The AI switch ("Funciones de IA", slice 18 contract §2, ADR 0005).

One platform-wide setting, persisted (``PlatformSettings``), changed by Administración and read
by every place where the AI layer could act:

- ``AiSwitch`` answers "is AI on now?" from the stored setting, or the deployment default
  (``CC_AI_ENABLED``) while nobody changed it. The assistant gate (new chats), the copilot and
  the agent builder ask it; off, they behave as if agent-core were not configured, so the
  platform is exactly the people-only one.
- ``GetPlatformSettings`` is what the SPA (``/auth/me``, the admin screen) and the customer
  simulator read.
- ``SetAiEnabled`` turns it on or off: a ``PUT`` of a desired state, safe to repeat (the same
  value is a no-op, ``changed: false``), run in ``retry_on_conflict`` on the singleton's
  compare-and-set. It records ``platform.ai_toggled`` (audited, and pushed live to every
  client on ``platform:settings``).

Turning AI off never interrupts a conversation the assistant already holds: it only stops new
chats from starting with it (contract §2.3).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.platform.settings import PlatformSettings


@dataclass(frozen=True, slots=True)
class PlatformDefaults:
    """Deployment facts the settings fall back on or report."""

    ai_enabled: bool = True
    """``CC_AI_ENABLED``: the AI switch until Administración changes it."""
    agent_core_configured: bool = False
    """Whether agent-core is wired (``CC_AGENT_CORE_URL``): with AI on but no agent-core the
    platform behaves as today (people only), and the admin screen says so."""


async def load_settings(
    uow: UnitOfWork, defaults: PlatformDefaults
) -> tuple[PlatformSettings, bool]:
    """The singleton and whether it is new (built from the defaults, not stored yet)."""
    stored = await uow.platform_settings.get()
    if stored is not None:
        return stored, False
    return PlatformSettings(ai_enabled=defaults.ai_enabled), True


@dataclass(frozen=True, slots=True)
class AiSwitch:
    """Reads the AI switch (the stored value, else the deployment default)."""

    uow: UnitOfWorkFactory
    defaults: PlatformDefaults

    async def is_on(self) -> bool:
        async with self.uow() as uow:
            return await self.is_on_in(uow)

    async def is_on_in(self, uow: UnitOfWork) -> bool:
        """Inside a Unit of Work the caller already holds."""
        settings, _new = await load_settings(uow, self.defaults)
        return settings.ai_enabled


@dataclass(frozen=True, slots=True)
class PlatformSettingsView:
    ai_enabled: bool
    agent_core_configured: bool
    version: int
    updated_at: datetime | None
    updated_by_id: str | None
    updated_by_name: str | None


async def _view(
    uow: UnitOfWork, settings: PlatformSettings, defaults: PlatformDefaults
) -> PlatformSettingsView:
    name = None
    if settings.updated_by_id is not None:
        person = await uow.staff.get(settings.updated_by_id)
        name = person.name if person is not None else None
    return PlatformSettingsView(
        ai_enabled=settings.ai_enabled,
        agent_core_configured=defaults.agent_core_configured,
        version=settings.version,
        updated_at=settings.updated_at,
        updated_by_id=settings.updated_by_id,
        updated_by_name=name,
    )


@dataclass(frozen=True, slots=True)
class GetPlatformSettings:
    uow: UnitOfWorkFactory
    defaults: PlatformDefaults

    async def execute(self) -> PlatformSettingsView:
        async with self.uow() as uow:
            settings, _new = await load_settings(uow, self.defaults)
            return await _view(uow, settings, self.defaults)


@dataclass(frozen=True, slots=True)
class SetAiResultView:
    changed: bool
    settings: PlatformSettingsView


@dataclass(frozen=True, slots=True)
class SetAiEnabled:
    """Administración turns the AI functions on or off (the router requires the role; the
    actor is recorded as ``admin``)."""

    uow: UnitOfWorkFactory
    clock: Clock
    defaults: PlatformDefaults

    async def execute(self, actor: Actor, enabled: bool) -> SetAiResultView:
        return await retry_on_conflict(lambda: self._attempt(actor, enabled))

    async def _attempt(self, actor: Actor, enabled: bool) -> SetAiResultView:
        async with self.uow() as uow:
            settings, new = await load_settings(uow, self.defaults)
            changed = settings.set_ai_enabled(
                enabled=enabled, actor=actor.acting_as({StaffRole.ADMIN}), at=self.clock.now()
            )
            if not changed:
                return SetAiResultView(
                    changed=False, settings=await _view(uow, settings, self.defaults)
                )
            if new:
                await uow.platform_settings.add(settings)
            else:
                await uow.platform_settings.save(settings)
            await uow.commit()
            return SetAiResultView(changed=True, settings=await _view(uow, settings, self.defaults))
