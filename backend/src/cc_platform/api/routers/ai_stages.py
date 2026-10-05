"""The AI stages per case type (slice 21, ADR 0006).

``GET /ai/stages`` is what the Workspace (the stage strip; a case's copilot mode is its type's)
and Supervisión read. Supervisión moves a type back (``POST /supervision/ai/stages/{caseType}/
move-back``). ``POST /cases/{caseId}/copilot/suggestions/{suggestionId}/tools`` records that the
analyst used a tool the copilot proposed (a stage 2 signal). A stage change reaches every
analyst and supervisor as ``ai.stage_updated`` on ``ai:stages``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response, status

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.ai_stages import (
    AiStages,
    MoveStageBackRequest,
    MoveStageBackResult,
    ToolUsedRequest,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(tags=["ai-stages"])

Analyst = Annotated[Actor, Depends(require_roles(StaffRole.ANALYST))]
Supervisor = Annotated[Actor, Depends(require_roles(StaffRole.SUPERVISOR))]
AnalystOrSupervisor = Annotated[
    Actor, Depends(require_roles(StaffRole.ANALYST, StaffRole.SUPERVISOR))
]
CaseId = Annotated[str, Path(alias="caseId", max_length=64, examples=["CASE-01J…"])]


@router.get(
    "/ai/stages",
    response_model=AiStages,
    summary="The AI stage of every case type (analysts and Supervisión)",
    description=(
        "Slice 21. Every case type but `none`, with its stage (0-3), whether an agent is "
        "proposed (`ready`) or serves it (`active`), the copilot mode a case of the type gets, "
        "the signals counted since its current stage and the team rule (example thresholds). "
        "A type nothing happened to is at stage 0. AI off: `available: false` and no types. "
        "Live: `ai.stage_updated` on `ai:stages`."
    ),
    responses=problem_responses(401, 403),
)
async def get_ai_stages(actor: AnalystOrSupervisor, api: ApiContextDep) -> AiStages:
    return AiStages.from_view(await api.use_cases.maturity.stages.execute(actor))


@router.post(
    "/supervision/ai/stages/{caseType}/move-back",
    response_model=MoveStageBackResult,
    summary="Move a case type back to an earlier stage (Supervisión)",
    description=(
        "Slice 21. A desired state, safe to repeat: the same stage answers `changed: false`. "
        "`toStage` 3 on a type `ready` for an agent withdraws the proposal. Moving up is only "
        "the team rule's. 409 `invalid_transition` for a higher stage or a type an agent serves "
        "(slice 22 deactivates the agent). Records `ai.stage_moved_back` (audited); the type "
        "earns the stages above again from zero. AI off: 404 `assistant_disabled`."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def move_stage_back(
    case_type: Annotated[str, Path(alias="caseType", max_length=40, examples=["undue_charge"])],
    body: MoveStageBackRequest,
    actor: Supervisor,
    api: ApiContextDep,
) -> MoveStageBackResult:
    view = await api.use_cases.maturity.move_back.execute(actor, case_type, to_stage=body.to_stage)
    return MoveStageBackResult.from_view(view)


@router.post(
    "/cases/{caseId}/copilot/suggestions/{suggestionId}/tools",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="The analyst used a tool the copilot proposed",
    description=(
        'Slice 21. Send it when "Usar" asks the copilot about a `tool` of the suggestion. '
        "Records `copilot.tool_used` (audited; the suggestion is not changed); it feeds the "
        "stage 2 signal of the case's type. Her own suggestion (`ready`), a tool it proposed: "
        "404 otherwise. AI off: 404 `assistant_disabled`."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def record_tool_used(
    case_id: CaseId,
    suggestion_id: Annotated[str, Path(alias="suggestionId", max_length=64, examples=["CPS-01J…"])],
    body: ToolUsedRequest,
    actor: Analyst,
    api: ApiContextDep,
) -> Response:
    await api.use_cases.maturity.tool_used.execute(actor, case_id, suggestion_id, tool=body.tool)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
