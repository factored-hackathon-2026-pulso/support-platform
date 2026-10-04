"""Development tools (part 4): the dev mailbox. 404 unless ``CC_DEV_MAILBOX`` is on, which
the settings refuse in production. No authentication: the invited person is not signed in
when the demo opens her invitation link."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from cc_platform.api.dependencies import ApiContextDep
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.onboarding import DevEmail, DevMailbox

router = APIRouter(prefix="/dev", tags=["dev"])


@router.get(
    "/mailbox",
    response_model=DevMailbox,
    summary="Development only: the newest emails the platform 'sent' (with their links)",
    responses=problem_responses(404, 422),
)
async def dev_mailbox(
    api: ApiContextDep, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> DevMailbox:
    view = await api.use_cases.onboarding.dev_mailbox.execute(limit)
    return DevMailbox(items=[DevEmail.from_view(item) for item in view.items])
