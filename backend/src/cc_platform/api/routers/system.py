"""Health and build metadata (no authentication)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Response, status

from cc_platform import __version__
from cc_platform.api.dependencies import ApiContextDep
from cc_platform.api.schemas.system import HealthResponse, MetaResponse

API_VERSION = "v1"

router = APIRouter(tags=["system"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness and dependency checks",
    responses={503: {"model": HealthResponse, "description": "A dependency is failing"}},
)
async def health(api: ApiContextDep, response: Response) -> HealthResponse:
    checks: dict[str, Literal["ok", "failing"]] = {}
    for probe in api.health_probes:
        checks[probe.name] = "ok" if await probe.check() else "failing"
    healthy = all(value == "ok" for value in checks.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return HealthResponse(status="ok" if healthy else "degraded", checks=checks)


@router.get("/meta", response_model=MetaResponse, summary="API version and build")
async def meta(api: ApiContextDep) -> MetaResponse:
    return MetaResponse(
        name="cc-platform",
        version=__version__,
        build=api.build_info.build,
        environment=api.build_info.environment,
        api_version=API_VERSION,
        dev_mailbox=api.build_info.dev_mailbox,
    )
