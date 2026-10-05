"""The analyst's copilot (ADR 0003, slice 15): ask about a case, read the thread.

The copilot is an agent-core agent that reads and calculates; it suggests what to look up and never
acts. The analyst talks to it as herself: an ``advisor`` credential with a short delegation on this
one customer, so agent-core decides what she may see. Only the case's assignee asks (anyone else is
``case_not_assigned``), only while the case is open and the customer is linked to the dataset.

A question is a short call, not a long transaction:

1. one Unit of Work stores the question (idempotent on ``clientMessageId``);
2. agent-core answers with no transaction open (it takes as long as the model);
3. another stores the answer.

If step 2 fails the question stays in the thread, and asking again with the same
``clientMessageId`` repeats the call (agent-core de-duplicates it by ``client_turn_id``).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import partial

from cc_platform.application.ai.credentials import AgentCredentialIssuer, AgentCredentials
from cc_platform.application.ai.errors import AgentCoreRejectedError, AgentCoreUnavailableError
from cc_platform.application.ai.runtime import (
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    AgentTurn,
)
from cc_platform.application.ai.staff import advisor_credentials
from cc_platform.application.cases.queries import load_case_for
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.copilot import CopilotMessage, CopilotThread
from cc_platform.domain.ai.errors import CopilotBusyError, CopilotUnavailableError
from cc_platform.domain.cases.errors import CaseClosedError
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

#: agent-core's problem codes that mean "this run is over: start another one".
_RUN_OVER = frozenset({"run_closed", "not_found"})
_CHANNEL = "workspace"


@dataclass(frozen=True, slots=True)
class CopilotMessageView:
    id: str
    role: str
    text: str
    created_at: datetime
    answers: str | None


@dataclass(frozen=True, slots=True)
class CopilotThreadView:
    case_id: str
    available: bool
    """False while agent-core is not configured or the customer is not linked: hide the panel."""
    messages: tuple[CopilotMessageView, ...]


@dataclass(frozen=True, slots=True)
class CopilotExchangeView:
    question: CopilotMessageView
    answers: tuple[CopilotMessageView, ...]
    replayed: bool


def _view(message: CopilotMessage) -> CopilotMessageView:
    return CopilotMessageView(
        id=message.id,
        role=message.role,
        text=message.text,
        created_at=message.created_at,
        answers=message.answers,
    )


@dataclass(frozen=True, slots=True)
class GetCopilotThread:
    """``GET /cases/{caseId}/copilot``: the analyst's thread (empty before her first question)."""

    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, case_id: str) -> CopilotThreadView:
        ensure_any_role(actor, {StaffRole.ANALYST})
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)  # only her assignee
            thread = await uow.copilot_threads.get_for(case.id, actor.staff_id)
            linked = await uow.bank_links.get(case.customer_id) is not None
        return CopilotThreadView(
            case_id=case_id,
            available=linked,
            messages=tuple(_view(m) for m in thread.messages) if thread else (),
        )


#: The run input that names the assistant's agent-core session (agent-core ``engine_tools``).
SESSION_INPUT = "assistant_session_id"


@dataclass(frozen=True, slots=True)
class _Question:
    thread_id: str
    question: CopilotMessage
    is_new: bool
    answered: tuple[CopilotMessage, ...]
    bank_customer_id: str
    language: str
    agent_session_id: str | None
    run_key: str
    case_id: str
    credentials: AgentCredentials
    assistant_session_id: str | None
    """agent-core's session of the assistant that held this case, if any: the copilot run gets it
    as its input so agent-core's ``obtener_handoff``/``leer_transcript`` read that conversation
    (agent-core checks it is the same customer as the delegation)."""


