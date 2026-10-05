"""``AssistantSession`` aggregate: the conversation a case holds with the agent (ADR 0003).

One session per case that opened in the hands of the agent. It is the platform's side of an
agent-core *session* (``session_id``) and of the *runs* in it (a transfer between agents opens
another run in the same session). It keeps what the customer-facing API needs (what the agent
waits for: a confirmation or a step-up), and the bookkeeping that makes calling agent-core safe:

- exactly one input is **in flight** at a time (``claim``): a compare-and-set on the session
  serialises concurrent jobs, a stale claim (the process died) is taken over, and agent-core
  de-duplicates the retry by its ``client_turn_id``;
- the customer's confirmation answer is **queued** until a job sends it;
- an input that stopped at a step-up is **blocked** and resent, with the elevated credential,
  once the customer passes the (simulated) second factor, like agent-core's reference client.

State machine (anything else raises ``AssistantNotActiveError``)::

    active ──▶ resolved   (the agent resolved the conversation; the case closes)
    active ──▶ escalated  (the agent handed over; ``handoff_ref`` is set; people take the case)
    active ──▶ ended      (its run ended without resolving; people take the case)
    active ──▶ failed     (agent-core did not answer or refused; people take the case)
    active ──▶ released   (a supervisor took the case from the agent)

Message text is never stored here: it lives in the case's turns.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal

from cc_platform.domain.ai.errors import (
    AssistantBusyError,
    AssistantNotActiveError,
    ConfirmationExpiredError,
    ConfirmationNotPendingError,
    StepUpNotPendingError,
)
from cc_platform.domain.ai.events import (
    AssistantEnded,
    AssistantInputQueued,
    AssistantSessionStarted,
    AssistantStepUpRejected,
    AssistantStepUpVerified,
    AssistantTurnAnswered,
)
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

#: How an analyst labels the usefulness of the assistant's handoff when she closes the case.
HANDOFF_QUALITIES: frozenset[str] = frozenset({"useful", "incomplete", "unnecessary"})

MAX_STEP_UP_ATTEMPTS = 3
#: How long a verified second factor keeps elevating the customer's credentials.
STEP_UP_WINDOW = timedelta(minutes=15)

type InputKind = Literal["text", "confirm"]


class AssistantState(StrEnum):
    ACTIVE = "active"
    RESOLVED = "resolved"
    ESCALATED = "escalated"
    ENDED = "ended"
    FAILED = "failed"
    RELEASED = "released"


@dataclass(frozen=True, slots=True)
class PendingConfirmation:
    """The agent asks the customer to confirm an action (the token goes back with the answer)."""

    token: str
    summary: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class PendingStepUp:
    reason: str
    simulated: bool


@dataclass(frozen=True, slots=True)
class AgentInput:
    """One thing to send agent-core: a customer message (``sequence`` of its turn) or the
    answer to a confirmation (``token`` and ``answer``). ``turn_id`` is the base of the
    ``client_turn_id``; each resend after a step-up bumps ``attempt`` so agent-core does not
    answer it from its de-duplication cache."""

    kind: InputKind
    turn_id: str
    sequence: int | None = None
    token: str | None = None
    answer: Literal["yes", "no"] | None = None
    attempt: int = 0

    @property
    def client_turn_id(self) -> str:
        return self.turn_id if self.attempt == 0 else f"{self.turn_id}.{self.attempt}"

    def resend(self) -> AgentInput:
        return AgentInput(
            kind=self.kind,
            turn_id=self.turn_id,
            sequence=self.sequence,
            token=self.token,
            answer=self.answer,
            attempt=self.attempt + 1,
        )


@dataclass(eq=False)
class AssistantSession(AggregateRoot):
    id: str
    case_id: str
    customer_id: str
    entry_agent: str
    """The agent the conversation starts with (``id@alias``), e.g. ``recepcion@prod``."""
    created_at: datetime
    updated_at: datetime
    state: AssistantState = AssistantState.ACTIVE
    agent: str | None = None
    """The agent that answered last (``id@version``; it changes after a transfer)."""
    agent_session_id: str | None = None
    run_id: str | None = None
    agent_release: str | None = None
    """The agent release the run started on (agent-core's), for outcome attribution."""
    awaiting: str = "none"
    confirmation: PendingConfirmation | None = None
    step_up: PendingStepUp | None = None
    step_up_verified_at: datetime | None = None
    step_up_attempts: int = 0
    processed_sequence: int = 0
    """The last customer message sent to the agent (by its turn sequence)."""
    claim: AgentInput | None = None
    claimed_at: datetime | None = None
    queued: AgentInput | None = None
    blocked: AgentInput | None = None
    resend_blocked: bool = False
    handoff_ref: str | None = None
    handoff_resolved_at: datetime | None = None
    failure_code: str | None = None
    last_trace_id: str | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.ASSISTANT_SESSION)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.customer_id, IdPrefix.CUSTOMER)

    # ------------------------------------------------------------------ factory
    @classmethod
    def start(
        cls, *, session_id: str, case_id: str, customer_id: str, entry_agent: str, at: datetime
    ) -> AssistantSession:
        session = cls(
            id=session_id,
            case_id=case_id,
            customer_id=customer_id,
            entry_agent=entry_agent,
            created_at=at,
            updated_at=at,
        )
        session._record(
            AssistantSessionStarted(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=session_id,
                case_id=case_id,
                customer_id=customer_id,
                agent=entry_agent,
            )
        )
        return session

    # ------------------------------------------------------------------ queries
    @property
    def is_active(self) -> bool:
        return self.state is AssistantState.ACTIVE

    def step_up_valid(self, now: datetime) -> bool:
        """The customer passed the second factor recently enough to elevate the credential."""
        return (
            self.step_up_verified_at is not None and now - self.step_up_verified_at < STEP_UP_WINDOW
        )

    def _require_active(self) -> None:
        if not self.is_active:
            raise AssistantNotActiveError(state=self.state.value)

    # ------------------------------------------------------------------ choosing the next input
    def select_input(
        self,
        unprocessed_messages: list[tuple[int, str]],
        *,
        now: datetime,
        claim_timeout: timedelta,
    ) -> AgentInput | None:
        """What to send next, or ``None`` (nothing to do, or another job holds the claim).

        ``unprocessed_messages`` are the customer messages after ``processed_sequence`` as
        ``(sequence, turn id)``, oldest first. A fresh claim blocks everything; a stale one is
        taken over (same input, same ``client_turn_id``: agent-core answers it once). Order:
        the queued confirmation, then the blocked input after a verified step-up, then the
        next message."""
        if not self.is_active:
            return None
        if self.claim is not None:
            stale = self.claimed_at is None or now - self.claimed_at >= claim_timeout
            return self.claim if stale else None
        if self.queued is not None:
            return self.queued
        if self.resend_blocked and self.blocked is not None:
            return self.blocked.resend()
        if unprocessed_messages:
            sequence, turn_id = unprocessed_messages[0]
            return AgentInput(kind="text", turn_id=turn_id, sequence=sequence)
        return None

    def claim_input(self, chosen: AgentInput, *, now: datetime) -> None:
        """Mark ``chosen`` as in flight (saved with the session's compare-and-set)."""
        self._require_active()
        if self.queued is not None and chosen.turn_id == self.queued.turn_id:
            self.queued = None
        if self.resend_blocked and self.blocked is not None:
            if chosen.turn_id == self.blocked.turn_id:
                self.blocked = chosen  # remember the attempt that is in flight
            self.resend_blocked = False
        self.claim = chosen
        self.claimed_at = now
        self.updated_at = now

    def link_run(
        self,
        *,
        agent_session_id: str,
        run_id: str,
        agent: str,
        at: datetime,
        release: str | None = None,
    ) -> None:
        self._require_active()
        self.agent_session_id = agent_session_id
        self.run_id = run_id
        self.agent_release = release or self.agent_release
        self.agent = agent
        self.updated_at = at

    # ------------------------------------------------------------------ the agent answered
    def apply_answer(
        self,
        *,
        turn_id: str,
        at: datetime,
        awaiting: str,
        status: str,
        trace_id: str,
        messages: int,
        run_id: str | None,
        agent: str | None,
        outcome: str | None,
        confirmation: PendingConfirmation | None,
        step_up: PendingStepUp | None,
    ) -> None:
        """Record agent-core's answer to the in-flight input and free the claim."""
        self._require_active()
        claim = self.claim
        if claim is None or claim.turn_id != turn_id:
            raise AssistantBusyError(turn_id=turn_id)
        if claim.kind == "text" and claim.sequence is not None:
            self.processed_sequence = max(self.processed_sequence, claim.sequence)
        self.claim = None
        self.claimed_at = None
        self.awaiting = awaiting
        self.confirmation = confirmation
        self.step_up = step_up
        if step_up is not None:
            self.blocked = claim  # resend it once the customer verifies
            self.step_up_attempts = 0
        else:
            self.blocked = None
        self.run_id = run_id or self.run_id
        self.agent = agent or self.agent
        self.last_trace_id = trace_id
        self.updated_at = at
        self._record(
            AssistantTurnAnswered(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=self.id,
                case_id=self.case_id,
                agent=self.agent,
                run_id=self.run_id,
                awaiting=awaiting,
                status=status,
                outcome=outcome,
                trace_id=trace_id,
                messages=messages,
                release=self.agent_release,
            )
        )

    # ------------------------------------------------------------------ the customer acts
    def answer_confirmation(
        self,
        *,
        token: str,
        answer: Literal["yes", "no"],
        turn_id: str,
        actor: ActorRef,
        at: datetime,
    ) -> None:
        """The customer answered the pending confirmation: queue it for the agent."""
        self._require_active()
        pending = self.confirmation
        if pending is None or pending.token != token:
            raise ConfirmationNotPendingError()
        if pending.expires_at <= at:
            raise ConfirmationExpiredError()
        if self.claim is not None:
            raise AssistantBusyError()
        self.queued = AgentInput(kind="confirm", turn_id=turn_id, token=token, answer=answer)
        self.confirmation = None
        self.updated_at = at
        self._record(
            AssistantInputQueued(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                kind="confirm",
                answer=answer,
            )
        )

    def verify_step_up(self, *, actor: ActorRef, at: datetime) -> None:
        """The customer passed the second factor: the blocked input will be resent."""
        self._require_active()
        pending = self.step_up
        if pending is None or self.blocked is None:
            raise StepUpNotPendingError()
        self.step_up_verified_at = at
        self.step_up = None
        self.resend_blocked = True
        self.updated_at = at
        self._record(
            AssistantStepUpVerified(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                simulated=pending.simulated,
            )
        )

    def reject_step_up(self, *, actor: ActorRef, at: datetime) -> bool:
        """A wrong code. Returns True once the attempts are used up (people take over)."""
        self._require_active()
        if self.step_up is None:
            raise StepUpNotPendingError()
        self.step_up_attempts += 1
        self.updated_at = at
        self._record(
            AssistantStepUpRejected(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                case_id=self.case_id,
                attempts=self.step_up_attempts,
            )
        )
        return self.step_up_attempts >= MAX_STEP_UP_ATTEMPTS

    # ------------------------------------------------------------------ ending
    def _end(
        self,
        state: AssistantState,
        *,
        at: datetime,
        handoff_ref: str | None = None,
        code: str | None = None,
        actor: ActorRef | None = None,
    ) -> None:
        self._require_active()
        self.state = state
        self.claim = None
        self.claimed_at = None
        self.queued = None
        self.confirmation = None
        self.step_up = None
        self.resend_blocked = False
        self.handoff_ref = handoff_ref
        self.failure_code = code
        self.updated_at = at
        self._record(
            AssistantEnded(
                occurred_at=at,
                actor=actor or ActorRef.system(),
                entity_id=self.id,
                case_id=self.case_id,
                result=state.value,
                handoff_ref=handoff_ref,
                code=code,
            )
        )

    def resolve(self, *, at: datetime) -> None:
        self._end(AssistantState.RESOLVED, at=at)

    def escalate(self, *, handoff_ref: str, at: datetime) -> None:
        if not handoff_ref:
            raise InvalidValueError("an escalation carries its handoff", field="handoff_ref")
        self._end(AssistantState.ESCALATED, at=at, handoff_ref=handoff_ref)

    def end_without_resolution(self, *, at: datetime, outcome: str) -> None:
        self._end(AssistantState.ENDED, at=at, code=outcome)

    def fail(self, *, at: datetime, code: str) -> None:
        self._end(AssistantState.FAILED, at=at, code=code)

    def release(self, *, actor: ActorRef, at: datetime) -> None:
        self._end(AssistantState.RELEASED, at=at, actor=actor)

    def mark_handoff_resolved(self, *, at: datetime) -> bool:
        """The platform told agent-core how the handoff went (once)."""
        if self.handoff_ref is None or self.handoff_resolved_at is not None:
            return False
        self.handoff_resolved_at = at
        self.updated_at = at
        return True
