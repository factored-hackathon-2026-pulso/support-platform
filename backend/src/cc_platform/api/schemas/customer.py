"""Customer chat simulator schemas (slice 2 contract §6)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from cc_platform.api.schemas.cases import CaseRating, ClientMessageId, TurnText
from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.cases.dto import (
    AssistantStateView,
    CustomerConversationDetailView,
    CustomerConversationResult,
    CustomerConversationSummaryView,
    CustomerConversationView,
    CustomerTurnView,
    PostCustomerTurnResult,
)
from cc_platform.application.customers.dto import (
    CustomerSessionGrant,
    DemoCustomerView,
)
from cc_platform.domain.cases.rating import (
    MAX_RATING_COMMENT,
    MAX_RATING_SCORE,
    MIN_RATING_SCORE,
)
from cc_platform.domain.cases.values import (
    CaseChannel,
    CustomerConversationStatus,
    CustomerTurnAuthor,
)
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale
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
    suggestions: list[str] = Field(description="Opener chips in the customer's own voice.")
    open_conversation: DemoConversation | None = Field(description="Only an open case.")
    closed_conversation_count: int

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
            closed_conversation_count=view.closed_conversation_count,
        )


class DemoCustomerList(ApiModel):
    items: list[DemoCustomer] = Field(
        description="Simulator customers first, then every other seeded customer by name."
    )


class CreateCustomerSessionRequest(RequestModel):
    customer_id: str = Field(min_length=1, max_length=64)
    channel: Literal["chat_app", "chat_web"] | None = Field(
        default=None,
        description="The chat a new case opens from: default chat_app. While the customer has an "
        "open chat case its channel wins. Calls and emails have their own routes (slice 12).",
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


class AssistantConfirmation(ApiModel):
    summary: str = Field(description="What the assistant is about to do, in the case language.")
    token: str = Field(description="Goes back in `POST /customer/conversation/confirmation`.")
    expires_at: datetime


class AssistantStepUp(ApiModel):
    reason: str
    simulated: bool = Field(description="True while the second factor is a development stand-in.")


class AssistantState(ApiModel):
    """ADR 0003: what the customer's app needs while the assistant handles the conversation."""

    working: bool = Field(description='An answer is on its way (show "escribiendo…").')
    confirmation: AssistantConfirmation | None = Field(
        description="The assistant waits for a yes or no (at most one of confirmation/stepUp)."
    )
    step_up: AssistantStepUp | None = Field(
        description="The assistant needs the second factor first."
    )

    @classmethod
    def from_view(cls, view: AssistantStateView | None) -> AssistantState | None:
        if view is None:
            return None
        confirmation = view.confirmation
        step_up = view.step_up
        return cls(
            working=view.working,
            confirmation=(
                None
                if confirmation is None
                else AssistantConfirmation(
                    summary=confirmation.summary,
                    token=confirmation.token,
                    expires_at=confirmation.expires_at,
                )
            ),
            step_up=(
                None
                if step_up is None
                else AssistantStepUp(reason=step_up.reason, simulated=step_up.simulated)
            ),
        )


class CustomerConversation(ApiModel):
    case_id: str
    status: CustomerConversationStatus
    channel: CaseChannel
    language: Language
    opened_at: datetime
    closed_at: datetime | None
    agent_name: str | None = Field(
        description="Assignee first name while with_agent; 'Asistente virtual' while "
        "with_assistant; on a closed case, who attended it."
    )
    last_sequence: int = Field(description="Highest sequence among customer-visible turns.")
    previous_case_id: str | None = Field(description="The closed case this one continues.")
    rating: CaseRating | None = Field(
        description="The customer's own rating (slice 7); null until rated (or while open)."
    )
    assistant: AssistantState | None = Field(
        description="ADR 0003: set only while `status` is `with_assistant`, else null.",
    )

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
            previous_case_id=view.previous_case_id,
            rating=CaseRating.from_view(view.rating),
            assistant=AssistantState.from_view(view.assistant),
        )


