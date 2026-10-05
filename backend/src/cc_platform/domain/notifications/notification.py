"""``Notification`` aggregate: one fact a staff member should know about (slice 10).

People-only: every notification is derived from a fact the platform already recorded (an
event of the log, or the first-response SLA entering its risk window). It stores **structured
data only** (who, which case, which customer, the language, the score…): the frontend owns
every word through fixed templates, like the analyst home (slice 6).

Lifecycle::

    unread ──▶ read      (``mark_read``: once; a second time is a no-op)

Retention (team-generated): the newest ``RETENTION_PER_PERSON`` per recipient are kept; the
writer prunes older ones right after inserting new ones.

**Why it is not in the event log.** A notification is a projection of a fact that is already
in ``event_log`` (``source_key`` points at it); its read state is personal UI state, not a
business fact. Writing either to the log would duplicate the audit trail. It is still an
aggregate with a ``version``: marking it read is a compare-and-set like any other change.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id, require_id

#: Team-generated: notifications kept per person (older ones are deleted).
RETENTION_PER_PERSON = 200

MAX_SOURCE_KEY = 80


class NotificationKind(StrEnum):
    """What happened. The value is the API vocabulary; the frontend renders the words."""

    # Analista: her own cases.
    ASSIGNED_ON_ARRIVAL = "assigned_on_arrival"
    ASSIGNED_FROM_QUEUE = "assigned_from_queue"
    ASSIGNED_BY_SUPERVISOR = "assigned_by_supervisor"
    REASSIGNED_AWAY = "reassigned_away"
    CUSTOMER_RETURNED = "customer_returned"
    ESCALATION_ANSWERED = "escalation_answered"
    ESCALATION_TAKEN = "escalation_taken"
    ESCALATION_REASSIGNED = "escalation_reassigned"
    CASE_RATED = "case_rated"
    # Supervisión: every active person with the role.
    CASE_ESCALATED = "case_escalated"
    CASE_QUEUED = "case_queued"
    SLA_AT_RISK = "sla_at_risk"
    # Administración: every active person with the role.
    ACCOUNT_LOCKED = "account_locked"
    INVITATION_ACCEPTED = "invitation_accepted"
    # Supervisión: the improvement engine proposed a change to an agent (ADR 0007).
    IMPROVEMENT_PROPOSED = "improvement_proposed"


#: The role a kind belongs to (the frontend toasts it only on that role's screens).
KIND_ROLE: dict[NotificationKind, StaffRole] = {
    NotificationKind.ASSIGNED_ON_ARRIVAL: StaffRole.ANALYST,
    NotificationKind.ASSIGNED_FROM_QUEUE: StaffRole.ANALYST,
    NotificationKind.ASSIGNED_BY_SUPERVISOR: StaffRole.ANALYST,
    NotificationKind.REASSIGNED_AWAY: StaffRole.ANALYST,
    NotificationKind.CUSTOMER_RETURNED: StaffRole.ANALYST,
    NotificationKind.ESCALATION_ANSWERED: StaffRole.ANALYST,
    NotificationKind.ESCALATION_TAKEN: StaffRole.ANALYST,
    NotificationKind.ESCALATION_REASSIGNED: StaffRole.ANALYST,
    NotificationKind.CASE_RATED: StaffRole.ANALYST,
    NotificationKind.CASE_ESCALATED: StaffRole.SUPERVISOR,
    NotificationKind.CASE_QUEUED: StaffRole.SUPERVISOR,
    NotificationKind.SLA_AT_RISK: StaffRole.SUPERVISOR,
    NotificationKind.ACCOUNT_LOCKED: StaffRole.ADMIN,
    NotificationKind.INVITATION_ACCEPTED: StaffRole.ADMIN,
    NotificationKind.IMPROVEMENT_PROPOSED: StaffRole.SUPERVISOR,
}

#: Kinds about a person, not a case (``target_id`` is that person).
STAFF_KINDS: frozenset[NotificationKind] = frozenset(
    {NotificationKind.ACCOUNT_LOCKED, NotificationKind.INVITATION_ACCEPTED}
)


MAX_TITLE = 120
MAX_PROBLEM = 600
MAX_EVIDENCE = 600
MAX_EFFECT = 400
MAX_EVIDENCE_LINKS = 8
MAX_PROPOSAL_ID = 64
MAX_AGENT_ID = 64

#: Free text that must not carry personal data: an email address, or a run of digits that
#: could be a card, account, phone or national id number. The address must end in an alphabetic
#: top-level label, so an artifact reference such as ``recepcion@1.0.0`` (an id, ADR 0007) passes.
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[A-Za-z]{2,}")
_LONG_NUMBER = re.compile(r"(?:\d[ \-.]?){9,}")


def _bounded(text: str, *, field: str, limit: int) -> str:
    cleaned = text.strip()
    if not cleaned or len(cleaned) > limit:
        raise InvalidValueError(f"{field} must have 1 to {limit} characters", field=field)
    if _EMAIL.search(cleaned) or _LONG_NUMBER.search(cleaned):
        raise InvalidValueError(f"{field} must not contain personal data", field=field)
    return cleaned


@dataclass(frozen=True, slots=True)
class ImprovementDossier:
    """What the improvement engine says about its proposal, bounded free text without personal
    data (the evidence is case ids, never customer words). The platform only relays it."""

    title: str
    problem: str
    evidence: str
    expected_effect: str
    evidence_links: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _bounded(self.title, field="title", limit=MAX_TITLE)
        _bounded(self.problem, field="problem", limit=MAX_PROBLEM)
        _bounded(self.evidence, field="evidence", limit=MAX_EVIDENCE)
        _bounded(self.expected_effect, field="expected_effect", limit=MAX_EFFECT)
        if len(self.evidence_links) > MAX_EVIDENCE_LINKS or len(set(self.evidence_links)) != len(
            self.evidence_links
        ):
            raise InvalidValueError("too many or repeated evidence links", field="evidence_links")
        for link in self.evidence_links:
            if not is_valid_id(link, IdPrefix.CASE):
                raise InvalidValueError("an evidence link is a case id", field="evidence_links")


@dataclass(eq=False)
class Notification(AggregateRoot):
    id: str
    recipient_id: str
    kind: NotificationKind
    created_at: datetime
    """When the fact happened (the source event's time), not when it was written."""
    source_key: str
    """Idempotency key, unique per recipient: the source event id (``EVT-…``), or
    ``sla:<CASE-id>`` for the SLA sweep."""
    case_id: str | None = None
    customer_id: str | None = None
    actor_id: str | None = None
    """Who acted: the supervisor who assigned, answered or took; the analyst who escalated."""
    target_id: str | None = None
    """Who the fact is about: the new assignee (reassignments), the locked or invited person."""
    escalation_id: str | None = None
    language: Language | None = None
    score: int | None = None
    """``case_rated``: the customer's score (1–4)."""
    failed_attempts: int | None = None
    """``account_locked``: failed attempts that locked the account."""
    read_at: datetime | None = None
    proposal_id: str | None = None
    """``improvement_proposed``: agent-core's proposal id (opaque text)."""
    agent_id: str | None = None
    """``improvement_proposed``: the agent the proposal changes."""
    improvement: ImprovementDossier | None = None
    """``improvement_proposed``: the engine's dossier summary."""

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.NOTIFICATION)
        require_id(self.recipient_id, IdPrefix.STAFF)
        if not self.source_key.strip() or len(self.source_key) > MAX_SOURCE_KEY:
            raise InvalidValueError("invalid source key", field="source_key")
        if self.kind is NotificationKind.IMPROVEMENT_PROPOSED:
            if not (self.proposal_id and self.agent_id and self.improvement is not None):
                raise InvalidValueError("an improvement names its proposal", field="proposal_id")
            if len(self.proposal_id) > MAX_PROPOSAL_ID or len(self.agent_id) > MAX_AGENT_ID:
                raise InvalidValueError("proposal or agent id too long", field="proposal_id")
            if self.case_id is not None:
                raise InvalidValueError("an improvement is not about a case", field="case_id")
        elif self.kind in STAFF_KINDS:
            if self.target_id is None:
                raise InvalidValueError("a staff notification names its person", field="target")
            require_id(self.target_id, IdPrefix.STAFF)
        elif self.case_id is None:
            raise InvalidValueError("a case notification names its case", field="case_id")
        if self.case_id is not None:
            require_id(self.case_id, IdPrefix.CASE)
        if self.score is not None and not 1 <= self.score <= 4:
            raise InvalidValueError("score must be 1–4", field="score")
        if self.read_at is not None and self.read_at < self.created_at:
            # A fact from the SLA sweep or the seed may be older than the read: fine. Only a
            # read before the fact itself is impossible.
            raise InvalidValueError("read before it happened", field="read_at")

    @property
    def role(self) -> StaffRole:
        return KIND_ROLE[self.kind]

    @property
    def is_unread(self) -> bool:
        return self.read_at is None

    def mark_read(self, *, at: datetime) -> bool:
        """Read it now; ``False`` (nothing changes) when it was already read."""
        if self.read_at is not None:
            return False
        self.read_at = max(at, self.created_at)
        return True
