"""The chat with the builder agent (ADR 0003 §7, slice 16): a thread per person, messages stored
before the call, answers as her, retries that never ask twice, and the proposals the agent made
joining the list. Both persistence adapters, scripted agent-core (no network)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.ai import AgentRuntimeError, AgentRuntimeUnavailableError
from cc_platform.application.ai.errors import (
    AgentCoreRejectedError,
    AgentCoreUnavailableError,
    BuilderBusyError,
)
from cc_platform.application.ai.use_cases import BuilderUseCases
from cc_platform.application.errors import ForbiddenError
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import decode, turn
from tests.builder_support import AGENT, BuilderWorld, builder_events, builder_world
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, actor_for

LUCIA = seed_staff_id(SUPERVISOR.number)
NOT_A_PROPOSAL = "11111111-1111-4111-8111-111111111111"  # looks like an id, the registry has none


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[BuilderWorld]:
    async for built in builder_world(str(request.param), tmp_path):
        yield built


def use_cases(world: BuilderWorld) -> BuilderUseCases:
    assert world.container.use_cases.assistant is not None
    assert world.container.use_cases.assistant.builder is not None
    return world.container.use_cases.assistant.builder


async def say(
    world: BuilderWorld, text: str = "Acorta el resumen de disputas", key: str | None = None
):  # type: ignore[no-untyped-def]
    return await use_cases(world).ask.execute(
        actor_for(SUPERVISOR), text=text, client_message_id=key or str(uuid.uuid4())
    )


def calls(world: BuilderWorld, operation: str) -> list[dict[str, object]]:
    return [c.arguments for c in world.runtime.calls if c.operation == operation]


async def test_the_builder_answers_as_the_supervisor_and_only_proposes(world: BuilderWorld) -> None:
    world.runtime.script.append(
        turn("Voy a leer la versión vigente de disputas.", agent="constructor-chat@1.0.0")
    )

    exchange = await say(world)

    assert exchange.message.role == "person"
    assert exchange.replayed is False
    assert [a.text for a in exchange.answers] == ["Voy a leer la versión vigente de disputas."]
    assert exchange.answers[0].answers == exchange.message.id
    start = world.runtime.calls[0]
    assert start.operation == "start_run"
    assert start.arguments["agent"] == "constructor-chat@prod"
    assert start.credentials is not None
    assert start.credentials.on_behalf_of is None  # no delegation: nothing about a customer
    principal = decode(start.credentials.authorization)
    assert (principal["type"], principal["id"]) == ("builder", LUCIA)
    assert sorted(principal["roles"]) == ["aprobador", "constructor"]
    assert principal["attrs"] == {"actor": "human"}
    assert principal["auth"]["level"] == "session"  # the chat never carries step-up
    sent = calls(world, "post_turn")[0]
    assert sent["client_turn_id"] == exchange.message.id
    assert sent["channel"] == "web"
    assert start.arguments["lang"] == "es"

    thread = await use_cases(world).thread.execute(actor_for(SUPERVISOR))
    assert [m.role for m in thread.messages] == ["person", "agent"]


async def test_each_person_has_her_own_thread(world: BuilderWorld) -> None:
    world.runtime.script.extend([turn("uno"), turn("dos")])

    await say(world)
    await use_cases(world).ask.execute(
        actor_for(ADMIN_ONLY), text="Hola", client_message_id=str(uuid.uuid4())
    )

    mine = await use_cases(world).thread.execute(actor_for(SUPERVISOR))
    hers = await use_cases(world).thread.execute(actor_for(ADMIN_ONLY))
    assert [m.text for m in mine.messages] == ["Acorta el resumen de disputas", "uno"]
    assert [m.text for m in hers.messages] == ["Hola", "dos"]
    assert [c.operation for c in world.runtime.calls].count("start_run") == 2


async def test_the_second_message_reuses_the_session(world: BuilderWorld) -> None:
    world.runtime.script.extend([turn("r1"), turn("r2")])

    await say(world, "uno")
    await say(world, "dos")

    assert [c.operation for c in world.runtime.calls] == ["start_run", "post_turn", "post_turn"]


async def test_a_retry_after_the_answer_never_asks_twice(world: BuilderWorld) -> None:
    world.runtime.script.append(turn("r1"))
    first = await say(world, "uno", key="msg-0001")

    again = await say(world, "uno", key="msg-0001")

    assert again.replayed is True
    assert [a.text for a in again.answers] == [a.text for a in first.answers]
    assert len(calls(world, "post_turn")) == 1
    with pytest.raises(IdempotencyConflictError):
        await say(world, "otra cosa", key="msg-0001")


async def test_a_failed_call_keeps_the_message_and_a_retry_asks_again(world: BuilderWorld) -> None:
    world.runtime.script.append(AgentRuntimeUnavailableError("down"))
    with pytest.raises(AgentCoreUnavailableError):
        await say(world, "uno", key="msg-0002")
    kept = await use_cases(world).thread.execute(actor_for(SUPERVISOR))
    assert [m.role for m in kept.messages] == ["person"]  # stored before the call

    world.runtime.script.append(turn("ahora sí"))
    retried = await say(world, "uno", key="msg-0002")

    assert retried.replayed is False  # the agent answered now
    assert [a.text for a in retried.answers] == ["ahora sí"]
    assert [c.operation for c in world.runtime.calls].count("post_turn") == 2
    # agent-core de-duplicates the retried turn by its client_turn_id
    sent = calls(world, "post_turn")
    assert sent[0]["client_turn_id"] == sent[1]["client_turn_id"]


async def test_agent_core_refusals_and_a_busy_thread_are_translated(world: BuilderWorld) -> None:
    world.runtime.script.append(AgentRuntimeError(status=403, code="agent_forbidden"))
    with pytest.raises(AgentCoreRejectedError) as refused:
        await say(world, "uno")
    assert refused.value.details["agentCoreCode"] == "agent_forbidden"

    world.runtime.script.append(AgentRuntimeError(status=409, code="turn_in_progress"))
    with pytest.raises(BuilderBusyError):
        await say(world, "dos")


async def test_a_run_agent_core_closed_is_replaced_keeping_the_thread(world: BuilderWorld) -> None:
    world.runtime.script.extend([turn("r1"), AgentRuntimeError(status=409, code="run_closed")])
    await say(world, "uno")
    world.runtime.script.append(turn("r2"))

    await say(world, "dos")

    starts = [c for c in world.runtime.calls if c.operation == "start_run"]
    assert len(starts) == 2
    assert starts[0].arguments["idempotency_key"] != starts[1].arguments["idempotency_key"]
    thread = await use_cases(world).thread.execute(actor_for(SUPERVISOR))
    assert [m.text for m in thread.messages][-1] == "r2"


async def test_proposals_the_agent_made_join_the_list_once(world: BuilderWorld) -> None:
    made = world.registry.seed_proposal(agent_id=AGENT, title="Del chat")
    world.runtime.script.extend(
        [
            turn(f"Creé la propuesta {made} y escribí el borrador."),
            turn(f"Sigue la propuesta {made}; la otra, {NOT_A_PROPOSAL}, no existe."),
        ]
    )

    first = await say(world, "Acorta el resumen")
    second = await say(world, "¿Cómo va?")

    assert [p.proposal_id for p in first.proposals] == [made]
    assert first.proposals[0].source == "chat"
    assert [p.proposal_id for p in second.proposals] == [made]  # the unknown id is ignored
    listed = await use_cases(world).registry.list_proposals(actor_for(SUPERVISOR))
    assert [p.proposal_id for p in listed] == [made]
    tracked = [
        e for e in await builder_events(world.container) if e[0] == "builder.proposal_tracked"
    ]
    assert len(tracked) == 1
    assert tracked[0][1]["source"] == "chat"


async def test_nobody_else_chats_with_the_builder(world: BuilderWorld) -> None:
    with pytest.raises(ForbiddenError):
        await use_cases(world).ask.execute(
            actor_for(ANALYST), text="hola", client_message_id=str(uuid.uuid4())
        )
    with pytest.raises(ForbiddenError):
        await use_cases(world).thread.execute(actor_for(ANALYST))
    assert world.runtime.calls == []


async def test_the_audit_keeps_ids_and_sizes_not_the_conversation(world: BuilderWorld) -> None:
    world.runtime.script.append(turn("RESPUESTA-PRIVADA"))

    await say(world, "TEXTO-PRIVADO")

    events = await builder_events(world.container)
    assert [e[0] for e in events] == ["builder.question_asked", "builder.answered"]
    assert "PRIVADO" not in str([e[1] for e in events])
    assert events[0][1]["question_length"] == len("TEXTO-PRIVADO")
    assert events[1][1]["trace_id"] == "trace-1"