CustomerTurnKind = Literal["message", "notice", "transcript", "email"]
_CUSTOMER_KINDS: dict[str, CustomerTurnKind] = {
    "message": "message",
    "transcript": "transcript",
    "email": "email",
}


class CustomerTurn(ApiModel):
    id: str
    sequence: int = Field(description="Case sequence (customer-visible turns may skip numbers).")
    kind: CustomerTurnKind = Field(
        description="message · notice · transcript (a line of a call, slice 12) · email "
        "(slice 12, with `subject`)."
    )
    author_role: CustomerTurnAuthor
    author_name: str | None
    text: str
    language: Language
    created_at: datetime
    client_message_id: str | None = Field(description="Only on the customer's own messages.")
    subject: str | None = Field(description="Slice 12: the subject of an `email` turn.")

    @classmethod
    def from_view(cls, view: CustomerTurnView) -> CustomerTurn:
        kind = _CUSTOMER_KINDS.get(view.kind.value, "notice")
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
            subject=view.subject,
        )


class CustomerConversationResponse(ApiModel):
    conversation: CustomerConversation | None
    turns: list[CustomerTurn]
    past_conversation_count: int = Field(
        description="Closed conversations other than the current one."
    )

    @classmethod
    def from_result(cls, result: CustomerConversationResult) -> CustomerConversationResponse:
        return cls(
            conversation=(
                CustomerConversation.from_view(result.conversation) if result.conversation else None
            ),
            turns=[CustomerTurn.from_view(turn) for turn in result.turns],
            past_conversation_count=result.past_conversation_count,
        )


class CustomerConversationSummary(ApiModel):
    case_id: str
    status: CustomerConversationStatus
    channel: CaseChannel
    opened_at: datetime
    closed_at: datetime | None
    agent_name: str | None = Field(description="First name of who attended it.")
    preview: str | None = Field(description="Last message text (at most 140 characters).")

    @classmethod
    def from_view(cls, view: CustomerConversationSummaryView) -> CustomerConversationSummary:
        return cls(
            case_id=view.case_id,
            status=view.status,
            channel=view.channel,
            opened_at=view.opened_at,
            closed_at=view.closed_at,
            agent_name=view.agent_name,
            preview=view.preview,
        )


class CustomerConversationList(ApiModel):
    items: list[CustomerConversationSummary] = Field(
        description="Closed conversations other than the current one, newest first (≤ 20)."
    )


class CustomerConversationDetail(ApiModel):
    conversation: CustomerConversation
    turns: list[CustomerTurn] = Field(description="Up to the latest 200, ascending.")

    @classmethod
    def from_view(cls, view: CustomerConversationDetailView) -> CustomerConversationDetail:
        return cls(
            conversation=CustomerConversation.from_view(view.conversation),
            turns=[CustomerTurn.from_view(turn) for turn in view.turns],
        )


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


# ----------------------------------------------------------------------------- assistant (ADR 0003)
class AnswerConfirmationRequest(RequestModel):
    token: str = Field(
        min_length=1, max_length=200, description="The `token` of the pending confirmation."
    )
    answer: Literal["yes", "no"]


class VerifyStepUpRequest(RequestModel):
    code: str = Field(
        min_length=1,
        max_length=16,
        description="The second-factor code. Simulated while `stepUp.simulated` is true.",
    )


# ----------------------------------------------------------------------------- rating (slice 7)
RatingComment = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_RATING_COMMENT),
    Field(description="Optional: trimmed, blank becomes null, at most 500 characters."),
]


class RateConversationRequest(RequestModel):
    score: int = Field(
        ge=MIN_RATING_SCORE,
        le=MAX_RATING_SCORE,
        description="1 Mal · 2 Regular · 3 Bien · 4 Excelente.",
    )
    comment: RatingComment | None = None

    @field_validator("comment")
    @classmethod
    def _blank_comment_is_null(cls, comment: str | None) -> str | None:
        return comment or None
