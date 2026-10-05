"""Analyst Workspace: inbox ("Casos"), case detail, the customer's other cases, transcript,
replies, read cursor, close, the priority (slice 8: the assignee or supervision), the case
type (slice 18, the same rules) and the escalation to supervision (slice 9: escalate, withdraw,
"Entendido").

Visibility (enforced in the use cases, contract §4.3): the assignee analyst reads and
writes; any supervisor reads; an analyst who holds (or held) another case of the same
customer reads (history access). Unknown or malformed ids → 404 ``not_found``; anything
else → 403 ``case_not_assigned``. ``/cases/inbox`` is declared before ``/cases/{caseId}``.
"""

from __future__ import annotations

from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Header, Path, Query, Response, status
from fastapi.exceptions import RequestValidationError

from cc_platform.api.dependencies import ApiContextDep, require_roles
from cc_platform.api.routers._assistant import (
    ai_is_on,
    assistant_use_cases,
    suggestion_use_cases,
    switched_assistant_use_cases,
)
from cc_platform.api.schemas.cases import (
    AskCopilotRequest,
    CaseDetail,
    CaseHandoff,
    CaseHistory,
    CasePriorityResult,
    CaseSummary,
    CaseTypeResult,
    ChangeCaseTypeRequest,
    ChangePriorityRequest,
    CloseCaseRequest,
    CopilotExchange,
    CopilotSuggestion,
    CopilotThread,
    EscalateRequest,
    EscalationResult,
    InboxResponse,
    LatestCopilotSuggestion,
    MarkReadRequest,
    PostAnalystTurnRequest,
    PostTurnResponse,
    RequestSuggestionRequest,
    SuggestionFeedbackRequest,
    TurnPage,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.cases.case_type import ChangeCaseTypeCommand
from cc_platform.application.cases.dto import CaseSummaryView, CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.escalations import EscalateCommand
from cc_platform.application.cases.priority import ChangePriorityCommand
from cc_platform.application.errors import VersionConflictError
from cc_platform.application.pagination import MAX_SEQUENCE
from cc_platform.application.security import Actor
from cc_platform.domain.cases.values import InboxStatus
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.json import JsonValue

router = APIRouter(prefix="/cases", tags=["cases"])

Analyst = Annotated[Actor, Depends(require_roles(StaffRole.ANALYST))]
AnalystOrSupervisor = Annotated[
    Actor, Depends(require_roles(StaffRole.ANALYST, StaffRole.SUPERVISOR))
]
CaseId = Annotated[str, Path(alias="caseId", max_length=64, examples=["CASE-01J…"])]
EscalationId = Annotated[str, Path(alias="escalationId", max_length=64, examples=["ESC-01J…"])]

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


CreationKey = Annotated[
    str,
    Header(
        alias=IDEMPOTENCY_KEY,
        min_length=8,
        max_length=64,
        description="One key per escalation the caller means to open: a retry with it replays "
        "the escalation it created (200 + `Idempotent-Replayed: true`).",
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
    after_sequence: Annotated[
        int | None, Query(alias="afterSequence", ge=0, le=MAX_SEQUENCE)
    ] = None,
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
    suggestions = api.use_cases.assistant.suggestions if api.use_cases.assistant else None
    if body.copilot_suggestion_id and suggestions is not None:  # best effort: never fails the reply
        await suggestions.link.reply_sent(
            actor,
            case_id,
            body.copilot_suggestion_id,
            sent_text=result.turn.text,
            turn_id=result.turn.id,
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
        CloseCaseCommand(
            reason=body.reason,
            note=body.note,
            handoff_quality=body.handoff_quality,
            handoff_reasked=tuple(body.handoff_reasked or ()),
        ),
    )
    return CaseDetail.from_view(detail)


@router.get(
    "/{caseId}/handoff",
    response_model=CaseHandoff,
    summary="The packet the assistant built when it escalated this case (assignee only)",
    description=(
        "ADR 0003. Only the case's assignee analyst (403 `case_not_assigned` otherwise), and "
        "only for a case that came from an assistant escalation (404 `handoff_unavailable`). "
        "The platform asks agent-core with the analyst's own delegation on this customer, so "
        "what she sees in clear is decided there. 404 `assistant_disabled` while agent-core is "
        "not configured; 503 `agent_core_unavailable` / 502 `agent_core_rejected` when it does "
        "not answer or refuses."
    ),
    responses=problem_responses(401, 403, 404, 502, 503),
)
async def get_handoff(case_id: CaseId, actor: Analyst, api: ApiContextDep) -> CaseHandoff:
    packet = await assistant_use_cases(api).handoff.execute(actor, case_id)
    return CaseHandoff(packet=dict(packet))


@router.get(
    "/{caseId}/copilot",
    response_model=CopilotThread,
    summary="The analyst's conversation with the copilot about this case",
    description=(
        "Slice 15 (ADR 0003). Only the case's assignee analyst (403 `case_not_assigned` "
        "otherwise). `available: false` (with no messages) while agent-core is not configured, "
        "the AI switch is off (slice 18) or the customer is not linked to the dataset: hide the "
        "panel, it is not an error."
    ),
    responses=problem_responses(401, 403, 404),
)
async def get_copilot(case_id: CaseId, actor: Analyst, api: ApiContextDep) -> CopilotThread:
    use_cases = api.use_cases.assistant
    if use_cases is None or not await ai_is_on(api):
        return CopilotThread(case_id=case_id, available=False, messages=[])
    return CopilotThread.from_view(await use_cases.copilot_thread.execute(actor, case_id))


@router.post(
    "/{caseId}/copilot/messages",
    response_model=CopilotExchange,
    status_code=status.HTTP_201_CREATED,
    summary="Ask the copilot something about this case",
    description=(
        "Slice 15 (ADR 0003). The copilot reads and calculates (it suggests what to look up and "
        "never acts) and answers as the analyst: agent-core decides what she may see. The call "
        "waits for the model (seconds): show a spinner. Idempotent on `clientMessageId` "
        "(= `Idempotency-Key`): a retry with the same text answers 200 with "
        "`Idempotent-Replayed: true`, and repeats the call only if the first one got no answer. "
        "Only the assignee, only on an open case (409 `case_closed`) whose customer is linked "
        "(409 `copilot_unavailable`); 409 `copilot_busy` while it answers a previous question; "
        "404 `assistant_disabled` without agent-core or while the AI switch is off; 503 "
        "`agent_core_unavailable` / 502 `agent_core_rejected` when it does not answer (the "
        "question stays in the thread: ask again with the same `clientMessageId`)."
    ),
    responses={
        200: {"description": "Replay of a question already answered", "model": CopilotExchange},
        **problem_responses(401, 403, 404, 409, 422, 502, 503),
    },
)
async def ask_copilot(
    *,
    case_id: CaseId,
    body: AskCopilotRequest,
    idempotency_key: IdempotencyKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> CopilotExchange:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    exchange = await (await switched_assistant_use_cases(api)).ask_copilot.execute(
        actor, case_id, text=body.text, client_message_id=body.client_message_id
    )
    if exchange.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"
    return CopilotExchange.from_view(exchange)


@router.get(
    "/{caseId}/copilot/suggestions/latest",
    response_model=LatestCopilotSuggestion,
    summary="The copilot's newest suggestion for this case",
    description=(
        "ADR 0005. Only the case's assignee analyst (403 `case_not_assigned` otherwise). "
        "`available: false` hides the suggestions (agent-core, the suggestions agent or the "
        "dataset link is missing, or the AI switch is off); `suggestion: null` means none yet "
        "or its texts expired (24 hours). `stale: true` once the customer wrote after the "
        "turns it read. A suggestion that is `preparing` is on its way: ask again or wait for the "
        "`copilot.suggestion_ready` signal on `inbox:<staffId>`."
    ),
    responses=problem_responses(401, 403, 404),
)
async def latest_copilot_suggestion(
    case_id: CaseId, actor: Analyst, api: ApiContextDep
) -> LatestCopilotSuggestion:
    suggestions = assistant_use_cases(api).suggestions
    if suggestions is None or not await ai_is_on(api):
        return LatestCopilotSuggestion(available=False, suggestion=None)
    return LatestCopilotSuggestion.from_view(await suggestions.latest.execute(actor, case_id))


@router.post(
    "/{caseId}/copilot/suggestions",
    response_model=CopilotSuggestion,
    status_code=status.HTTP_201_CREATED,
    summary="Ask the copilot for a suggestion about this case",
    description=(
        "ADR 0005. The copilot reads the recent turns and answers a typed list that may be "
        "empty (`status: none` is a normal answer): a draft reply, reads to look at, a prepared "
        "action that is **not executable**, and a recommendation to escalate. Nothing is sent "
        "or run. The call waits for the model (seconds). Idempotent on `Idempotency-Key`: a "
        "retry of a request that has its answer is 200 with `Idempotent-Replayed: true` and "
        "asks nothing; after a failure the same key asks again. Only the assignee, only on an "
        "open case (409 `case_closed`) whose customer is linked (409 `copilot_unavailable`); "
        "409 `copilot_busy` while one is being prepared; 404 `assistant_disabled` without "
        "agent-core or the suggestions agent, or while the AI switch is off; 503/502 when "
        "agent-core does not answer."
    ),
    responses={
        200: {"description": "Replay of a request already answered", "model": CopilotSuggestion},
        **problem_responses(401, 403, 404, 409, 422, 502, 503),
    },
)
async def request_copilot_suggestion(
    *,
    case_id: CaseId,
    idempotency_key: IdempotencyKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
    body: RequestSuggestionRequest | None = None,
) -> CopilotSuggestion:
    view = await (await suggestion_use_cases(api)).request.execute(
        actor, case_id, request_key=idempotency_key
    )
    if view.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"
    return CopilotSuggestion.from_view(view)


@router.post(
    "/{caseId}/copilot/suggestions/{suggestionId}/feedback",
    response_model=CopilotSuggestion,
    summary="Dismiss the copilot's draft or its recommendation to escalate",
    description=(
        "ADR 0005. For the draft (`subject: reply`): `discarded` (the analyst dismissed it) or "
        "`ignored` (she left it). For the recommendation (`subject: escalation`): `dismissed` "
        '("Ahora no"). What was decided leaves the list; the rest of the suggestion stays. '
        "`used` and `edited` are derived when she replies with `copilotSuggestionId`; "
        "`accepted` when she escalates with it. 404 for an id that is not hers."
    ),
    responses=problem_responses(401, 403, 404, 422),
)
async def decide_copilot_suggestion(
    *,
    case_id: CaseId,
    suggestion_id: Annotated[str, Path(alias="suggestionId", max_length=64, examples=["CPS-01J…"])],
    body: SuggestionFeedbackRequest,
    actor: Analyst,
    api: ApiContextDep,
) -> CopilotSuggestion:
    view = await (await suggestion_use_cases(api)).decide.execute(
        actor, case_id, suggestion_id, decision=body.decision, subject=body.subject
    )
    return CopilotSuggestion.from_view(view)


@router.post(
    "/{caseId}/copilot/suggestions/{suggestionId}/shown",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="The analyst's screen showed the copilot's suggestion",
    description=(
        "Event catalog 1.3.0. Send it when a `ready` suggestion is on screen (the draft, the "
        'recommendation to escalate or "Herramientas"). Records `copilot.suggestion_shown` once '
        "per suggestion (audited, no text); a repeat, or one with nothing left to show, records "
        "nothing and is still 204. 404 for an id that is not hers."
    ),
    responses=problem_responses(401, 403, 404, 422),
)
async def copilot_suggestion_shown(
    *,
    case_id: CaseId,
    suggestion_id: Annotated[str, Path(alias="suggestionId", max_length=64, examples=["CPS-01J…"])],
    actor: Analyst,
    api: ApiContextDep,
) -> Response:
    await (await suggestion_use_cases(api)).shown.execute(actor, case_id, suggestion_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{caseId}/priority",
    response_model=CasePriorityResult,
    summary="Set the case priority (the assignee, or supervision on any open case)",
    description=(
        "Slice 8. Checks in this order: the case exists (404) · the caller is its assignee "
        "analyst or a supervisor (403 `case_not_assigned`) · it is not closed (409 "
        "`case_closed`) · it already has that priority (200, `changed: false`, nothing "
        "happens) · it is still at `expectedVersion` (409 `version_conflict`, with the case "
        "now as `current`). Records `case.priority_changed` `{from, to}`; the first-response "
        "SLA does not change."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def change_priority(
    case_id: CaseId, body: ChangePriorityRequest, actor: AnalystOrSupervisor, api: ApiContextDep
) -> CasePriorityResult:
    try:
        view = await api.use_cases.cases.change_priority.execute(
            actor,
            case_id,
            ChangePriorityCommand(priority=body.priority, expected_version=body.expected_version),
        )
    except VersionConflictError as exc:
        _attach_current_case(exc)
        raise
    return CasePriorityResult.from_view(view)


def _attach_current_case(exc: VersionConflictError) -> None:
    """``version_conflict`` carries the case as the caller reads it now (``current``)."""
    if isinstance(exc.current_view, CaseSummaryView):
        current: dict[str, Any] = CaseSummary.from_view(exc.current_view).model_dump(
            mode="json", by_alias=True
        )
        exc.details = {**exc.details, "current": cast("JsonValue", current)}


@router.put(
    "/{caseId}/type",
    response_model=CaseTypeResult,
    summary="Set what the case is about (the assignee, or supervision on any open case)",
    description=(
        "Slice 18, the same rules as the priority. Checks in this order: the case exists (404) "
        "· the caller is its assignee analyst or a supervisor (403 `case_not_assigned`) · it is "
        "not closed (409 `case_closed`) · it already has that type (200, `changed: false`, "
        "nothing happens) · it is still at `expectedVersion` (409 `version_conflict`, with the "
        "case now as `current`). Records `case.type_changed` `{from, to}`. Independent of the "
        "AI switch: the type is data about the case."
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def change_case_type(
    case_id: CaseId, body: ChangeCaseTypeRequest, actor: AnalystOrSupervisor, api: ApiContextDep
) -> CaseTypeResult:
    try:
        view = await api.use_cases.cases.change_type.execute(
            actor,
            case_id,
            ChangeCaseTypeCommand(case_type=body.case_type, expected_version=body.expected_version),
        )
    except VersionConflictError as exc:
        _attach_current_case(exc)
        raise
    return CaseTypeResult.from_view(view)


# ------------------------------------------------------------------------- escalations (slice 9)
@router.post(
    "/{caseId}/escalations",
    response_model=EscalationResult,
    status_code=status.HTTP_201_CREATED,
    summary="Escalate the case to supervision (the assignee, with a motive)",
    description=(
        "Slice 9. The assignee analyst only (403 `case_not_assigned`), on an open assigned "
        "case (409 `case_closed` / `invalid_transition`) without an open escalation (409 "
        "`escalation_open`). The motive is required (trimmed, at most 500). The case stays "
        "with her; a staff banner records it in the transcript; supervision is told live."
    ),
    responses={
        200: {"description": "Replay of the same Idempotency-Key", "model": EscalationResult},
        **problem_responses(401, 403, 404, 409, 422),
    },
)
async def escalate_case(
    *,
    case_id: CaseId,
    body: EscalateRequest,
    idempotency_key: CreationKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> EscalationResult:
    result = await api.use_cases.cases.escalate.execute(
        actor, case_id, EscalateCommand(motive=body.motive, idempotency_key=idempotency_key)
    )
    suggestions = api.use_cases.assistant.suggestions if api.use_cases.assistant else None
    if body.copilot_suggestion_id and suggestions is not None:  # best effort: never fails it
        await suggestions.link.escalated(actor, case_id, body.copilot_suggestion_id)
    if result.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"
    return EscalationResult.from_view(result)


@router.post(
    "/{caseId}/escalations/{escalationId}/withdraw",
    response_model=EscalationResult,
    summary="Withdraw the open escalation (the assignee)",
    description=(
        "Slice 9. The assignee analyst only, while it is open (409 `escalation_not_open` with "
        "`currentState` once supervision acted)."
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def withdraw_escalation(
    case_id: CaseId, escalation_id: EscalationId, actor: Analyst, api: ApiContextDep
) -> EscalationResult:
    view = await api.use_cases.cases.withdraw_escalation.execute(actor, case_id, escalation_id)
    return EscalationResult.from_view(view)


@router.post(
    "/{caseId}/escalations/{escalationId}/acknowledge",
    response_model=EscalationResult,
    summary='"Entendido": the analyst who escalated read what supervision did',
    description=(
        "Slice 9. Only who escalated (403 `case_not_assigned`), once supervision answered, took "
        "or reassigned the case (409 `invalid_transition` before). Repeating it changes nothing."
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def acknowledge_escalation(
    case_id: CaseId, escalation_id: EscalationId, actor: Analyst, api: ApiContextDep
) -> EscalationResult:
    view = await api.use_cases.cases.acknowledge_escalation.execute(actor, case_id, escalation_id)
    return EscalationResult.from_view(view)
