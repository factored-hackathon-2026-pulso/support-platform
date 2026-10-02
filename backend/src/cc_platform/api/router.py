"""Aggregates the context routers under ``/api/v1``."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.routing import APIRoute

from cc_platform.api.routers import (
    auth,
    availability,
    cases,
    customer,
    people,
    realtime,
    system,
)

API_PREFIX = "/api/v1"


def build_api_router() -> APIRouter:
    router = APIRouter(prefix=API_PREFIX)
    router.include_router(system.router)
    router.include_router(auth.router)
    router.include_router(people.router)
    router.include_router(availability.router)
    router.include_router(cases.router)
    router.include_router(customer.router)
    router.include_router(realtime.router)
    return router


def operation_id(route: APIRoute) -> str:
    """Stable, readable operation ids for generated clients (``auth_login``)."""
    tag = route.tags[0] if route.tags else "default"
    return f"{tag}_{route.name}"
