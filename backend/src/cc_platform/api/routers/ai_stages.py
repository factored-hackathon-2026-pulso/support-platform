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
    ActivateAgentRequest,
    ActivateAgentResult,
    AiAgents,
    AiStages,
    CaseTypeStage,
    MoveStageBackRequest,
    MoveStageBackResult,
    RenameAgentRequest,
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
        "(slice 22 activates one; deactivating is not built). Records `ai.stage_moved_back` "
        "(audited); the type earns the stages above again from zero. AI off: 404 "
        "`assistant_disabled`."
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
    "/supervision/ai/stages/{caseType}/agent",
    response_model=ActivateAgentResult,
    summary="Activate the agent of a case type (Supervisión)",
    description=(
        'Slice 22, "Activar". For a type `ready` for an agent: points the agent\'s `prod` alias '
        "at the published release (the registry's promotion, audited as `builder.alias_promoted`) "
        "and records that the agent serves the type (`agent: active`, `agentId`; audited as "
        "`ai.agent_activated`, live on `ai:stages`). Needs a fresh authenticator code "
        "(`stepUpCode`): a wrong one is 422 `builder_step_up_invalid` (`remainingAttempts`; it "
        "counts toward the account lock, 423 `account_locked`). Safe to repeat: the agent that "
        "already serves the type answers `changed: false` without promoting. 409 "
        "`invalid_transition` for a type not ready or served by another agent (checked before "
        "anything is promoted); registry refusals are `registry_*`. AI off or no agent-core: "
        "404 `assistant_disabled`."
    ),
    responses=problem_responses(401, 403, 404, 409, 422, 423, 429, 502, 503),
)
async def activate_agent(
    case_type: Annotated[str, Path(alias="caseType", max_length=40, examples=["undue_charge"])],
    body: ActivateAgentRequest,
    actor: Supervisor,
    api: ApiContextDep,
) -> ActivateAgentResult:
    view = await api.use_cases.maturity.activate_agent.execute(
        actor,
        case_type,
        agent_id=body.agent_id,
        release_id=body.release_id,
        step_up_code=body.step_up_code,
    )
    return ActivateAgentResult.from_view(view)


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
    responses=problem_responses(401, 403, 404, 422),
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


@router.get(
    "/ai/agents",
    response_model=AiAgents,
    summary="The agents the platform knows: name to show and results (analysts and Supervisión)",
    description=(
        "ADR 0009. One row per agent that serves a case type or has held an assistant session: "
        "`displayName` (Supervisión's name, else the id humanized), the type it serves and its "
        "results (sessions, still open, resolved, handed to people), counted from the assistant "
        "sessions by their last answering agent. AI off: `available: false`."
    ),
    responses=problem_responses(401, 403),
)
async def get_ai_agents(actor: AnalystOrSupervisor, api: ApiContextDep) -> AiAgents:
    return AiAgents.from_view(await api.use_cases.agent_catalog.agents.execute(actor))


@router.put(
    "/supervision/ai/stages/{caseType}/agent/name",
    response_model=CaseTypeStage,
    summary="Name the agent that serves a case type (Supervisión)",
    description=(
        "ADR 0009. 1 to 80 characters. 404 `not_found`: the type has no agent; 404 "
        "`assistant_disabled`: AI off. Audited (`ai.agent_renamed`, without the name), live on "
        "`ai:stages`."
    ),
    responses=problem_responses(401, 403, 404, 422),
)
async def rename_agent(
    case_type: Annotated[str, Path(alias="caseType", max_length=40, examples=["undue_charge"])],
    body: RenameAgentRequest,
    actor: Supervisor,
    api: ApiContextDep,
) -> CaseTypeStage:
    view = await api.use_cases.agent_catalog.rename.execute(actor, case_type, name=body.name)
    return CaseTypeStage.from_view(view)
