"""Aggregates the context routers under ``/api/v1``."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.routing import APIRoute

from cc_platform.api.routers import (
    administration,
    audit,
    auth,
    availability,
    cases,
    channels,
    customer,
    dev,
    home,
    notifications,
    onboarding,
    people,
    realtime,
    supervision,
    system,
)

API_PREFIX = "/api/v1"


def build_api_router() -> APIRouter:
    router = APIRouter(prefix=API_PREFIX)
    router.include_router(system.router)
    router.include_router(auth.router)
    router.include_router(onboarding.router)
    router.include_router(people.router)
    router.include_router(availability.router)
    router.include_router(home.router)
    router.include_router(notifications.router)
    router.include_router(cases.router)
    router.include_router(channels.router)
    router.include_router(supervision.router)
    router.include_router(audit.router)
    router.include_router(administration.router)
    router.include_router(customer.router)
    router.include_router(channels.customer_router)
    router.include_router(realtime.router)
    router.include_router(dev.router)
    return router


#: Short operation-id prefixes for long tags (``administration`` → ``admin_list_users``).
OPERATION_PREFIX: dict[str, str] = {"administration": "admin"}


def operation_id(route: APIRoute) -> str:
    """Stable, readable operation ids for generated clients (``auth_login``)."""
    tag = str(route.tags[0]) if route.tags else "default"
    return f"{OPERATION_PREFIX.get(tag, tag)}_{route.name}"