@dataclass(frozen=True, slots=True)
class AskCopilot:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer
    agent: str
    """The copilot agent (``id@alias``), e.g. ``copiloto-asesor@prod``."""

    async def execute(
        self, actor: Actor, case_id: str, *, text: str, client_message_id: str
    ) -> CopilotExchangeView:
        ensure_any_role(actor, {StaffRole.ANALYST})
        stored = await retry_on_conflict(
            partial(self._store_question, actor, case_id, text, client_message_id)
        )
        if stored.answered:  # a retry of a question that already has its answer
            return CopilotExchangeView(
                question=_view(stored.question),
                answers=tuple(_view(m) for m in stored.answered),
                replayed=True,
            )
        turn, session_id, run_started = await self._ask_agent(stored.credentials, stored)
        answers = await retry_on_conflict(
            partial(self._store_answer, actor, stored, turn, session_id, run_started)
        )
        return CopilotExchangeView(
            question=_view(stored.question),
            answers=tuple(_view(m) for m in answers),
            replayed=False,  # the agent answered now, even if the question is a retry
        )

    # ------------------------------------------------------------------ 1. the question
    async def _store_question(
        self, actor: Actor, case_id: str, text: str, client_message_id: str
    ) -> _Question:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            bank_id = await uow.bank_links.get(case.customer_id)
            if bank_id is None:
                raise CopilotUnavailableError()
            now = self.clock.now()
            thread = await uow.copilot_threads.get_for(case.id, actor.staff_id)
            if thread is None:
                thread = CopilotThread.start(
                    thread_id=self.ids.new_id(IdPrefix.COPILOT_THREAD),
                    case_id=case.id,
                    analyst_id=actor.staff_id,
                    agent=self.agent,
                    at=now,
                )
                await uow.copilot_threads.add(thread)
            question, is_new = thread.ask(
                message_id=self.ids.new_id(IdPrefix.COPILOT_MESSAGE),
                text=text,
                client_message_id=client_message_id,
                at=now,
            )
            answered = thread.answers_to(question.id)
            if not answered and case.is_closed:  # a closed case is read-only for everyone
                raise CaseClosedError()
            if is_new:
                await uow.copilot_threads.save(thread)
                await uow.commit()
            assistant = await uow.assistant_sessions.get_by_case(case.id)
            return _Question(
                thread_id=thread.id,
                question=question,
                is_new=is_new,
                answered=answered,
                bank_customer_id=bank_id,
                language=case.language.value,
                agent_session_id=thread.agent_session_id,
                run_key=thread.run_key,
                case_id=case.id,
                credentials=await advisor_credentials(
                    uow, self.issuer, self.clock, case, actor.staff_id
                ),
                assistant_session_id=assistant.agent_session_id if assistant else None,
            )

    # ------------------------------------------------------------------ 2. the call (no UoW)
    async def _ask_agent(
        self, creds: AgentCredentials, stored: _Question
    ) -> tuple[AgentTurn, str, bool]:
        """Returns ``(turn, agent session id, started a run now)``."""
        try:
            return await self._call(creds, stored, stored.agent_session_id, stored.run_key)
        except AgentRuntimeError as error:
            if error.code in _RUN_OVER and stored.agent_session_id is not None:
                # agent-core closed that run: start another (a new idempotency key) and ask again
                next_key = f"{stored.thread_id}.{_next_run(stored.run_key)}"
                try:
                    turn, session_id, _ = await self._call(creds, stored, None, next_key)
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
        stored: _Question,
        session_id: str | None,
        run_key: str,
    ) -> tuple[AgentTurn, str, bool]:
        started = False
        if session_id is None:
            run = await self.runtime.start_run(
                credentials,
                agent=self.agent,
                idempotency_key=run_key,
                lang=stored.language,
                input=(
                    {SESSION_INPUT: stored.assistant_session_id}
                    if stored.assistant_session_id is not None
                    else None
                ),
            )
            if run.session_id is None:
                raise AgentRuntimeError(status=502, code="no_agent_session")
            session_id, started = run.session_id, True
        turn = await self.runtime.post_turn(
            credentials,
            session_id=session_id,
            client_turn_id=stored.question.id,
            channel=_CHANNEL,
            text=stored.question.text,
            lang=stored.language,
        )
        return turn, session_id, started

    @staticmethod
    def _translate(error: AgentRuntimeError) -> Exception:
        if error.code == "turn_in_progress":
            return CopilotBusyError()
        return AgentCoreRejectedError(agent_core_code=error.code, agent_core_status=error.status)

    # ------------------------------------------------------------------ 3. the answer
    async def _store_answer(
        self,
        actor: Actor,
        stored: _Question,
        turn: AgentTurn,
        session_id: str,
        run_started: bool,
    ) -> tuple[CopilotMessage, ...]:
        async with self.uow() as uow:
            thread = await uow.copilot_threads.get_for(stored.case_id, actor.staff_id)
            if thread is None:  # stored with the question a moment ago
                raise NotFoundError("No encontramos la conversación con el copiloto.")
            now = self.clock.now()
            if run_started:
                if stored.agent_session_id is not None:
                    thread.new_run(at=now)
                thread.link_run(agent_session_id=session_id, run_id=turn.run_id, at=now)
            answers = thread.record_answer(
                question_id=stored.question.id,
                texts=[m.text for m in turn.messages],
                message_ids=[self.ids.new_id(IdPrefix.COPILOT_MESSAGE) for _ in turn.messages],
                trace_id=turn.trace_id,
                status=turn.status,
                at=now,
            )
            if turn.status == "closed":  # the run is over: the next question starts another
                thread.new_run(at=now)
            await uow.copilot_threads.save(thread)
            await uow.commit()
            return answers


def _next_run(run_key: str) -> int:
    """The suffix of ``<thread id>.<n>`` plus one."""
    return int(run_key.rsplit(".", 1)[1]) + 1
