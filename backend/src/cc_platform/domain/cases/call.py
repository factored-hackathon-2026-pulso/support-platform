"""``Call`` aggregate: one simulated phone call of a case (slice 12). No telephony: the
platform only keeps the call's state, its times and its transcript (turns of kind
``transcript`` in the case, written by the people on the line).

State machine (explicit transitions; anything else raises ``InvalidTransitionError``, and
anything on an ended call raises ``CallNotActiveError``)::

    ringing ──▶ in_call            (answered: the assignee an inbound call, the customer an
                                     outbound one)
    in_call ──▶ on_hold ──▶ in_call (the analyst holds and resumes; each hold is an interval)
    ringing ──▶ ended              (cancelled by who called, or an outbound call rejected)
    in_call | on_hold ──▶ ended    (either side hangs up: ``completed``)
    in_call | on_hold ──▶ same + muted flag (the analyst mutes or unmutes her line)

A case has at most one active call (``Case.active_call_id``): starting and ending a call also
save the case, so the case's compare-and-set serialises a call against a close or a second
call. ``duration_seconds`` is the talk time (answer → end, holds included).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.cases.errors import CallNotActiveError
from cc_platform.domain.cases.events import (
    CallAnswered,
    CallEnded,
    CallHeld,
    CallMuteChanged,
    CallResumed,
    CallStarted,
)
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

MAX_CALL_REASON = 500


class CallDirection(StrEnum):
    """``inbound``: the customer called the bank; ``outbound``: an analyst called them."""

    INBOUND = "inbound"
    OUTBOUND = "outbound"


class CallState(StrEnum):
    RINGING = "ringing"
    IN_CALL = "in_call"
    ON_HOLD = "on_hold"
    ENDED = "ended"


#: A call in one of these states is the case's active call.
ACTIVE_CALL_STATES: frozenset[CallState] = frozenset(
    {CallState.RINGING, CallState.IN_CALL, CallState.ON_HOLD}
)


class CallEndReason(StrEnum):
    """How the call ended (team-generated list)."""

    COMPLETED = "completed"
    """Someone hung up after the call was answered."""
    CANCELLED = "cancelled"
    """Who called hung up before anyone answered."""
    REJECTED = "rejected"
    """The customer rejected an outbound call."""


def normalize_call_reason(reason: str) -> str:
    """Why an analyst calls (required for an outbound call): trimmed, 1–500 characters."""
    normalized = reason.strip()
    if not normalized:
        raise InvalidValueError("Escribe el motivo de la llamada.", field="reason")
    if len(normalized) > MAX_CALL_REASON:
        raise InvalidValueError(
            f"El motivo puede tener hasta {MAX_CALL_REASON} caracteres.", field="reason"
        )
    return normalized


@dataclass(frozen=True, slots=True)
class HoldInterval:
    """One hold: from ``started_at`` until ``ended_at`` (``None`` while on hold)."""

    started_at: datetime
    ended_at: datetime | None = None

    def seconds(self) -> int:
        if self.ended_at is None:
            return 0
        return max(0, int((self.ended_at - self.started_at).total_seconds()))


@dataclass(eq=False)
class Call(AggregateRoot):
    id: str
    case_id: str
    customer_id: str
    direction: CallDirection
    started_at: datetime
    """When it started ringing."""
    state: CallState = CallState.RINGING
    reason: str | None = None
    """Why the analyst called (outbound only; staff text, the audit shows only its length)."""
    analyst_id: str | None = None
    """Who is on the line for the bank: the caller (outbound) or who answered (inbound)."""
    answered_at: datetime | None = None
    ended_at: datetime | None = None
    end_reason: CallEndReason | None = None
    ended_by_role: ActorRole | None = None
    muted: bool = False
    """The analyst's microphone is muted (the customer does not hear her)."""
    holds: tuple[HoldInterval, ...] = ()
    creation_key: str | None = None
    """``Idempotency-Key`` of the request that started it (a retry replays it)."""

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.CALL)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.customer_id, IdPrefix.CUSTOMER)
        if self.analyst_id is not None:
            require_id(self.analyst_id, IdPrefix.STAFF)
        if (self.direction is CallDirection.OUTBOUND) != (self.reason is not None):
            raise InvalidValueError("only an outbound call has a reason", field="reason")
        if self.direction is CallDirection.OUTBOUND and self.analyst_id is None:
            raise InvalidValueError("an outbound call needs its caller", field="analyst_id")
        if (self.state is CallState.ENDED) != (self.ended_at is not None):
            raise InvalidValueError("only an ended call has ended_at", field="state")
        talking = self.state in {CallState.IN_CALL, CallState.ON_HOLD}
        if talking and self.answered_at is None:
            raise InvalidValueError("an answered call has answered_at", field="answered_at")
        open_holds = [h for h in self.holds if h.ended_at is None]
        if len(open_holds) != (1 if self.state is CallState.ON_HOLD else 0):
            raise InvalidValueError("only a call on hold has an open hold", field="holds")

    # ------------------------------------------------------------------ factories
    @classmethod
    def start_inbound(
        cls,
        *,
        call_id: str,
        case_id: str,
        customer_id: str,
        at: datetime,
        creation_key: str | None = None,
    ) -> Call:
        """The customer calls the bank: it rings until the case's assignee answers."""
        call = cls(
            id=call_id,
            case_id=case_id,
            customer_id=customer_id,
            direction=CallDirection.INBOUND,
            started_at=at,
            creation_key=creation_key,
        )
        call._started(ActorRef(ActorRole.CUSTOMER, customer_id))
        return call

    @classmethod
    def start_outbound(
        cls,
        *,
        call_id: str,
        case_id: str,
        customer_id: str,
        analyst_id: str,
        reason: str,
        at: datetime,
        creation_key: str | None = None,
    ) -> Call:
        """An analyst calls the customer with a reason: it rings until they answer."""
        call = cls(
            id=call_id,
            case_id=case_id,
            customer_id=customer_id,
            direction=CallDirection.OUTBOUND,
            started_at=at,
            reason=normalize_call_reason(reason),
            analyst_id=analyst_id,
            creation_key=creation_key,
        )
        call._started(ActorRef(ActorRole.ANALYST, analyst_id))
        return call

    def _started(self, actor: ActorRef) -> None:
        self._record(
            CallStarted(
                occurred_at=self.started_at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                direction=self.direction.value,
                customer_id=self.customer_id,
                analyst_id=self.analyst_id,
                reason=self.reason,
            )
        )

    # ------------------------------------------------------------------ queries
    @property
    def is_active(self) -> bool:
        return self.state in ACTIVE_CALL_STATES

    @property
    def hold_seconds(self) -> int:
        """Total time on hold (closed holds only)."""
        return sum(hold.seconds() for hold in self.holds)

    @property
    def duration_seconds(self) -> int | None:
        """Talk time of an ended, answered call (holds included); ``None`` otherwise."""
        if self.ended_at is None or self.answered_at is None:
            return None
        return max(0, int((self.ended_at - self.answered_at).total_seconds()))

    def is_on_the_line(self, actor: ActorRef) -> bool:
        """Whether ``actor`` is one of the two people of this call."""
        if actor.role is ActorRole.CUSTOMER:
            return actor.actor_id == self.customer_id
        return self.analyst_id is not None and actor.actor_id == self.analyst_id

    # ------------------------------------------------------------------ transitions
    def answer(self, *, actor: ActorRef, at: datetime) -> None:
        """``ringing → in_call``: the assignee answers an inbound call (she is now on the line);
        the customer answers an outbound one."""
        self._require(CallState.RINGING, target=CallState.IN_CALL)
        if self.direction is CallDirection.INBOUND:
            if actor.role is ActorRole.CUSTOMER:
                raise InvalidValueError("the bank answers an inbound call", field="actor")
            self.analyst_id = actor.actor_id
        elif actor.role is not ActorRole.CUSTOMER or actor.actor_id != self.customer_id:
            raise InvalidValueError("the customer answers an outbound call", field="actor")
        self.state = CallState.IN_CALL
        self.answered_at = at
        self._record(
            CallAnswered(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                answered_by_role=actor.role.value,
                analyst_id=self.analyst_id or actor.actor_id,
                ring_seconds=max(0, int((at - self.started_at).total_seconds())),
            )
        )

    def hold(self, *, actor: ActorRef, at: datetime) -> None:
        """``in_call → on_hold`` (the analyst)."""
        self._require_analyst(actor)
        self._require(CallState.IN_CALL, target=CallState.ON_HOLD)
        self.state = CallState.ON_HOLD
        self.holds = (*self.holds, HoldInterval(started_at=at))
        self._record(
            CallHeld(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=actor.actor_id,
            )
        )

    def resume(self, *, actor: ActorRef, at: datetime) -> None:
        """``on_hold → in_call`` (the analyst); closes the open hold interval."""
        self._require_analyst(actor)
        self._require(CallState.ON_HOLD, target=CallState.IN_CALL)
        held = self._close_hold(at)
        self.state = CallState.IN_CALL
        self._record(
            CallResumed(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                analyst_id=actor.actor_id,
                hold_seconds=held,
            )
        )

    def set_muted(self, *, actor: ActorRef, muted: bool, at: datetime) -> bool:
        """The analyst mutes or unmutes her line while the call is answered. The same value
        is a no-op (False, no event)."""
        self._require_analyst(actor)
        self._require(CallState.IN_CALL, CallState.ON_HOLD, target=self.state)
        if muted == self.muted:
            return False
        self.muted = muted
        self._record(
            CallMuteChanged(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                muted=muted,
                analyst_id=actor.actor_id,
            )
        )
        return True

    def hang_up(self, *, actor: ActorRef, at: datetime) -> None:
        """Either side ends it. While ringing: the customer hanging up an outbound call
        rejects it; who called hanging up cancels it. Once answered: ``completed``."""
        if not self.is_active:
            raise CallNotActiveError(self.state.value)
        if self.state is CallState.RINGING:
            outbound = self.direction is CallDirection.OUTBOUND
            if outbound and actor.role is ActorRole.CUSTOMER:
                reason = CallEndReason.REJECTED
            else:
                reason = CallEndReason.CANCELLED
        else:
            reason = CallEndReason.COMPLETED
        self._end(actor=actor, at=at, reason=reason)

    def reject(self, *, actor: ActorRef, at: datetime) -> None:
        """The customer rejects a ringing outbound call."""
        if self.direction is not CallDirection.OUTBOUND or actor.role is not ActorRole.CUSTOMER:
            raise InvalidTransitionError(
                "Solo se rechaza una llamada del banco.", currentState=self.state.value
            )
        self._require(CallState.RINGING, target=CallState.ENDED)
        self._end(actor=actor, at=at, reason=CallEndReason.REJECTED)

    def ensure_talking(self) -> None:
        """Transcript lines are written only while the call is ``in_call``."""
        self._require(CallState.IN_CALL, target=CallState.IN_CALL)

    # ------------------------------------------------------------------ helpers
    def _end(self, *, actor: ActorRef, at: datetime, reason: CallEndReason) -> None:
        if self.state is CallState.ON_HOLD:
            self._close_hold(at)
        self.state = CallState.ENDED
        self.ended_at = at
        self.end_reason = reason
        self.ended_by_role = actor.role
        self._record(
            CallEnded(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                end_reason=reason.value,
                ended_by_role=actor.role.value,
                analyst_id=self.analyst_id,
                answered=self.answered_at is not None,
                duration_seconds=self.duration_seconds,
                hold_seconds=self.hold_seconds,
            )
        )

    def _close_hold(self, at: datetime) -> int:
        *done, current = self.holds
        closed = replace(current, ended_at=max(at, current.started_at))
        self.holds = (*done, closed)
        return closed.seconds()

    def _require(self, *allowed: CallState, target: CallState) -> None:
        if not self.is_active:
            raise CallNotActiveError(self.state.value)
        if self.state not in allowed:
            raise InvalidTransitionError(
                f"Una llamada en estado {self.state.value} no puede pasar a {target.value}.",
                currentState=self.state.value,
            )

    def _require_analyst(self, actor: ActorRef) -> None:
        if actor.role is ActorRole.CUSTOMER:
            raise InvalidValueError("only the bank's side does that", field="actor")
