"""The chat with the builder agent (``constructor-chat``, ADR 0003 §7, slice 16).

A supervisor (or administrator) describes the change she wants; the agent reads the current
version, drafts it, creates a **proposal**, writes the draft and validates it. It **only
proposes**: freezing, evaluating, approving and publishing are the screens' steps, and approving
and publishing are human (agent-core ADR 0018 §6). The agent runs as the person (a ``builder``
credential minted from her session, without step-up); the registry and the builder's own tools
do not lend permissions (agent-core ADR 0019 §4).

One thread per person, with the mechanics of the analyst's copilot: a message is stored before the
call (idempotent on ``clientMessageId``), agent-core answers with no transaction open, and an
answer is stored after. A run that agent-core closed is replaced by another one, keeping the
thread. The proposals the agent made are created with agent-core's service identity, so the platform
does not know them: any proposal id in an answer that the registry confirms is **tracked** (joins
the platform's list) so the person finds it in the proposals screen.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from functools import partial

from cc_platform.application.ai.builder import (
    AgentBuilder,
    ProposalSummary,
    identity_of,
)
from cc_platform.application.ai.builder_step_up import BUILDER_ROLES
from cc_platform.application.ai.credentials import AgentCredentialIssuer, AgentCredentials
from cc_platform.application.ai.errors import (
    AgentCoreRejectedError,
    AgentCoreUnavailableError,
    BuilderBusyError,
)
from cc_platform.application.ai.registry import AgentRegistryClient, AgentRegistryError
from cc_platform.application.ai.runtime import (
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    AgentTurn,
)
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.builder import BuilderMessage, BuilderThread
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

#: agent-core's run is over: start another one (and the same codes as the copilot).
_RUN_OVER = frozenset({"run_closed", "not_found"})
_CHANNEL = "web"
_LANGUAGE = "es"  # ``constructor-chat`` speaks Spanish; supervisors build in it
#: agent-core's proposal ids are UUIDs.
_PROPOSAL_ID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
_MAX_TRACKED = 5


@dataclass(frozen=True, slots=True)
class BuilderMessageView:
    id: str
    role: str
    text: str
    created_at: datetime
    answers: str | None


@dataclass(frozen=True, slots=True)
class BuilderThreadView:
    messages: tuple[BuilderMessageView, ...]


@dataclass(frozen=True, slots=True)
class BuilderExchangeView:
    message: BuilderMessageView
    answers: tuple[BuilderMessageView, ...]
    proposals: tuple[ProposalSummary, ...]
    """Proposals this answer mentions that the registry confirmed (and the list now has)."""
    replayed: bool


def _view(message: BuilderMessage) -> BuilderMessageView:
    return BuilderMessageView(
        id=message.id,
        role=message.role,
        text=message.text,
        created_at=message.created_at,
        answers=message.answers,
    )


@dataclass(frozen=True, slots=True)
class GetBuilderThread:
    """``GET /builder/chat``: the person's thread (empty before her first message)."""

    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor) -> BuilderThreadView:
        ensure_any_role(actor, BUILDER_ROLES)
        async with self.uow() as uow:
            thread = await uow.builder_threads.get_for(actor.staff_id)
        return BuilderThreadView(
            messages=tuple(_view(m) for m in thread.messages) if thread else ()
        )


@dataclass(frozen=True, slots=True)
class _Stored:
    thread_id: str
    message: BuilderMessage
    answered: tuple[BuilderMessage, ...]
    agent_session_id: str | None
    run_key: str


