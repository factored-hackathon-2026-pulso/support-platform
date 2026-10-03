"""Staff directory (supervision and administration)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.people import StaffListResponse, StaffOut
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/staff", tags=["people"])

SupervisorOrAdmin = Annotated[Actor, Depends(require_roles(StaffRole.SUPERVISOR, StaffRole.ADMIN))]


@router.get(
    "",
    response_model=StaffListResponse,
    summary="List staff (active only unless includeInactive), optionally by role",
    responses=problem_responses(401, 403),
)
async def list_staff(
    _actor: SupervisorOrAdmin,
    api: ApiContextDep,
    role: Annotated[StaffRole | None, Query(description="Only staff holding this role")] = None,
    include_inactive: Annotated[
        bool, Query(alias="includeInactive", description="Also deactivated accounts")
    ] = False,
) -> StaffListResponse:
    views = await api.use_cases.people.list_staff.execute(
        role=role, include_inactive=include_inactive
    )
    return StaffListResponse(items=[StaffOut.from_view(view) for view in views])
