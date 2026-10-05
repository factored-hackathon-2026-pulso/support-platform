"""Inputs and outputs of the cases use cases (plain dataclasses; the API maps them 1:1 to
its camelCase schemas, and the realtime projection sends the same shapes)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.cases.call import CallDirection, CallEndReason, CallState
from cc_platform.domain.cases.escalation import EscalationState
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseStatus,
    CaseType,
    CloseReason,
    CustomerConversationStatus,
    CustomerTurnAuthor,
    EmailDirection,
    InboxStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRole


class ReplyBlockedReason(StrEnum):
    NOT_ASSIGNEE = "not_assignee"
    CLOSED = "closed"


# ----------------------------------------------------------------------------- both sides
@dataclass(frozen=True, slots=True)
class CaseRatingView:
    """The customer's rating of a closed case (slice 7): 1 Mal · 2 Regular · 3 Bien ·
    4 Excelente (the words live in the frontend)."""

    score: int
    comment: str | None
    rated_at: datetime


# ----------------------------------------------------------------------------- analyst side
@dataclass(frozen=True, slots=True)
class CustomerRefView:
    id: str
    display_name: str


@dataclass(frozen=True, slots=True)
class CaseSummaryView:
    id: str
    version: int
    customer: CustomerRefView
    channel: CaseChannel
    language: Language
    priority: CasePriority
    case_type: CaseType
    status: CaseStatus
    inbox_status: InboxStatus | None
    opened_at: datetime
    sla_due_at: datetime
    first_response_at: datetime | None
    last_interaction_at: datetime
    preview: str | None
    preview_author_role: TurnAuthorRole | None
    assigned_analyst_id: str | None
    unread_count: int
    last_sequence: int
    previous_case_id: str | None
    closed_at: datetime | None
    close_reason: CloseReason | None
    rating: CaseRatingView | None
    escalated: bool
    """An escalation to supervision is open (slice 9: the "Escalado" marker)."""
    active_call_id: str | None
    """Slice 12: the call ringing or connected now ("En llamada"), if any."""


@dataclass(frozen=True, slots=True)
class InboxCountsView:
    all: int
    new: int
    to_reply: int
    waiting: int
    closed: int
    computed_at: datetime


@dataclass(frozen=True, slots=True)
class InboxView:
    items: tuple[CaseSummaryView, ...]
    counts: InboxCountsView
    server_time: datetime


@dataclass(frozen=True, slots=True)
class CaseCustomerView:
    """Who the analyst talks to (no customer-file data)."""

    id: str
    display_name: str
    locale: CustomerLocale
    language: Language
    country: CountryCode
    city: str


@dataclass(frozen=True, slots=True)
class AssignmentView:
    """ "Cómo llegó a ti": people-based assignment only (available + language + queue, or
    a supervisor's choice)."""

    id: str
    analyst_id: str
    analyst_name: str
    reason: AssignmentReason
    policy_rule_id: str | None
    assigned_at: datetime
    queue_label: str | None
    waited_seconds: int | None
    assigned_by_role: ActorRole
    """``system`` (on arrival, queue drain) or ``supervisor`` (``manual``)."""
    assigned_by_name: str | None
    previous_analyst_id: str | None
    previous_analyst_name: str | None


@dataclass(frozen=True, slots=True)
class CaseClosureView:
    closed_at: datetime
    closed_by_id: str
    closed_by_name: str | None
    reason: CloseReason
    note: str | None


@dataclass(frozen=True, slots=True)
class CaseCapabilitiesView:
    can_reply: bool
    reply_blocked_reason: ReplyBlockedReason | None
    can_close: bool
    can_assign: bool
    """The caller holds ``supervisor`` and the case is not closed ("Asignar"/"Reasignar")."""
    can_change_priority: bool
    """The caller is the assignee analyst or holds ``supervisor``, and the case is open."""
    can_change_type: bool
    """Slice 18: the same rule as ``can_change_priority`` (``PUT /cases/{caseId}/type``)."""
    can_escalate: bool
    """Slice 9: the caller is the assignee analyst, the case is open and not escalated."""
    can_call: bool
    """Slice 12: the caller is the assignee analyst, the case is open and has no active call
    (an outbound call, ``POST /cases/{caseId}/calls``)."""
    can_email: bool
    """Slice 12: the caller is the assignee analyst and the case is open (an email reply)."""
    can_add_note: bool
    """Slice 12: the caller is the assignee analyst and the case is open (an internal note)."""


@dataclass(frozen=True, slots=True)
class EscalationView:
    """An escalation to supervision (slice 9) as staff see it (never the customer)."""

    id: str
    case_id: str
    customer_name: str
    state: EscalationState
    motive: str
    escalated_at: datetime
    escalated_by_id: str
    escalated_by_name: str | None
    resolved_at: datetime | None
    resolved_by_id: str | None
    resolved_by_name: str | None
    note: str | None
    reassigned_to_id: str | None
    reassigned_to_name: str | None
    acknowledged_at: datetime | None


@dataclass(frozen=True, slots=True)
class CaseDetailView:
    case: CaseSummaryView
    customer: CaseCustomerView
    assignment: AssignmentView | None
    closure: CaseClosureView | None
    capabilities: CaseCapabilitiesView
    previous_case_count: int
    escalation: EscalationView | None
    """The case's latest escalation (any state; slice 9), or ``None``."""
    active_call: CallView | None
    """Slice 12: the call ringing or connected now, or ``None``."""


@dataclass(frozen=True, slots=True)
class CaseHistoryItemView:
    id: str
    status: CaseStatus
    channel: CaseChannel
    opened_at: datetime
    closed_at: datetime | None
    close_reason: CloseReason | None
    analyst_id: str | None
    analyst_name: str | None
    preview: str | None
    rating: CaseRatingView | None


@dataclass(frozen=True, slots=True)
class CaseHistoryView:
    items: tuple[CaseHistoryItemView, ...]
    total: int


@dataclass(frozen=True, slots=True)
class TurnView:
    id: str
    case_id: str
    sequence: int
    kind: TurnKind
    audience: TurnAudience
    author_role: TurnAuthorRole
    author_id: str | None
    author_name: str | None
    text: str
    language: Language
    created_at: datetime
    client_message_id: str | None
    subject: str | None = None
    """Slice 12: the subject of an ``email`` turn."""


@dataclass(frozen=True, slots=True)
class TurnPageView:
    items: tuple[TurnView, ...]
    older_cursor: str | None
    last_sequence: int


@dataclass(frozen=True, slots=True)
class PostTurnCommand:
    text: str
    client_message_id: str


@dataclass(frozen=True, slots=True)
class PostTurnResult:
    turn: TurnView
    case: CaseSummaryView
    replayed: bool


@dataclass(frozen=True, slots=True)
class CloseCaseCommand:
    reason: CloseReason
    note: str | None = None
    handoff_quality: str | None = None
    """ADR 0003: how useful the assistant's handoff was (``useful``, ``incomplete`` or
    ``unnecessary``). Only meaningful for a case that came from one; sent to agent-core as the
    label of that handoff. Left out, nothing is sent (the platform never guesses a label)."""


# ----------------------------------------------------------------------------- customer side
@dataclass(frozen=True, slots=True)
class AssistantConfirmationView:
    """The agent asks the customer to confirm an action. ``token`` goes back in
    ``POST /customer/conversation/confirmation``."""

    summary: str
    token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class AssistantStepUpView:
    """The agent needs a second factor first (``POST /customer/conversation/step-up``).
    ``simulated`` is true while the second factor is a development stand-in."""

    reason: str
    simulated: bool


@dataclass(frozen=True, slots=True)
class AssistantStateView:
    """What the customer's app needs while the assistant handles the conversation (ADR 0003).

    ``working`` is true while an answer is on its way ("escribiendo…"); ``confirmation`` and
    ``step_up`` are what the assistant waits for (at most one of them)."""

    working: bool
    confirmation: AssistantConfirmationView | None
    step_up: AssistantStepUpView | None


@dataclass(frozen=True, slots=True)
class CustomerConversationView:
    case_id: str
    status: CustomerConversationStatus
    channel: CaseChannel
    language: Language
    opened_at: datetime
    closed_at: datetime | None
    agent_name: str | None
    last_sequence: int
    previous_case_id: str | None
    rating: CaseRatingView | None
    assistant: AssistantStateView | None = None
    """Set only while ``status`` is ``with_assistant`` (ADR 0003)."""


@dataclass(frozen=True, slots=True)
class CustomerTurnView:
    id: str
    sequence: int
    kind: TurnKind
    author_role: CustomerTurnAuthor
    author_name: str | None
    text: str
    language: Language
    created_at: datetime
    client_message_id: str | None
    subject: str | None = None
    """Slice 12: the subject of an ``email`` turn."""


@dataclass(frozen=True, slots=True)
class CustomerConversationResult:
    conversation: CustomerConversationView | None
    turns: tuple[CustomerTurnView, ...]
    past_conversation_count: int


@dataclass(frozen=True, slots=True)
class CustomerConversationSummaryView:
    case_id: str
    status: CustomerConversationStatus
    channel: CaseChannel
    opened_at: datetime
    closed_at: datetime | None
    agent_name: str | None
    preview: str | None


@dataclass(frozen=True, slots=True)
class CustomerConversationDetailView:
    conversation: CustomerConversationView
    turns: tuple[CustomerTurnView, ...]


@dataclass(frozen=True, slots=True)
class PostCustomerTurnResult:
    turn: CustomerTurnView
    conversation: CustomerConversationView
    case_created: bool
    replayed: bool


@dataclass(frozen=True, slots=True)
class RateConversationCommand:
    """``POST /customer/conversations/{caseId}/rating`` (slice 7). ``idempotency_key`` is the
    ``Idempotency-Key`` header: a retry with it and the same answer is a replay."""

    score: int
    comment: str | None
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class RateConversationResult:
    conversation: CustomerConversationView
    replayed: bool


# ----------------------------------------------------------------------------- calls (slice 12)
@dataclass(frozen=True, slots=True)
class HoldIntervalView:
    started_at: datetime
    ended_at: datetime | None


@dataclass(frozen=True, slots=True)
class CallView:
    """A simulated call as staff see it."""

    id: str
    case_id: str
    direction: CallDirection
    state: CallState
    reason: str | None
    analyst_id: str | None
    analyst_name: str | None
    started_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None
    end_reason: CallEndReason | None
    ended_by_role: ActorRole | None
    muted: bool
    holds: tuple[HoldIntervalView, ...]
    hold_seconds: int
    duration_seconds: int | None
    version: int


@dataclass(frozen=True, slots=True)
class CallResult:
    call: CallView
    case: CaseSummaryView
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class CallListView:
    items: tuple[CallView, ...]
    server_time: datetime


@dataclass(frozen=True, slots=True)
class CustomerCallView:
    """What the customer sees of a call: no reason, no staff ids, the analyst's first name."""

    id: str
    case_id: str
    direction: CallDirection
    state: CallState
    agent_name: str | None
    started_at: datetime
    answered_at: datetime | None
    ended_at: datetime | None
    end_reason: CallEndReason | None
    on_hold: bool
    duration_seconds: int | None


@dataclass(frozen=True, slots=True)
class CustomerCallResult:
    call: CustomerCallView
    conversation: CustomerConversationView
    case_created: bool = False
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class StartOutboundCallCommand:
    reason: str
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class CustomerTurnResult:
    """A line the customer said in a call (``kind = transcript``)."""

    turn: CustomerTurnView
    call: CustomerCallView
    replayed: bool


# ----------------------------------------------------------------------------- email (slice 12)
@dataclass(frozen=True, slots=True)
class EmailMessageView:
    """One email of a case thread (an ``email`` turn)."""

    id: str
    case_id: str
    sequence: int
    direction: EmailDirection
    subject: str
    body: str
    author_role: TurnAuthorRole
    author_id: str | None
    author_name: str | None
    created_at: datetime
    client_message_id: str | None


@dataclass(frozen=True, slots=True)
class EmailThreadView:
    case_id: str
    subject: str | None
    """The thread's subject: the first email's (``None`` while the case has no email)."""
    items: tuple[EmailMessageView, ...]


@dataclass(frozen=True, slots=True)
class EmailReplyCommand:
    body: str
    client_message_id: str
    subject: str | None = None


@dataclass(frozen=True, slots=True)
class EmailReplyResult:
    email: EmailMessageView
    case: CaseSummaryView
    replayed: bool


@dataclass(frozen=True, slots=True)
class CustomerEmailCommand:
    subject: str
    body: str
    client_message_id: str


@dataclass(frozen=True, slots=True)
class CustomerEmailView:
    """An email of the customer's thread (analysts by first name in ``author_name``)."""

    id: str
    sequence: int
    direction: EmailDirection
    subject: str
    body: str
    author_name: str | None
    created_at: datetime
    client_message_id: str | None


@dataclass(frozen=True, slots=True)
class CustomerEmailThreadView:
    case_id: str | None
    subject: str | None
    items: tuple[CustomerEmailView, ...]


@dataclass(frozen=True, slots=True)
class CustomerEmailResult:
    email: CustomerEmailView
    conversation: CustomerConversationView
    case_created: bool
    replayed: bool
