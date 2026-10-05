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
thread. The proposals the agent made are created with agent-core's service identity: any proposal
id in an answer that the registry confirms is **tracked** (joins the platform's index), and the
proposals list reads agent-core's own list, so the others show there too (``source="registry"``).

The builder speaks the person's UI language (``es`` or ``pt-BR`` → agent-core's ``es`` / ``pt``).
A run of ``constructor-chat`` opens by asking (its flow ``construir`` collects the agent, then the
goal): that opening question is kept in the thread, so the person sees what her next message
answers. "Nueva conversación" starts the run right away, so the thread opens with the question.
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
from cc_platform.application.people.preferences import ui_language_of
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.builder import BuilderMessage, BuilderThread
from cc_platform.domain.people.preferences import UiLanguage
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

#: agent-core's run is over: start another one (and the same codes as the copilot).
_RUN_OVER = frozenset({"run_closed", "not_found"})
_CHANNEL = "web"
#: agent-core's language for each UI language (``constructor-chat`` supports ``es`` and ``pt``).
_AGENT_LANGUAGE: dict[UiLanguage, str] = {
    UiLanguage.SPANISH: "es",
    UiLanguage.PORTUGUESE_BRAZIL: "pt",
}
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
    awaiting: str | None = None
    """What the builder waits for after its last word (agent-core's ``awaiting``: ``slot`` when
    it asked for a datum); None when the platform does not know (a plain read)."""


@dataclass(frozen=True, slots=True)
class BuilderExchangeView:
    message: BuilderMessageView
    answers: tuple[BuilderMessageView, ...]
    proposals: tuple[ProposalSummary, ...]
    """Proposals this answer mentions that the registry confirmed (and the list now has)."""
    replayed: bool
    awaiting: str | None = None
    """What the builder waits for now (``slot``: it asked for a datum, the next message answers
    it; ``none``: it finished or handed over); None on a replay."""


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
class RestartBuilderThread:
    """``POST /builder/chat/restart`` ("Nueva conversación", slice 22): the person's thread starts
    over and a new run of the builder agent starts at once, in her language; its opening (the
    question its flow asks first) opens the thread. If agent-core does not answer, the thread is
    empty and her next message starts the run."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer
    agent: str

    async def execute(self, actor: Actor) -> BuilderThreadView:
        ensure_any_role(actor, BUILDER_ROLES)
        thread_id, run_key, language = await retry_on_conflict(partial(self._reset, actor))
        try:
            run = await self.runtime.start_run(
                self.issuer.builder_run(identity_of(actor)),
                agent=self.agent,
                idempotency_key=run_key,
                lang=language,
            )
        except (AgentRuntimeError, AgentRuntimeUnavailableError):
            return BuilderThreadView(messages=())
        if run.session_id is None or run.first_turn is None:
            return BuilderThreadView(messages=())
        opening = run.first_turn
        session_id = run.session_id
        messages = await retry_on_conflict(
            partial(self._open, actor, thread_id, run_key, session_id, opening)
        )
        return BuilderThreadView(
            messages=tuple(_view(m) for m in messages), awaiting=opening.awaiting.value
        )

    async def _reset(self, actor: Actor) -> tuple[str, str, str]:
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
                await uow.commit()
            elif thread.restart(at=now):
                await uow.builder_threads.save(thread)
                await uow.commit()
            language = await ui_language_of(uow, actor.staff_id)
            return thread.id, thread.run_key, _AGENT_LANGUAGE[language]

    async def _open(
        self, actor: Actor, thread_id: str, run_key: str, session_id: str, opening: AgentTurn
    ) -> tuple[BuilderMessage, ...]:
        async with self.uow() as uow:
            thread = await uow.builder_threads.get_for(actor.staff_id)
            # another request moved the thread meanwhile (a message started its own run)
            if (
                thread is None
                or thread.id != thread_id
                or thread.run_key != run_key
                or thread.agent_session_id is not None
            ):
                return ()
            now = self.clock.now()
            thread.link_run(agent_session_id=session_id, run_id=opening.run_id, at=now)
            written = thread.record_opening(
                texts=[m.text for m in opening.messages],
                message_ids=[self.ids.new_id(IdPrefix.BUILDER_MESSAGE) for _ in opening.messages],
                trace_id=opening.trace_id,
                at=now,
            )
            await uow.builder_threads.save(thread)
            await uow.commit()
            return written


@dataclass(frozen=True, slots=True)
class _Stored:
    thread_id: str
    message: BuilderMessage
    answered: tuple[BuilderMessage, ...]
    agent_session_id: str | None
    run_key: str
    language: str
    """agent-core's language for her (``es`` or ``pt``), from her UI language."""


