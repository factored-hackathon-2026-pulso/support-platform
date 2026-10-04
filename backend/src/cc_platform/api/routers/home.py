"""The analyst home, "Inicio" (slice 6): what happened since her previous session and her
team's queues now. Analysts only; read-only (nothing is recorded)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.home import AnalystHome
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/me", tags=["home"])

Analyst = Annotated[Actor, Depends(require_roles(StaffRole.ANALYST))]


@router.get(
    "/home",
    response_model=AnalystHome,
    summary="My home: activity since my previous session and my team's queues now",
    description=(
        "`since` is the end of her previous session (the latest ended or expired session "
        "other than the current one), or now − 8 h without one (`sinceSource: fallback`). "
        "`activity` lists structured rows (no text) built from the event log after `since`: "
        "only her cases (held now, or assigned to her or taken away from her), never her own "
        "actions, one row per case and kind, newest first, at most 10 (`total` counts them "
        "all). `teamNow` counts the available analysts of her team and the cases waiting in "
        "the queues of her languages (no names)."
    ),
    responses=problem_responses(401, 403),
)
async def get_home(actor: Analyst, api: ApiContextDep) -> AnalystHome:
    return AnalystHome.from_view(await api.use_cases.cases.analyst_home.execute(actor))
