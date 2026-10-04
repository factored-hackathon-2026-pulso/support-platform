"""Domain events of the assistant session (ADR 0003).

``entity`` is ``assistant`` and ``entity_id`` the session id (``AST-…``); ``case_id`` is set.
Payloads carry ids, enums and counters only: never message text, never a confirmation's
summary, never a credential (the audit and the data pipeline read these).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.shared.events import DomainEvent


@dataclass(frozen=True, kw_only=True, slots=True)
class AssistantSessionStarted(DomainEvent):
    event_type = "assistant.session_started"
    entity = "assistant"

    customer_id: str
    agent: str


@dataclass(frozen=True, kw_only=True, slots=True)
class AssistantTurnAnswered(DomainEvent):
    """agent-core answered one input. ``trace_id`` is the correlation with its traces."""

    event_type = "assistant.turn_answered"
    entity = "assistant"

    agent: str | None
    run_id: str | None
    awaiting: str
    status: str
    outcome: str | None
    trace_id: str
    messages: int


@dataclass(frozen=True, kw_only=True, slots=True)
class AssistantInputQueued(DomainEvent):
    """The customer answered a confirmation: an input for the agent is waiting to be sent."""

    event_type = "assistant.input_queued"
    entity = "assistant"

    kind: str
    answer: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class AssistantStepUpVerified(DomainEvent):
    """The customer passed the (simulated) second factor; the blocked input is resent."""

    event_type = "assistant.step_up_verified"
    entity = "assistant"

    simulated: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class AssistantStepUpRejected(DomainEvent):
    event_type = "assistant.step_up_rejected"
    entity = "assistant"

    attempts: int


@dataclass(frozen=True, kw_only=True, slots=True)
class AssistantEnded(DomainEvent):
    """The session stopped being active. ``result``: ``resolved`` (the case closed),
    ``escalated`` (the agent handed over, ``handoff_ref`` set), ``ended`` (its run ended
    without resolving), ``failed`` (agent-core did not answer; ``code`` says why) or
    ``released`` (a supervisor took the case)."""

    event_type = "assistant.ended"
    entity = "assistant"

    result: str
    handoff_ref: str | None
    code: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotQueryAsked(DomainEvent):
    """An analyst asked the copilot something about a case. The text stays in the thread: the log
    carries its size only."""

    event_type = "copilot.query_asked"
    entity = "copilot"

    question_id: str
    question_length: int


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotAnswered(DomainEvent):
    """agent-core answered the analyst's question (``trace_id`` correlates with its traces)."""

    event_type = "copilot.answered"
    entity = "copilot"

    question_id: str
    agent: str
    run_id: str | None
    trace_id: str
    status: str
    messages: int


#: Every copilot event: audited, never sent on a socket (the thread is the analyst's alone).
COPILOT_EVENTS: tuple[type[DomainEvent], ...] = (CopilotQueryAsked, CopilotAnswered)


#: Every assistant event (the realtime projection owns them).
ASSISTANT_EVENTS: tuple[type[DomainEvent], ...] = (
    AssistantSessionStarted,
    AssistantTurnAnswered,
    AssistantInputQueued,
    AssistantStepUpVerified,
    AssistantStepUpRejected,
    AssistantEnded,
)
