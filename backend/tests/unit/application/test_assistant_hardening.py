"""S17 hardening of the assistant: recovering work lost with its process, and the grant check
agent-core
asks the platform (ADR 0003), over the real composition and both persistence adapters."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import pytest

from cc_platform.application.ai.sweep import SweepAssistantSessions
from cc_platform.application.cases.dto import CloseCaseCommand
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import CaseStatus, CloseReason
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import NATALIA, assistant_world, escalation, say, settle, turn
from tests.support import ANALYST, JULIAN, actor_for, customer_actor, make_available_quietly

DANIELA = seed_staff_id(ANALYST.number)
JULIAN_ID = seed_staff_id(JULIAN.number)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(
    request: pytest.FixtureRequest, tmp_path: Path, runtime: InMemoryAgentRuntime
) -> AsyncIterator[Container]:
    async for container in assistant_world(str(request.param), tmp_path, runtime):
        yield container


def sweep_of(world: Container) -> SweepAssistantSessions:
    assert world.assistant_engine is not None
    return SweepAssistantSessions(
        uow=world.uow, clock=world.clock, tasks=world.background, engine=world.assistant_engine
    )


async def open_case(world: Container) -> str:
    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    await settle(world)
    return result.conversation.case_id


# ----------------------------------------------------------------------------- the sweep
async def test_the_sweep_resends_work_a_dead_process_left_behind(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([turn("r1"), turn("r2")])
    case_id = await open_case(world)
    async with world.uow() as uow:  # as if the job died before applying its answer
        session = await uow.assistant_sessions.get_by_case(case_id)
        assert session is not None
        session.processed_sequence = 0
        await uow.assistant_sessions.save(session)
        await uow.commit()
    sweep = sweep_of(world)

    assert await sweep.execute() == 0  # too recent: a live job may still be on it
    world.clock.advance(timedelta(seconds=30))  # type: ignore[attr-defined]
    assert await sweep.execute() == 1
    await settle(world)

    sent = [c.arguments["text"] for c in runtime.calls if c.operation == "post_turn"]
    assert len(sent) == 2  # the message went again; agent-core de-duplicates by client_turn_id


async def test_the_sweep_takes_over_a_dead_claim(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([turn("r1"), turn("r2")])
    case_id = await open_case(world)
    async with world.uow() as uow:
        session = await uow.assistant_sessions.get_by_case(case_id)
        assert session is not None
        session.processed_sequence = 0
        # a claim nobody will ever finish (its process died mid-call)
        from cc_platform.domain.ai.session import AgentInput

        session.claim = AgentInput(kind="text", turn_id="TRN-LOST", sequence=1)
        session.claimed_at = world.clock.now()
        await uow.assistant_sessions.save(session)
        await uow.commit()
    world.clock.advance(timedelta(minutes=3))  # type: ignore[attr-defined]

    assert await sweep_of(world).execute() == 1
    await settle(world)

    assert len([c for c in runtime.calls if c.operation == "post_turn"]) == 2
    async with world.uow() as uow:
        session = await uow.assistant_sessions.get_by_case(case_id)
    assert session is not None
    assert session.claim is None


async def test_the_sweep_ignores_sessions_that_ended(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    await open_case(world)  # escalated: its session is no longer active
    world.clock.advance(timedelta(minutes=5))  # type: ignore[attr-defined]

    assert await sweep_of(world).execute() == 0


# ----------------------------------------------------------------------------- grant_active
async def test_a_grant_lives_while_she_holds_the_case_and_dies_when_it_moves(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    case_id = await open_case(world)
    assert world.use_cases.assistant is not None
    grants = world.use_cases.assistant.grant_status

    assert await grants.execute(f"{case_id}:{DANIELA}") is True
    assert await grants.execute(f"{case_id}:{JULIAN_ID}") is False  # not hers
    assert await grants.execute(f"{case_id}") is False
    assert await grants.execute("nonsense:value") is False
    assert await grants.execute(f"CASE-{'0' * 26}:{DANIELA}") is False  # unknown case

    await world.use_cases.cases.close.execute(
        actor_for(ANALYST), case_id, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )
    assert await grants.execute(f"{case_id}:{DANIELA}") is True  # the label is sent after the close


async def test_a_grant_dies_when_the_case_is_reassigned_away(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
    from tests.support import SUPERVISOR

    await make_available_quietly(world.uow, DANIELA, JULIAN_ID)
    runtime.script.append(escalation())
    case_id = await open_case(world)
    async with world.uow() as uow:
        case = await uow.cases.get(case_id)
    assert case is not None
    assert case.status is CaseStatus.ASSIGNED
    holder = case.assigned_analyst_id
    other = JULIAN_ID if holder == DANIELA else DANIELA
    assert world.use_cases.assistant is not None
    grants = world.use_cases.assistant.grant_status
    assert await grants.execute(f"{case_id}:{holder}") is True

    await world.use_cases.cases.set_assignee.execute(
        actor_for(SUPERVISOR),
        case_id,
        SetAssigneeCommand(analyst_id=other, expected_analyst_id=holder, confirm_paused=False),
    )

    assert await grants.execute(f"{case_id}:{holder}") is False
    assert await grants.execute(f"{case_id}:{other}") is True
