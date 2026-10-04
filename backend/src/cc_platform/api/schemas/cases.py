"""Analyst-side case schemas (slice 2 contract §5.2). Response members are always present
(``T | null`` where nullable), so the generated frontend types have no optional members."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import Field, StringConstraints, field_validator

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.cases.dto import (
    AssignmentView,
    CaseCapabilitiesView,
    CaseClosureView,
    CaseCustomerView,
    CaseDetailView,
    CaseHistoryItemView,
    CaseHistoryView,
    CaseRatingView,
    CaseSummaryView,
    InboxCountsView,
    InboxView,
    PostTurnResult,
    ReplyBlockedReason,
    TurnPageView,
    TurnView,
)
from cc_platform.application.cases.priority import PriorityResultView
from cc_platform.domain.cases.case import MAX_CLOSE_NOTE
from cc_platform.domain.cases.turn import MAX_TURN_TEXT
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseStatus,
    CloseReason,
    InboxStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRole

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


# ----------------------------------------------------------------------------- rating (slice 7)
class CaseRating(ApiModel):
    """The customer's rating of a closed case: 1 Mal · 2 Regular · 3 Bien · 4 Excelente."""

    score: int = Field(ge=1, le=4, description="1 Mal · 2 Regular · 3 Bien · 4 Excelente.")
    comment: str | None = Field(description="The customer's words (trimmed, at most 500).")
    rated_at: datetime

    @classmethod
    def from_view(cls, view: CaseRatingView | None) -> CaseRating | None:
        if view is None:
            return None
        return cls(score=view.score, comment=view.comment, rated_at=view.rated_at)


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
    priority: CasePriority = Field(
        description="Slice 8: `none` until the assignee or supervision sets it."
    )
    status: CaseStatus
    inbox_status: InboxStatus | None = Field(description="null while the case is queued.")
    opened_at: datetime
    sla_due_at: datetime = Field(description="First-response due time.")
    first_response_at: datetime | None = Field(
        description="The first analyst message (the SLA stops); null while pending."
    )
    last_interaction_at: datetime
    preview: str | None
    preview_author_role: TurnAuthorRole | None
    assigned_analyst_id: str | None
    unread_count: int
    last_sequence: int
    previous_case_id: str | None = Field(
        description='The closed case this one continues ("Volvió a escribir").'
    )
    closed_at: datetime | None
    close_reason: CloseReason | None
    rating: CaseRating | None = Field(
        description="The customer's rating (slice 7); only on a closed case, null until rated."
    )

    @classmethod
    def from_view(cls, view: CaseSummaryView) -> CaseSummary:
        return cls(
            id=view.id,
            version=view.version,
            customer=CustomerRef(id=view.customer.id, display_name=view.customer.display_name),
            channel=view.channel,
            language=view.language,
            priority=view.priority,
            status=view.status,
            inbox_status=view.inbox_status,
            opened_at=view.opened_at,
            sla_due_at=view.sla_due_at,
            first_response_at=view.first_response_at,
            last_interaction_at=view.last_interaction_at,
            preview=view.preview,
            preview_author_role=view.preview_author_role,
            assigned_analyst_id=view.assigned_analyst_id,
            unread_count=view.unread_count,
            last_sequence=view.last_sequence,
            previous_case_id=view.previous_case_id,
            closed_at=view.closed_at,
            close_reason=view.close_reason,
            rating=CaseRating.from_view(view.rating),
        )


