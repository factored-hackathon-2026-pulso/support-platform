"""Customer chat simulator (dev/demo tool): pick a seeded customer, chat as them.

Customer tokens (scheme ``CustomerToken``, audience ``cc-customer``) are separate from staff
tokens: each kind is ``unauthenticated`` on the other's routes. A customer only ever sees
their own conversations and only the turns meant for them.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Path, Query, Response, status

from cc_platform.api.dependencies import ApiContextDep, CurrentCustomer
from cc_platform.api.routers._assistant import assistant_use_cases
from cc_platform.api.routers.cases import (
    IDEMPOTENCY_KEY,
    REPLAYED_HEADER,
    IdempotencyKey,
    ensure_idempotency_key,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.customer import (
    AnswerConfirmationRequest,
    CreateCustomerSessionRequest,
    CustomerConversation,
    CustomerConversationDetail,
    CustomerConversationList,
    CustomerConversationResponse,
    CustomerConversationSummary,
    CustomerSessionResponse,
    DemoCustomer,
    DemoCustomerList,
    PostCustomerTurnRequest,
    PostCustomerTurnResponse,
    RateConversationRequest,
    VerifyStepUpRequest,
)
from cc_platform.application.cases.dto import PostTurnCommand, RateConversationCommand
from cc_platform.application.pagination import MAX_SEQUENCE
from cc_platform.domain.cases.values import CaseChannel

router = APIRouter(prefix="/customer", tags=["customer"])

RatingKey = Annotated[
    str,
    Header(
        alias=IDEMPOTENCY_KEY,
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9-]+$",
        description="Client-generated (UUID v4); a retry with it and the same answer replays.",
    ),
]


@router.get(
    "/demo-customers",
    response_model=DemoCustomerList,
    summary="Seeded customers for the simulator picker (no auth; empty without demo data)",
    description="Simulator customers first, then every other seeded customer by name.",
)
async def list_demo_customers(api: ApiContextDep) -> DemoCustomerList:
    views = await api.use_cases.customers.list_demo_customers.execute()
    return DemoCustomerList(items=[DemoCustomer.from_view(view) for view in views])


@router.post(
    "/sessions",
    response_model=CustomerSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a customer session (channel identity = app/web session)",
    responses=problem_responses(404, 422),
)
async def create_session(
    body: CreateCustomerSessionRequest, api: ApiContextDep
) -> CustomerSessionResponse:
    grant = await api.use_cases.customers.start_session.execute(
        body.customer_id, CaseChannel(body.channel) if body.channel else None
    )
    return CustomerSessionResponse.from_grant(grant)


@router.get(
    "/conversation",
    response_model=CustomerConversationResponse,
    summary="My current conversation (open case, else the last closed one) and its turns",
    responses=problem_responses(401, 422),
)
async def get_conversation(
    customer: CurrentCustomer,
    api: ApiContextDep,
    after_sequence: Annotated[
        int | None, Query(alias="afterSequence", ge=0, le=MAX_SEQUENCE)
    ] = None,
) -> CustomerConversationResponse:
    result = await api.use_cases.cases.customer_conversation.execute(
        customer, after_sequence=after_sequence
    )
    return CustomerConversationResponse.from_result(result)


@router.get(
    "/conversations",
    response_model=CustomerConversationList,
    summary="My past conversations (closed, other than the current one)",
    description="Newest `openedAt` first, at most 20.",
    responses=problem_responses(401),
)
async def list_past_conversations(
    customer: CurrentCustomer, api: ApiContextDep
) -> CustomerConversationList:
    views = await api.use_cases.cases.past_conversations.execute(customer)
    return CustomerConversationList(
        items=[CustomerConversationSummary.from_view(view) for view in views]
    )


@router.get(
    "/conversations/{caseId}",
    response_model=CustomerConversationDetail,
    summary="One of my conversations with its turns (read-only)",
    description="Up to the latest 200 turns meant for the customer, ascending.",
    responses=problem_responses(401, 404),
)
async def get_past_conversation(
    case_id: Annotated[str, Path(alias="caseId", max_length=64)],
    customer: CurrentCustomer,
    api: ApiContextDep,
) -> CustomerConversationDetail:
    view = await api.use_cases.cases.past_conversation.execute(customer, case_id)
    return CustomerConversationDetail.from_view(view)


@router.post(
    "/conversation/turns",
    response_model=PostCustomerTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Write to the bank: opens a case when none is open, else appends to it",
    description=(
        "Idempotent on `clientMessageId` (= `Idempotency-Key`): a retry with the same text "
        "answers 200 with `Idempotent-Replayed: true`. With no open case (never wrote, or the "
        "last one closed) a new case opens, linked to the previous closed one, and is "
        "assigned in the same request (`with_agent`) or waits in the queue (`waiting_agent`)."
    ),
    responses={
        200: {
            "description": "Replay of an already-sent message",
            "model": PostCustomerTurnResponse,
        },
        **problem_responses(401, 409, 422),
    },
)
async def post_turn(
    *,
    body: PostCustomerTurnRequest,
    idempotency_key: IdempotencyKey,
    customer: CurrentCustomer,
    api: ApiContextDep,
    response: Response,
) -> PostCustomerTurnResponse:
    ensure_idempotency_key(idempotency_key, body.client_message_id)
    result = await api.use_cases.cases.post_customer_turn.execute(
        customer, PostTurnCommand(text=body.text, client_message_id=body.client_message_id)
    )
    if result.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"
    return PostCustomerTurnResponse.from_result(result)


@router.post(
    "/conversation/confirmation",
    response_model=CustomerConversation,
    summary="Answer the assistant's confirmation (yes or no)",
    description=(
        "ADR 0003. While `conversation.assistant.confirmation` is set, the assistant waits "
        "for a yes or no with its `token`. The answer is queued and the assistant's reply "
        "arrives as a turn over the socket (`turn.created` on `customer:<id>`); this call "
        "answers right away with the conversation. 409 `confirmation_not_pending` (wrong or "
        "already-answered token), `confirmation_expired`, `assistant_not_active` (people "
        "have the case now) or `assistant_busy`. 404 `assistant_disabled` while agent-core is "
        "not configured."
    ),
    responses=problem_responses(401, 404, 409, 422),
)
async def answer_confirmation(
    body: AnswerConfirmationRequest, customer: CurrentCustomer, api: ApiContextDep
) -> CustomerConversation:
    view = await assistant_use_cases(api).confirm.execute(
        customer, token=body.token, answer=body.answer
    )
    return CustomerConversation.from_view(view)


@router.post(
    "/conversation/step-up",
    response_model=CustomerConversation,
    summary="Pass the second factor the assistant asked for",
    description=(
        "ADR 0003. While `conversation.assistant.stepUp` is set. The second factor is "
        "simulated for now (`stepUp.simulated`): the development code is "
        "`CC_ASSISTANT_STEP_UP_CODE`. "
        "A wrong code is 422 `invalid_step_up_code` with `remainingAttempts`; the third wrong "
        "code hands the case to people. After a right one the assistant carries on by itself "
        "(its reply arrives over the socket). 409 `step_up_not_pending` / `assistant_not_active`."
    ),
    responses=problem_responses(401, 404, 409, 422),
)
async def verify_step_up(
    body: VerifyStepUpRequest, customer: CurrentCustomer, api: ApiContextDep
) -> CustomerConversation:
    view = await assistant_use_cases(api).verify_step_up.execute(customer, code=body.code)
    return CustomerConversation.from_view(view)


@router.post(
    "/conversation/human",
    response_model=CustomerConversation,
    summary="Ask to talk to a person instead of the assistant",
    description=(
        "ADR 0003. The case leaves the assistant, goes to its language queue and is placed "
        "like any new arrival (rule 3): `status` becomes `waiting_agent`, then `with_agent`. "
        "409 `assistant_not_active` when people already have it."
    ),
    responses=problem_responses(401, 404, 409),
)
async def request_person(customer: CurrentCustomer, api: ApiContextDep) -> CustomerConversation:
    view = await assistant_use_cases(api).request_person.execute(customer)
    return CustomerConversation.from_view(view)


@router.post(
    "/conversations/{caseId}/rating",
    response_model=CustomerConversation,
    status_code=status.HTTP_201_CREATED,
    summary="Rate a closed conversation (CSAT 1–4, once)",
    description=(
        "Only the customer's own **closed** case (`case_not_closed` otherwise), once "
        "(`already_rated`). Someone else's case is `not_found`, like an unknown id. "
        "Idempotent on `Idempotency-Key`: a retry with the same key and the same answer "
        "answers 200 with `Idempotent-Replayed: true`; the same key with another answer is "
        "`idempotency_conflict`. Records `case.rated` (the analyst who closed the case gets "
        "it) and answers the conversation with its `rating`."
    ),
    responses={
        200: {"description": "Replay of the same rating", "model": CustomerConversation},
        **problem_responses(401, 404, 409, 422),
    },
)
async def rate_conversation(
    *,
    case_id: Annotated[str, Path(alias="caseId", max_length=64)],
    body: RateConversationRequest,
    idempotency_key: RatingKey,
    customer: CurrentCustomer,
    api: ApiContextDep,
    response: Response,
) -> CustomerConversation:
    result = await api.use_cases.cases.rate_conversation.execute(
        customer,
        case_id,
        RateConversationCommand(
            score=body.score, comment=body.comment, idempotency_key=idempotency_key
        ),
    )
    if result.replayed:
        response.status_code = status.HTTP_200_OK
        response.headers[REPLAYED_HEADER] = "true"
    return CustomerConversation.from_view(result.conversation)
