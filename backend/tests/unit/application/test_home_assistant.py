"""Inicio with the assistant (slice 21, IaHomeTurno): a hand-over that went to her is a row
("assigned_by_assistant"; it used to break the feed), and the summary counts what the assistant
resolved in her languages, what it handed to her and what it holds now. AI off: no summary."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.cases.analyst_home import HomeActivityKind
from cc_platform.bootstrap.container import Container
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import (
    NATALIA,
    XIMENA,
    assistant_world,
    escalation,
    resolution,
    say,
    settle,
    turn,
)
from tests.support import ADMIN_ONLY, ANALYST, actor_for, customer_actor, make_available_quietly

DANIELA = seed_staff_id(ANALYST.number)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(
    request: pytest.FixtureRequest, tmp_path: Path, runtime: InMemoryAgentRuntime
) -> AsyncIterator[Container]:
    async for container in assistant_world(str(request.param), tmp_path, runtime):
        yield container


async def write(world: Container, customer: int) -> None:
    await world.use_cases.cases.post_customer_turn.execute(customer_actor(customer), say())
    await settle(world)


async def test_the_assistant_in_her_home(world: Container, runtime: InMemoryAgentRuntime) -> None:
    await make_available_quietly(world.uow, DANIELA)
    home = await world.use_cases.cases.analyst_home.execute(actor_for(ANALYST))
    assert home.assistant is not None
    before = home.assistant

    runtime.script.append(escalation())  # Natalia: handed over to Daniela
    await write(world, NATALIA)
    runtime.script.append(resolution())  # Ximena: resolved by the assistant
    await write(world, XIMENA)

    home = await world.use_cases.cases.analyst_home.execute(actor_for(ANALYST))
    assert home.assistant is not None
    assert home.assistant.handed_to_you == before.handed_to_you + 1
    assert home.assistant.resolved == before.resolved + 1
    rows = [i for i in home.activity.items if i.kind is HomeActivityKind.ASSIGNED_BY_ASSISTANT]
    assert len(rows) == 1
    assert rows[0].customer_name.startswith("Natalia")


async def test_it_counts_what_the_assistant_holds_now(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    home = await world.use_cases.cases.analyst_home.execute(actor_for(ANALYST))
    assert home.assistant is not None
    holding = home.assistant.with_assistant_now
    runtime.script.append(turn("¿Me confirmas la fecha del cargo?"))  # still with the assistant
    await write(world, NATALIA)
    home = await world.use_cases.cases.analyst_home.execute(actor_for(ANALYST))
    assert home.assistant is not None
    assert home.assistant.with_assistant_now == holding + 1


async def test_no_summary_with_ai_off(world: Container) -> None:
    await world.use_cases.platform.set_ai_enabled.execute(actor_for(ADMIN_ONLY), False)
    home = await world.use_cases.cases.analyst_home.execute(actor_for(ANALYST))
    assert home.assistant is None
