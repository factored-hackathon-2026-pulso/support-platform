"""The analyst's copilot (ADR 0003, slice 15): a thread per (case, analyst), questions stored before
the call, answers as the analyst, retries that never ask twice. Over the real composition and both
persistence adapters, with a scripted agent-core (no network)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.ai import AgentRuntimeError, AgentRuntimeUnavailableError
from cc_platform.application.audit.catalog import AuditNames, describe, fallback_description
from cc_platform.application.cases.dto import CloseCaseCommand
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.errors import ForbiddenError
from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.errors import CopilotBusyError, CopilotUnavailableError
from cc_platform.domain.cases import CloseReason
from cc_platform.domain.cases.errors import CaseClosedError, IdempotencyConflictError
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import (
    NATALIA,
    assistant_world,
    decode,
    escalation,
    say,
    settle,
    turn,
)
from tests.support import (
    ANALYST,
    JULIAN,
    SUPERVISOR,
    actor_for,
    customer_actor,
    make_available_quietly,
)

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


async def case_with_daniela(
    world: Container, runtime: InMemoryAgentRuntime, number: int = NATALIA
) -> str:
    """A case assigned to Daniela (the assistant escalated it); the copilot script starts empty."""
    await make_available_quietly(world.uow, DANIELA)
    if number == NATALIA:
        runtime.script.append(escalation())
    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(number), say())
    await settle(world)
    runtime.calls.clear()
    return result.conversation.case_id


async def ask(
    world: Container,
    case_id: str,
    text: str = "¿Cuánto debe en la tarjeta?",
    key: str | None = None,
):  # type: ignore[no-untyped-def]
    assert world.use_cases.assistant is not None
    return await world.use_cases.assistant.ask_copilot.execute(
        actor_for(ANALYST), case_id, text=text, client_message_id=key or str(uuid.uuid4())
    )


def calls(runtime: InMemoryAgentRuntime, operation: str) -> list[dict[str, object]]:
    return [c.arguments for c in runtime.calls if c.operation == operation]


# ----------------------------------------------------------------------------- asking
async def test_the_analyst_asks_and_the_copilot_answers_as_her(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.append(
        turn("Debe 1.342,80 USD en la tarjeta de crédito.", agent="copiloto-asesor@1.0.0")
    )

    exchange = await ask(world, case_id)

    assert exchange.question.role == "analyst"
    assert exchange.replayed is False
    assert [a.text for a in exchange.answers] == ["Debe 1.342,80 USD en la tarjeta de crédito."]
    assert exchange.answers[0].answers == exchange.question.id
    start = runtime.calls[0]
    assert start.operation == "start_run"
    assert start.arguments["agent"] == "copiloto-asesor@prod"
    assert start.credentials is not None
    assert start.credentials.on_behalf_of is not None
    principal = decode(start.credentials.authorization)
    assert (principal["type"], principal["id"]) == ("advisor", DANIELA)
    assert decode(start.credentials.on_behalf_of)["subject"]["kind"] == "customer"
    sent = calls(runtime, "post_turn")[0]
    assert sent["client_turn_id"] == exchange.question.id
    assert sent["channel"] == "workspace"

    thread = await world.use_cases.assistant.copilot_thread.execute(actor_for(ANALYST), case_id)  # type: ignore[union-attr]
    assert thread.available is True
    assert [m.role for m in thread.messages] == ["analyst", "copilot"]


async def test_the_second_question_reuses_the_session(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.extend([turn("r1"), turn("r2")])

    await ask(world, case_id, "uno")
    await ask(world, case_id, "dos")

    assert [c.operation for c in runtime.calls] == ["start_run", "post_turn", "post_turn"]


async def test_a_retry_after_the_answer_never_asks_twice(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.append(turn("r1"))
    first = await ask(world, case_id, "uno", key="msg-0001")

    again = await ask(world, case_id, "uno", key="msg-0001")

    assert again.replayed is True
    assert [a.text for a in again.answers] == [a.text for a in first.answers]
    assert len(calls(runtime, "post_turn")) == 1
    with pytest.raises(IdempotencyConflictError):
        await ask(world, case_id, "otra cosa", key="msg-0001")


async def test_a_failed_call_keeps_the_question_and_a_retry_asks_again(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.append(AgentRuntimeUnavailableError("down"))
    with pytest.raises(Exception, match="comunicarnos"):
        await ask(world, case_id, "uno", key="msg-0001")
    thread = await world.use_cases.assistant.copilot_thread.execute(actor_for(ANALYST), case_id)  # type: ignore[union-attr]
    assert [m.role for m in thread.messages] == ["analyst"]  # the question is not lost

    runtime.script.append(turn("ahora sí"))
    again = await ask(world, case_id, "uno", key="msg-0001")

    assert [a.text for a in again.answers] == ["ahora sí"]
    sent = calls(runtime, "post_turn")
    assert sent[0]["client_turn_id"] == sent[1]["client_turn_id"]  # agent-core dedupes it


async def test_a_run_agent_core_closed_is_replaced_keeping_the_thread(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.extend(
        [turn("r1"), AgentRuntimeError(status=410, code="run_closed"), turn("r2")]
    )
    await ask(world, case_id, "uno")

    second = await ask(world, case_id, "dos")

    assert [a.text for a in second.answers] == ["r2"]
    keys = [str(a["idempotency_key"]) for a in calls(runtime, "start_run")]
    assert len(keys) == 2
    assert keys[0].endswith(".0")
    assert keys[1].endswith(".1")
    thread = await world.use_cases.assistant.copilot_thread.execute(actor_for(ANALYST), case_id)  # type: ignore[union-attr]
    assert len(thread.messages) == 4


async def test_a_run_that_ends_with_its_answer_starts_another_next_time(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.extend([turn("r1", status="closed"), turn("r2")])

    await ask(world, case_id, "uno")
    await ask(world, case_id, "dos")

    assert [c.operation for c in runtime.calls] == [
        "start_run",
        "post_turn",
        "start_run",
        "post_turn",
    ]


async def test_the_copilot_still_answering_is_busy(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.append(AgentRuntimeError(status=409, code="turn_in_progress"))

    with pytest.raises(CopilotBusyError):
        await ask(world, case_id)


# ----------------------------------------------------------------------------- who and when
async def test_only_the_assignee_analyst_asks(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    assert world.use_cases.assistant is not None

    with pytest.raises(CaseNotAssignedError):
        await world.use_cases.assistant.ask_copilot.execute(
            actor_for(JULIAN), case_id, text="hola", client_message_id="msg-0001"
        )
    with pytest.raises(ForbiddenError):  # a supervisor holds no customer data
        await world.use_cases.assistant.ask_copilot.execute(
            actor_for(SUPERVISOR), case_id, text="hola", client_message_id="msg-0001"
        )
    with pytest.raises(CaseNotAssignedError):
        await world.use_cases.assistant.copilot_thread.execute(actor_for(JULIAN), case_id)
    assert runtime.calls == []


async def test_a_customer_not_linked_to_the_dataset_has_no_copilot(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime, number=2003)  # people from the start
    assert world.use_cases.assistant is not None

    thread = await world.use_cases.assistant.copilot_thread.execute(actor_for(ANALYST), case_id)
    assert thread.available is False
    with pytest.raises(CopilotUnavailableError):
        await ask(world, case_id)


async def test_a_closed_case_takes_no_new_question(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.append(turn("r1"))
    await ask(world, case_id, "uno", key="msg-0001")
    await world.use_cases.cases.close.execute(
        actor_for(ANALYST), case_id, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )

    with pytest.raises(CaseClosedError):
        await ask(world, case_id, "otra")
    again = await ask(world, case_id, "uno", key="msg-0001")  # a replay still reads its answer
    assert again.replayed is True


async def test_every_copilot_event_has_an_audit_description_and_never_the_text(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.script.append(turn("Debe 1.342,80 USD"))
    await ask(world, case_id, "pregunta con datos del cliente")

    async with world.uow() as uow:
        events = (await uow.event_log.page(case_id=case_id, limit=500)).items

    mine = [e for e in events if e.event_type.startswith("copilot.")]
    assert {e.event_type for e in mine} == {"copilot.query_asked", "copilot.answered"}
    for event in mine:
        assert describe(event, AuditNames()) != fallback_description(event.event_type)
        assert "pregunta con datos" not in repr(event.payload)
        assert "1.342" not in repr(event.payload)


async def test_the_copilot_run_names_the_assistant_session_of_the_case(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    async with world.uow() as uow:
        assistant = await uow.assistant_sessions.get_by_case(case_id)
    assert assistant is not None
    assert assistant.agent_session_id is not None
    runtime.script.append(turn("Escaló por el monto.", agent="copiloto-asesor@1.0.0"))
    await ask(world, case_id)
    starts = [c for c in runtime.calls if c.operation == "start_run"]
    assert len(starts) == 1
    assert starts[0].arguments["input"] == {"assistant_session_id": assistant.agent_session_id}
