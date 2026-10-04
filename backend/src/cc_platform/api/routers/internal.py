"""Service-to-service routes (not part of the public contract: absent from the OpenAPI document).

Authenticated with a shared secret (``CC_INTERNAL_SERVICE_TOKEN``, ``Authorization: Bearer``),
compared in constant time. Without the secret, or without agent-core, they answer ``404``: nothing
to expose. Today it has one consumer: agent-core's ``grant_active`` check (ADR 0003, S17).
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Header, Path
from pydantic import BaseModel

from cc_platform.api.dependencies import ApiContextDep
from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.domain.shared.errors import NotFoundError

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


class GrantStatus(BaseModel):
    active: bool


def _authorize(token: str | None, authorization: str | None) -> None:
    if token is None:
        raise NotFoundError()  # not configured: the route does not exist
    presented = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(presented.encode(), token.encode()):
        raise AuthenticationRequiredError()


@router.get("/grants/{grantRef}", response_model=GrantStatus)
async def grant_status(
    grant_ref: Annotated[str, Path(alias="grantRef", max_length=128)],
    api: ApiContextDep,
    authorization: Annotated[str | None, Header()] = None,
) -> GrantStatus:
    _authorize(api.internal_token, authorization)
    assistant = api.use_cases.assistant
    if assistant is None:
        raise NotFoundError()
    return GrantStatus(active=await assistant.grant_status.execute(grant_ref))
