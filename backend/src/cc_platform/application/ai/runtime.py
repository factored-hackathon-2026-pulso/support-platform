"""``AgentRuntime``: the port to ``agent-core``'s runtime API (M9: runs, turns, handoffs).

DTOs mirror the published shapes in ``agent-core/contracts/openapi.json`` (snake_case there,
Python names here). The adapter is ``infrastructure/ai/http_runtime.py``; tests use
``infrastructure/ai/memory_runtime.py``.

agent-core answers request/response (no streaming), so a turn takes as long as the model:
callers run it outside a Unit of Work (ADR 0003 §4).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Literal, Protocol

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.domain.ai.suggestion import Suggestion


class AgentAwaiting(StrEnum):
    """What the run waits for from the user on the next turn."""

    NONE = "none"
    SLOT = "slot"
    CONFIRMATION = "confirmation"
    STEP_UP = "step_up"
    INPUT = "input"


class AgentOutcome(StrEnum):
    RESOLVED = "resolved"
    ABSTAINED = "abstained"
    CANCELLED = "cancelled"
    CLARIFY_EXHAUSTED = "clarify_exhausted"
    COMPLETED = "completed"
    FAILED = "failed"
    ABANDONED = "abandoned"
    ESCALATED = "escalated"
    TRANSFERRED = "transferred"


HandoffQuality = Literal["useful", "incomplete", "unnecessary"]


@dataclass(frozen=True, slots=True)
class AgentMessage:
    kind: Literal["template", "generated"]
    text: str
    locale: str


@dataclass(frozen=True, slots=True)
class AgentConfirmation:
    """The agent asks the customer to confirm an action; ``token`` goes back with the answer."""

    action_summary: str
    token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class AgentStepUp:
    required_level: Literal["anonymous", "session", "step_up"]
    reason: str
    simulated: bool


@dataclass(frozen=True, slots=True)
class AgentTurn:
    run_id: str
    turn_id: str
    messages: tuple[AgentMessage, ...]
    locale: str
    awaiting: AgentAwaiting
    status: str
    trace_id: str
    outcome: AgentOutcome | None = None
    handoff_ref: str | None = None
    confirmation: AgentConfirmation | None = None
    step_up: AgentStepUp | None = None
    #: The agent that answered (it differs from the first one after a transfer).
    agent: str | None = None

    @property
    def escalated(self) -> bool:
        return self.outcome is AgentOutcome.ESCALATED and self.handoff_ref is not None


@dataclass(frozen=True, slots=True)
class AgentRun:
    run_id: str
    release: str
    status: str
    trace_id: str
    session_id: str | None = None
    outcome: AgentOutcome | None = None
    handoff_ref: str | None = None
    first_turn: AgentTurn | None = None
    suggestions: tuple[Suggestion, ...] = ()
    """What a ``task`` run proposed (ADR 0005). Empty for a conversation or for nothing."""


@dataclass(frozen=True, slots=True)
class SessionLineageRun:
    run_id: str
    agent: str
    release: str
    status: str
    outcome: AgentOutcome | None
    from_agent: str | None = None


@dataclass(frozen=True, slots=True)
class SessionLineage:
    session_id: str
    runs: tuple[SessionLineageRun, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class HandoffResolutionResult:
    handoff_ref: str
    resolution_code: str
    handoff_quality: HandoffQuality


class AgentRuntimeError(Exception):
    """agent-core answered with an error (``application/problem+json``).

    ``code`` is its stable problem code (``agent_forbidden``, ``run_closed``,
    ``idempotency_conflict`` ...). The message never carries a credential or message text.
    """

    def __init__(self, *, status: int, code: str, trace_id: str | None = None) -> None:
        super().__init__(f"agent-core answered {status} {code}")
        self.status = status
        self.code = code
        self.trace_id = trace_id


class AgentRuntimeUnavailableError(Exception):
    """agent-core did not answer in time or was unreachable (the case falls back to a person)."""


class AgentRuntime(Protocol):
    async def start_run(
        self,
        credentials: AgentCredentials,
        *,
        agent: str,
        idempotency_key: str,
        lang: str | None = None,
        input: Mapping[str, object] | None = None,
    ) -> AgentRun:
        """``POST /v1/runs``. ``agent`` is ``id``, ``id@alias`` or ``id@X.Y.Z``; the subject is
        derived by agent-core from the credential, never sent. ``input`` is the validated input of
        a ``task`` agent (the copilot's suggestions: the recent turns and the case facts)."""
        ...

    async def post_turn(
        self,
        credentials: AgentCredentials,
        *,
        session_id: str,
        client_turn_id: str,
        channel: str,
        text: str = "",
        confirm_token: str | None = None,
        confirm_answer: Literal["yes", "no"] | None = None,
        lang: str | None = None,
    ) -> AgentTurn:
        """``POST /v1/sessions/{session_id}/turns``. A turn carries text or a confirmation."""
        ...

    async def get_lineage(
        self, credentials: AgentCredentials, *, session_id: str
    ) -> SessionLineage:
        """``GET /v1/sessions/{session_id}/lineage``: the runs of the session, in order."""
        ...

    async def get_handoff(
        self, credentials: AgentCredentials, *, handoff_ref: str
    ) -> dict[str, object]:
        """``GET /v1/handoffs/{ref}``: the packet rendered for the reader's permissions."""
        ...

    async def record_resolution(
        self,
        credentials: AgentCredentials,
        *,
        handoff_ref: str,
        resolution_code: str,
        handoff_quality: HandoffQuality,
        notes: str | None = None,
    ) -> HandoffResolutionResult:
        """``POST /v1/handoffs/{ref}/resolution``: once per handoff (``409`` otherwise)."""
        ...
