"""FastAPI dependencies: API context access, authenticated actor and RBAC.

Every route declares the roles it allows with ``require_roles`` (brief §4.5)::

    @router.get("/staff")
    async def list_staff(actor: Annotated[Actor, Depends(require_roles(SUPERVISOR, ADMIN))]): ...
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, cast

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.requests import HTTPConnection

from cc_platform.api.context import ApiContext
from cc_platform.application.security import Actor, CustomerActor, ensure_any_role
from cc_platform.domain.people.staff import StaffRole

session_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="SessionToken",
    description="Session token returned by POST /api/v1/auth/mfa.",
)

customer_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="CustomerToken",
    description="Customer token returned by POST /api/v1/customer/sessions (simulator).",
)

API_CONTEXT_STATE = "api_context"


def get_api_context(connection: HTTPConnection) -> ApiContext:
    return cast("ApiContext", getattr(connection.app.state, API_CONTEXT_STATE))


ApiContextDep = Annotated[ApiContext, Depends(get_api_context)]


async def current_actor(
    api: ApiContextDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(session_bearer)],
) -> Actor:
    token = credentials.credentials if credentials is not None else None
    return await api.use_cases.people.authenticate.execute(token)


CurrentActor = Annotated[Actor, Depends(current_actor)]


def require_roles(*roles: StaffRole) -> Callable[[Actor], Awaitable[Actor]]:
    """Dependency factory: the actor must hold at least one of ``roles``."""
    if not roles:
        raise ValueError("require_roles needs at least one role; use CurrentActor for any staff")
    allowed = frozenset(roles)

    async def dependency(actor: CurrentActor) -> Actor:
        ensure_any_role(actor, allowed)
        return actor

    return dependency


async def current_customer(
    api: ApiContextDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(customer_bearer)],
) -> CustomerActor:
    """Customer routes accept only customer tokens (a staff token is ``unauthenticated``)."""
    token = credentials.credentials if credentials is not None else None
    return await api.use_cases.customers.authenticate.execute(token)


CurrentCustomer = Annotated[CustomerActor, Depends(current_customer)]
