"""Health ports: ``HealthProbe`` (``GET /api/v1/health``) and ``ReadinessProbe``
(``GET /readyz``)."""

from __future__ import annotations

from typing import Protocol


class HealthProbe(Protocol):
    name: str

    async def check(self) -> bool:
        """Return True when the dependency is reachable. Must not raise."""
        ...


class ReadinessProbe(Protocol):
    """One dependency of ``GET /readyz``.

    A ``critical`` probe that is not ``ok`` makes the instance not ready (503): the database.
    A non-critical one only reports itself degraded (still 200): the Core, without which the
    platform keeps serving every screen that needs no AI.
    """

    name: str
    critical: bool

    async def state(self) -> str:
        """``ok``, or why not (``unreachable``, ``not_migrated``, ``degraded``, ``disabled``).

        The caller bounds it with a timeout and treats an exception as a failure; the state
        must never carry error text (hosts, credentials).
        """
        ...
