"""Supervision schemas (slice 3 contract §4.2): team and queues, manual assignment.

Response members are always present (``T | null`` where nullable). Case rows are the
slice 2 ``CaseSummary``; "at SLA risk" counts are computed at ``serverTime`` and the UI
recomputes them from the rows with its own clock.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from cc_platform.api.schemas.cases import AssignmentOut, CaseSummary, Escalation
from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.api.schemas.people import TeamRef
from cc_platform.application.cases.escalations import (
    EscalationItemView,
    EscalationOverviewView,
)
from cc_platform.application.cases.manual_assignment import AssignmentResultView
from cc_platform.application.cases.supervision import (
    ActivityCountsView,
    AnalystActivity,
    AnalystCaseCountsView,
    LanguageOpenCasesView,
    LanguageQueueView,
    OpenCaseRowView,
    QueueCountsView,
    QueueCountView,
    QueueOverviewView,
    RatingStatsView,
    TeamAnalystView,
    TeamOverviewView,
    TeamSummaryView,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.staff import Language, StaffRole


# ----------------------------------------------------------------------------- team
class ActivityCounts(ApiModel):
    busy: int
    available: int
    paused: int
    offline: int

    @classmethod
    def from_view(cls, view: ActivityCountsView) -> ActivityCounts:
        return cls(
            busy=view.busy, available=view.available, paused=view.paused, offline=view.offline
        )


class TeamSummary(ApiModel):
    id: str = Field(description="TEAM-… id (the `?equipo=` filter).")
    name: str
    analyst_count: int
    activity: ActivityCounts = Field(description="The team's analysts by activity.")
    open_cases: int = Field(description="Open cases of the team's analysts.")
    at_risk_cases: int = Field(description="At serverTime; the UI recomputes it.")

    @classmethod
    def from_view(cls, view: TeamSummaryView) -> TeamSummary:
        return cls(
            id=view.id,
            name=view.name,
            analyst_count=view.analyst_count,
            activity=ActivityCounts.from_view(view.activity),
            open_cases=view.open_cases,
            at_risk_cases=view.at_risk_cases,
        )


class AnalystCaseCounts(ApiModel):
    open: int
    new: int
    to_reply: int
    waiting: int

    @classmethod
    def from_view(cls, view: AnalystCaseCountsView) -> AnalystCaseCounts:
        return cls(open=view.open, new=view.new, to_reply=view.to_reply, waiting=view.waiting)


class RatingStats(ApiModel):
    """Customer ratings (1–4) of the cases she closed in the last 7 days (slice 7)."""

    count: int = Field(description="Rated cases among the ones she closed in the window.")
    average: float | None = Field(description="Unrounded average score; null when count = 0.")

    @classmethod
    def from_view(cls, view: RatingStatsView) -> RatingStats:
        return cls(count=view.count, average=view.average)


class TeamAnalyst(ApiModel):
    id: str
    name: str
    team: TeamRef
    languages: list[Language] = Field(description="Sorted (es, pt).")
    roles: list[StaffRole] = Field(description="Canonical order.")
    availability: AvailabilityStatus = Field(description="No availability row = paused.")
    availability_since: datetime | None = Field(description="null when never set.")
    signed_in: bool = Field(description="At least one active staff session.")
    activity: AnalystActivity = Field(
        description="Derived: busy/available (available, with or without open cases), "
        "paused (paused and signed in), offline (paused and not signed in)."
    )
    counts: AnalystCaseCounts
    oldest_waiting_since: datetime | None = Field(
        description="Oldest lastInteractionAt of her new/to_reply cases; null if none."
    )
    open_cases: list[CaseSummary] = Field(description="assigned | in_progress, inbox order.")
    recent_ratings: RatingStats = Field(
        description='"Calificación 7 días": ratings of the cases she closed in the last 7 days.'
    )

    @classmethod
    def from_view(cls, view: TeamAnalystView) -> TeamAnalyst:
        return cls(
            id=view.id,
            name=view.name,
            team=TeamRef.from_view(view.team),
            languages=list(view.languages),
            roles=list(view.roles),
            availability=view.availability,
            availability_since=view.availability_since,
            signed_in=view.signed_in,
            activity=view.activity,
            counts=AnalystCaseCounts.from_view(view.counts),
            oldest_waiting_since=view.oldest_waiting_since,
            open_cases=[CaseSummary.from_view(case) for case in view.open_cases],
            recent_ratings=RatingStats.from_view(view.recent_ratings),
        )


class TeamOverview(ApiModel):
    teams: list[TeamSummary] = Field(description="By name.")
    analysts: list[TeamAnalyst] = Field(
        description="By activity (busy, available, paused, offline), then name, then id."
    )
    server_time: datetime

    @classmethod
    def from_view(cls, view: TeamOverviewView) -> TeamOverview:
        return cls(
            teams=[TeamSummary.from_view(team) for team in view.teams],
            analysts=[TeamAnalyst.from_view(analyst) for analyst in view.analysts],
            server_time=view.server_time,
        )


# ----------------------------------------------------------------------------- queues
class QueueCount(ApiModel):
    language: Language
    waiting: int
    oldest_queued_at: datetime | None

    @classmethod
    def from_view(cls, view: QueueCountView) -> QueueCount:
        return cls(
            language=view.language, waiting=view.waiting, oldest_queued_at=view.oldest_queued_at
        )


class QueueCounts(ApiModel):
    total: int
    by_language: list[QueueCount] = Field(description="es then pt.")
    computed_at: datetime

    @classmethod
    def from_view(cls, view: QueueCountsView) -> QueueCounts:
        return cls(
            total=view.total,
            by_language=[QueueCount.from_view(count) for count in view.by_language],
            computed_at=view.computed_at,
        )


class LanguageQueue(ApiModel):
    language: Language
    label: str = Field(examples=["Cola en español"])
    waiting: int
    oldest_queued_at: datetime | None
    at_risk: int = Field(description="At serverTime; the UI recomputes it.")
    available_speakers: int = Field(description="Active analysts, available, who speak it.")
    speakers: int = Field(description="Active analysts who speak it (any availability).")
    cases: list[CaseSummary] = Field(description="Queued, oldest openedAt first.")
    open_cases: int = Field(description="Slice 9: every open case of the language (queued too).")
    open_at_risk: int = Field(
        description="Slice 9: open cases at first-response risk, at serverTime."
    )

    @classmethod
    def from_view(cls, view: LanguageQueueView) -> LanguageQueue:
        return cls(
            language=view.language,
            label=view.label,
            waiting=view.waiting,
            oldest_queued_at=view.oldest_queued_at,
            at_risk=view.at_risk,
            available_speakers=view.available_speakers,
            speakers=view.speakers,
            cases=[CaseSummary.from_view(case) for case in view.cases],
            open_cases=view.open_cases,
            open_at_risk=view.open_at_risk,
        )


class QueueOverview(ApiModel):
    queues: list[LanguageQueue] = Field(description="Always es then pt, even when empty.")
    counts: QueueCounts
    server_time: datetime

    @classmethod
    def from_view(cls, view: QueueOverviewView) -> QueueOverview:
        return cls(
            queues=[LanguageQueue.from_view(queue) for queue in view.queues],
            counts=QueueCounts.from_view(view.counts),
            server_time=view.server_time,
        )


# ----------------------------------------------------------------------------- assignment
class SetAssigneeRequest(RequestModel):
    analyst_id: str = Field(max_length=64, description="STF-… of the analyst to assign.")
    expected_analyst_id: str | None = Field(
        max_length=64,
        description="Required: who the caller saw holding the case (null = it was queued).",
    )
    confirm_paused: bool = Field(default=False, description="Assign even if the analyst is paused.")


class AssignmentResult(ApiModel):
    changed: bool = Field(description="false: the analyst already held it (no-op).")
    case: CaseSummary
    assignment: AssignmentOut

    @classmethod
    def from_view(cls, view: AssignmentResultView) -> AssignmentResult:
        return cls(
            changed=view.changed,
            case=CaseSummary.from_view(view.case),
            assignment=AssignmentOut.from_view(view.assignment),
        )


# ------------------------------------------------------------------------------ "Colas" (slice 9)
class OpenCaseRow(ApiModel):
    case: CaseSummary
    assignee_name: str | None = Field(description="Who holds it; null = nobody (queued).")

    @classmethod
    def from_view(cls, view: OpenCaseRowView) -> OpenCaseRow:
        return cls(case=CaseSummary.from_view(view.case), assignee_name=view.assignee_name)


class LanguageOpenCases(ApiModel):
    language: Language
    label: str = Field(examples=["Cola en español"])
    cases: list[OpenCaseRow] = Field(
        description="Every open case of the language: nobody's first (oldest first), then the "
        "held ones in open-inbox order."
    )
    server_time: datetime

    @classmethod
    def from_view(cls, view: LanguageOpenCasesView) -> LanguageOpenCases:
        return cls(
            language=view.language,
            label=view.label,
            cases=[OpenCaseRow.from_view(row) for row in view.cases],
            server_time=view.server_time,
        )


# -------------------------------------------------------------------------- "Escalados" (slice 9)
class EscalationItem(ApiModel):
    escalation: Escalation
    case: CaseSummary
    assignee_name: str | None = Field(description="Who holds the case now.")
    can_take: bool = Field(
        description="The caller may take the case herself (she also holds Analista, speaks "
        "its language, it is open and someone else's)."
    )

    @classmethod
    def from_view(cls, view: EscalationItemView) -> EscalationItem:
        return cls(
            escalation=Escalation.from_view(view.escalation),
            case=CaseSummary.from_view(view.case),
            assignee_name=view.assignee_name,
            can_take=view.can_take,
        )


class EscalationOverview(ApiModel):
    items: list[EscalationItem] = Field(
        description="Open first (the longest waiting first), then the ones supervision attended "
        "in the last 24 hours (the most recent first)."
    )
    open_count: int
    server_time: datetime

    @classmethod
    def from_view(cls, view: EscalationOverviewView) -> EscalationOverview:
        return cls(
            items=[EscalationItem.from_view(item) for item in view.items],
            open_count=view.open_count,
            server_time=view.server_time,
        )
