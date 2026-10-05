"""The agent builder's two records (ADR 0003 §7, slice 16).

``BuilderProposal`` is the platform's *index* of agent-core's proposals. agent-core's registry has
no "list proposals" call, so the platform remembers the ones it created or learned about (a
supervisor creates one here, or the builder chat made one and it is tracked by id) and keeps the
last state it saw. The registry stays the source of truth: every detail read goes there, and the
cached state is refreshed on the way.

``BuilderThread`` is a supervisor's conversation with the builder agent (``constructor-chat``).
One thread per person. Same mechanics as the analyst's copilot thread: a question is stored
before the call, retried by ``client_message_id``, and a run that agent-core closed is replaced
by another one keeping the thread. The agent only proposes; approving and publishing are human
steps in the registry (agent-core ADR 0018 §6).

Message text lives in the thread (and in agent-core's transcript); events carry ids and sizes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from cc_platform.domain.ai.copilot import MAX_ANSWER, MAX_MESSAGES, normalize_question
from cc_platform.domain.ai.events import BuilderAnswered, BuilderQuestionAsked
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

type ProposalSource = Literal["platform", "chat", "tracked", "engine"]
PROPOSAL_SOURCES: tuple[ProposalSource, ...] = ("platform", "chat", "tracked", "engine")
#: ``registered_by`` of a proposal the improvement engine announced (ADR 0007): no staff member.
ENGINE_REGISTRANT = "engine"


@dataclass(eq=False)
class BuilderProposal(AggregateRoot):
    id: str
    """agent-core's proposal id (opaque text; not a platform id)."""
    agent_id: str
    title: str
    origin: str
    created_by: str
    """Who agent-core says created it (a staff id, or the builder service's)."""
    registered_by: str
    """The staff member whose action brought it into the platform's list."""
    source: ProposalSource
    state: str
    rev: int
    base_release_id: str | None
    candidate_hash: str | None
    created_at: datetime
    updated_at: datetime
    """When the registry last changed it (agent-core's ``updated_at``)."""
    refreshed_at: datetime
    """When the platform last read it from the registry."""

    def __post_init__(self) -> None:
        if not self.id.strip():
            raise InvalidValueError("a proposal needs an id", field="proposal_id")
        if self.source == "engine":
            if self.registered_by != ENGINE_REGISTRANT:
                raise InvalidValueError("the engine announces its own", field="registered_by")
        else:
            require_id(self.registered_by, IdPrefix.STAFF)

    def observe(
        self,
        *,
        title: str,
        state: str,
        rev: int,
        base_release_id: str | None,
        candidate_hash: str | None,
        updated_at: datetime,
        at: datetime,
    ) -> bool:
        """Remember what the registry says now. Returns whether anything changed."""
        changed = (self.title, self.state, self.rev, self.base_release_id, self.candidate_hash) != (
            title,
            state,
            rev,
            base_release_id,
            candidate_hash,
        ) or self.updated_at != updated_at
        self.title, self.state, self.rev = title, state, rev
        self.base_release_id, self.candidate_hash = base_release_id, candidate_hash
        self.updated_at = updated_at
        self.refreshed_at = at
        return changed


type BuilderRole = Literal["person", "agent"]


@dataclass(frozen=True, slots=True)
class BuilderMessage:
    id: str
    role: BuilderRole
    text: str
    created_at: datetime
    client_message_id: str | None = None
    """Only on the person's messages (the idempotency key of the request)."""
    answers: str | None = None
    """On an agent message: the id of the person's message it answers."""


@dataclass(eq=False)
class BuilderThread(AggregateRoot):
    id: str
    staff_id: str
    agent: str
    """The agent asked (``id@alias``), e.g. ``constructor-chat@prod``."""
    created_at: datetime
    updated_at: datetime
    agent_session_id: str | None = None
    run_id: str | None = None
    runs: int = 0
    """How many runs the thread has used (the idempotency key of each is ``<thread id>.<n>``)."""
    messages: tuple[BuilderMessage, ...] = ()
    last_trace_id: str | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.BUILDER_THREAD)
        require_id(self.staff_id, IdPrefix.STAFF)

    @classmethod
    def start(cls, *, thread_id: str, staff_id: str, agent: str, at: datetime) -> BuilderThread:
        return cls(id=thread_id, staff_id=staff_id, agent=agent, created_at=at, updated_at=at)

    # ------------------------------------------------------------------ queries
    def message_by_client_id(self, client_message_id: str) -> BuilderMessage | None:
        return next((m for m in self.messages if m.client_message_id == client_message_id), None)

    def answers_to(self, message_id: str) -> tuple[BuilderMessage, ...]:
        return tuple(m for m in self.messages if m.answers == message_id)

    @property
    def run_key(self) -> str:
        """The idempotency key of the current run (``POST /v1/runs``)."""
        return f"{self.id}.{self.runs}"

    # ------------------------------------------------------------------ writing
    def say(
        self, *, message_id: str, text: str, client_message_id: str, at: datetime, actor: ActorRef
    ) -> tuple[BuilderMessage, bool]:
        """Store what the person wrote. Returns ``(message, is_new)``: the same
        ``client_message_id`` with the same text is a retry; with another text, a conflict."""
        clean = normalize_question(text)
        existing = self.message_by_client_id(client_message_id)
        if existing is not None:
            if existing.text != clean:
                raise IdempotencyConflictError()
            return existing, False
        message = BuilderMessage(
            id=message_id,
            role="person",
            text=clean,
            created_at=at,
            client_message_id=client_message_id,
        )
        self._append(message, at)
        self._record(
            BuilderQuestionAsked(
                occurred_at=at,
                actor=actor,
                entity_id=self.id,
                question_id=message_id,
                question_length=len(clean),
            )
        )
        return message, True

    def link_run(self, *, agent_session_id: str, run_id: str, at: datetime) -> None:
        self.agent_session_id = agent_session_id
        self.run_id = run_id
        self.updated_at = at

    def new_run(self, *, at: datetime) -> None:
        """agent-core closed the run: the next call starts another one in a new session."""
        self.runs += 1
        self.agent_session_id = None
        self.run_id = None
        self.updated_at = at

    def record_answer(
        self,
        *,
        question_id: str,
        texts: list[str],
        message_ids: list[str],
        trace_id: str,
        status: str,
        at: datetime,
    ) -> tuple[BuilderMessage, ...]:
        """Store what the agent answered (empty texts are skipped; long ones are cut)."""
        if len(texts) != len(message_ids):
            raise InvalidValueError("one id per answer message", field="message_ids")
        written: list[BuilderMessage] = []
        for message_id, raw in zip(message_ids, texts, strict=True):
            text = raw.strip()[:MAX_ANSWER]
            if not text:
                continue
            answer = BuilderMessage(
                id=message_id, role="agent", text=text, created_at=at, answers=question_id
            )
            self._append(answer, at)
            written.append(answer)
        self.last_trace_id = trace_id
        self._record(
            BuilderAnswered(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=self.id,
                question_id=question_id,
                agent=self.agent,
                run_id=self.run_id,
                trace_id=trace_id,
                status=status,
                messages=len(written),
            )
        )
        return tuple(written)

    def _append(self, message: BuilderMessage, at: datetime) -> None:
        self.messages = (*self.messages, message)[-MAX_MESSAGES:]
        self.updated_at = at
