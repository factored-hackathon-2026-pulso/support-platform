"""The HTTP side of the Core's resilience layer (deploy brief P4): the shared ``httpx`` client
(transport timeouts, the W3C trace on every request) and the readiness check of the Core."""

from __future__ import annotations

import httpx

from cc_platform.application.ai.availability import CoreStatus
from cc_platform.application.ai.runtime import AgentRuntimeUnavailableError
from cc_platform.application.tracing import current_trace, new_trace
from cc_platform.infrastructure.core.resilience import CallKind, CoreGuard, CoreTimeouts

#: agent-core's liveness route (public, no token; agent-core ``api/tracing.py``).
CORE_HEALTH_PATH = "/healthz"


async def send_trace_context(request: httpx.Request) -> None:
    """``httpx`` request hook: every call to the Core carries ``traceparent`` (the current trace
    with a new parent id) and the incoming ``tracestate``, if any."""
    trace = current_trace() or new_trace()
    request.headers.update(trace.child().headers())


def core_http_client(
    base_url: str,
    *,
    timeouts: CoreTimeouts,
    connect_timeout: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.AsyncClient:
    """One client for the runtime and the registry APIs. Its read timeout is only a backstop (the
    longest kind's budget): ``CoreGuard`` enforces each kind's own. Connecting is short, so a Core
    that is down fails fast. ``transport`` is a seam for tests."""
    return httpx.AsyncClient(
        base_url=base_url,
        timeout=httpx.Timeout(timeouts.longest, connect=connect_timeout, pool=connect_timeout),
        event_hooks={"request": [send_trace_context]},
        transport=transport,
    )


class CoreHealth:
    """``CoreStatusCheck`` for ``/readyz``: ``degraded`` while the breaker is open (no call), else
    a quick ``GET /healthz`` of the Core through the guard. The probe counts like any call, so a
    readiness poll also notices a Core that went down (and closes the breaker when it is back)
    before a customer runs into it. Never raises."""

    def __init__(self, client: httpx.AsyncClient, guard: CoreGuard) -> None:
        self._client = client
        self._guard = guard

    async def __call__(self) -> CoreStatus:
        if not self._guard.is_available():
            return "degraded"
        try:
            await self._guard.call(CallKind.PROBE, "healthz", self._ping)
        except Exception:
            return "degraded"
        return "ok"

    async def _ping(self) -> None:
        try:
            response = await self._client.get(CORE_HEALTH_PATH)
        except httpx.HTTPError:
            raise AgentRuntimeUnavailableError("agent-core did not answer") from None
        if response.status_code >= 500:
            raise AgentRuntimeUnavailableError(f"agent-core failed ({response.status_code})")
