"""Slice 12 schemas: simulated phone calls, email and internal notes (both sides).

Response members are always present (``T | null`` where nullable), so the generated frontend
types have no optional members."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from cc_platform.api.schemas.cases import (
    Call,
    CaseSummary,
    ClientMessageId,
    TurnText,
)
from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.api.schemas.customer import CustomerConversation, CustomerTurn
from cc_platform.application.cases.dto import (
    CallListView,
    CallResult,
    CustomerCallResult,
    CustomerCallView,
    CustomerEmailResult,
    CustomerEmailThreadView,
    CustomerEmailView,
    CustomerTurnResult,
    EmailMessageView,
    EmailReplyResult,
    EmailThreadView,
)
from cc_platform.domain.cases.call import (
    MAX_CALL_REASON,
    CallDirection,
    CallEndReason,
    CallState,
)
from cc_platform.domain.cases.turn import MAX_EMAIL_SUBJECT
from cc_platform.domain.cases.values import EmailDirection, TurnAuthorRole

CallReason = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_CALL_REASON)
]
EmailSubject = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_EMAIL_SUBJECT)
]


# ----------------------------------------------------------------------------- staff: calls
class StartCallRequest(RequestModel):
    reason: CallReason = Field(description="Why the analyst calls (required, at most 500).")


class MuteCallRequest(RequestModel):
    muted: bool


class CallLineRequest(RequestModel):
    """A line said on the call (a `transcript` turn), only while it is `in_call`."""

    text: TurnText
    client_message_id: ClientMessageId


class NoteRequest(RequestModel):
    """An internal note (a staff-only `note` turn)."""

    text: TurnText
    client_message_id: ClientMessageId


class CallResponse(ApiModel):
    call: Call
    case: CaseSummary

    @classmethod
    def from_result(cls, result: CallResult) -> CallResponse:
        return cls(call=Call.from_view(result.call), case=CaseSummary.from_view(result.case))


class CallList(ApiModel):
    items: list[Call] = Field(description="Every call of the case, the most recent first.")
    server_time: datetime

    @classmethod
    def from_view(cls, view: CallListView) -> CallList:
        return cls(
            items=[Call.from_view(item) for item in view.items], server_time=view.server_time
        )


# ----------------------------------------------------------------------------- staff: email
class EmailMessage(ApiModel):
    """One email of a case thread (an `email` turn: `id` is the turn id)."""

    id: str
    case_id: str
    sequence: int
    direction: EmailDirection = Field(description="in: from the customer · out: from an analyst.")
    subject: str
    body: str
    author_role: TurnAuthorRole
    author_id: str | None
    author_name: str | None
    created_at: datetime
    client_message_id: str | None

    @classmethod
    def from_view(cls, view: EmailMessageView) -> EmailMessage:
        return cls(
            id=view.id,
            case_id=view.case_id,
            sequence=view.sequence,
            direction=view.direction,
            subject=view.subject,
            body=view.body,
            author_role=view.author_role,
            author_id=view.author_id,
            author_name=view.author_name,
            created_at=view.created_at,
            client_message_id=view.client_message_id,
        )


class EmailThread(ApiModel):
    case_id: str
    subject: str | None = Field(description="The first email's subject; null without emails.")
    items: list[EmailMessage] = Field(description="Oldest first, at most 200.")

    @classmethod
    def from_view(cls, view: EmailThreadView) -> EmailThread:
        return cls(
            case_id=view.case_id,
            subject=view.subject,
            items=[EmailMessage.from_view(item) for item in view.items],
        )


class EmailReplyRequest(RequestModel):
    body: TurnText = Field(
        description='What the analyst writes. The platform adds the greeting ("Hola, '
        '{nombre}:") and the signature ("Saludos,\\n{Analista}\\nLATAM Bank").'
    )
    subject: EmailSubject | None = Field(
        default=None,
        description='Default "Re: <thread subject>"; required when the case has no email yet.',
    )
    client_message_id: ClientMessageId


class EmailReplyResponse(ApiModel):
    email: EmailMessage
    case: CaseSummary

    @classmethod
    def from_result(cls, result: EmailReplyResult) -> EmailReplyResponse:
        return cls(
            email=EmailMessage.from_view(result.email), case=CaseSummary.from_view(result.case)
        )


# ----------------------------------------------------------------------------- customer side
class CustomerCall(ApiModel):
    """A call as the customer sees it: no reason, no staff ids, the analyst's first name."""

    id: str
    case_id: str
    direction: CallDirection
    state: CallState
    agent_name: str | None = Field(description="First name of the analyst on the line.")
    started_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None
    end_reason: CallEndReason | None
    on_hold: bool
    duration_seconds: int | None

    @classmethod
    def from_view(cls, view: CustomerCallView) -> CustomerCall:
        return cls(
            id=view.id,
            case_id=view.case_id,
            direction=view.direction,
            state=view.state,
            agent_name=view.agent_name,
            started_at=view.started_at,
            answered_at=view.answered_at,
            ended_at=view.ended_at,
            end_reason=view.end_reason,
            on_hold=view.on_hold,
            duration_seconds=view.duration_seconds,
        )


class CustomerCallState(ApiModel):
    call: CustomerCall | None = Field(
        description="The active call of the current conversation, else its latest call, else null."
    )


class CustomerCallResponse(ApiModel):
    call: CustomerCall
    conversation: CustomerConversation
    case_created: bool

    @classmethod
    def from_result(cls, result: CustomerCallResult) -> CustomerCallResponse:
        return cls(
            call=CustomerCall.from_view(result.call),
            conversation=CustomerConversation.from_view(result.conversation),
            case_created=result.case_created,
        )


class CustomerCallLineResponse(ApiModel):
    turn: CustomerTurn
    call: CustomerCall

    @classmethod
    def from_result(cls, result: CustomerTurnResult) -> CustomerCallLineResponse:
        return cls(
            turn=CustomerTurn.from_view(result.turn), call=CustomerCall.from_view(result.call)
        )


class SendEmailRequest(RequestModel):
    subject: EmailSubject
    body: TurnText
    client_message_id: ClientMessageId


class CustomerEmail(ApiModel):
    id: str
    sequence: int
    direction: EmailDirection
    subject: str
    body: str
    author_name: str | None = Field(description="An analyst's first name on `out` emails.")
    created_at: datetime
    client_message_id: str | None = Field(description="Only on the customer's own emails.")

    @classmethod
    def from_view(cls, view: CustomerEmailView) -> CustomerEmail:
        return cls(
            id=view.id,
            sequence=view.sequence,
            direction=view.direction,
            subject=view.subject,
            body=view.body,
            author_name=view.author_name,
            created_at=view.created_at,
            client_message_id=view.client_message_id,
        )


class CustomerEmailThread(ApiModel):
    case_id: str | None
    subject: str | None
    items: list[CustomerEmail]

    @classmethod
    def from_view(cls, view: CustomerEmailThreadView) -> CustomerEmailThread:
        return cls(
            case_id=view.case_id,
            subject=view.subject,
            items=[CustomerEmail.from_view(item) for item in view.items],
        )


class SendEmailResponse(ApiModel):
    email: CustomerEmail
    conversation: CustomerConversation
    case_created: bool

    @classmethod
    def from_result(cls, result: CustomerEmailResult) -> SendEmailResponse:
        return cls(
            email=CustomerEmail.from_view(result.email),
            conversation=CustomerConversation.from_view(result.conversation),
            case_created=result.case_created,
        )
