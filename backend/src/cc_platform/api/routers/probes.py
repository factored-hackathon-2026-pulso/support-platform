"""Liveness and readiness for the orchestrator and the reverse proxy (no authentication).

Mounted at the root, outside ``/api/v1`` and outside the OpenAPI contract, like the Core's
(agent-core M9 §3.9). Both are cheap, answer JSON and never include error text.

- ``GET /healthz``: 200 ``{"status": "ok"}`` while the process serves; touches nothing.
- ``GET /readyz``: runs every ``ReadinessProbe`` at once, each bounded by
  ``CC_READINESS_TIMEOUT_SECONDS``. 200 ``{"status": "ready", "checks": {…}}`` when every
  critical probe is ``ok`` (a non-critical one, the Core, may be ``degraded``); otherwise 503
  ``{"status": "not_ready", "checks": {…}}``.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from cc_platform.api.dependencies import ApiContextDep
from cc_platform.application.ports.health import ReadinessProbe

router = APIRouter(tags=["system"], include_in_schema=False)

#: Paths the access log keeps quiet about (an orchestrator polls them every few seconds).
PROBE_PATHS = frozenset({"/healthz", "/readyz"})
_NO_STORE = {"Cache-Control": "no-store"}


@router.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"status": "ok"}, headers=_NO_STORE)


@router.get("/readyz")
async def readyz(api: ApiContextDep) -> JSONResponse:
    probes = list(api.readiness.probes)
    states = await asyncio.gather(
        *(_bounded(probe, api.readiness.timeout_seconds) for probe in probes)
    )
    results = list(zip(probes, states, strict=True))
    checks = {probe.name: state for probe, state in results}
    ready = all(state == "ok" for probe, state in results if probe.critical)
    return JSONResponse(
        {"status": "ready" if ready else "not_ready", "checks": checks},
        status_code=200 if ready else 503,
        headers=_NO_STORE,
    )


async def _bounded(probe: ReadinessProbe, limit_seconds: float) -> str:
    try:
        async with asyncio.timeout(limit_seconds):
            return await probe.state()
    except Exception:  # a timeout or a probe bug: down, without the error text
        return "unreachable" if probe.critical else "degraded"
