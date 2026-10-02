"""Customer chat simulator schemas (slice 1 contract §4)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from cc_platform.api.schemas.cases import ClientMessageId, TurnText
from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.cases.dto import (
    CustomerConversationView,
    CustomerTurnView,
    PostCustomerTurnResult,
)
from cc_platform.application.customers.dto import (
    CustomerSessionGrant,
    DemoCustomerView,
)
from cc_platform.domain.cases.values import (
    CaseChannel,
    CustomerConversationStatus,
    CustomerTurnAuthor,
)
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale, CustomerSegment
from cc_platform.domain.people.staff import Language


class DemoConversation(ApiModel):
    case_id: str
    channel: CaseChannel
    status: CustomerConversationStatus


class DemoCustomer(ApiModel):
    id: str
    display_name: str
    locale: CustomerLocale
    language: Language
    country: CountryCode
    city: str
    segment: CustomerSegment
    suggestions: list[str] = Field(description="Opener chips in the customer's own voice.")
    open_conversation: DemoConversation | None

    @classmethod
    def from_view(cls, view: DemoCustomerView) -> DemoCustomer:
        conversation = view.open_conversation
        return cls(
            id=view.id,
            display_name=view.display_name,
            locale=view.locale,
            language=view.language,
            country=view.country,
            city=view.city,
            segment=view.segment,
            suggestions=list(view.suggestions),
            open_conversation=(
                DemoConversation(
                    case_id=conversation.case_id,
                    channel=conversation.channel,
                    status=conversation.status,
                )
                if conversation
                else None
            ),
        )


class DemoCustomerList(ApiModel):
    items: list[DemoCustomer] = Field(
        description="Simulator customers first, then customers with an open chat case."
    )


class CreateCustomerSessionRequest(RequestModel):
    customer_id: str = Field(min_length=1, max_length=64)
    channel: Literal["app_chat", "web_chat"] | None = Field(
        default=None, description="Default app_chat; ignored while the customer has an open case."
    )


class CustomerSelf(ApiModel):
    id: str
    display_name: str
    locale: CustomerLocale
    language: Language


class CustomerSessionResponse(ApiModel):
    token: str
    expires_at: datetime
    customer: CustomerSelf
    channel: CaseChannel

    @classmethod
    def from_grant(cls, grant: CustomerSessionGrant) -> CustomerSessionResponse:
        return cls(
            token=grant.token,
            expires_at=grant.expires_at,
            customer=CustomerSelf(
                id=grant.customer.id,
                display_name=grant.customer.display_name,
                locale=grant.customer.locale,
                language=grant.customer.language,
            ),
            channel=grant.channel,
        )


class CustomerConversation(ApiModel):
    case_id: str
    status: CustomerConversationStatus
    channel: CaseChannel
    language: Language
    opened_at: datetime
    closed_at: datetime | None
    agent_name: str | None = Field(description="Assignee first name while with_agent.")
    last_sequence: int = Field(description="Highest sequence among customer-visible turns.")

    @classmethod
    def from_view(cls, view: CustomerConversationView) -> CustomerConversation:
        return cls(
            case_id=view.case_id,
            status=view.status,
            channel=view.channel,
            language=view.language,
            opened_at=view.opened_at,
            closed_at=view.closed_at,
            agent_name=view.agent_name,
            last_sequence=view.last_sequence,
        )


class CustomerTurn(ApiModel):
    id: str
    sequence: int = Field(description="Case sequence (customer-visible turns may skip numbers).")
    kind: Literal["message", "notice"]
    author_role: CustomerTurnAuthor
    author_name: str | None
    text: str
    language: Language
    created_at: datetime
    client_message_id: str | None = Field(description="Only on the customer's own messages.")

    @classmethod
    def from_view(cls, view: CustomerTurnView) -> CustomerTurn:
        kind: Literal["message", "notice"] = "message" if view.kind.value == "message" else "notice"
        return cls(
            id=view.id,
            sequence=view.sequence,
            kind=kind,
            author_role=view.author_role,
            author_name=view.author_name,
            text=view.text,
            language=view.language,
            created_at=view.created_at,
            client_message_id=view.client_message_id,
        )


class CustomerConversationResponse(ApiModel):
    conversation: CustomerConversation | None
    turns: list[CustomerTurn]


class PostCustomerTurnRequest(RequestModel):
    text: TurnText
    client_message_id: ClientMessageId


class PostCustomerTurnResponse(ApiModel):
    turn: CustomerTurn
    conversation: CustomerConversation
    case_created: bool

    @classmethod
    def from_result(cls, result: PostCustomerTurnResult) -> PostCustomerTurnResponse:
        return cls(
            turn=CustomerTurn.from_view(result.turn),
            conversation=CustomerConversation.from_view(result.conversation),
            case_created=result.case_created,
        )
