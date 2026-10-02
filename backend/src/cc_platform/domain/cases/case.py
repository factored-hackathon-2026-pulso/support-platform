"""``Case`` aggregate: one contact from the customer's first message to the close.

State machine (explicit transitions; anything else raises ``InvalidTransitionError``, and
writing to a closed case raises ``CaseClosedError``)::

    open ──▶ routing ──▶ queued ──▶ assigned        (queue drain)
                    └──────────────▶ assigned        (eligible analyst)
    assigned ──▶ in_progress                         (assignee opens or replies)
    assigned ──▶ to_call                             (outbound origin: the bank calls)
    assigned | in_progress | to_call ──▶ in_call     (call starts; seeds only in slice 1)
    assigned | in_progress | in_call | to_call ──▶ closed   (terminal)

``awaiting_approval`` is declared for slice 3. Every transition records a domain event; the
optimistic ``version`` makes concurrent transitions lose instead of overwrite, and also
serialises turn sequence numbers (a turn is appended in the same Unit of Work as the save).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.errors import CaseClosedError, invalid_case_transition
from cc_platform.domain.cases.events import (
    CaseAssigned,
    CaseClosed,
    CaseOpened,
    CaseQueued,
    CaseRead,
    CaseStatusChanged,
    TurnCreated,
)
from cc_platform.domain.cases.turn import Turn, normalize_turn_text
from cc_platform.domain.cases.values import (
    CLOSABLE_STATUSES,
    REPLYABLE_STATUSES,
    CaseChannel,
    CaseOrigin,
    CasePriority,
    CaseStatus,
    CaseTopic,
    ChannelSessionKind,
    ContactReason,
    ResolutionCode,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

PREVIEW_LENGTH = 140


def search_key(*parts: str) -> str:
    """Lower-cased, accent-stripped text for portable ``contains`` search."""
    decomposed = unicodedata.normalize("NFKD", " ".join(parts))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def preview_of(text: str) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= PREVIEW_LENGTH else flat[: PREVIEW_LENGTH - 1] + "…"


@dataclass(frozen=True, slots=True)
class CaseClosure:
    """Contract ``case_close`` as stored on the case."""

    closed_at: datetime
    closed_by_id: str
    closed_by_role: ActorRole
    resolved: bool
    contact_reason: ContactReason
    resolution_code: ResolutionCode | None
    followup_at: datetime | None
    csat_requested: bool


@dataclass(eq=False)
class Case(AggregateRoot):
    id: str
    customer_id: str
    channel: CaseChannel
    channel_session: ChannelSessionKind
    language: Language
    origin: CaseOrigin
    priority: CasePriority
    status: CaseStatus
    opened_at: datetime
    sla_due_at: datetime
    search_text: str
    topic: CaseTopic | None = None
    assigned_analyst_id: str | None = None
    assigned_at: datetime | None = None
    queued_at: datetime | None = None
    queue_label: str | None = None
    queue_summary: str | None = None
    entry_label: str | None = None
    entry_summary: str | None = None
    last_sequence: int = 0
    last_public_sequence: int = 0
    last_message_at: datetime | None = None
    last_message_author_role: TurnAuthorRole | None = None
    last_message_preview: str | None = None
    last_turn_author_role: TurnAuthorRole | None = None
    last_turn_preview: str | None = None
    assignee_read_sequence: int = 0
    unread_sequences: tuple[int, ...] = ()
    """Sequences of customer messages after the assignee's read cursor (``unreadCount``)."""
    live_since: datetime | None = None
    closure: CaseClosure | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.CASE)
        require_id(self.customer_id, IdPrefix.CUSTOMER)
        if self.assigned_analyst_id is not None:
            require_id(self.assigned_analyst_id, IdPrefix.STAFF)
        if self.sla_due_at < self.opened_at:
            raise InvalidValueError("SLA cannot be due before the case opens", field="sla_due_at")
        if not 0 <= self.assignee_read_sequence <= self.last_sequence:
            raise InvalidValueError("read cursor out of range", field="assignee_read_sequence")

    # ------------------------------------------------------------------ factory
    @classmethod
    def open(
        cls,
        *,
        case_id: str,
        customer_id: str,
        customer_name: str,
        channel: CaseChannel,
        channel_session: ChannelSessionKind,
        language: Language,
        origin: CaseOrigin,
        priority: CasePriority,
        opened_at: datetime,
        sla_due_at: datetime,
        actor: ActorRef,
        topic: CaseTopic | None = None,
        entry_label: str | None = None,
        entry_summary: str | None = None,
    ) -> Case:
        case = cls(
            id=case_id,
            customer_id=customer_id,
            channel=channel,
            channel_session=channel_session,
            language=language,
            origin=origin,
            priority=priority,
            status=CaseStatus.ROUTING,
            opened_at=opened_at,
            sla_due_at=sla_due_at,
            search_text=search_key(customer_name, case_id),
            topic=topic,
            entry_label=entry_label,
            entry_summary=entry_summary,
        )
        case._record(
            CaseOpened(
                occurred_at=opened_at,
                actor=actor,
                entity_id=case_id,
                case_id=case_id,
                customer_id=customer_id,
                channel=channel.value,
                channel_session=channel_session.value,
                language=language.value,
                origin=origin.value,
                topic=topic.value if topic else None,
                priority=priority.value,
                sla_due_at=sla_due_at,
            )
        )
        return case

    # ------------------------------------------------------------------ queries
    @property
    def is_closed(self) -> bool:
        return self.status is CaseStatus.CLOSED

    @property
    def closed_at(self) -> datetime | None:
        return self.closure.closed_at if self.closure else None

    @property
    def unread_count(self) -> int:
        return len(self.unread_sequences)

    @property
    def last_interaction_at(self) -> datetime:
        return self.last_message_at or self.opened_at

    def is_assignee(self, staff_id: str) -> bool:
        return self.assigned_analyst_id is not None and self.assigned_analyst_id == staff_id

    # ------------------------------------------------------------------ transcript
    def append_turn(
        self,
        *,
        turn_id: str,
        kind: TurnKind,
        audience: TurnAudience,
        author_role: TurnAuthorRole,
        author_id: str | None,
        text: str,
        created_at: datetime,
        client_message_id: str | None = None,
    ) -> Turn:
        """Add the next turn (``sequence = last_sequence + 1``) and record ``turn.created``.

        The caller stores the returned turn in the same Unit of Work as this case.
        """
        if self.is_closed:
            raise CaseClosedError()
        turn = Turn(
            id=turn_id,
            case_id=self.id,
            sequence=self.last_sequence + 1,
            kind=kind,
            audience=audience,
            author_role=author_role,
            author_id=author_id,
            text=normalize_turn_text(text),
            language=self.language,
            created_at=created_at,
            client_message_id=client_message_id,
        )
        self.last_sequence = turn.sequence
        if turn.is_public:
            self.last_public_sequence = turn.sequence
        preview = preview_of(turn.text)
        self.last_turn_author_role = author_role
        self.last_turn_preview = preview
        if kind is TurnKind.MESSAGE:
            self.last_message_at = created_at
            self.last_message_author_role = author_role
            self.last_message_preview = preview
        if turn.is_customer_message:
            self.unread_sequences = (*self.unread_sequences, turn.sequence)
        self._record(
            TurnCreated(
                occurred_at=created_at,
                actor=turn.author,
                entity_id=turn.id,
                case_id=self.id,
                sequence=turn.sequence,
                kind=kind.value,
                audience=audience.value,
                author_role=author_role.value,
                author_id=author_id,
                text=turn.text,
                language=turn.language.value,
                client_message_id=client_message_id,
                evidence_ids=turn.evidence_ids,
                from_suggestion_id=turn.from_suggestion_id,
            )
        )
        return turn

    def ensure_assignee_can_reply(self) -> None:
        """Rule of ``PostAnalystTurn``: only ``assigned``/``in_progress`` cases take replies."""
        if self.is_closed:
            raise CaseClosedError()
        if self.status not in REPLYABLE_STATUSES:
            raise invalid_case_transition(self.status, "in_progress")

    # ------------------------------------------------------------------ routing
    def queue(
        self,
        *,
        label: str,
        reason_code: str,
        policy_rule_id: str | None,
        at: datetime,
        summary: str | None = None,
    ) -> None:
        self._require(CaseStatus.ROUTING, target=CaseStatus.QUEUED)
        self.status = CaseStatus.QUEUED
        self.queued_at = at
        self.queue_label = label
        self.queue_summary = summary
        self._record(
            CaseQueued(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=self.id,
                case_id=self.id,
                queue_label=label,
                reason_code=reason_code,
                language=self.language.value,
                policy_rule_id=policy_rule_id,
            )
        )

    def assign(self, assignment: Assignment) -> None:
        self._require(CaseStatus.ROUTING, CaseStatus.QUEUED, target=CaseStatus.ASSIGNED)
        if assignment.case_id != self.id:
            raise InvalidValueError("assignment belongs to another case", field="case_id")
        previous = self.assigned_analyst_id
        self.status = CaseStatus.ASSIGNED
        self.assigned_analyst_id = assignment.staff_id
        self.assigned_at = assignment.assigned_at
        # Customer messages written before the assignment stay unread for the assignee.
        self.assignee_read_sequence = 0
        self._record(
            CaseAssigned(
                occurred_at=assignment.assigned_at,
                actor=assignment.assigned_by,
                entity_id=self.id,
                case_id=self.id,
                assignment_id=assignment.id,
                assigned_analyst_id=assignment.staff_id,
                previous_analyst_id=previous,
                reason=assignment.reason.value,
                policy_rule_id=assignment.policy_rule_id,
                open_cases_at_assignment=assignment.open_cases_at_assignment,
                strategy=assignment.strategy,
            )
        )

    # ------------------------------------------------------------------ work on the case
    def mark_read(self, *, up_to: int, at: datetime) -> bool:
        """The assignee read up to ``up_to`` (monotonic, clamped to ``last_sequence``).

        Opening an ``assigned`` case moves it to ``in_progress``. Returns True when the
        status or the cursor changed.
        """
        staff_id = self._require_assignee()
        changed = self._start_progress(at=at, actor=ActorRef(ActorRole.ANALYST, staff_id))
        target = min(max(up_to, 0), self.last_sequence)
        if target <= self.assignee_read_sequence:
            return changed
        self.assignee_read_sequence = target
        self.unread_sequences = tuple(s for s in self.unread_sequences if s > target)
        self._record(
            CaseRead(
                occurred_at=at,
                actor=ActorRef(ActorRole.ANALYST, staff_id),
                entity_id=self.id,
                case_id=self.id,
                staff_id=staff_id,
                read_sequence=target,
            )
        )
        return True

    def start_progress(self, *, at: datetime) -> bool:
        """``assigned → in_progress`` when the assignee replies; no-op if already there."""
        staff_id = self._require_assignee()
        return self._start_progress(at=at, actor=ActorRef(ActorRole.ANALYST, staff_id))

    def _start_progress(self, *, at: datetime, actor: ActorRef) -> bool:
        if self.status is not CaseStatus.ASSIGNED:
            return False
        self._change_status(CaseStatus.IN_PROGRESS, at=at, actor=actor, reason="opened_by_assignee")
        return True

    def require_callback(self, *, at: datetime, actor: ActorRef) -> None:
        """``assigned → to_call``: a regulator/branch complaint the bank must call about."""
        self._require(CaseStatus.ASSIGNED, target=CaseStatus.TO_CALL)
        if not self.origin.is_outbound:
            raise invalid_case_transition(self.status, CaseStatus.TO_CALL.value)
        self._change_status(CaseStatus.TO_CALL, at=at, actor=actor, reason="outbound_followup")

    def start_call(self, *, at: datetime, actor: ActorRef) -> None:
        """A call with the customer starts (layout seam: only seeds use it in slice 1)."""
        self._require(
            CaseStatus.ASSIGNED,
            CaseStatus.IN_PROGRESS,
            CaseStatus.TO_CALL,
            target=CaseStatus.IN_CALL,
        )
        self.live_since = at
        self._change_status(CaseStatus.IN_CALL, at=at, actor=actor, reason="call_started")

    def close(
        self,
        *,
        actor: ActorRef,
        at: datetime,
        resolved: bool,
        contact_reason: ContactReason,
        resolution_code: ResolutionCode | None,
        followup_at: datetime | None,
        csat_requested: bool,
    ) -> None:
        if self.is_closed:
            raise CaseClosedError()
        if self.status not in CLOSABLE_STATUSES:
            raise invalid_case_transition(self.status, CaseStatus.CLOSED.value)
        self.closure = CaseClosure(
            closed_at=at,
            closed_by_id=actor.actor_id,
            closed_by_role=actor.role,
            resolved=resolved,
            contact_reason=contact_reason,
            resolution_code=resolution_code,
            followup_at=followup_at,
            csat_requested=csat_requested,
        )
        self.live_since = None
        self._record(
            CaseClosed(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.id,
                closed_at=at,
                closed_by_role=actor.role.value,
                closed_by_id=actor.actor_id,
                resolved=resolved,
                contact_reason=contact_reason.value,
                resolution_code=resolution_code.value if resolution_code else None,
                followup_at=followup_at,
                csat_requested=csat_requested,
            )
        )
        self._change_status(CaseStatus.CLOSED, at=at, actor=actor, reason="closed")

    # ------------------------------------------------------------------ helpers
    def _require(self, *allowed: CaseStatus, target: CaseStatus) -> None:
        if self.is_closed:
            raise CaseClosedError()
        if self.status not in allowed:
            raise invalid_case_transition(self.status, target.value)

    def _require_assignee(self) -> str:
        if self.assigned_analyst_id is None:
            raise InvalidTransitionError(
                "El caso todavía no tiene una persona asignada.", currentStatus=self.status.value
            )
        return self.assigned_analyst_id

    def _change_status(
        self, target: CaseStatus, *, at: datetime, actor: ActorRef, reason: str
    ) -> None:
        previous = self.status
        self.status = target
        self._record(
            CaseStatusChanged(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.id,
                from_status=previous.value,
                to_status=target.value,
                reason=reason,
            )
        )
