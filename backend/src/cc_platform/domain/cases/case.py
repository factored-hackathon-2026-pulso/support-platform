"""``Case`` aggregate: one chat from the customer's first message to the close.

State machine (slice 2 contract §2.3; explicit transitions, anything else raises
``InvalidTransitionError``, and writing to a closed case raises ``CaseClosedError``)::

    open ──▶ queued ──▶ assigned        (AssignCase in the open's Unit of Work, or a drain)
    assigned ──▶ in_progress            (the assignee opens or replies)
    assigned | in_progress ──▶ closed   (the assignee closes with a reason; terminal)

A closed case never reopens: the customer's next message opens a new case linked through
``previous_case_id``. Every transition records a domain event; the optimistic ``version``
makes concurrent transitions lose instead of overwrite, and also serialises turn sequence
numbers (a turn is appended in the same Unit of Work as the save).

First-response SLA: ``sla_due_at`` is the first-response due time; the first analyst
message sets ``first_response_at`` once and records ``case.first_responded``.
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
    CaseFirstResponded,
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
    CasePriority,
    CaseStatus,
    CloseReason,
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
MAX_CLOSE_NOTE = 500


def search_key(*parts: str) -> str:
    """Lower-cased, accent-stripped text for portable ``contains`` search."""
    decomposed = unicodedata.normalize("NFKD", " ".join(parts))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def preview_of(text: str) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= PREVIEW_LENGTH else flat[: PREVIEW_LENGTH - 1] + "…"


def normalize_close_note(note: str | None) -> str | None:
    """Trimmed internal note; blank → ``None``; at most 500 characters."""
    if note is None:
        return None
    trimmed = note.strip()
    if not trimmed:
        return None
    if len(trimmed) > MAX_CLOSE_NOTE:
        raise InvalidValueError(
            f"La nota puede tener hasta {MAX_CLOSE_NOTE} caracteres.", field="note"
        )
    return trimmed


@dataclass(frozen=True, slots=True)
class CaseClosure:
    """How the case ended. ``reason`` and ``note`` are for staff only."""

    closed_at: datetime
    closed_by_id: str
    closed_by_role: ActorRole
    reason: CloseReason
    note: str | None = None


@dataclass(eq=False)
class Case(AggregateRoot):
    id: str
    customer_id: str
    channel: CaseChannel
    language: Language
    priority: CasePriority
    status: CaseStatus
    opened_at: datetime
    sla_due_at: datetime
    """First-response due time (``opened_at`` + the ``SlaPolicy`` target)."""
    search_text: str
    previous_case_id: str | None = None
    """The customer's most recent closed case when this one opened ("Volvió a escribir")."""
    first_response_at: datetime | None = None
    assigned_analyst_id: str | None = None
    assigned_at: datetime | None = None
    queued_at: datetime | None = None
    queue_label: str | None = None
    """Set when nobody could take the case on arrival (``case.queued`` was recorded)."""
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
    closure: CaseClosure | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.CASE)
        require_id(self.customer_id, IdPrefix.CUSTOMER)
        if self.assigned_analyst_id is not None:
            require_id(self.assigned_analyst_id, IdPrefix.STAFF)
        if self.previous_case_id is not None:
            require_id(self.previous_case_id, IdPrefix.CASE)
            if self.previous_case_id == self.id:
                raise InvalidValueError("a case cannot follow itself", field="previous_case_id")
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
        language: Language,
        priority: CasePriority,
        opened_at: datetime,
        sla_due_at: datetime,
        actor: ActorRef,
        previous_case_id: str | None = None,
    ) -> Case:
        """A new case, ``queued`` until ``AssignCase`` places it (same Unit of Work)."""
        case = cls(
            id=case_id,
            customer_id=customer_id,
            channel=channel,
            language=language,
            priority=priority,
            status=CaseStatus.QUEUED,
            opened_at=opened_at,
            sla_due_at=sla_due_at,
            search_text=search_key(customer_name, case_id),
            previous_case_id=previous_case_id,
            queued_at=opened_at,
        )
        case._record(
            CaseOpened(
                occurred_at=opened_at,
                actor=actor,
                entity_id=case_id,
                case_id=case_id,
                customer_id=customer_id,
                channel=channel.value,
                language=language.value,
                priority=priority.value,
                sla_due_at=sla_due_at,
                previous_case_id=previous_case_id,
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

    @property
    def is_waiting_in_queue(self) -> bool:
        """Queued and already announced (``case.queued`` + banner): nobody could take it."""
        return self.status is CaseStatus.QUEUED and self.queue_label is not None

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

        The first analyst message also stops the first-response SLA. The caller stores the
        returned turn in the same Unit of Work as this case.
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
            )
        )
        if turn.is_analyst_message and self.first_response_at is None:
            self._first_response(turn)
        return turn

    def _first_response(self, turn: Turn) -> None:
        at = turn.created_at
        self.first_response_at = at
        self._record(
            CaseFirstResponded(
                occurred_at=at,
                actor=turn.author,
                entity_id=self.id,
                case_id=self.id,
                first_response_at=at,
                response_seconds=max(0, int((at - self.opened_at).total_seconds())),
                sla_due_at=self.sla_due_at,
                sla_met=at <= self.sla_due_at,
            )
        )

    def ensure_assignee_can_reply(self) -> None:
        """Rule of ``PostAnalystTurn``: only ``assigned``/``in_progress`` cases take replies."""
        if self.is_closed:
            raise CaseClosedError()
        if self.status not in REPLYABLE_STATUSES:
            raise invalid_case_transition(self.status, CaseStatus.IN_PROGRESS.value)

    # ------------------------------------------------------------------ assignment
    def mark_waiting_in_queue(
        self, *, label: str, reason_code: str, policy_rule_id: str | None, at: datetime
    ) -> bool:
        """Nobody eligible: record ``case.queued`` once (no transition, the case is already
        ``queued``). Returns False when it was already announced."""
        self._require(CaseStatus.QUEUED, target=CaseStatus.QUEUED)
        if self.queue_label is not None:
            return False
        self.queue_label = label
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
        return True

    def assign(self, assignment: Assignment) -> None:
        """``queued → assigned`` (slice 3 adds reassignment of an open case)."""
        self._require(CaseStatus.QUEUED, target=CaseStatus.ASSIGNED)
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
                waited_seconds=assignment.waited_seconds,
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

    def close(
        self, *, actor: ActorRef, at: datetime, reason: CloseReason, note: str | None = None
    ) -> None:
        """``assigned | in_progress → closed`` (terminal). The note is trimmed (≤ 500)."""
        if self.is_closed:
            raise CaseClosedError()
        if self.status not in CLOSABLE_STATUSES:
            raise invalid_case_transition(self.status, CaseStatus.CLOSED.value)
        clean_note = normalize_close_note(note)
        self.closure = CaseClosure(
            closed_at=at,
            closed_by_id=actor.actor_id,
            closed_by_role=actor.role,
            reason=reason,
            note=clean_note,
        )
        self._record(
            CaseClosed(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.id,
                closed_at=at,
                closed_by_role=actor.role.value,
                closed_by_id=actor.actor_id,
                reason=reason.value,
                note=clean_note,
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
