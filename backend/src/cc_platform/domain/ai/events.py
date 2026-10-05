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
    release: str | None = None
    """The agent release the run started on (agent-core's id), so an outcome can be attributed to
    the release that produced it; ``None`` when the runtime did not say."""


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


# --------------------------------------------------------------------------- suggestions (ADR 0005)
# ``entity`` is ``copilot`` and ``entity_id`` the suggestion id (``CPS-…``); ``case_id`` is set.
# Payloads carry ids, enums and counters only: never a draft, a motive, an evidence line or a tool's
# arguments. Audited and silent on sockets; the one signal an analyst receives (``ready``) is built
# by ``SuggestionSignal`` from these events and carries the suggestion id and status only.


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotSuggestionRequested(DomainEvent):
    """A suggestion is being prepared (``trigger``: customer_message, manual or handover)."""

    event_type = "copilot.suggestion_requested"
    entity = "copilot"

    analyst_id: str
    trigger: str
    based_on_sequence: int


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotSuggestionReady(DomainEvent):
    """agent-core proposed something: the kinds (``reply``, ``tool``, ``action``, ``escalate``)."""

    event_type = "copilot.suggestion_ready"
    entity = "copilot"

    analyst_id: str
    agent: str
    kinds: tuple[str, ...]
    count: int
    truncated: bool
    """More was proposed than kept (a cap or a limit): a flag, never the text."""
    run_id: str | None
    trace_id: str
    release: str | None = None
    """The agent release that answered (see ``AssistantTurnAnswered.release``)."""


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotSuggestionNone(DomainEvent):
    """agent-core answered that there is nothing to propose (a normal answer, not an error)."""

    event_type = "copilot.suggestion_none"
    entity = "copilot"

    analyst_id: str
    agent: str
    run_id: str | None
    trace_id: str
    release: str | None = None


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotSuggestionFailed(DomainEvent):
    """The call failed: ``failure_code`` is ours or agent-core's problem code, never a message."""

    event_type = "copilot.suggestion_failed"
    entity = "copilot"

    analyst_id: str
    failure_code: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotSuggestionDecided(DomainEvent):
    """What happened to a suggestion. ``subject`` is ``reply`` (``decision``: used, edited,
    discarded, ignored; ``edit_distance_permille`` when edited) or ``escalation`` (``accepted``)."""

    event_type = "copilot.suggestion_decided"
    entity = "copilot"

    subject: str
    decision: str
    edit_distance_permille: int | None = None
    turn_id: str | None = None
    """The turn the analyst sent when she used or edited the draft (``None`` for the other
    decisions): the join with ``turn.created`` for the engine, an id and never the text."""
    agent: str | None = None
    release: str | None = None
    """Who produced the suggestion (copied from it), so acceptance can be sliced by agent and
    release without reading the suggestion's table."""


#: Every suggestion event: audited and silent on sockets.
SUGGESTION_EVENTS: tuple[type[DomainEvent], ...] = (
    CopilotSuggestionRequested,
    CopilotSuggestionReady,
    CopilotSuggestionNone,
    CopilotSuggestionFailed,
    CopilotSuggestionDecided,
)


# ----------------------------------------------------------------------------- agent builder (S16)
# ``entity`` is ``builder``; ``entity_id`` is the proposal id (agent-core's), the agent id (an alias
# change), the release id (a revocation) or the chat thread id. Payloads carry ids, states and
# counters only: never a draft's content, a prompt, a reason or a chat text.


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalCreated(DomainEvent):
    event_type = "builder.proposal_created"
    entity = "builder"

    agent_id: str
    origin: str
    base_release_id: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalTracked(DomainEvent):
    """A proposal that agent-core already had (made by the builder chat or by hand) joined the
    platform's list."""

    event_type = "builder.proposal_tracked"
    entity = "builder"

    agent_id: str
    source: str


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderDraftSaved(DomainEvent):
    event_type = "builder.draft_saved"
    entity = "builder"

    agent_id: str
    rev: int
    changes: int
    kinds: list[str]


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalValidated(DomainEvent):
    event_type = "builder.proposal_validated"
    entity = "builder"

    agent_id: str
    violations: int
    candidate_hash: str | None


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalFrozen(DomainEvent):
    event_type = "builder.proposal_frozen"
    entity = "builder"

    agent_id: str
    candidate_hash: str
    new_versions: int


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalReopened(DomainEvent):
    event_type = "builder.proposal_reopened"
    entity = "builder"

    agent_id: str
    rev: int


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalEvaluated(DomainEvent):
    """``verdict``: ``pass``, ``fail`` (the gate refused: the proposal went back to draft) or
    ``failed_infra``."""

    event_type = "builder.proposal_evaluated"
    entity = "builder"

    agent_id: str
    suite_id: str
    verdict: str
    items: int
    items_failed: int


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalApproved(DomainEvent):
    event_type = "builder.proposal_approved"
    entity = "builder"

    agent_id: str
    candidate_hash: str
    yardstick_loosened: int
    step_up: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalRejected(DomainEvent):
    event_type = "builder.proposal_rejected"
    entity = "builder"

    agent_id: str
    reason_length: int
    step_up: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderProposalPublished(DomainEvent):
    event_type = "builder.proposal_published"
    entity = "builder"

    agent_id: str
    release_id: str
    step_up: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderAliasPromoted(DomainEvent):
    """``entity_id`` is the agent id; ``alias`` is ``staging`` or ``prod``."""

    event_type = "builder.alias_promoted"
    entity = "builder"

    alias: str
    release_id: str
    before: str | None
    reason_length: int
    step_up: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderReleaseRevoked(DomainEvent):
    """``entity_id`` is the release id."""

    event_type = "builder.release_revoked"
    entity = "builder"

    agent_id: str
    reason_length: int
    step_up: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderQuestionAsked(DomainEvent):
    """A supervisor wrote to the builder agent. ``entity_id`` is her thread; only the size of the
    text is kept."""

    event_type = "builder.question_asked"
    entity = "builder"

    question_id: str
    question_length: int


@dataclass(frozen=True, kw_only=True, slots=True)
class BuilderAnswered(DomainEvent):
    """The builder agent answered (``trace_id`` correlates with agent-core's traces)."""

    event_type = "builder.answered"
    entity = "builder"

    question_id: str
    agent: str
    run_id: str | None
    trace_id: str
    status: str
    messages: int


#: Every builder event: audited, never sent on a socket (nothing here is for the customer, and a
#: draft is not for every supervisor's screen).
BUILDER_EVENTS: tuple[type[DomainEvent], ...] = (
    BuilderProposalCreated,
    BuilderProposalTracked,
    BuilderDraftSaved,
    BuilderProposalValidated,
    BuilderProposalFrozen,
    BuilderProposalReopened,
    BuilderProposalEvaluated,
    BuilderProposalApproved,
    BuilderProposalRejected,
    BuilderProposalPublished,
    BuilderAliasPromoted,
    BuilderReleaseRevoked,
    BuilderQuestionAsked,
    BuilderAnswered,
)


#: Every assistant event (the realtime projection owns them).
ASSISTANT_EVENTS: tuple[type[DomainEvent], ...] = (
    AssistantSessionStarted,
    AssistantTurnAnswered,
    AssistantInputQueued,
    AssistantStepUpVerified,
    AssistantStepUpRejected,
    AssistantEnded,
)
