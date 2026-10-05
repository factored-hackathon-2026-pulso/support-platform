"""Notification center schemas (slice 10 contract §4). Members are always present
(``T | null`` where nullable). Structured facts only: the frontend renders every Spanish word
from ``kind`` with fixed templates (no pre-rendered text here)."""

from __future__ import annotations

from datetime import datetime

from pydantic import Field

from cc_platform.api.schemas.common import ApiModel
from cc_platform.application.notifications.dto import (
    NotificationPageView,
    NotificationReadView,
    NotificationsReadAllView,
    NotificationView,
)
from cc_platform.domain.notifications.notification import NotificationKind
from cc_platform.domain.people.staff import Language, StaffRole


class ImprovementNotice(ApiModel):
    """``improvement_proposed``: what the improvement engine says about its proposal (ADR 0007).
    Bounded free text without personal data; render it as text, never as markup."""

    proposal_id: str = Field(description="agent-core's proposal id; open it in the Agentes list.")
    agent_id: str
    title: str = Field(description="Up to 120 characters.")
    problem: str = Field(description="Up to 600 characters.")
    evidence: str = Field(description="Up to 600 characters.")
    expected_effect: str = Field(description="Up to 400 characters.")
    evidence_links: list[str] = Field(
        description="Up to 8 case ids (`CASE-…`); open `/supervision/cases/{id}`."
    )


class Notification(ApiModel):
    id: str = Field(description="`NTF-…`")
    kind: NotificationKind
    role: StaffRole = Field(
        description="The role the kind belongs to: the SPA toasts it only on that role's screens."
    )
    created_at: datetime = Field(description="When the fact happened (not when it was written).")
    read_at: datetime | None
    case_id: str | None = Field(
        description="The case of a case kind (null for staff and improvement kinds)."
    )
    customer_name: str | None
    actor_id: str | None = Field(
        description=(
            "Who acted: the supervisor (assigned_by_supervisor, reassigned_away, escalation_*), "
            "the analyst who escalated (case_escalated), the new person (invitation_accepted)."
        )
    )
    actor_name: str | None
    target_id: str | None = Field(
        description=(
            "Who it is about: the new assignee (reassigned_away, escalation_taken, "
            "escalation_reassigned), the locked or invited person."
        )
    )
    target_name: str | None
    escalation_id: str | None = Field(description="case_escalated, escalation_*: `ESC-…`.")
    language: Language | None = Field(description="The case language (case kinds).")
    score: int | None = Field(description="case_rated: the customer's score, 1–4.")
    failed_attempts: int | None = Field(description="account_locked: attempts that locked it.")
    sla_due_at: datetime | None = Field(description="The case's first-response due time now.")
    first_response_at: datetime | None = Field(description="The case's first response, if any.")
    improvement: ImprovementNotice | None = Field(
        description="improvement_proposed only (`caseId` is null for it)."
    )

    @classmethod
    def from_view(cls, view: NotificationView) -> Notification:
        return cls(
            id=view.id,
            kind=view.kind,
            role=view.role,
            created_at=view.created_at,
            read_at=view.read_at,
            case_id=view.case_id,
            customer_name=view.customer_name,
            actor_id=view.actor_id,
            actor_name=view.actor_name,
            target_id=view.target_id,
            target_name=view.target_name,
            escalation_id=view.escalation_id,
            language=view.language,
            score=view.score,
            failed_attempts=view.failed_attempts,
            sla_due_at=view.sla_due_at,
            first_response_at=view.first_response_at,
            improvement=(
                None
                if view.improvement is None or view.proposal_id is None or view.agent_id is None
                else ImprovementNotice(
                    proposal_id=view.proposal_id,
                    agent_id=view.agent_id,
                    title=view.improvement.title,
                    problem=view.improvement.problem,
                    evidence=view.improvement.evidence,
                    expected_effect=view.improvement.expected_effect,
                    evidence_links=list(view.improvement.evidence_links),
                )
            ),
        )


class NotificationPage(ApiModel):
    items: list[Notification] = Field(description="Newest first (`createdAt`, then id).")
    unread_count: int = Field(description="All her unread notifications (not only this page).")
    next_cursor: str | None = Field(description="Pass as `cursor` for the next (older) page.")
    server_time: datetime

    @classmethod
    def from_view(cls, view: NotificationPageView) -> NotificationPage:
        return cls(
            items=[Notification.from_view(item) for item in view.items],
            unread_count=view.unread_count,
            next_cursor=view.next_cursor,
            server_time=view.server_time,
        )


class NotificationReadResult(ApiModel):
    notification: Notification
    changed: bool = Field(description="False when it was already read (nothing changed).")
    unread_count: int

    @classmethod
    def from_view(cls, view: NotificationReadView) -> NotificationReadResult:
        return cls(
            notification=Notification.from_view(view.notification),
            changed=view.changed,
            unread_count=view.unread_count,
        )


class NotificationsReadAllResult(ApiModel):
    updated: int = Field(description="How many were unread and are read now.")
    unread_count: int

    @classmethod
    def from_view(cls, view: NotificationsReadAllView) -> NotificationsReadAllResult:
        return cls(updated=view.updated, unread_count=view.unread_count)
