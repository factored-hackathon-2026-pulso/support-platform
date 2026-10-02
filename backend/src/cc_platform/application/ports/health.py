"""Health probe port used by ``GET /api/v1/health``."""

from __future__ import annotations

from typing import Protocol


class HealthProbe(Protocol):
    name: str

    async def check(self) -> bool:
        """Return True when the dependency is reachable. Must not raise."""
        ...
