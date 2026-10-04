"""Domain events of the cases context (snake_case payloads, slice 2 contract §2.4).

``entity_id`` is the case id except for ``turn.created`` (the turn id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject


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
    paused_override: bool


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


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseRated(DomainEvent):
    """The customer rated a closed case (CSAT 1–4, slice 7). ``analyst_id`` is who closed it:
    the rating counts for her. The comment is the customer's own words: the audit API never
    shows it (only its length), like message text."""

    event_type = "case.rated"
    entity = "case"

    score: int
    comment: str | None
    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CasePriorityChanged(DomainEvent):
    """The assignee or supervision changed the case priority (slice 8). Payload
    ``{"from": "medium", "to": "high"}`` (the contract's names; ``from`` is a Python
    keyword, hence the field names)."""

    event_type = "case.priority_changed"
    entity = "case"

    from_priority: str
    to_priority: str

    def payload(self) -> JsonObject:
        return {"from": self.from_priority, "to": self.to_priority}


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseViewed(DomainEvent):
    """A supervisor opened a case she does not hold (supervision view, read-only).

    The only read that writes: an audit fact, never sent on a socket (not in
    ``CASE_EVENTS``).
    """

    event_type = "case.viewed"
    entity = "case"

    viewer_id: str
    access: str
    case_status: str
    assigned_analyst_id: str | None


# ----------------------------------------------------------------------------- escalations
# Slice 9: an analyst asks supervision for help on a case she holds (``Escalation``). The
# dataset only says whether a case was escalated (yes/no): there are no types, amounts,
# levels or deadlines. ``entity_id`` is the escalation id (``ESC-…``); ``case_id`` is set.


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationOpened(DomainEvent):
    """The assignee escalated the case. ``motive`` is staff text: the audit API shows only
    its length (like message text)."""

    event_type = "escalation.opened"
    entity = "escalation"

    motive: str
    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationWithdrawn(DomainEvent):
    """The assignee withdrew her escalation while it was open."""

    event_type = "escalation.withdrawn"
    entity = "escalation"

    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationAnswered(DomainEvent):
    """Supervision answered with a note for the analyst (the audit shows only its length)."""

    event_type = "escalation.answered"
    entity = "escalation"

    note: str
    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationTaken(DomainEvent):
    """A supervisor who also holds Analista took the case herself."""

    event_type = "escalation.taken"
    entity = "escalation"

    previous_analyst_id: str
    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationReassigned(DomainEvent):
    """Supervision passed the escalated case to another analyst (``SetCaseAssignee``)."""

    event_type = "escalation.reassigned"
    entity = "escalation"

    previous_analyst_id: str
    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationClosed(DomainEvent):
    """The case closed while the escalation was still open: it ends with the case."""

    event_type = "escalation.closed"
    entity = "escalation"

    analyst_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class EscalationAcknowledged(DomainEvent):
    """The analyst who escalated read what supervision did ("Entendido")."""

    event_type = "escalation.acknowledged"
    entity = "escalation"

    analyst_id: str


#: Every escalation event (slice 9).
ESCALATION_EVENTS: tuple[type[DomainEvent], ...] = (
    EscalationOpened,
    EscalationWithdrawn,
    EscalationAnswered,
    EscalationTaken,
    EscalationReassigned,
    EscalationClosed,
    EscalationAcknowledged,
)

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
    CaseRated,
    CasePriorityChanged,
    *ESCALATION_EVENTS,
)