class InboxCounts(ApiModel):
    all: int = Field(description="Open cases: new + toReply + waiting.")
    new: int
    to_reply: int
    waiting: int
    closed: int = Field(description="Cases closed in the last 7 days.")
    computed_at: datetime

    @classmethod
    def from_view(cls, view: InboxCountsView) -> InboxCounts:
        return cls(
            all=view.all,
            new=view.new,
            to_reply=view.to_reply,
            waiting=view.waiting,
            closed=view.closed,
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
class CaseCustomer(ApiModel):
    id: str
    display_name: str
    locale: CustomerLocale
    language: Language
    country: CountryCode
    city: str

    @classmethod
    def from_view(cls, view: CaseCustomerView) -> CaseCustomer:
        return cls(
            id=view.id,
            display_name=view.display_name,
            locale=view.locale,
            language=view.language,
            country=view.country,
            city=view.city,
        )


class AssignmentOut(ApiModel):
    id: str
    analyst_id: str
    analyst_name: str
    reason: AssignmentReason
    policy_rule_id: str | None
    assigned_at: datetime
    queue_label: str | None = Field(description="Set when the case waited in a queue.")
    waited_seconds: int | None = Field(
        description="Queue wait (queue_drained, or manual from the queue), else null."
    )
    assigned_by_role: ActorRole = Field(
        description="'system' (language_least_loaded, queue_drained) or 'supervisor' (manual)."
    )
    assigned_by_name: str | None = Field(description="The supervisor's name; null for system.")
    previous_analyst_id: str | None = Field(description="Who held it before (reassignment).")
    previous_analyst_name: str | None

    @classmethod
    def from_view(cls, view: AssignmentView) -> AssignmentOut:
        return cls(
            id=view.id,
            analyst_id=view.analyst_id,
            analyst_name=view.analyst_name,
            reason=view.reason,
            policy_rule_id=view.policy_rule_id,
            assigned_at=view.assigned_at,
            queue_label=view.queue_label,
            waited_seconds=view.waited_seconds,
            assigned_by_role=view.assigned_by_role,
            assigned_by_name=view.assigned_by_name,
            previous_analyst_id=view.previous_analyst_id,
            previous_analyst_name=view.previous_analyst_name,
        )


class CaseClosure(ApiModel):
    closed_at: datetime
    closed_by_id: str
    closed_by_name: str | None
    reason: CloseReason
    note: str | None = Field(description="Internal note: staff only, never sent to the customer.")

    @classmethod
    def from_view(cls, view: CaseClosureView) -> CaseClosure:
        return cls(
            closed_at=view.closed_at,
            closed_by_id=view.closed_by_id,
            closed_by_name=view.closed_by_name,
            reason=view.reason,
            note=view.note,
        )


class CaseCapabilities(ApiModel):
    can_reply: bool
    reply_blocked_reason: ReplyBlockedReason | None
    can_close: bool
    can_assign: bool = Field(
        description='The caller is a supervisor and the case is open ("Asignar"/"Reasignar").'
    )
    can_change_priority: bool = Field(
        description="Slice 8: the caller is the assignee analyst or a supervisor, and the case "
        "is open (PUT /cases/{caseId}/priority)."
    )

    @classmethod
    def from_view(cls, view: CaseCapabilitiesView) -> CaseCapabilities:
        return cls(
            can_reply=view.can_reply,
            reply_blocked_reason=view.reply_blocked_reason,
            can_close=view.can_close,
            can_assign=view.can_assign,
            can_change_priority=view.can_change_priority,
        )


class CaseDetail(ApiModel):
    case: CaseSummary
    customer: CaseCustomer
    assignment: AssignmentOut | None = Field(description='"Cómo llegó a ti".')
    closure: CaseClosure | None
    capabilities: CaseCapabilities = Field(description="Computed for the caller.")
    previous_case_count: int = Field(description="Other cases of this customer (any status).")

    @classmethod
    def from_view(cls, view: CaseDetailView) -> CaseDetail:
        return cls(
            case=CaseSummary.from_view(view.case),
            customer=CaseCustomer.from_view(view.customer),
            assignment=AssignmentOut.from_view(view.assignment) if view.assignment else None,
            closure=CaseClosure.from_view(view.closure) if view.closure else None,
            capabilities=CaseCapabilities.from_view(view.capabilities),
            previous_case_count=view.previous_case_count,
        )


class CaseHistoryItem(ApiModel):
    id: str
    status: CaseStatus
    channel: CaseChannel
    opened_at: datetime
    closed_at: datetime | None
    close_reason: CloseReason | None
    analyst_id: str | None = Field(description="Who held it (the assignee).")
    analyst_name: str | None
    preview: str | None = Field(description="Last message text (at most 140 characters).")
    rating: CaseRating | None = Field(description="The customer's rating, if any (slice 7).")

    @classmethod
    def from_view(cls, view: CaseHistoryItemView) -> CaseHistoryItem:
        return cls(
            id=view.id,
            status=view.status,
            channel=view.channel,
            opened_at=view.opened_at,
            closed_at=view.closed_at,
            close_reason=view.close_reason,
            analyst_id=view.analyst_id,
            analyst_name=view.analyst_name,
            preview=view.preview,
            rating=CaseRating.from_view(view.rating),
        )


class CaseHistory(ApiModel):
    items: list[CaseHistoryItem] = Field(description="Newest openedAt first, at most 20.")
    total: int = Field(description="All other cases of the customer.")

    @classmethod
    def from_view(cls, view: CaseHistoryView) -> CaseHistory:
        return cls(items=[CaseHistoryItem.from_view(item) for item in view.items], total=view.total)


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


CloseNote = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=MAX_CLOSE_NOTE),
    Field(description="Internal note (staff only): trimmed, blank becomes null, at most 500."),
]


class CloseCaseRequest(RequestModel):
    reason: CloseReason
    note: CloseNote | None

    @field_validator("note")
    @classmethod
    def _blank_note_is_null(cls, note: str | None) -> str | None:
        return note or None


# ----------------------------------------------------------------------------- priority (slice 8)
class ChangePriorityRequest(RequestModel):
    priority: CasePriority
    expected_version: int = Field(
        ge=0, description="The case `version` the caller saw (stale → `version_conflict`)."
    )


class CasePriorityResult(ApiModel):
    changed: bool = Field(description="false: the case already had that priority (no event).")
    case: CaseSummary

    @classmethod
    def from_view(cls, view: PriorityResultView) -> CasePriorityResult:
        return cls(changed=view.changed, case=CaseSummary.from_view(view.case))
