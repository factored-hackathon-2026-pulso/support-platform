"""The signed-in analyst's availability ("Disponible" / "En pausa").

Paused analysts get no new cases (the ones they have stay with them); switching to
available assigns queued cases right away (queue drain in the background).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.availability import Availability, UpdateAvailabilityRequest
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/me", tags=["availability"])

Analyst = Annotated[Actor, Depends(require_roles(StaffRole.ANALYST))]


@router.get(
    "/availability",
    response_model=Availability,
    summary="My availability (never set = paused)",
    responses=problem_responses(401, 403),
)
async def get_availability(actor: Analyst, api: ApiContextDep) -> Availability:
    return Availability.from_view(await api.use_cases.people.get_availability.execute(actor))


@router.put(
    "/availability",
    response_model=Availability,
    summary="Set my availability (same status = no change, no event)",
    responses=problem_responses(401, 403, 422),
)
async def set_availability(
    body: UpdateAvailabilityRequest, actor: Analyst, api: ApiContextDep
) -> Availability:
    view = await api.use_cases.people.set_availability.execute(actor, body.status)
    return Availability.from_view(view)
