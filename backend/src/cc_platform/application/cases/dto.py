"""Inputs and outputs of the cases use cases (plain dataclasses; the API maps them 1:1 to
its camelCase schemas, and the realtime projection sends the same shapes)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum

from cc_platform.domain.cases.case import CaseClosure
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CaseOrigin,
    CasePriority,
    CaseStatus,
    CaseTopic,
    ChannelSessionKind,
    ContactReason,
    CustomerConversationStatus,
    CustomerTurnAuthor,
    FollowUp,
    InboxStatus,
    ResolutionCode,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale, CustomerSegment
from cc_platform.domain.people.staff import Language
from cc_platform.domain.routing.values import RouteStopKind, RoutingOutcome, Tier


class ReplyBlockedReason(StrEnum):
    NOT_ASSIGNEE = "not_assignee"
    CLOSED = "closed"
    CHANNEL_NOT_SUPPORTED = "channel_not_supported"


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
    origin: CaseOrigin
    topic: CaseTopic | None
    priority: CasePriority
    status: CaseStatus
    inbox_status: InboxStatus | None
    opened_at: datetime
    sla_due_at: datetime
    last_interaction_at: datetime
    live_since: datetime | None
    preview: str | None
    preview_author_role: TurnAuthorRole | None
    assigned_analyst_id: str | None
    unread_count: int
    last_sequence: int
    closed_at: datetime | None


@dataclass(frozen=True, slots=True)
class InboxCountsView:
    all: int
    new: int
    to_reply: int
    live: int
    to_call: int
    waiting: int
    computed_at: datetime


@dataclass(frozen=True, slots=True)
class InboxView:
    items: tuple[CaseSummaryView, ...]
    counts: InboxCountsView
    server_time: datetime


@dataclass(frozen=True, slots=True)
class CustomerProfileView:
    id: str
    display_name: str
    segment: CustomerSegment
    country: CountryCode
    city: str
    locale: CustomerLocale
    language: Language
    customer_since: date
    document_type: str


@dataclass(frozen=True, slots=True)
class ChannelIdentityView:
    kind: ChannelSessionKind
    verified: bool


@dataclass(frozen=True, slots=True)
class AssignmentView:
    id: str
    analyst_id: str
    analyst_name: str
    reason: AssignmentReason
    policy_rule_id: str | None
    assigned_at: datetime


@dataclass(frozen=True, slots=True)
class RouteStopView:
    kind: RouteStopKind
    occurred_at: datetime
    label: str | None = None
    tier: Tier | None = None
    component_id: str | None = None
    component_version: str | None = None
    outcome: RoutingOutcome | None = None
    reason_code: str | None = None
    policy_rule_id: str | None = None
    summary: str | None = None
    staff_id: str | None = None
    waited_seconds: int | None = None


@dataclass(frozen=True, slots=True)
class RoutingSummaryView:
    stops: tuple[RouteStopView, ...]
    inputs_used: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CaseCapabilitiesView:
    can_reply: bool
    reply_blocked_reason: ReplyBlockedReason | None
    can_close: bool


@dataclass(frozen=True, slots=True)
class CaseDetailView:
    case: CaseSummaryView
    customer: CustomerProfileView
    channel_identity: ChannelIdentityView
    assignment: AssignmentView | None
    routing: RoutingSummaryView
    closure: CaseClosure | None
    capabilities: CaseCapabilitiesView


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
    evidence_ids: tuple[str, ...]
    from_suggestion_id: str | None


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
    resolved: bool
    contact_reason: ContactReason
    resolution_code: ResolutionCode | None
    follow_up: FollowUp
    send_csat_survey: bool


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


@dataclass(frozen=True, slots=True)
class PostCustomerTurnResult:
    turn: CustomerTurnView
    conversation: CustomerConversationView
    case_created: bool
    replayed: bool
