"""Analyst-side case schemas (slice 1 contract §3.2). Response members are always present
(``T | null`` where nullable), so the generated frontend types have no optional members."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated

from pydantic import Field, StringConstraints

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.cases.dto import (
    AssignmentView,
    CaseCapabilitiesView,
    CaseDetailView,
    CaseSummaryView,
    CustomerProfileView,
    InboxCountsView,
    InboxView,
    PostTurnResult,
    ReplyBlockedReason,
    RouteStopView,
    RoutingSummaryView,
    TurnPageView,
    TurnView,
)
from cc_platform.domain.cases.case import CaseClosure as DomainCaseClosure
from cc_platform.domain.cases.turn import MAX_TURN_TEXT
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CaseOrigin,
    CasePriority,
    CaseStatus,
    CaseTopic,
    ChannelSessionKind,
    ContactReason,
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

TurnText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TURN_TEXT)
]
ClientMessageId = Annotated[
    str,
    StringConstraints(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$"),
    Field(
        description="Client-generated id (UUID v4); also the Idempotency-Key header.",
        examples=["0b8f6a52-6f0e-4c1e-9d55-2f5a0c7d9e10"],
    ),
]


# ----------------------------------------------------------------------------- summaries
class CustomerRef(ApiModel):
    id: str
    display_name: str


class CaseSummary(ApiModel):
    id: str
    version: int = Field(description="Realtime: apply only when newer than the cached one.")
    customer: CustomerRef
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

    @classmethod
    def from_view(cls, view: CaseSummaryView) -> CaseSummary:
        return cls(
            id=view.id,
            version=view.version,
            customer=CustomerRef(id=view.customer.id, display_name=view.customer.display_name),
            channel=view.channel,
            language=view.language,
            origin=view.origin,
            topic=view.topic,
            priority=view.priority,
            status=view.status,
            inbox_status=view.inbox_status,
            opened_at=view.opened_at,
            sla_due_at=view.sla_due_at,
            last_interaction_at=view.last_interaction_at,
            live_since=view.live_since,
            preview=view.preview,
            preview_author_role=view.preview_author_role,
            assigned_analyst_id=view.assigned_analyst_id,
            unread_count=view.unread_count,
            last_sequence=view.last_sequence,
            closed_at=view.closed_at,
        )


class InboxCounts(ApiModel):
    all: int
    new: int
    to_reply: int
    live: int
    to_call: int
    waiting: int
    computed_at: datetime

    @classmethod
    def from_view(cls, view: InboxCountsView) -> InboxCounts:
        return cls(
            all=view.all,
            new=view.new,
            to_reply=view.to_reply,
            live=view.live,
            to_call=view.to_call,
            waiting=view.waiting,
            computed_at=view.computed_at,
        )


class InboxResponse(ApiModel):
    items: list[CaseSummary]
    counts: InboxCounts = Field(description="Always the whole inbox (ignores status and q).")
    server_time: datetime

    @classmethod
    def from_view(cls, view: InboxView) -> InboxResponse:
        return cls(
            items=[CaseSummary.from_view(item) for item in view.items],
            counts=InboxCounts.from_view(view.counts),
            server_time=view.server_time,
        )


# ----------------------------------------------------------------------------- detail
class CustomerProfile(ApiModel):
    id: str
    display_name: str
    segment: CustomerSegment
    country: CountryCode
    city: str
    locale: CustomerLocale
    language: Language
    customer_since: date
    document_type: str

    @classmethod
    def from_view(cls, view: CustomerProfileView) -> CustomerProfile:
        return cls(
            id=view.id,
            display_name=view.display_name,
            segment=view.segment,
            country=view.country,
            city=view.city,
            locale=view.locale,
            language=view.language,
            customer_since=view.customer_since,
            document_type=view.document_type,
        )


class ChannelIdentity(ApiModel):
    kind: ChannelSessionKind
    verified: bool


class AssignmentOut(ApiModel):
    id: str
    analyst_id: str
    analyst_name: str
    reason: AssignmentReason
    policy_rule_id: str | None
    assigned_at: datetime

    @classmethod
    def from_view(cls, view: AssignmentView) -> AssignmentOut:
        return cls(
            id=view.id,
            analyst_id=view.analyst_id,
            analyst_name=view.analyst_name,
            reason=view.reason,
            policy_rule_id=view.policy_rule_id,
            assigned_at=view.assigned_at,
        )


class RouteStop(ApiModel):
    kind: RouteStopKind
    label: str | None
    tier: Tier | None
    component_id: str | None
    component_version: str | None
    outcome: RoutingOutcome | None
    reason_code: str | None
    policy_rule_id: str | None
    summary: str | None
    staff_id: str | None
    waited_seconds: int | None
    occurred_at: datetime

    @classmethod
    def from_view(cls, view: RouteStopView) -> RouteStop:
        return cls(
            kind=view.kind,
            label=view.label,
            tier=view.tier,
            component_id=view.component_id,
            component_version=view.component_version,
            outcome=view.outcome,
            reason_code=view.reason_code,
            policy_rule_id=view.policy_rule_id,
            summary=view.summary,
            staff_id=view.staff_id,
            waited_seconds=view.waited_seconds,
            occurred_at=view.occurred_at,
        )


class RoutingSummary(ApiModel):
    stops: list[RouteStop]
    inputs_used: list[str]

    @classmethod
    def from_view(cls, view: RoutingSummaryView) -> RoutingSummary:
        return cls(
            stops=[RouteStop.from_view(stop) for stop in view.stops],
            inputs_used=list(view.inputs_used),
        )


class CaseClosure(ApiModel):
    closed_at: datetime
    closed_by_id: str
    resolved: bool
    contact_reason: ContactReason
    resolution_code: ResolutionCode | None
    followup_at: datetime | None
    csat_requested: bool

    @classmethod
    def from_domain(cls, closure: DomainCaseClosure) -> CaseClosure:
        return cls(
            closed_at=closure.closed_at,
            closed_by_id=closure.closed_by_id,
            resolved=closure.resolved,
            contact_reason=closure.contact_reason,
            resolution_code=closure.resolution_code,
            followup_at=closure.followup_at,
            csat_requested=closure.csat_requested,
        )


class CaseCapabilities(ApiModel):
    can_reply: bool
    reply_blocked_reason: ReplyBlockedReason | None
    can_close: bool

    @classmethod
    def from_view(cls, view: CaseCapabilitiesView) -> CaseCapabilities:
        return cls(
            can_reply=view.can_reply,
            reply_blocked_reason=view.reply_blocked_reason,
            can_close=view.can_close,
        )


class CaseDetail(ApiModel):
    case: CaseSummary
    customer: CustomerProfile
    channel_identity: ChannelIdentity
    assignment: AssignmentOut | None
    routing: RoutingSummary = Field(description='"Cómo llegó a ti".')
    closure: CaseClosure | None
    capabilities: CaseCapabilities = Field(description="Computed for the caller.")

    @classmethod
    def from_view(cls, view: CaseDetailView) -> CaseDetail:
        return cls(
            case=CaseSummary.from_view(view.case),
            customer=CustomerProfile.from_view(view.customer),
            channel_identity=ChannelIdentity(
                kind=view.channel_identity.kind, verified=view.channel_identity.verified
            ),
            assignment=AssignmentOut.from_view(view.assignment) if view.assignment else None,
            routing=RoutingSummary.from_view(view.routing),
            closure=CaseClosure.from_domain(view.closure) if view.closure else None,
            capabilities=CaseCapabilities.from_view(view.capabilities),
        )


# ----------------------------------------------------------------------------- turns
class Turn(ApiModel):
    id: str
    case_id: str
    sequence: int = Field(description="1-based, gap-free per case (staff-only turns included).")
    kind: TurnKind
    audience: TurnAudience
    author_role: TurnAuthorRole
    author_id: str | None
    author_name: str | None
    text: str
    language: Language
    created_at: datetime
    client_message_id: str | None
    evidence_ids: list[str]
    from_suggestion_id: str | None

    @classmethod
    def from_view(cls, view: TurnView) -> Turn:
        return cls(
            id=view.id,
            case_id=view.case_id,
            sequence=view.sequence,
            kind=view.kind,
            audience=view.audience,
            author_role=view.author_role,
            author_id=view.author_id,
            author_name=view.author_name,
            text=view.text,
            language=view.language,
            created_at=view.created_at,
            client_message_id=view.client_message_id,
            evidence_ids=list(view.evidence_ids),
            from_suggestion_id=view.from_suggestion_id,
        )


class TurnPage(ApiModel):
    items: list[Turn] = Field(description="Ascending sequence.")
    older_cursor: str | None
    last_sequence: int

    @classmethod
    def from_view(cls, view: TurnPageView) -> TurnPage:
        return cls(
            items=[Turn.from_view(item) for item in view.items],
            older_cursor=view.older_cursor,
            last_sequence=view.last_sequence,
        )


class PostAnalystTurnRequest(RequestModel):
    text: TurnText
    client_message_id: ClientMessageId


class PostTurnResponse(ApiModel):
    turn: Turn
    case: CaseSummary

    @classmethod
    def from_result(cls, result: PostTurnResult) -> PostTurnResponse:
        return cls(turn=Turn.from_view(result.turn), case=CaseSummary.from_view(result.case))


class MarkReadRequest(RequestModel):
    up_to_sequence: int = Field(ge=0)


class CloseCaseRequest(RequestModel):
    resolved: bool
    contact_reason: ContactReason
    resolution_code: ResolutionCode | None
    follow_up: FollowUp
    send_csat_survey: bool