@dataclass(frozen=True, slots=True)
class AskBuilder:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    runtime: AgentRuntime
    registry: AgentRegistryClient
    issuer: AgentCredentialIssuer
    builder: AgentBuilder
    agent: str
    """The builder agent (``id@alias``), e.g. ``constructor-chat@prod``."""

    async def execute(
        self, actor: Actor, *, text: str, client_message_id: str
    ) -> BuilderExchangeView:
        ensure_any_role(actor, BUILDER_ROLES)
        credentials = self.issuer.builder(identity_of(actor))
        stored = await retry_on_conflict(
            partial(self._store_message, actor, text, client_message_id)
        )
        if stored.answered:  # a retry of a message that already has its answer
            return BuilderExchangeView(
                message=_view(stored.message),
                answers=tuple(_view(m) for m in stored.answered),
                proposals=(),
                replayed=True,
            )
        turn, session_id, run_started = await self._ask_agent(credentials, stored)
        answers = await retry_on_conflict(
            partial(self._store_answer, actor, stored, turn, session_id, run_started)
        )
        tracked = await self._track_proposals(actor, credentials, [m.text for m in answers])
        return BuilderExchangeView(
            message=_view(stored.message),
            answers=tuple(_view(m) for m in answers),
            proposals=tracked,
            replayed=False,
        )

    # ------------------------------------------------------------------ 1. the message
    async def _store_message(self, actor: Actor, text: str, client_message_id: str) -> _Stored:
        async with self.uow() as uow:
            now = self.clock.now()
            thread = await uow.builder_threads.get_for(actor.staff_id)
            if thread is None:
                thread = BuilderThread.start(
                    thread_id=self.ids.new_id(IdPrefix.BUILDER_THREAD),
                    staff_id=actor.staff_id,
                    agent=self.agent,
                    at=now,
                )
                await uow.builder_threads.add(thread)
            message, is_new = thread.say(
                message_id=self.ids.new_id(IdPrefix.BUILDER_MESSAGE),
                text=text,
                client_message_id=client_message_id,
                at=now,
                actor=actor.acting_as(BUILDER_ROLES),
            )
            if is_new:
                await uow.builder_threads.save(thread)
                await uow.commit()
            return _Stored(
                thread_id=thread.id,
                message=message,
                answered=thread.answers_to(message.id),
                agent_session_id=thread.agent_session_id,
                run_key=thread.run_key,
            )

    # ------------------------------------------------------------------ 2. the call (no UoW)
    async def _ask_agent(
        self, credentials: AgentCredentials, stored: _Stored
    ) -> tuple[AgentTurn, str, bool]:
        """Returns ``(turn, agent session id, started a run now)``."""
        try:
            return await self._call(credentials, stored, stored.agent_session_id, stored.run_key)
        except AgentRuntimeError as error:
            if error.code in _RUN_OVER and stored.agent_session_id is not None:
                next_key = f"{stored.thread_id}.{_next_run(stored.run_key)}"
                try:
                    turn, session_id, _ = await self._call(credentials, stored, None, next_key)
                except AgentRuntimeError as retry:
                    raise self._translate(retry) from None
                except AgentRuntimeUnavailableError:
                    raise AgentCoreUnavailableError() from None
                return turn, session_id, True
            raise self._translate(error) from None
        except AgentRuntimeUnavailableError:
            raise AgentCoreUnavailableError() from None

    async def _call(
        self,
        credentials: AgentCredentials,
        stored: _Stored,
        session_id: str | None,
        run_key: str,
    ) -> tuple[AgentTurn, str, bool]:
        started = False
        if session_id is None:
            run = await self.runtime.start_run(
                credentials, agent=self.agent, idempotency_key=run_key, lang=_LANGUAGE
            )
            if run.session_id is None:
                raise AgentRuntimeError(status=502, code="no_agent_session")
            session_id, started = run.session_id, True
        turn = await self.runtime.post_turn(
            credentials,
            session_id=session_id,
            client_turn_id=stored.message.id,
            channel=_CHANNEL,
            text=stored.message.text,
            lang=_LANGUAGE,
        )
        return turn, session_id, started

    @staticmethod
    def _translate(error: AgentRuntimeError) -> Exception:
        if error.code == "turn_in_progress":
            return BuilderBusyError()
        return AgentCoreRejectedError(agent_core_code=error.code, agent_core_status=error.status)

    # ------------------------------------------------------------------ 3. the answer
    async def _store_answer(
        self,
        actor: Actor,
        stored: _Stored,
        turn: AgentTurn,
        session_id: str,
        run_started: bool,
    ) -> tuple[BuilderMessage, ...]:
        async with self.uow() as uow:
            thread = await uow.builder_threads.get_for(actor.staff_id)
            if thread is None:  # stored with the message a moment ago
                raise NotFoundError("No encontramos la conversación con el constructor.")
            now = self.clock.now()
            if run_started:
                if stored.agent_session_id is not None:
                    thread.new_run(at=now)
                thread.link_run(agent_session_id=session_id, run_id=turn.run_id, at=now)
            answers = thread.record_answer(
                question_id=stored.message.id,
                texts=[m.text for m in turn.messages],
                message_ids=[self.ids.new_id(IdPrefix.BUILDER_MESSAGE) for _ in turn.messages],
                trace_id=turn.trace_id,
                status=turn.status,
                at=now,
            )
            if turn.status == "closed":  # the run is over: the next message starts another
                thread.new_run(at=now)
            await uow.builder_threads.save(thread)
            await uow.commit()
            return answers

    # ------------------------------------------------------------------ 4. what it made
    async def _track_proposals(
        self, actor: Actor, credentials: AgentCredentials, texts: list[str]
    ) -> tuple[ProposalSummary, ...]:
        """Best effort: a proposal id in the answer that the registry confirms joins the list."""
        found: list[str] = []
        for text in texts:
            for proposal_id in _PROPOSAL_ID.findall(text):
                if proposal_id not in found:
                    found.append(proposal_id)
        tracked: list[ProposalSummary] = []
        for proposal_id in found[:_MAX_TRACKED]:
            try:
                detail = await self.registry.get_proposal(credentials, proposal_id=proposal_id)
            except (AgentRuntimeUnavailableError, AgentRegistryError):
                continue  # not a proposal (or the registry is busy): nothing to track
            tracked.append(
                await self.builder.adopt(actor, credentials, detail.proposal, source="chat")
            )
        return tuple(tracked)


def _next_run(run_key: str) -> int:
    """The suffix of ``<thread id>.<n>`` plus one."""
    return int(run_key.rsplit(".", 1)[1]) + 1
