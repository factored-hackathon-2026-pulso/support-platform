"""Readiness of agent-core (the Core) for ``GET /readyz``: non-critical.

The platform keeps serving every screen that needs no AI while the Core is down, so a Core
that does not answer its own ``GET /readyz`` reports ``degraded`` and the instance stays
ready. ``disabled``: ``CC_AGENT_CORE_URL`` is unset (people-only platform).
"""

from __future__ import annotations

import httpx

#: The Core's readiness route (agent-core M9 §3.9: outside ``/v1``, no credential).
CORE_READINESS_PATH = "/readyz"


class CoreReadinessProbe:
    name = "core"
    critical = False

    def __init__(self, client: httpx.AsyncClient | None, *, timeout_seconds: float) -> None:
        self._client = client
        self._timeout = timeout_seconds

    async def state(self) -> str:
        if self._client is None:
            return "disabled"
        try:
            response = await self._client.get(CORE_READINESS_PATH, timeout=self._timeout)
        except httpx.HTTPError:
            return "degraded"
        return "ok" if response.status_code == httpx.codes.OK else "degraded"
