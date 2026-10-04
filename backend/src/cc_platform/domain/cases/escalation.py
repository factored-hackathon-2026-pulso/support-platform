"""``Escalation`` aggregate: an analyst asks supervision for help on a case she holds (slice 9).

Grounded in the dataset's ``was_escalated`` (yes/no) only: an escalation has a motive (staff
text) and what supervision did about it. There are no escalation types, amounts, limits,
levels or deadlines.

State machine (explicit transitions; anything else raises ``EscalationNotOpenError``)::

    open ──▶ withdrawn   (the assignee withdraws it)
    open ──▶ answered    (supervision answers with a note; the case stays with her)
    open ──▶ taken       (a supervisor who also holds Analista takes the case herself)
    open ──▶ reassigned  (supervision passes the case to another analyst)
    open ──▶ closed      (the assignee closes the case while it is open)
    answered | taken | reassigned ──▶ same + acknowledged_at   ("Entendido", once)

**Why its own aggregate (and not part of ``Case``).** A case can be escalated more than once
over its life (one at a time), and supervision lists escalations, not cases ("Escalados":
open first, then the ones attended today). Each escalation keeps its own row, version and
events. The "one open escalation per case" rule lives on the ``Case``
(``open_escalation_id``): every command that opens or ends an escalation also saves the case
(it writes a staff banner in the transcript), so the case's compare-and-set serialises them:
two escalations of the same case at once → the loser re-runs and gets ``escalation_open``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.cases.errors import EscalationNotOpenError
from cc_platform.domain.cases.events import (
    EscalationAcknowledged,
    EscalationAnswered,
    EscalationClosed,
    EscalationOpened,
    EscalationReassigned,
    EscalationTaken,
    EscalationWithdrawn,
)
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

MAX_ESCALATION_TEXT = 500


class EscalationState(StrEnum):
    OPEN = "open"
    ANSWERED = "answered"
    TAKEN = "taken"
    REASSIGNED = "reassigned"
    WITHDRAWN = "withdrawn"
    CLOSED = "closed"


#: Supervision did something about it ("Atendidos hoy"; the analyst gets a card to
#: acknowledge). ``withdrawn`` and ``closed`` ended without supervision.
ATTENDED_STATES: frozenset[EscalationState] = frozenset(
    {EscalationState.ANSWERED, EscalationState.TAKEN, EscalationState.REASSIGNED}
)


def normalize_escalation_text(text: str, *, field: str) -> str:
    """Required staff text (motive or answer): trimmed, 1–500 characters."""
    normalized = text.strip()
    if not normalized:
        label = "el motivo" if field == "motive" else "tu respuesta"
        raise InvalidValueError(f"Escribe {label}.", field=field)
    if len(normalized) > MAX_ESCALATION_TEXT:
        raise InvalidValueError(f"Puede tener hasta {MAX_ESCALATION_TEXT} caracteres.", field=field)
    return normalized


@dataclass(eq=False)
class Escalation(AggregateRoot):
    id: str
    case_id: str
    motive: str
    escalated_by_id: str
    escalated_at: datetime
    state: EscalationState = EscalationState.OPEN
    resolved_at: datetime | None = None
    """When it stopped being open (whatever the outcome)."""
    resolved_by_id: str | None = None
    """Who ended it: the supervisor (answered, taken, reassigned) or the analyst."""
    note: str | None = None
    """Supervision's answer for the analyst (``answered`` only)."""
    reassigned_to_id: str | None = None
    """Who holds the case now (``taken``: the supervisor herself; ``reassigned``)."""
    acknowledged_at: datetime | None = None
    creation_key: str | None = None
    """``Idempotency-Key`` of the request that opened it (a retry replays it)."""

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.ESCALATION)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.escalated_by_id, IdPrefix.STAFF)
        if normalize_escalation_text(self.motive, field="motive") != self.motive:
            raise InvalidValueError("the motive must be normalized", field="motive")
        if (self.state is EscalationState.OPEN) != (self.resolved_at is None):
            raise InvalidValueError("only an ended escalation has resolved_at", field="state")

    # ------------------------------------------------------------------ factory
    @classmethod
    def open(
        cls,
        *,
        escalation_id: str,
        case_id: str,
        motive: str,
        actor: ActorRef,
        at: datetime,
        creation_key: str | None = None,
    ) -> Escalation:
        escalation = cls(
            id=escalation_id,
            case_id=case_id,
            motive=normalize_escalation_text(motive, field="motive"),
            escalated_by_id=actor.actor_id,
            escalated_at=at,
            creation_key=creation_key,
        )
        escalation._record(
            EscalationOpened(
                occurred_at=at,
                actor=actor,
                entity_id=escalation_id,
                case_id=case_id,
                motive=escalation.motive,
                analyst_id=actor.actor_id,
            )
        )
        return escalation

    # ------------------------------------------------------------------ queries
    @property
    def is_open(self) -> bool:
        return self.state is EscalationState.OPEN

    @property
    def was_attended(self) -> bool:
        return self.state in ATTENDED_STATES

    # ------------------------------------------------------------------ transitions
    def withdraw(self, *, actor: ActorRef, at: datetime) -> None:
        self._end(EscalationState.WITHDRAWN, actor=actor, at=at)
        self._record(
            EscalationWithdrawn(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=self.escalated_by_id,
            )
        )

    def answer(self, *, actor: ActorRef, note: str, at: datetime) -> None:
        clean = normalize_escalation_text(note, field="note")
        self._end(EscalationState.ANSWERED, actor=actor, at=at)
        self.note = clean
        self._record(
            EscalationAnswered(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                note=clean,
                analyst_id=self.escalated_by_id,
            )
        )

    def take(self, *, actor: ActorRef, at: datetime) -> None:
        """The supervisor (``actor``) holds the case now."""
        self._end(EscalationState.TAKEN, actor=actor, at=at)
        self.reassigned_to_id = actor.actor_id
        self._record(
            EscalationTaken(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                previous_analyst_id=self.escalated_by_id,
                analyst_id=actor.actor_id,
            )
        )

    def mark_reassigned(self, *, actor: ActorRef, to_staff_id: str, at: datetime) -> None:
        require_id(to_staff_id, IdPrefix.STAFF)
        self._end(EscalationState.REASSIGNED, actor=actor, at=at)
        self.reassigned_to_id = to_staff_id
        self._record(
            EscalationReassigned(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                previous_analyst_id=self.escalated_by_id,
                analyst_id=to_staff_id,
            )
        )

    def end_with_case(self, *, actor: ActorRef, at: datetime) -> None:
        """The case closed while this was open."""
        self._end(EscalationState.CLOSED, actor=actor, at=at)
        self._record(
            EscalationClosed(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=self.escalated_by_id,
            )
        )

    def acknowledge(self, *, actor: ActorRef, at: datetime) -> bool:
        """The analyst who escalated read the outcome ("Entendido"). Only an attended
        escalation, only her; a second time is a no-op (False, no event)."""
        if actor.actor_id != self.escalated_by_id:
            raise InvalidValueError("only who escalated acknowledges", field="actor")
        if not self.was_attended:
            raise InvalidTransitionError(
                "Supervisión todavía no atendió este escalamiento.", currentState=self.state.value
            )
        if self.acknowledged_at is not None:
            return False
        self.acknowledged_at = at
        self._record(
            EscalationAcknowledged(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=self.escalated_by_id,
            )
        )
        return True

    def _end(self, state: EscalationState, *, actor: ActorRef, at: datetime) -> None:
        if not self.is_open:
            raise EscalationNotOpenError(self.state.value)
        self.state = state
        self.resolved_at = at
        self.resolved_by_id = actor.actor_id
