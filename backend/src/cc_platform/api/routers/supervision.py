"""Supervision: team and queues, manual assignment (slice 3 §4); slice 9: "Colas" (every open
case of a language) and "Escalados" (answer, take the case).

Supervisors only. A supervisor reads any case through ``/cases/{caseId}`` (read-only; that
read is audited as ``case.viewed``) and assigns or reassigns it here. Rule 3 applies to a
manual assignment too: a Portuguese case only to a Portuguese speaker.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.routers._assistant import assistant_use_cases
from cc_platform.api.schemas.cases import CaseSummary, EscalationResult, RespondEscalationRequest
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.supervision import (
    AssignmentResult,
    EscalationOverview,
    LanguageOpenCases,
    QueueOverview,
    SetAssigneeRequest,
    TeamOverview,
)
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import Language, StaffRole

router = APIRouter(prefix="/supervision", tags=["supervision"])

Supervisor = Annotated[Actor, Depends(require_roles(StaffRole.SUPERVISOR))]
CaseId = Annotated[str, Path(alias="caseId", max_length=64, examples=["CASE-01J…"])]
EscalationId = Annotated[str, Path(alias="escalationId", max_length=64, examples=["ESC-01J…"])]


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


@router.post(
    "/cases/{caseId}/assistant/release",
    response_model=CaseSummary,
    summary="Take a case from the assistant: it goes to the language queue",
    description=(
        "ADR 0003. For a case in `with_assistant`: the assistant stops, the case becomes "
        "`queued` and `AssignCase` places it like any arrival (rule 3), with a staff banner. "
        "409 `assistant_not_active` when the assistant does not hold it. 404 "
        "`assistant_disabled` while agent-core is not configured."
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def release_assistant_case(
    case_id: CaseId, actor: Supervisor, api: ApiContextDep
) -> CaseSummary:
    summary = await assistant_use_cases(api).release.execute(actor, case_id)
    return CaseSummary.from_view(summary)


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


@router.get(
    "/open-cases",
    response_model=LanguageOpenCases,
    summary='"Colas": every open case of one language and who holds it',
    description=(
        "Slice 9. Queued, assigned and in-progress cases of `language` (one indexed query): "
        "the ones nobody holds first (oldest first), then the held ones in open-inbox order. "
        "Assignment stays automatic: this is a view."
    ),
    responses=problem_responses(401, 403, 422),
)
async def get_open_cases(
    _actor: Supervisor,
    api: ApiContextDep,
    language: Annotated[Language, Query(description="es | pt")],
) -> LanguageOpenCases:
    view = await api.use_cases.cases.language_open_cases.execute(language)
    return LanguageOpenCases.from_view(view)


@router.get(
    "/escalations",
    response_model=EscalationOverview,
    summary='"Escalados": open escalations and the ones attended in the last 24 hours',
    responses=problem_responses(401, 403),
)
async def get_escalations(actor: Supervisor, api: ApiContextDep) -> EscalationOverview:
    return EscalationOverview.from_view(
        await api.use_cases.cases.escalation_overview.execute(actor)
    )


@router.post(
    "/escalations/{escalationId}/response",
    response_model=EscalationResult,
    summary="Answer an open escalation with a note (the case stays with the analyst)",
    description=(
        "Slice 9. 404 unknown escalation · 409 `escalation_not_open` (`currentState`) · 422 "
        "empty or longer than 500. The analyst sees the answer live in the case."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def respond_escalation(
    escalation_id: EscalationId,
    body: RespondEscalationRequest,
    actor: Supervisor,
    api: ApiContextDep,
) -> EscalationResult:
    view = await api.use_cases.cases.respond_escalation.execute(actor, escalation_id, body.note)
    return EscalationResult.from_view(view)


@router.post(
    "/escalations/{escalationId}/take",
    response_model=EscalationResult,
    summary="Take the escalated case yourself (supervisors who also hold Analista)",
    description=(
        "Slice 9. A reassignment to the caller: she must be an active analyst too (422 "
        "`analyst_not_eligible`) who speaks the case language (rule 3, 422 "
        "`language_mismatch`), and the escalation open (409 `escalation_not_open`). The "
        "customer is told who attends them now."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def take_escalated_case(
    escalation_id: EscalationId, actor: Supervisor, api: ApiContextDep
) -> EscalationResult:
    view = await api.use_cases.cases.take_escalated_case.execute(actor, escalation_id)
    return EscalationResult.from_view(view)
