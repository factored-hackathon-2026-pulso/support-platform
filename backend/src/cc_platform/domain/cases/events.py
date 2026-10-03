"""Domain events of the cases context (snake_case payloads, slice 2 contract §2.4).

``entity_id`` is the case id except for ``turn.created`` (the turn id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.shared.events import DomainEvent


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseOpened(DomainEvent):
    event_type = "case.opened"
    entity = "case"

    customer_id: str
    channel: str
    language: str
    priority: str
    sla_due_at: datetime
    previous_case_id: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class TurnCreated(DomainEvent):
    event_type = "turn.created"
    entity = "turn"

    sequence: int
    kind: str
    audience: str
    author_role: str
    author_id: str | None
    text: str
    language: str
    client_message_id: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseQueued(DomainEvent):
    event_type = "case.queued"
    entity = "case"

    queue_label: str
    reason_code: str
    language: str
    policy_rule_id: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseAssigned(DomainEvent):
    event_type = "case.assigned"
    entity = "case"

    assignment_id: str
    assigned_analyst_id: str
    previous_analyst_id: str | None
    reason: str
    policy_rule_id: str | None
    open_cases_at_assignment: int
    strategy: str
    waited_seconds: int | None


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseStatusChanged(DomainEvent):
    event_type = "case.status_changed"
    entity = "case"

    from_status: str
    to_status: str
    reason: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseRead(DomainEvent):
    event_type = "case.read"
    entity = "case"

    staff_id: str
    read_sequence: int


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseFirstResponded(DomainEvent):
    """The first analyst message: the first-response SLA stops here (met or missed)."""

    event_type = "case.first_responded"
    entity = "case"

    first_response_at: datetime
    response_seconds: int
    sla_due_at: datetime
    sla_met: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseClosed(DomainEvent):
    """The assignee closed the case with a reason (the note is internal: staff only)."""

    event_type = "case.closed"
    entity = "case"

    closed_at: datetime
    closed_by_role: str
    closed_by_id: str
    reason: str
    note: str | None


#: Every event type of the cases context (the realtime projection owns them).
CASE_EVENTS: tuple[type[DomainEvent], ...] = (
    CaseOpened,
    TurnCreated,
    CaseQueued,
    CaseAssigned,
    CaseStatusChanged,
    CaseRead,
    CaseFirstResponded,
    CaseClosed,
)
