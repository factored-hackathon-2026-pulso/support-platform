"""Platform settings (slice 18, ADR 0006): the AI switch ("Funciones de IA").

Administración reads and changes it (``/admin/platform``); the customer simulator reads it
(``/customer/platform``); staff read it in ``/auth/me``. A change records
``platform.ai_toggled`` (audited) and reaches every connected client as ``platform.updated``
on ``platform:settings``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from cc_platform.api.dependencies import ApiContextDep, CurrentCustomer, require_roles
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.platform import (
    AdminPlatformSettings,
    PlatformSettings,
    SetAiEnabledRequest,
    SetAiEnabledResult,
)
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(tags=["platform"])

Admin = Annotated[Actor, Depends(require_roles(StaffRole.ADMIN))]


@router.get(
    "/admin/platform",
    response_model=AdminPlatformSettings,
    summary="The platform settings (Administración)",
    responses=problem_responses(401, 403),
)
async def get_admin_settings(actor: Admin, api: ApiContextDep) -> AdminPlatformSettings:
    return AdminPlatformSettings.from_view(await api.use_cases.platform.settings.execute())


@router.put(
    "/admin/platform/ai",
    response_model=SetAiEnabledResult,
    summary="Turn the AI functions on or off (Administración)",
    description=(
        "Slice 18. Sets the desired state, so it is safe to repeat: the same state answers "
        "200 with `changed: false` and records nothing. A change records "
        '`platform.ai_toggled` `{enabled}` (audit: "Activó / Desactivó las funciones de IA") '
        "and sends `platform.updated` on `platform:settings`. Off: new chats go to people, the "
        "copilot answers `available: false`, the builder is unavailable; an assistant "
        "conversation already under way is not interrupted."
    ),
    responses=problem_responses(401, 403, 422),
)
async def set_ai_enabled(
    body: SetAiEnabledRequest, actor: Admin, api: ApiContextDep
) -> SetAiEnabledResult:
    view = await api.use_cases.platform.set_ai_enabled.execute(actor, body.enabled)
    return SetAiEnabledResult.from_view(view)


@router.get(
    "/customer/platform",
    response_model=PlatformSettings,
    summary="The platform settings as the customer simulator needs them",
    description="Slice 18: whether the AI functions are on (live: `platform:settings`).",
    responses=problem_responses(401),
)
async def get_customer_settings(customer: CurrentCustomer, api: ApiContextDep) -> PlatformSettings:
    return PlatformSettings.from_view(await api.use_cases.platform.settings.execute())
