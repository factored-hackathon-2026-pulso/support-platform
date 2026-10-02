"""Customer chat simulator (dev/demo tool): pick a seeded customer, chat as them.

Customer tokens (scheme ``CustomerToken``, audience ``cc-customer``) are separate from staff
tokens: each kind is ``unauthenticated`` on the other's routes. A customer only ever sees
their own conversation and only the turns meant for them (rule 2).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from cc_platform.api.dependencies import ApiContextDep, CurrentCustomer
from cc_platform.api.routers.cases import (
    REPLAYED_HEADER,
    IdempotencyKey,
    ensure_idempotency_key,
)
from cc_platform.api.schemas.common import problem_responses
from cc_platform.api.schemas.customer import (
    CreateCustomerSessionRequest,
    CustomerConversation,
    CustomerConversationResponse,
    CustomerSessionResponse,
    CustomerTurn,
    DemoCustomer,
    DemoCustomerList,
    PostCustomerTurnRequest,
    PostCustomerTurnResponse,
)
from cc_platform.application.cases.dto import PostTurnCommand
from cc_platform.domain.cases.values import CaseChannel

router = APIRouter(prefix="/customer", tags=["customer"])


@router.get(
    "/demo-customers",
    response_model=DemoCustomerList,
    summary="Seeded customers for the simulator picker (no auth; empty without demo data)",
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
    after_sequence: Annotated[int | None, Query(alias="afterSequence", ge=0)] = None,
) -> CustomerConversationResponse:
    result = await api.use_cases.cases.customer_conversation.execute(
        customer, after_sequence=after_sequence
    )
    return CustomerConversationResponse(
        conversation=(
            CustomerConversation.from_view(result.conversation) if result.conversation else None
        ),
        turns=[CustomerTurn.from_view(turn) for turn in result.turns],
    )


@router.post(
    "/conversation/turns",
    response_model=PostCustomerTurnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Write to the bank: opens a case when none is open, else appends to it",
    description=(
        "Idempotent on `clientMessageId` (= `Idempotency-Key`): a retry with the same text "
        "answers 200 with `Idempotent-Replayed: true`."
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
