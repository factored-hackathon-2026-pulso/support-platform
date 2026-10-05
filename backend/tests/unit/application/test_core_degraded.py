"""Degraded mode (deploy brief P4): what the platform does while the Core is down, over the real
composition with a scripted agent-core behind the resilience layer (no network).

- a new chat goes straight to people;
- an ongoing assistant conversation tells the customer it cannot answer now and hands over;
- a turn past its timeout does the same;
- the copilot fails fast and its automatic suggestions are not even attempted;
- the container reports the Core as ``degraded`` for ``/readyz``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Literal

import pytest

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.application.ai.errors import AgentCoreUnavailableError
from cc_platform.application.ai.runtime import AgentTurn
from cc_platform.application.ai.suggestions import MIN_GAP
from cc_platform.application.cases import copy
from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.session import AssistantState
from cc_platform.domain.ai.suggestion import ReplySuggestion
from cc_platform.domain.cases import CaseStatus, TurnAudience, TurnAuthorRole, TurnKind
from cc_platform.domain.people.staff import Language
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.core.resilience import (
    BreakerState,
    CircuitBreaker,
    CoreGuard,
    CoreTimeouts,
    RetryPolicy,
)
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import (
    NATALIA,
    RAFAEL,
    XIMENA,
    assistant_world,
    escalation,
    say,
    settle,
    turn,
)
from tests.support import ANALYST, actor_for, customer_actor, make_available_quietly

DANIELA = seed_staff_id(ANALYST.number)
SUGGESTIONS_AGENT = "copiloto-sugerencias@prod"


@dataclass
class HangingRuntime(InMemoryAgentRuntime):
    """A scripted agent-core whose turns can hang (a model that never answers)."""

    hang: bool = False
    hung: int = 0

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
        if self.hang:
            self.hung += 1
            await asyncio.sleep(30)
        return await super().post_turn(
            credentials,
            session_id=session_id,
            client_turn_id=client_turn_id,
            channel=channel,
            text=text,
            confirm_token=confirm_token,
            confirm_answer=confirm_answer,
            lang=lang,
        )


async def _no_wait(_seconds: float) -> None:
    return None


def make_guard(*, threshold: int = 3) -> CoreGuard:
    return CoreGuard(
        timeouts=CoreTimeouts(assistant=0.05, copilot=0.05, suggestions=0.05),
        retry=RetryPolicy(attempts=1, base_delay=0, max_delay=0),
        breaker=CircuitBreaker(failure_threshold=threshold, reset_seconds=30),
        sleep=_no_wait,
    )


def open_breaker(guard: CoreGuard) -> None:
    while guard.breaker.state is not BreakerState.OPEN:
        guard.breaker.record_failure()


@pytest.fixture
def runtime() -> HangingRuntime:
    return HangingRuntime()


@pytest.fixture
def guard() -> CoreGuard:
    return make_guard()


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(
    request: pytest.FixtureRequest, tmp_path: Path, runtime: HangingRuntime, guard: CoreGuard
) -> AsyncIterator[Container]:
    async for container in assistant_world(
        str(request.param),
        tmp_path,
        runtime,
        guard=guard,
        copilot_suggestions_agent=SUGGESTIONS_AGENT,
        copilot_suggestions_auto=True,
        copilot_suggestions_coalesce_seconds=0,
        stage_gates_suggestions=False,
    ):
        yield container


async def write(world: Container, number: int, text: str = "No reconozco un cargo") -> str:
    result = await world.use_cases.cases.post_customer_turn.execute(
        customer_actor(number), say(text)
    )
    return result.conversation.case_id


async def snapshot(world: Container, case_id: str):  # type: ignore[no-untyped-def]
    async with world.uow() as uow:
        case = await uow.cases.get(case_id)
        session = await uow.assistant_sessions.get_by_case(case_id)
        turns = await uow.turns.page(case_id, limit=50)
    assert case is not None
    return case, session, turns


def customer_notices(turns) -> list[str]:  # type: ignore[no-untyped-def]
    return [
        t.text for t in turns if t.kind is TurnKind.NOTICE and t.audience is TurnAudience.EVERYONE
    ]


def staff_banners(turns) -> list[str]:  # type: ignore[no-untyped-def]
    return [t.text for t in turns if t.audience is TurnAudience.STAFF]


# ----------------------------------------------------------------------------- the assistant
async def test_a_new_chat_goes_straight_to_people_while_the_core_is_down(
    world: Container, runtime: HangingRuntime, guard: CoreGuard
) -> None:
    open_breaker(guard)

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, turns = await snapshot(world, case_id)

    assert session is None  # never opened with the assistant
    assert case.status is CaseStatus.QUEUED
    assert runtime.calls == []  # not a single call to the Core
    assert not [t for t in turns if t.author_role is TurnAuthorRole.ASSISTANT]


async def test_an_ongoing_conversation_tells_the_customer_and_hands_over(
    world: Container, runtime: HangingRuntime
) -> None:
    runtime.script.append(turn("Hola Natalia, cuéntame qué pasó."))
    case_id = await write(world, NATALIA)
    await settle(world)
    runtime.unavailable = True  # the Core goes down mid-conversation

    await write(world, NATALIA, "Fue un cargo de 200 dólares")
    await settle(world)
    case, session, turns = await snapshot(world, case_id)

    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert session.state is AssistantState.FAILED
    assert session.failure_code == "unavailable"
    assert customer_notices(turns)[-1] == copy.NOTICE_ASSISTANT_UNAVAILABLE[Language.SPANISH]
    # the existing staff banner of a failed hand-over, with its code
    assert any("no pudo seguir atendiendo (unavailable)" in text for text in staff_banners(turns))


async def test_a_portuguese_customer_is_told_in_portuguese(
    world: Container, runtime: HangingRuntime
) -> None:
    runtime.unavailable = True

    case_id = await write(world, RAFAEL, "Não reconheço uma cobrança")
    await settle(world)
    _case, _session, turns = await snapshot(world, case_id)

    assert customer_notices(turns)[-1] == copy.NOTICE_ASSISTANT_UNAVAILABLE[Language.PORTUGUESE]


async def test_a_turn_past_its_timeout_hands_over_the_same_way(
    world: Container, runtime: HangingRuntime
) -> None:
    runtime.script.append(turn("Hola Natalia, cuéntame qué pasó."))
    case_id = await write(world, NATALIA)
    await settle(world)
    runtime.hang = True

    await write(world, NATALIA, "¿Sigues ahí?")
    await settle(world)
    case, session, turns = await snapshot(world, case_id)

    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert session.failure_code == "unavailable"
    assert customer_notices(turns)[-1] == copy.NOTICE_ASSISTANT_UNAVAILABLE[Language.SPANISH]
    assert runtime.hung == 1  # a timeout is not retried


async def test_once_the_breaker_opens_the_next_chats_go_to_people_without_trying(
    tmp_path: Path, runtime: HangingRuntime
) -> None:
    guard = make_guard(threshold=2)  # one failed turn with its retry opens it
    async for world in assistant_world("memory", tmp_path, runtime, guard=guard):
        runtime.unavailable = True
        await write(world, NATALIA)
        await settle(world)
        tried = len(runtime.calls)
        assert guard.breaker.state is BreakerState.OPEN

        case_id = await write(world, XIMENA)
        await settle(world)
        case, session, _turns = await snapshot(world, case_id)

        assert session is None
        assert case.status is CaseStatus.QUEUED
        assert len(runtime.calls) == tried


async def test_a_retry_recovers_a_blip_without_the_customer_noticing(
    world: Container, runtime: HangingRuntime
) -> None:
    from cc_platform.application.ai.runtime import AgentRuntimeUnavailableError

    runtime.script.extend(
        [AgentRuntimeUnavailableError("blip"), turn("Hola Natalia, cuéntame qué pasó.")]
    )

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, turns = await snapshot(world, case_id)

    assert case.status is CaseStatus.WITH_ASSISTANT
    assert session is not None
    assert session.state is AssistantState.ACTIVE
    assert [t.text for t in turns if t.author_role is TurnAuthorRole.ASSISTANT] == [
        "Hola Natalia, cuéntame qué pasó."
    ]
    # the same client turn id twice: agent-core answers a repeat from its own record
    keys = [c.arguments["client_turn_id"] for c in runtime.calls if c.operation == "post_turn"]
    assert len(keys) == 2
    assert keys[0] == keys[1]


# ----------------------------------------------------------------------------- the copilot
async def case_with_daniela(world: Container, runtime: HangingRuntime) -> str:
    """A case the assistant escalated to Daniela; the calls so far are forgotten."""
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    case_id = await write(world, NATALIA)
    await settle(world)
    runtime.calls.clear()
    return case_id


async def test_the_copilot_fails_fast_while_the_core_is_down(
    world: Container, runtime: HangingRuntime, guard: CoreGuard
) -> None:
    case_id = await case_with_daniela(world, runtime)
    open_breaker(guard)
    assert world.use_cases.assistant is not None

    with pytest.raises(AgentCoreUnavailableError):
        await world.use_cases.assistant.ask_copilot.execute(
            actor_for(ANALYST), case_id, text="¿Cuánto debe?", client_message_id="q-1"
        )
    assert runtime.calls == []


async def test_automatic_suggestions_are_not_attempted_while_the_core_is_down(
    world: Container, runtime: HangingRuntime, guard: CoreGuard
) -> None:
    runtime.suggestion_script.append((ReplySuggestion(text="Ya radiqué la disputa."),))
    case_id = await case_with_daniela(world, runtime)  # the hand-over made one suggestion
    assert world.use_cases.assistant is not None
    suggestions = world.use_cases.assistant.suggestions
    assert suggestions is not None
    before = await suggestions.latest.execute(actor_for(ANALYST), case_id)
    assert before.latest is not None
    clock = world.clock
    assert isinstance(clock, FixedClock)
    clock.advance(MIN_GAP + timedelta(seconds=1))
    open_breaker(guard)

    await write(world, NATALIA, "Quiero hablar con supervisión, esto es un robo")
    await settle(world)

    assert runtime.calls == []  # no run, so no failed suggestion in the panel either
    after = await suggestions.latest.execute(actor_for(ANALYST), case_id)
    assert after.latest is not None
    assert after.latest.suggestion.id == before.latest.suggestion.id


# ----------------------------------------------------------------------------- readiness
async def test_the_core_status_follows_the_breaker(world: Container, guard: CoreGuard) -> None:
    assert await world.core_status() == "ok"
    assert await world.api_context().core_status() == "ok"

    open_breaker(guard)

    assert await world.core_status() == "degraded"
    assert await world.api_context().core_status() == "degraded"