@dataclass(frozen=True, slots=True)
class _Reply:
    turn: AgentTurn
    session_id: str
    started: bool
    """A run started for this message (the previous one was over, or there was none)."""
    opening: tuple[str, ...] = ()
    """What the new run said before her message (its first question)."""


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
        # the runtime verifies principals against the identity keys, the registry against the
        # staff keys: the chat's run credential and the registry's are signed differently
        run_credentials = self.issuer.builder_run(identity_of(actor))
        registry_credentials = self.issuer.builder(identity_of(actor))
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
        reply = await self._ask_agent(run_credentials, stored)
        answers = await retry_on_conflict(partial(self._store_answer, actor, stored, reply))
        tracked = await self._track_proposals(
            actor, registry_credentials, [m.text for m in answers]
        )
        return BuilderExchangeView(
            message=_view(stored.message),
            answers=tuple(_view(m) for m in answers),
            proposals=tracked,
            replayed=False,
            awaiting=reply.turn.awaiting.value,
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
            language = await ui_language_of(uow, actor.staff_id)
            return _Stored(
                thread_id=thread.id,
                message=message,
                answered=thread.answers_to(message.id),
                agent_session_id=thread.agent_session_id,
                run_key=thread.run_key,
                language=_AGENT_LANGUAGE[language],
            )

    # ------------------------------------------------------------------ 2. the call (no UoW)
    async def _ask_agent(self, credentials: AgentCredentials, stored: _Stored) -> _Reply:
        try:
            return await self._call(credentials, stored, stored.agent_session_id, stored.run_key)
        except AgentRuntimeError as error:
            if error.code in _RUN_OVER and stored.agent_session_id is not None:
                next_key = f"{stored.thread_id}.{_next_run(stored.run_key)}"
                try:
                    return await self._call(credentials, stored, None, next_key)
                except AgentRuntimeError as retry:
                    raise self._translate(retry) from None
                except AgentRuntimeUnavailableError:
                    raise AgentCoreUnavailableError() from None
            raise self._translate(error) from None
        except AgentRuntimeUnavailableError:
            raise AgentCoreUnavailableError() from None

    async def _call(
        self,
        credentials: AgentCredentials,
        stored: _Stored,
        session_id: str | None,
        run_key: str,
    ) -> _Reply:
        opening: tuple[str, ...] = ()
        started = False
        if session_id is None:
            run = await self.runtime.start_run(
                credentials, agent=self.agent, idempotency_key=run_key, lang=stored.language
            )
            if run.session_id is None:
                raise AgentRuntimeError(status=502, code="no_agent_session")
            session_id, started = run.session_id, True
            if run.first_turn is not None:
                opening = tuple(m.text for m in run.first_turn.messages)
        turn = await self.runtime.post_turn(
            credentials,
            session_id=session_id,
            client_turn_id=stored.message.id,
            channel=_CHANNEL,
            text=stored.message.text,
            lang=stored.language,
        )
        return _Reply(turn=turn, session_id=session_id, started=started, opening=opening)

    @staticmethod
    def _translate(error: AgentRuntimeError) -> Exception:
        if error.code == "turn_in_progress":
            return BuilderBusyError()
        return AgentCoreRejectedError(agent_core_code=error.code, agent_core_status=error.status)

    # ------------------------------------------------------------------ 3. the answer
    async def _store_answer(
        self, actor: Actor, stored: _Stored, reply: _Reply
    ) -> tuple[BuilderMessage, ...]:
        turn = reply.turn
        async with self.uow() as uow:
            thread = await uow.builder_threads.get_for(actor.staff_id)
            if thread is None:  # stored with the message a moment ago
                raise NotFoundError("No encontramos la conversación con el constructor.")
            now = self.clock.now()
            if reply.started:
                if stored.agent_session_id is not None:
                    thread.new_run(at=now)
                thread.link_run(agent_session_id=reply.session_id, run_id=turn.run_id, at=now)
            # a run started for this message asked its opening question first: her message
            # answered it, so the thread shows both, in order
            texts = [*reply.opening, *(m.text for m in turn.messages)]
            answers = thread.record_answer(
                question_id=stored.message.id,
                texts=texts,
                message_ids=[self.ids.new_id(IdPrefix.BUILDER_MESSAGE) for _ in texts],
                trace_id=turn.trace_id,
                status=turn.status,
                at=now,
            )
            if turn.status != "open":  # closed or escalated: the next message starts another
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
