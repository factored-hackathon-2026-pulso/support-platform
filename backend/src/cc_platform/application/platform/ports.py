"""Repository port of the platform context."""

from __future__ import annotations

from typing import Protocol

from cc_platform.domain.platform.settings import PlatformSettings


class PlatformSettingsRepository(Protocol):
    async def get(self) -> PlatformSettings | None:
        """The singleton, or ``None`` while nobody changed a switch (defaults apply)."""
        ...

    async def add(self, settings: PlatformSettings) -> None:
        """Store the singleton the first time (a concurrent first insert raises
        ``ConcurrentUpdateError``: retry on fresh state)."""
        ...

    async def save(self, settings: PlatformSettings) -> None: ...
