"""Domain events of the cases context (snake_case payloads, contract-shaped).

``entity_id`` is the case id except for ``turn.created`` (the turn id) and ``case.closed``
(entity ``case_close``, keyed by the case id as in the contract).
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
    channel_session: str
    language: str
    origin: str
    topic: str | None
    priority: str
    sla_due_at: datetime


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
    evidence_ids: tuple[str, ...]
    from_suggestion_id: str | None


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
class CaseClosed(DomainEvent):
    """Contract ``case_close`` (plus ``csat_requested``; the CSAT answer arrives later)."""

    event_type = "case.closed"
    entity = "case_close"

    closed_at: datetime
    closed_by_role: str
    closed_by_id: str
    resolved: bool
    contact_reason: str
    resolution_code: str | None
    followup_at: datetime | None
    csat_requested: bool


#: Every event type of the cases context (the realtime projection owns them).
CASE_EVENTS: tuple[type[DomainEvent], ...] = (
    CaseOpened,
    TurnCreated,
    CaseQueued,
    CaseAssigned,
    CaseStatusChanged,
    CaseRead,
    CaseClosed,
)
