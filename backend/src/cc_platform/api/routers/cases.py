"""Analyst Workspace: inbox ("Casos"), case detail, the customer's other cases, transcript,
replies, read cursor, close.

Visibility (enforced in the use cases, contract §4.3): the assignee analyst reads and
writes; any supervisor reads; an analyst who holds (or held) another case of the same
customer reads (history access). Unknown or malformed ids → 404 ``not_found``; anything
else → 403 ``case_not_assigned``. ``/cases/inbox`` is declared before ``/cases/{caseId}``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Response, status
from fastapi.exceptions import RequestValidationError

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.schemas.cases import (
    CaseDetail,
    CaseHistory,
    CaseSummary,
    CloseCaseRequest,
    InboxResponse,
    MarkReadRequest,
    PostAnalystTurnRequest,
    PostTurnResponse,
    TurnPage,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.security import Actor
from cc_platform.domain.cases.values import InboxStatus
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/cases", tags=["cases"])

Analyst = Annotated[Actor, Depends(require_roles(StaffRole.ANALYST))]
AnalystOrSupervisor = Annotated[
    Actor, Depends(require_roles(StaffRole.ANALYST, StaffRole.SUPERVISOR))
]
CaseId = Annotated[str, Path(alias="caseId", max_length=64, examples=["CASE-01J…"])]

IDEMPOTENCY_KEY = "Idempotency-Key"
REPLAYED_HEADER = "Idempotent-Replayed"
IdempotencyKey = Annotated[
    str,
    Header(
        alias=IDEMPOTENCY_KEY,
        min_length=8,
        max_length=64,
        description="Must equal the body `clientMessageId`; a retry with it is a replay.",
    ),
]


def ensure_idempotency_key(header: str, body_id: str) -> None:
    """The ``Idempotency-Key`` header must equal the body ``clientMessageId`` (422)."""
    if header != body_id:
        raise RequestValidationError(
            [
                {
                    "loc": ("header", IDEMPOTENCY_KEY),
                    "msg": "Idempotency-Key must equal clientMessageId",
                    "type": "value_error",
                }
            ]
        )


@router.get(
    "/inbox",
    response_model=InboxResponse,
    summary='The caller\'s cases ("Casos") and the status counters',
    description=(
        "No `status` = Todos (the open cases); `status=closed` = the caller's cases closed in "
        "the last 7 days. `counts` always cover the whole inbox (the counters are the "
        "filters), whatever `status` and `q` select. Open lists: `new` and `to_reply` first, "
        "then `waiting`, each by the oldest last interaction; `closed`: the most recently "
        "closed first. At most 200 items."
    ),
    responses=problem_responses(401, 403, 422),
)
async def get_inbox(
    actor: Analyst,
    api: ApiContextDep,
    status_filter: Annotated[
        InboxStatus | None, Query(alias="status", description="Omit for Todos (open cases)")
    ] = None,
    q: Annotated[
        str | None,
        Query(min_length=1, max_length=80, description="Customer name or case id (contains)"),
    ] = None,
) -> InboxResponse:
    view = await api.use_cases.cases.inbox.execute(actor, status=status_filter, query=q)
    return InboxResponse.from_view(view)


@router.get(
    "/{caseId}",
    response_model=CaseDetail,
    summary='Case detail: customer, "Cómo llegó a ti", closure, capabilities',
    responses=problem_responses(401, 403, 404),
)
async def get_case(case_id: CaseId, actor: AnalystOrSupervisor, api: ApiContextDep) -> CaseDetail:
    return CaseDetail.from_view(await api.use_cases.cases.detail.execute(actor, case_id))


@router.get(
    "/{caseId}/history",
    response_model=CaseHistory,
    summary='"Casos anteriores de este cliente": the customer\'s other cases',
    description=(
        "Any status, excluding `caseId`, newest `openedAt` first, at most 20 (`total` is the "
        "full count). Whoever may read `caseId` may read every listed case (read-only)."
    ),
    responses=problem_responses(401, 403, 404),
)
async def get_case_history(
    case_id: CaseId, actor: AnalystOrSupervisor, api: ApiContextDep
) -> CaseHistory:
    return CaseHistory.from_view(await api.use_cases.cases.history.execute(actor, case_id))


@router.get(
    "/{caseId}/turns",
    response_model=TurnPage,
    summary="A page of the transcript (ascending sequence)",
    description=(
        "No params → the latest page. `cursor` (from `olderCursor`) → the page before it. "
        "`afterSequence` → turns after it (gap fill after a reconnect). `cursor` and "
        "`afterSequence` are mutually exclusive."
    ),
    responses=problem_responses(401, 403, 404, 422),
)
async def list_turns(
    *,
    case_id: CaseId,
    actor: AnalystOrSupervisor,
    api: ApiContextDep,
    cursor: Annotated[str | None, Query(max_length=32)] = None,
    after_sequence: Annotated[int | None, Query(alias="afterSequence", ge=0)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> TurnPage:
    if cursor is not None and after_sequence is not None:
        raise RequestValidationError(
            [
                {
                    "loc": ("query", "cursor"),
                    "msg": "cursor and afterSequence are mutually exclusive",
                    "type": "value_error",
                }
            ]
        )
    page = await api.use_cases.cases.turns.execute(
        actor, case_id, cursor=cursor, after_sequence=after_sequence, limit=limit
    )
    return TurnPage.from_view(page)


@router.post(
    "/{caseId}/turns",
    response_model=PostTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reply to the customer (assignee only)",
    description=(
        "Idempotent on `clientMessageId` (= `Idempotency-Key`): a retry with the same text "
        "answers 200 with `Idempotent-Replayed: true` and the original turn; the same id with "
        "another text is `idempotency_conflict`. Moves a `new` case to `in_progress`; the "
        "first reply stops the first-response SLA."
    ),
    responses={
        200: {"description": "Replay of an already-created turn", "model": PostTurnResponse},
        **problem_responses(401, 403, 404, 409, 422),
    },
)
async def post_turn(
    *,
    case_id: CaseId,
    body: PostAnalystTurnRequest,
    idempotency_key: IdempotencyKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> PostTurnResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.cases.post_analyst_turn.execute(
        actor, case_id, PostTurnCommand(text=body.text, client_message_id=body.client_message_id)
    )
    if result.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"
    return PostTurnResponse.from_result(result)


@router.post(
    "/{caseId}/read",
    response_model=CaseSummary,
    summary="Move the assignee's read cursor (opening a new case starts it)",
    responses=problem_responses(401, 403, 404, 422),
)
async def mark_read(
    case_id: CaseId, body: MarkReadRequest, actor: Analyst, api: ApiContextDep
) -> CaseSummary:
    summary = await api.use_cases.cases.mark_read.execute(actor, case_id, body.up_to_sequence)
    return CaseSummary.from_view(summary)


@router.post(
    "/{caseId}/close",
    response_model=CaseDetail,
    summary="Close the case with a reason; the customer is told the conversation ended",
    description=(
        "Assignee only, from `assigned` or `in_progress`. The note is internal (trimmed, "
        "blank becomes null, at most 500 characters); the customer never sees the reason "
        "or the note. Their next message opens a new case linked to this one."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def close_case(
    case_id: CaseId, body: CloseCaseRequest, actor: Analyst, api: ApiContextDep
) -> CaseDetail:
    detail = await api.use_cases.cases.close.execute(
        actor,
        case_id,
        CloseCaseCommand(reason=body.reason, note=body.note),
    )
    return CaseDetail.from_view(detail)
