"""Slice 12: simulated phone calls, email and internal notes (no telephony, no mail server).

Staff routes (``/cases/{caseId}/…``): every write is the case's assignee analyst (403
``case_not_assigned``); reads (calls, email thread) follow the case's read access (assignee,
history access, supervisors). Unknown or malformed ids, or a call of another case → 404.

Customer routes (``/customer/…``, customer token): only their own calls and emails; anyone
else's call is 404 like an unknown id.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Response, status

from cc_platform.api.dependencies import ApiContextDep, CurrentCustomer, require_roles
from cc_platform.api.routers.cases import (
    IDEMPOTENCY_KEY,
    REPLAYED_HEADER,
    IdempotencyKey,
    ensure_idempotency_key,
)
from cc_platform.api.schemas.cases import PostTurnResponse
from cc_platform.api.schemas.channels import (
    CallLineRequest,
    CallList,
    CallResponse,
    CustomerCall,
    CustomerCallLineResponse,
    CustomerCallResponse,
    CustomerCallState,
    CustomerEmailThread,
    EmailReplyRequest,
    EmailReplyResponse,
    EmailThread,
    MuteCallRequest,
    NoteRequest,
    SendEmailRequest,
    SendEmailResponse,
    StartCallRequest,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.application.cases.dto import (
    CustomerEmailCommand,
    EmailReplyCommand,
    PostTurnCommand,
    StartOutboundCallCommand,
)
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole

router = APIRouter(prefix="/cases", tags=["channels"])
customer_router = APIRouter(prefix="/customer", tags=["customer"])

Analyst = Annotated[Actor, Depends(require_roles(StaffRole.ANALYST))]
AnalystOrSupervisor = Annotated[
    Actor, Depends(require_roles(StaffRole.ANALYST, StaffRole.SUPERVISOR))
]
CaseId = Annotated[str, Path(alias="caseId", max_length=64, examples=["CASE-01J…"])]
CallId = Annotated[str, Path(alias="callId", max_length=64, examples=["CALL-01J…"])]
CallKey = Annotated[
    str,
    Header(
        alias=IDEMPOTENCY_KEY,
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9-]+$",
        description="One key per call the caller means to start: a retry with it replays the "
        "call it started (200 + `Idempotent-Replayed: true`).",
    ),
]

_CALL_STATE_ERRORS = (
    "409 `call_not_active` (with `currentState`) once the call ended; 409 "
    "`invalid_transition` (with `currentState`) from any other state."
)


def _replayed(response: Response, replayed: bool) -> None:
    if replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"


# ----------------------------------------------------------------------------- staff: calls
@router.get(
    "/{caseId}/calls",
    response_model=CallList,
    summary="The calls of a case, the most recent first",
    responses=problem_responses(401, 403, 404),
)
async def list_calls(case_id: CaseId, actor: AnalystOrSupervisor, api: ApiContextDep) -> CallList:
    return CallList.from_view(await api.use_cases.channels.list_calls.execute(actor, case_id))


@router.post(
    "/{caseId}/calls",
    response_model=CallResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Call the customer (outbound, the assignee, with a reason)",
    description=(
        "The assignee analyst only (403 `case_not_assigned`), on an open assigned case (409 "
        "`case_closed` / `invalid_transition`) without an active call (409 `call_in_progress` "
        "with `callId`). It rings until the customer answers or rejects it; a `new` case moves "
        "to `in_progress`. Records `call.started`."
    ),
    responses={
        200: {"description": "Replay of the same Idempotency-Key", "model": CallResponse},
        **problem_responses(401, 403, 404, 409, 422),
    },
)
async def start_call(
    *,
    case_id: CaseId,
    body: StartCallRequest,
    idempotency_key: CallKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> CallResponse:
    result = await api.use_cases.channels.start_outbound_call.execute(
        actor,
        case_id,
        StartOutboundCallCommand(reason=body.reason, idempotency_key=idempotency_key),
    )
    _replayed(response, result.replayed)
    return CallResponse.from_result(result)


@router.post(
    "/{caseId}/calls/{callId}/answer",
    response_model=CallResponse,
    summary="Answer an inbound call that rings (the assignee)",
    description=(
        "`ringing → in_call`. Answering is a response: the first one stops the first-response "
        "SLA (`case.first_responded`) and a `new` case moves to `in_progress`. An outbound "
        f"call is answered by the customer (409 `invalid_transition`). {_CALL_STATE_ERRORS}"
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def answer_call(
    case_id: CaseId, call_id: CallId, actor: Analyst, api: ApiContextDep
) -> CallResponse:
    result = await api.use_cases.channels.answer_call.execute(actor, case_id, call_id)
    return CallResponse.from_result(result)


@router.post(
    "/{caseId}/calls/{callId}/hold",
    response_model=CallResponse,
    summary="Put the call on hold (`in_call → on_hold`)",
    description=f"Writes a `system` transcript line. {_CALL_STATE_ERRORS}",
    responses=problem_responses(401, 403, 404, 409),
)
async def hold_call(
    case_id: CaseId, call_id: CallId, actor: Analyst, api: ApiContextDep
) -> CallResponse:
    result = await api.use_cases.channels.hold_call.execute(actor, case_id, call_id)
    return CallResponse.from_result(result)


@router.post(
    "/{caseId}/calls/{callId}/resume",
    response_model=CallResponse,
    summary="Resume the call (`on_hold → in_call`)",
    description=f"Closes the hold interval and writes a `system` transcript line. "
    f"{_CALL_STATE_ERRORS}",
    responses=problem_responses(401, 403, 404, 409),
)
async def resume_call(
    case_id: CaseId, call_id: CallId, actor: Analyst, api: ApiContextDep
) -> CallResponse:
    result = await api.use_cases.channels.resume_call.execute(actor, case_id, call_id)
    return CallResponse.from_result(result)


@router.post(
    "/{caseId}/calls/{callId}/mute",
    response_model=CallResponse,
    summary="Mute or unmute the analyst's line",
    description=(
        "While `in_call` or `on_hold`. The same value changes nothing (no event). "
        f"{_CALL_STATE_ERRORS}"
    ),
    responses=problem_responses(401, 403, 404, 409, 422),
)
async def mute_call(
    case_id: CaseId, call_id: CallId, body: MuteCallRequest, actor: Analyst, api: ApiContextDep
) -> CallResponse:
    result = await api.use_cases.channels.set_call_muted.execute(
        actor, case_id, call_id, body.muted
    )
    return CallResponse.from_result(result)


@router.post(
    "/{caseId}/calls/{callId}/hangup",
    response_model=CallResponse,
    summary="Hang up (or stop calling while it rings)",
    description=(
        "Ends the call (`completed` once answered, `cancelled` while it rang) and writes a "
        "`system` transcript line; the case can be closed again. 409 `call_not_active` once "
        "it ended."
    ),
    responses=problem_responses(401, 403, 404, 409),
)
async def hang_up_call(
    case_id: CaseId, call_id: CallId, actor: Analyst, api: ApiContextDep
) -> CallResponse:
    result = await api.use_cases.channels.hang_up_call.execute(actor, case_id, call_id)
    return CallResponse.from_result(result)


@router.post(
    "/{caseId}/calls/{callId}/transcript",
    response_model=PostTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add what the analyst said to the call transcript",
    description=(
        "A `transcript` turn (the customer sees it), only while the call is `in_call` "
        "(409 `invalid_transition` on hold or ringing, `call_not_active` once ended). "
        "Idempotent on `clientMessageId` (= `Idempotency-Key`)."
    ),
    responses={
        200: {"description": "Replay of an already-added line", "model": PostTurnResponse},
        **problem_responses(401, 403, 404, 409, 422),
    },
)
async def add_call_line(
    *,
    case_id: CaseId,
    call_id: CallId,
    body: CallLineRequest,
    idempotency_key: IdempotencyKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> PostTurnResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.channels.post_call_line.execute(
        actor,
        case_id,
        call_id,
        PostTurnCommand(text=body.text, client_message_id=body.client_message_id),
    )
    _replayed(response, result.replayed)
    return PostTurnResponse.from_result(result)


# ----------------------------------------------------------------------------- staff: notes
@router.post(
    "/{caseId}/notes",
    response_model=PostTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add an internal note (staff only)",
    description=(
        "A `note` turn with audience `staff`: the customer never sees it (REST or socket). The "
        "assignee analyst, on an open assigned case. Idempotent on `clientMessageId` "
        "(= `Idempotency-Key`)."
    ),
    responses={
        200: {"description": "Replay of an already-added note", "model": PostTurnResponse},
        **problem_responses(401, 403, 404, 409, 422),
    },
)
async def add_note(
    *,
    case_id: CaseId,
    body: NoteRequest,
    idempotency_key: IdempotencyKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> PostTurnResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.channels.add_note.execute(
        actor, case_id, PostTurnCommand(text=body.text, client_message_id=body.client_message_id)
    )
    _replayed(response, result.replayed)
    return PostTurnResponse.from_result(result)


# ----------------------------------------------------------------------------- staff: email
@router.get(
    "/{caseId}/emails",
    response_model=EmailThread,
    summary="The case's email thread, oldest first",
    responses=problem_responses(401, 403, 404),
)
async def get_email_thread(
    case_id: CaseId, actor: AnalystOrSupervisor, api: ApiContextDep
) -> EmailThread:
    return EmailThread.from_view(await api.use_cases.channels.email_thread.execute(actor, case_id))


@router.post(
    "/{caseId}/emails",
    response_model=EmailReplyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Answer the customer by email (the assignee)",
    description=(
        'The platform frames the body with "Hola, {nombre}:" and "Saludos,\\n{Analista}\\n'
        'LATAM Bank" (Portuguese cases: "Olá, {nome}:" / "Atenciosamente,"). Subject: '
        '"Re: <thread subject>" unless given (required without a thread: 422 '
        "`invalid_value`). The first reply stops the first-response SLA. Idempotent on "
        "`clientMessageId` (= `Idempotency-Key`)."
    ),
    responses={
        200: {"description": "Replay of an already-sent email", "model": EmailReplyResponse},
        **problem_responses(401, 403, 404, 409, 422),
    },
)
async def reply_email(
    *,
    case_id: CaseId,
    body: EmailReplyRequest,
    idempotency_key: IdempotencyKey,
    actor: Analyst,
    api: ApiContextDep,
    response: Response,
) -> EmailReplyResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.channels.reply_email.execute(
        actor,
        case_id,
        EmailReplyCommand(
            body=body.body, subject=body.subject, client_message_id=body.client_message_id
        ),
    )
    _replayed(response, result.replayed)
    return EmailReplyResponse.from_result(result)


# ----------------------------------------------------------------------------- customer: calls
@customer_router.get(
    "/call",
    response_model=CustomerCallState,
    summary="My call now: the active one, else the latest of my current conversation",
    responses=problem_responses(401),
)
async def get_my_call(customer: CurrentCustomer, api: ApiContextDep) -> CustomerCallState:
    view = await api.use_cases.channels.customer_call.execute(customer)
    return CustomerCallState(call=CustomerCall.from_view(view) if view else None)


@customer_router.post(
    "/calls",
    response_model=CustomerCallResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Call the bank: joins the open conversation or opens one (phone_inbound)",
    description=(
        "With no open case a new one opens (channel `phone_inbound`, linked to the previous "
        "closed one) and is assigned like a chat (`with_agent`) or waits in the queue "
        "(`waiting_agent`); it rings until the assignee answers. With an open case the call "
        "joins it (409 `call_in_progress` if it already has one)."
    ),
    responses={
        200: {"description": "Replay of the same Idempotency-Key", "model": CustomerCallResponse},
        **problem_responses(401, 409, 422),
    },
)
async def start_my_call(
    *,
    idempotency_key: CallKey,
    customer: CurrentCustomer,
    api: ApiContextDep,
    response: Response,
) -> CustomerCallResponse:
    result = await api.use_cases.channels.start_inbound_call.execute(customer, idempotency_key)
    _replayed(response, result.replayed)
    return CustomerCallResponse.from_result(result)


@customer_router.post(
    "/calls/{callId}/answer",
    response_model=CustomerCallResponse,
    summary="Answer the bank's call (outbound)",
    description=(
        "`ringing → in_call`; the analyst's first response if the case had none. An inbound "
        f"call is answered by the bank (409 `invalid_transition`). {_CALL_STATE_ERRORS}"
    ),
    responses=problem_responses(401, 404, 409),
)
async def answer_my_call(
    call_id: CallId, customer: CurrentCustomer, api: ApiContextDep
) -> CustomerCallResponse:
    result = await api.use_cases.channels.answer_outbound_call.execute(customer, call_id)
    return CustomerCallResponse.from_result(result)


@customer_router.post(
    "/calls/{callId}/reject",
    response_model=CustomerCallResponse,
    summary="Reject the bank's call while it rings",
    responses=problem_responses(401, 404, 409),
)
async def reject_my_call(
    call_id: CallId, customer: CurrentCustomer, api: ApiContextDep
) -> CustomerCallResponse:
    result = await api.use_cases.channels.reject_call.execute(customer, call_id)
    return CustomerCallResponse.from_result(result)


@customer_router.post(
    "/calls/{callId}/hangup",
    response_model=CustomerCallResponse,
    summary="Hang up (an inbound call that still rings is cancelled)",
    responses=problem_responses(401, 404, 409),
)
async def hang_up_my_call(
    call_id: CallId, customer: CurrentCustomer, api: ApiContextDep
) -> CustomerCallResponse:
    result = await api.use_cases.channels.customer_hang_up.execute(customer, call_id)
    return CustomerCallResponse.from_result(result)


@customer_router.post(
    "/calls/{callId}/transcript",
    response_model=CustomerCallLineResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add what I said to the call transcript (only while in_call)",
    responses={
        200: {"description": "Replay of an already-added line", "model": CustomerCallLineResponse},
        **problem_responses(401, 404, 409, 422),
    },
)
async def add_my_call_line(
    *,
    call_id: CallId,
    body: CallLineRequest,
    idempotency_key: IdempotencyKey,
    customer: CurrentCustomer,
    api: ApiContextDep,
    response: Response,
) -> CustomerCallLineResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.channels.post_customer_call_line.execute(
        customer,
        call_id,
        PostTurnCommand(text=body.text, client_message_id=body.client_message_id),
    )
    _replayed(response, result.replayed)
    return CustomerCallLineResponse.from_result(result)


# ----------------------------------------------------------------------------- customer: email
@customer_router.get(
    "/emails",
    response_model=CustomerEmailThread,
    summary="The email thread of my current conversation",
    responses=problem_responses(401),
)
async def get_my_emails(customer: CurrentCustomer, api: ApiContextDep) -> CustomerEmailThread:
    view = await api.use_cases.channels.customer_emails.execute(customer)
    return CustomerEmailThread.from_view(view)


@customer_router.post(
    "/emails",
    response_model=SendEmailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Email the bank: joins the open conversation or opens one (email)",
    description=(
        "With no open case a new one opens (channel `email`) and is assigned like a chat or "
        "waits in the queue; with an open case the email joins it. Idempotent on "
        "`clientMessageId` (= `Idempotency-Key`)."
    ),
    responses={
        200: {"description": "Replay of an already-sent email", "model": SendEmailResponse},
        **problem_responses(401, 409, 422),
    },
)
async def send_my_email(
    *,
    body: SendEmailRequest,
    idempotency_key: IdempotencyKey,
    customer: CurrentCustomer,
    api: ApiContextDep,
    response: Response,
) -> SendEmailResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.channels.send_customer_email.execute(
        customer,
        CustomerEmailCommand(
            subject=body.subject, body=body.body, client_message_id=body.client_message_id
        ),
    )
    _replayed(response, result.replayed)
    return SendEmailResponse.from_result(result)
