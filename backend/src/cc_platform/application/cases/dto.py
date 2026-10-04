"""Inputs and outputs of the cases use cases (plain dataclasses; the API maps them 1:1 to
its camelCase schemas, and the realtime projection sends the same shapes)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseStatus,
    CloseReason,
    CustomerConversationStatus,
    CustomerTurnAuthor,
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


@dataclass(frozen=True, slots=True)
class CaseDetailView:
    case: CaseSummaryView
    customer: CaseCustomerView
    assignment: AssignmentView | None
    closure: CaseClosureView | None
    capabilities: CaseCapabilitiesView
    previous_case_count: int


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


# ----------------------------------------------------------------------------- customer side
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
