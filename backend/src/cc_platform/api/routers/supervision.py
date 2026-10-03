"""Supervision: team and queues ("Equipo y colas") and manual assignment (slice 3 §4).

Supervisors only. A supervisor reads any case through ``/cases/{caseId}`` (read-only; that
read is audited as ``case.viewed``) and assigns or reassigns it here. Rule 3 applies to a
manual assignment too: a Portuguese case only to a Portuguese speaker.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.supervision import (
    AssignmentResult,
    QueueOverview,
    SetAssigneeRequest,
    TeamOverview,
)
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/supervision", tags=["supervision"])

Supervisor = Annotated[Actor, Depends(require_roles(StaffRole.SUPERVISOR))]
CaseId = Annotated[str, Path(alias="caseId", max_length=64, examples=["CASE-01J…"])]


@router.get(
    "/team",
    response_model=TeamOverview,
    summary="Analysts by team: what each one is doing now, her load and open cases",
    description=(
        "Active staff holding the analyst role. `activity` is derived (never stored): busy "
        "or available while available (with or without open cases, even without a session), "
        "paused when paused and signed in, offline when paused and not signed in."
    ),
    responses=problem_responses(401, 403),
)
async def get_team(_actor: Supervisor, api: ApiContextDep) -> TeamOverview:
    return TeamOverview.from_view(await api.use_cases.cases.team_overview.execute())


@router.get(
    "/queues",
    response_model=QueueOverview,
    summary="The language queues (es, pt) with their cases, oldest first",
    responses=problem_responses(401, 403),
)
async def get_queues(_actor: Supervisor, api: ApiContextDep) -> QueueOverview:
    return QueueOverview.from_view(await api.use_cases.cases.queue_overview.execute())


@router.put(
    "/cases/{caseId}/assignee",
    response_model=AssignmentResult,
    summary="Assign a queued case, or reassign an open case, to an analyst",
    description=(
        "Checks in this order: the case exists (404) · it is not closed (409 `case_closed`) · "
        "the target is an active analyst (422 `analyst_not_eligible`) · she speaks the case "
        "language (rule 3, 422 `language_mismatch`) · she already holds it (200, "
        "`changed: false`, nothing happens) · the holder is still `expectedAnalystId` (409 "
        "`assignment_changed`) · a paused target needs `confirmPaused` (409 "
        "`analyst_paused`). A reassignment tells the customer who attends them now; a staff "
        "banner records every assignment."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def set_assignee(
    case_id: CaseId, body: SetAssigneeRequest, actor: Supervisor, api: ApiContextDep
) -> AssignmentResult:
    view = await api.use_cases.cases.set_assignee.execute(
        actor,
        case_id,
        SetAssigneeCommand(
            analyst_id=body.analyst_id,
            expected_analyst_id=body.expected_analyst_id,
            confirm_paused=body.confirm_paused,
        ),
    )
    return AssignmentResult.from_view(view)
