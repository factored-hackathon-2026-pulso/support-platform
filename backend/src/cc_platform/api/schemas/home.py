"""Analyst home schemas ("Inicio", slice 6 contract §3). Members are always present
(``T | null`` where nullable). Rows are structured facts: the frontend renders every
Spanish word from ``kind`` with fixed templates (no pre-rendered text here)."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel
from cc_platform.application.cases.analyst_home import (
    AnalystHomeView,
    HomeActivityItemView,
    HomeActivityKind,
    HomeActivityView,
    HomeAssistantView,
    HomeQueueView,
    HomeTeamView,
    SinceSource,
)
from cc_platform.domain.cases.values import AssignmentReason, CaseStatus, CloseReason, InboxStatus
from cc_platform.domain.people.staff import Language


class HomeActivityItem(ApiModel):
    kind: HomeActivityKind
    case_id: str
    customer_name: str
    occurred_at: datetime = Field(description="The fact's time (last message for messages).")
    language: Language = Field(description="The case language.")
    read_only: bool = Field(description="The case is not hers now: it opens read-only.")
    case_status: CaseStatus = Field(description="The case status now.")
    inbox_status: InboxStatus | None = Field(description="Its bucket in Casos now.")
    sla_due_at: datetime
    first_response_at: datetime | None
    actor_name: str | None = Field(
        description="assigned_by_supervisor, reassigned_away: the supervisor."
    )
    target_name: str | None = Field(description="reassigned_away: who has it now.")
    reason: AssignmentReason | None = Field(description="Assignment rows: why it moved.")
    waited_seconds: int | None = Field(description="assigned_from_queue: the queue wait.")
    previous_cases_count: int | None = Field(
        description="customer_returned: the customer's cases opened before this one."
    )
    last_close_reason: CloseReason | None = Field(
        description="customer_returned: how the case it continues was closed."
    )
    message_count: int | None = Field(description="customer_messages: how many.")

    @classmethod
    def from_view(cls, view: HomeActivityItemView) -> HomeActivityItem:
        return cls(
            kind=view.kind,
            case_id=view.case_id,
            customer_name=view.customer_name,
            occurred_at=view.occurred_at,
            language=view.language,
            read_only=view.read_only,
            case_status=view.case_status,
            inbox_status=view.inbox_status,
            sla_due_at=view.sla_due_at,
            first_response_at=view.first_response_at,
            actor_name=view.actor_name,
            target_name=view.target_name,
            reason=view.reason,
            waited_seconds=view.waited_seconds,
            previous_cases_count=view.previous_cases_count,
            last_close_reason=view.last_close_reason,
            message_count=view.message_count,
        )


class HomeActivity(ApiModel):
    items: list[HomeActivityItem] = Field(description="Newest first, at most 10.")
    total: int = Field(description="Every row after `since` (items is capped).")

    @classmethod
    def from_view(cls, view: HomeActivityView) -> HomeActivity:
        return cls(
            items=[HomeActivityItem.from_view(item) for item in view.items], total=view.total
        )


class HomeQueue(ApiModel):
    language: Language
    waiting: int
    oldest_queued_at: datetime | None

    @classmethod
    def from_view(cls, view: HomeQueueView) -> HomeQueue:
        return cls(
            language=view.language, waiting=view.waiting, oldest_queued_at=view.oldest_queued_at
        )


class HomeTeam(ApiModel):
    team_id: str
    team_name: str
    available_count: int = Field(description="Active analysts of her team now available.")
    analyst_count: int = Field(description="Active analysts of her team (her included).")
    queues: list[HomeQueue] = Field(description="Only the languages she speaks (es, then pt).")

    @classmethod
    def from_view(cls, view: HomeTeamView) -> HomeTeam:
        return cls(
            team_id=view.team_id,
            team_name=view.team_name,
            available_count=view.available_count,
            analyst_count=view.analyst_count,
            queues=[HomeQueue.from_view(queue) for queue in view.queues],
        )


class HomeAssistant(ApiModel):
    """Slice 21 (IaHomeTurno): the assistant in her languages."""

    resolved: int = Field(description="Conversations of her languages it resolved since `since`.")
    handed_to_you: int = Field(description="Cases it handed over that went to her since `since`.")
    with_assistant_now: int = Field(description="Open conversations of her languages it holds.")

    @classmethod
    def from_view(cls, view: HomeAssistantView) -> HomeAssistant:
        return cls(
            resolved=view.resolved,
            handed_to_you=view.handed_to_you,
            with_assistant_now=view.with_assistant_now,
        )


class AnalystHome(ApiModel):
    since: datetime = Field(description="Start of 'Mientras no estabas' (exclusive).")
    since_source: SinceSource = Field(
        description="previous_session: her previous session ended then; fallback: now − 8 h."
    )
    activity: HomeActivity
    team_now: HomeTeam
    server_time: datetime
    assistant: HomeAssistant | None = Field(
        description="Slice 21: the assistant in her languages; null while the AI switch is off."
    )

    @classmethod
    def from_view(cls, view: AnalystHomeView) -> AnalystHome:
        return cls(
            since=view.since,
            since_source=view.since_source,
            activity=HomeActivity.from_view(view.activity),
            team_now=HomeTeam.from_view(view.team_now),
            server_time=view.server_time,
            assistant=HomeAssistant.from_view(view.assistant) if view.assistant else None,
        )
