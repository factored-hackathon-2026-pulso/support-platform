"""``CopilotThread``: an analyst's conversation with the copilot about one case (ADR 0003).

One thread per (case, analyst). The copilot is an agent-core agent (``copiloto-asesor``) that reads
and calculates: it answers the analyst's questions about the customer and suggests what to look
up. It writes nothing and runs as the analyst (an ``advisor`` principal with a short delegation
on this one customer), so what it may show is decided by agent-core for her permissions.

The thread keeps agent-core's session and run, and the messages (so the panel survives a reload):

- a question is stored **before** the call, with the analyst's ``client_message_id``; a retry of
  the same question never asks twice and, if the first call failed, asks again with the same
  ``client_turn_id``;
- the answer is stored when it arrives (it may be several messages);
- a run that agent-core closed is replaced by a new one (``new_run``), keeping the thread.

Message text lives here (and in agent-core's transcript); the events carry ids and sizes only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from cc_platform.domain.ai.events import CopilotAnswered, CopilotQueryAsked
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

MAX_QUESTION = 2000
MAX_ANSWER = 4000
#: The thread keeps the newest messages only (it is a working aid, not a record).
MAX_MESSAGES = 200

type CopilotRole = Literal["analyst", "copilot"]


def normalize_question(text: str) -> str:
    """Trimmed, 1-2000 characters."""
    normalized = text.strip()
    if not normalized:
        raise InvalidValueError("Escribe tu pregunta.", field="text")
    if len(normalized) > MAX_QUESTION:
        raise InvalidValueError(
            f"La pregunta puede tener hasta {MAX_QUESTION} caracteres.", field="text"
        )
    return normalized


@dataclass(frozen=True, slots=True)
class CopilotMessage:
    id: str
    role: CopilotRole
    text: str
    created_at: datetime
    client_message_id: str | None = None
    """Only on the analyst's questions (the idempotency key of the request)."""
    answers: str | None = None
    """On a copilot message: the id of the question it answers."""


@dataclass(eq=False)
class CopilotThread(AggregateRoot):
    id: str
    case_id: str
    analyst_id: str
    agent: str
    """The agent asked (``id@alias``), e.g. ``copiloto-asesor@prod``."""
    created_at: datetime
    updated_at: datetime
    agent_session_id: str | None = None
    run_id: str | None = None
    runs: int = 0
    """How many runs the thread has used (the idempotency key of each is ``<thread id>.<n>``)."""
    messages: tuple[CopilotMessage, ...] = ()
    last_trace_id: str | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.COPILOT_THREAD)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.analyst_id, IdPrefix.STAFF)

    @classmethod
    def start(
        cls, *, thread_id: str, case_id: str, analyst_id: str, agent: str, at: datetime
    ) -> CopilotThread:
        return cls(
            id=thread_id,
            case_id=case_id,
            analyst_id=analyst_id,
            agent=agent,
            created_at=at,
            updated_at=at,
        )

    # ------------------------------------------------------------------ queries
    def question_by_client_id(self, client_message_id: str) -> CopilotMessage | None:
        return next((m for m in self.messages if m.client_message_id == client_message_id), None)

    def answers_to(self, question_id: str) -> tuple[CopilotMessage, ...]:
        return tuple(m for m in self.messages if m.answers == question_id)

    @property
    def run_key(self) -> str:
        """The idempotency key of the current run (``POST /v1/runs``)."""
        return f"{self.id}.{self.runs}"

    # ------------------------------------------------------------------ asking
    def ask(
        self,
        *,
        message_id: str,
        text: str,
        client_message_id: str,
        at: datetime,
    ) -> tuple[CopilotMessage, bool]:
        """Store a question. Returns ``(question, is_new)``: the same ``client_message_id`` with
        the same text is a retry (``is_new`` False); with another text it is a conflict."""
        clean = normalize_question(text)
        existing = self.question_by_client_id(client_message_id)
        if existing is not None:
            if existing.text != clean:
                raise IdempotencyConflictError()
            return existing, False
        question = CopilotMessage(
            id=message_id,
            role="analyst",
            text=clean,
            created_at=at,
            client_message_id=client_message_id,
        )
        self._append(question, at)
        self._record(
            CopilotQueryAsked(
                occurred_at=at,
                actor=ActorRef(ActorRole.ANALYST, self.analyst_id),
                entity_id=self.id,
                case_id=self.case_id,
                question_id=message_id,
                question_length=len(clean),
            )
        )
        return question, True

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
    ) -> tuple[CopilotMessage, ...]:
        """Store what the copilot answered (empty texts are skipped; long ones are cut)."""
        if len(texts) != len(message_ids):
            raise InvalidValueError("one id per answer message", field="message_ids")
        written: list[CopilotMessage] = []
        for message_id, raw in zip(message_ids, texts, strict=True):
            text = raw.strip()[:MAX_ANSWER]
            if not text:
                continue
            answer = CopilotMessage(
                id=message_id, role="copilot", text=text, created_at=at, answers=question_id
            )
            self._append(answer, at)
            written.append(answer)
        self.last_trace_id = trace_id
        self._record(
            CopilotAnswered(
                occurred_at=at,
                actor=ActorRef.system(),
                entity_id=self.id,
                case_id=self.case_id,
                question_id=question_id,
                agent=self.agent,
                run_id=self.run_id,
                trace_id=trace_id,
                status=status,
                messages=len(written),
            )
        )
        return tuple(written)

    def _append(self, message: CopilotMessage, at: datetime) -> None:
        kept = (*self.messages, message)[-MAX_MESSAGES:]
        self.messages = kept
        self.updated_at = at
