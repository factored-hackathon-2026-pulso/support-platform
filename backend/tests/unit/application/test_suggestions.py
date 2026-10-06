"""The copilot's suggestions (ADR 0005): a typed list that may be empty, asked by the analyst or
made on its own, with decisions, staleness and the 24-hour purge. Over the real composition and
both persistence adapters, with a scripted agent-core (no network)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import pytest

from cc_platform.application.ai import AgentRuntimeError, AgentRuntimeUnavailableError
from cc_platform.application.ai.errors import AgentCoreRejectedError, AgentCoreUnavailableError
from cc_platform.application.ai.runtime import AgentOutcome
from cc_platform.application.ai.suggestions import MIN_GAP, PREPARING_TIMEOUT
from cc_platform.application.ai.use_cases import SuggestionUseCases
from cc_platform.application.audit.catalog import AuditNames, describe, fallback_description
from cc_platform.application.cases.dto import CloseCaseCommand
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.errors import ForbiddenError
from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.errors import CopilotBusyError, CopilotUnavailableError
from cc_platform.domain.ai.suggestion import (
    DRAFT_TTL,
    ActionSuggestion,
    EscalationSuggestion,
    ReplyDecision,
    ReplySuggestion,
    SuggestionStatus,
    SuggestionTrigger,
    ToolSuggestion,
)
from cc_platform.domain.cases import CloseReason
from cc_platform.domain.cases.errors import CaseClosedError
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
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
AGENT = "copiloto-sugerencias@prod"
DRAFT = "Natalia, ya radiqué la disputa y te confirmo por este chat."


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(
    request: pytest.FixtureRequest, tmp_path: Path, runtime: InMemoryAgentRuntime
) -> AsyncIterator[Container]:
    async for container in assistant_world(
        str(request.param),
        tmp_path,
        runtime,
        copilot_suggestions_agent=AGENT,
        copilot_suggestions_auto=False,  # these tests drive the service by hand
    ):
        yield container


def suggestions(world: Container) -> SuggestionUseCases:
    assert world.use_cases.assistant is not None
    assert world.use_cases.assistant.suggestions is not None
    return world.use_cases.assistant.suggestions


def clock(world: Container) -> FixedClock:
    assert isinstance(world.clock, FixedClock)
    return world.clock


async def case_with_daniela(world: Container, runtime: InMemoryAgentRuntime) -> str:
    """A case the assistant escalated to Daniela; the calls so far are forgotten."""
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    await settle(world)
    runtime.calls.clear()
    return result.conversation.case_id


async def customer_says(world: Container, text: str) -> None:
    await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say(text))
    await settle(world)


async def request(world: Container, case_id: str, key: str = "key-00000001"):  # type: ignore[no-untyped-def]
    return await suggestions(world).request.execute(actor_for(ANALYST), case_id, request_key=key)


async def latest(world: Container, case_id: str):  # type: ignore[no-untyped-def]
    return await suggestions(world).latest.execute(actor_for(ANALYST), case_id)


def runs(runtime: InMemoryAgentRuntime) -> list[dict[str, object]]:
    return [c.arguments for c in runtime.calls if c.operation == "start_run"]


#: What agent-core's input_schema declares (the contract test checks them against its YAML).
FLAT_INPUT_KEYS = {
    "turnos",
    "idioma",
    "canal",
    "prioridad",
    "sla_estado",
    "sla_minutos_restantes",
    "espera_del_cliente_segundos",
    "motivo_llegada",
    "sugerencia_borrador",
    "sugerencia_escalacion_aceptada",
    "assistant_session_id",
}

FULL = (
    ReplySuggestion(text=DRAFT, citations=("f1",)),
    ToolSuggestion(tool="leer_movimientos@1", label="Movimientos", why="Ver los cargos"),
    ActionSuggestion(tool="radicar_pqr@1", summary="Radicar una disputa por 120 USD"),
    EscalationSuggestion(
        reason_code="policy:fraude", evidence=("Dice que le robaron",), motive_draft="Fraude"
    ),
)


# ----------------------------------------------------------------------------- asking (manual)
async def test_the_analyst_asks_and_gets_a_typed_list_made_as_her(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)

    view = await request(world, case_id)

    suggestion = view.suggestion
    assert suggestion.status is SuggestionStatus.READY
    assert suggestion.kinds == ("reply", "tool", "escalate")
    assert suggestion.trigger is SuggestionTrigger.MANUAL
    assert view.stale is False
    (run,) = runs(runtime)
    assert run["agent"] == AGENT
    assert run["idempotency_key"] == suggestion.id
    assert run["lang"] == "es"
    start = runtime.calls[0]
    assert start.credentials is not None
    assert start.credentials.on_behalf_of is not None
    principal = decode(start.credentials.authorization)
    assert (principal["type"], principal["id"]) == ("advisor", DANIELA)
    assert decode(start.credentials.on_behalf_of)["subject"]["kind"] == "customer"


async def test_the_input_carries_the_recent_turns_and_the_facts_of_the_case(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    await customer_says(world, "Quiero hablar con supervisión, esto es un robo")
    runtime.suggestion_script.append(())

    await request(world, case_id)

    agent_input = runs(runtime)[0]["input"]
    assert isinstance(agent_input, dict)
    assert agent_input["idioma"] == "es"
    assert agent_input["canal"] == "chat_app"
    assert agent_input["motivo_llegada"] == "assistant_handoff"
    roles = [t["rol"] for t in agent_input["turnos"]]
    assert roles[0] == "cliente"
    assert "asistente" in roles
    assert roles[-1] == "cliente"  # banners and notices are not speech
    assert agent_input["turnos"][-1]["texto"] == "Quiero hablar con supervisión, esto es un robo"
    assert agent_input["espera_del_cliente_segundos"] == 0
    assert agent_input["sla_estado"] in {"a_tiempo", "en_riesgo", "vencido"}


async def test_the_input_is_flat_and_omits_what_does_not_apply(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    """agent-core's input_schema takes scalars and one flat list: no objects, no nulls."""
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(())

    await request(world, case_id)

    agent_input = runs(runtime)[0]["input"]
    assert isinstance(agent_input, dict)
    assert set(agent_input) <= FLAT_INPUT_KEYS
    assert {"turnos", "idioma", "canal", "prioridad", "sla_estado"} <= set(agent_input)
    assert "sla" not in agent_input
    assert "sugerencia_anterior" not in agent_input  # nothing before this one
    assert "sugerencia_borrador" not in agent_input
    assert "sugerencia_escalacion_aceptada" not in agent_input
    assert all(value is not None for value in agent_input.values())
    for spoken in agent_input["turnos"]:
        assert set(spoken) == {"rol", "texto", "hora"}
    if agent_input["sla_estado"] in {"respondida", "vencido"}:
        assert "sla_minutos_restantes" not in agent_input
    else:
        assert isinstance(agent_input["sla_minutos_restantes"], int)


async def test_the_input_names_the_assistant_session_as_traceability(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    async with world.uow() as uow:
        assistant = await uow.assistant_sessions.get_by_case(case_id)
    assert assistant is not None
    assert assistant.agent_session_id is not None
    runtime.suggestion_script.append(())

    await request(world, case_id)

    agent_input = runs(runtime)[0]["input"]
    assert isinstance(agent_input, dict)
    assert agent_input["assistant_session_id"] == assistant.agent_session_id


async def test_the_previous_suggestions_fate_goes_as_scalars(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id, "key-00000001")
    runtime.suggestion_script.append(())

    await request(world, case_id, "key-00000002")

    agent_input = runs(runtime)[1]["input"]
    assert isinstance(agent_input, dict)
    assert first.suggestion.reply_decision is None
    assert agent_input["sugerencia_borrador"] == "ignored"  # the new request replaced it
    assert agent_input["sugerencia_escalacion_aceptada"] is False
    assert "sugerencia_anterior" not in agent_input


async def test_the_tool_label_comes_from_the_platforms_catalog(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(
        (
            ToolSuggestion(tool="leer_movimientos@1", label="lo que diga el agente", why="Ver"),
            ToolSuggestion(tool="herramienta_nueva@2", why="Ver"),
        )
    )

    view = await request(world, case_id)

    labels = [i.label for i in view.suggestion.items if isinstance(i, ToolSuggestion)]
    assert labels == ["Movimientos", "herramienta_nueva"]  # catalog, else the name without version


async def test_more_than_three_are_cut_visibly(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(
        (
            ToolSuggestion(tool="leer_movimientos@1", why="a"),
            ToolSuggestion(tool="leer_productos@1", why="b"),
            ToolSuggestion(tool="leer_pqr_cliente@1", why="c"),
            ReplySuggestion(text=DRAFT),
            ReplySuggestion(text="otro borrador"),
        )
    )

    view = await request(world, case_id)

    suggestion = view.suggestion
    assert len(suggestion.items) == 3
    assert suggestion.kinds[0] == "tool"
    assert "reply" in suggestion.kinds  # the reply is kept
    assert suggestion.truncated is True
    async with world.uow() as uow:
        events = (await uow.event_log.page(case_id=case_id, limit=500)).items
    (ready,) = [e for e in events if e.event_type == "copilot.suggestion_ready"]
    assert ready.payload["truncated"] is True  # visible in the audit, with no text
    assert ready.payload["count"] == 3
    assert "otro borrador" not in repr(ready.payload)
    assert DRAFT not in repr(ready.payload)


async def test_a_list_that_fits_is_not_truncated(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL[:3])

    view = await request(world, case_id)

    assert view.suggestion.truncated is False


async def test_nothing_to_propose_is_a_normal_answer(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(())

    view = await request(world, case_id)

    assert view.suggestion.status is SuggestionStatus.NONE
    assert view.suggestion.items == ()


async def test_a_retry_after_the_answer_never_asks_twice(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)

    again = await request(world, case_id)

    assert again.suggestion.id == first.suggestion.id
    assert again.suggestion.status is SuggestionStatus.READY
    assert len(runs(runtime)) == 1


async def test_a_failure_is_stored_and_the_same_key_asks_again(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.extend([AgentRuntimeUnavailableError("down"), FULL])
    with pytest.raises(AgentCoreUnavailableError):
        await request(world, case_id)
    failed = (await latest(world, case_id)).latest
    assert failed is not None
    assert failed.suggestion.status is SuggestionStatus.FAILED
    assert failed.suggestion.failure_code == "agent_core_unavailable"

    again = await request(world, case_id)

    assert again.suggestion.id == failed.suggestion.id
    assert again.suggestion.status is SuggestionStatus.READY
    keys = [r["idempotency_key"] for r in runs(runtime)]
    assert keys == [failed.suggestion.id, failed.suggestion.id]  # agent-core dedupes it


async def test_a_run_agent_core_closes_failed_is_a_failure_not_an_empty_list(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.extend([AgentOutcome.FAILED, FULL])

    view = await request(world, case_id)

    assert view.suggestion.status is SuggestionStatus.FAILED
    assert view.suggestion.failure_code == "agent_run_failed"
    assert view.suggestion.items == ()
    again = await request(world, case_id)  # a failure is retried, like any other
    assert again.suggestion.status is SuggestionStatus.READY


async def test_a_refusal_carries_agent_cores_code(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(AgentRuntimeError(status=404, code="not_found"))

    with pytest.raises(AgentCoreRejectedError):
        await request(world, case_id)

    stored = (await latest(world, case_id)).latest
    assert stored is not None
    assert stored.suggestion.failure_code == "not_found"


async def test_a_second_request_while_one_is_being_prepared_is_busy_until_it_times_out(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    await suggestions(world).service.prepare_manual(
        actor_for(ANALYST), case_id, request_key="key-00000001"
    )

    with pytest.raises(CopilotBusyError):
        await request(world, case_id, "key-00000002")
    with pytest.raises(CopilotBusyError):
        await request(world, case_id, "key-00000001")

    clock(world).advance(PREPARING_TIMEOUT + timedelta(seconds=1))
    runtime.suggestion_script.append(FULL)
    view = await request(world, case_id, "key-00000002")  # the lost one is replaced

    assert view.suggestion.status is SuggestionStatus.READY


async def test_only_the_assignee_analyst_asks(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)

    with pytest.raises(CaseNotAssignedError):
        await suggestions(world).request.execute(
            actor_for(JULIAN), case_id, request_key="key-00000001"
        )
    with pytest.raises(ForbiddenError):  # a supervisor holds no customer data
        await suggestions(world).request.execute(
            actor_for(SUPERVISOR), case_id, request_key="key-00000001"
        )
    with pytest.raises(CaseNotAssignedError):
        await suggestions(world).latest.execute(actor_for(JULIAN), case_id)
    assert runs(runtime) == []


async def test_a_closed_case_takes_no_new_request_but_its_latest_stays_readable(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)
    await world.use_cases.cases.close.execute(
        actor_for(ANALYST), case_id, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )

    with pytest.raises(CaseClosedError):
        await request(world, case_id, "key-00000002")
    again = await request(world, case_id)  # a replay still reads its answer
    read = await latest(world, case_id)

    assert again.suggestion.id == first.suggestion.id
    assert read.latest is not None


async def test_a_customer_without_a_dataset_link_has_no_suggestions(
    tmp_path: Path, runtime: InMemoryAgentRuntime
) -> None:
    async for world in assistant_world(
        "memory",
        tmp_path,
        runtime,
        link=False,
        copilot_suggestions_agent=AGENT,
        copilot_suggestions_auto=False,
    ):
        await make_available_quietly(world.uow, DANIELA)
        result = await world.use_cases.cases.post_customer_turn.execute(
            customer_actor(NATALIA), say()
        )
        case_id = result.conversation.case_id

        with pytest.raises(CopilotUnavailableError):
            await request(world, case_id)
        read = await latest(world, case_id)

        assert read.available is False
        assert read.latest is None
        assert runs(runtime) == []


async def test_without_a_suggestions_agent_the_feature_does_not_exist(
    tmp_path: Path, runtime: InMemoryAgentRuntime
) -> None:
    async for world in assistant_world("memory", tmp_path, runtime):
        assert world.use_cases.assistant is not None
        assert world.use_cases.assistant.suggestions is None


# ----------------------------------------------------------------------------- the latest
async def test_the_latest_is_none_before_any_and_the_newest_after(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    assert (await latest(world, case_id)).latest is None

    runtime.suggestion_script.extend([FULL, ()])
    await request(world, case_id, "key-00000001")
    clock(world).advance(timedelta(minutes=1))
    second = await request(world, case_id, "key-00000002")

    read = await latest(world, case_id)
    assert read.available is True
    assert read.latest is not None
    assert read.latest.suggestion.id == second.suggestion.id


async def test_it_goes_stale_when_the_customer_writes_after_the_turns_it_read(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    await request(world, case_id)
    assert (await latest(world, case_id)).latest.stale is False  # type: ignore[union-attr]

    await customer_says(world, "Sigo esperando, ¿qué pasó?")

    assert (await latest(world, case_id)).latest.stale is True  # type: ignore[union-attr]


async def test_a_new_request_ignores_the_draft_nobody_decided(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.extend([FULL, FULL])
    first = await request(world, case_id, "key-00000001")
    clock(world).advance(timedelta(minutes=1))

    await request(world, case_id, "key-00000002")

    async with world.uow() as uow:
        old = await uow.copilot_suggestions.get(first.suggestion.id)
    assert old is not None
    assert old.reply_decision is ReplyDecision.IGNORED
    assert old.kinds == ("reply", "tool", "escalate")  # what was proposed stays


# ----------------------------------------------------------------------------- deciding
async def test_the_analyst_can_discard_the_draft_and_the_rest_stays(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)

    view = await suggestions(world).decide.execute(
        actor_for(ANALYST), case_id, first.suggestion.id, decision="discarded"
    )

    assert view.suggestion.reply_decision is ReplyDecision.DISCARDED
    assert [i.kind for i in view.suggestion.items] == ["tool", "escalate"]


async def test_a_message_sent_from_the_draft_is_used_or_edited(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.extend([FULL, FULL])
    used = await request(world, case_id, "key-00000001")
    clock(world).advance(timedelta(minutes=1))
    edited = await request(world, case_id, "key-00000002")
    link = suggestions(world).link

    assert await link.reply_sent(actor_for(ANALYST), case_id, edited.suggestion.id, sent_text=DRAFT)
    assert not await link.reply_sent(
        actor_for(ANALYST), case_id, edited.suggestion.id, sent_text=DRAFT
    )  # decided once

    async with world.uow() as uow:
        decided = await uow.copilot_suggestions.get(edited.suggestion.id)
        ignored = await uow.copilot_suggestions.get(used.suggestion.id)
    assert decided is not None
    assert decided.reply_decision is ReplyDecision.USED
    assert decided.edit_distance_permille == 0
    assert ignored is not None
    assert ignored.reply_decision is ReplyDecision.IGNORED


async def test_a_changed_draft_records_how_far_it_went(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)

    await suggestions(world).link.reply_sent(
        actor_for(ANALYST), case_id, first.suggestion.id, sent_text="Natalia, ya lo estoy viendo."
    )

    async with world.uow() as uow:
        decided = await uow.copilot_suggestions.get(first.suggestion.id)
    assert decided is not None
    assert decided.reply_decision is ReplyDecision.EDITED
    assert 0 < (decided.edit_distance_permille or 0) <= 1000


async def test_escalating_with_the_recommendation_is_recorded(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)

    taken = await suggestions(world).link.escalated(
        actor_for(ANALYST), case_id, first.suggestion.id
    )

    assert taken is True
    async with world.uow() as uow:
        stored = await uow.copilot_suggestions.get(first.suggestion.id)
    assert stored is not None
    assert stored.escalation_accepted is True


async def test_linking_a_wrong_or_foreign_suggestion_never_fails(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)
    link = suggestions(world).link

    assert not await link.reply_sent(actor_for(ANALYST), case_id, "CPS-" + "0" * 26, sent_text="x")
    assert not await link.reply_sent(actor_for(JULIAN), case_id, first.suggestion.id, sent_text="x")
    assert not await link.reply_sent(
        actor_for(ANALYST), "CASE-" + "0" * 25 + "9", first.suggestion.id, sent_text="x"
    )
    with pytest.raises(CaseNotAssignedError):  # another analyst does not hold the case
        await suggestions(world).decide.execute(
            actor_for(JULIAN), case_id, first.suggestion.id, decision="ignored"
        )
    with pytest.raises(NotFoundError):  # an id that is not hers
        await suggestions(world).decide.execute(
            actor_for(ANALYST), case_id, "CPS-" + "0" * 26, decision="ignored"
        )


# ----------------------------------------------------------------------------- the purge
async def test_a_draft_is_purged_after_twenty_four_hours(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.append(FULL)
    first = await request(world, case_id)
    purge = suggestions(world).purge
    assert await purge.execute() == 0  # too early

    clock(world).advance(DRAFT_TTL + timedelta(seconds=1))

    assert (await latest(world, case_id)).latest is None  # expired, even before the sweep
    assert await purge.execute() == 1
    assert await purge.execute() == 0
    async with world.uow() as uow:
        stored = await uow.copilot_suggestions.get(first.suggestion.id)
    assert stored is not None
    assert stored.items == ()
    assert stored.purged_at is not None
    assert stored.reply_decision is ReplyDecision.IGNORED
    assert stored.reply_hash is not None


# ----------------------------------------------------------------------------- automatic
async def prepare(world: Container, case_id: str, trigger: SuggestionTrigger):  # type: ignore[no-untyped-def]
    return await suggestions(world).service.prepare_automatic(case_id, trigger)


async def test_a_greeting_gets_no_suggestion(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    await customer_says(world, "hola")

    assert await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE) is None


async def test_a_greeting_that_chases_after_a_long_wait_does_get_one(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    await customer_says(world, "hola?")
    clock(world).advance(timedelta(minutes=10))

    assert await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE) is not None


async def test_a_real_message_gets_a_suggestion_and_a_failure_is_swallowed(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    await customer_says(world, "Quiero hablar con supervisión, esto es un robo")
    runtime.suggestion_script.extend([AgentRuntimeUnavailableError("down"), FULL])

    prepared = await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE)
    assert prepared is not None
    failed = await suggestions(world).service.produce(prepared, raise_errors=False)
    assert failed.status is SuggestionStatus.FAILED
    assert failed.trigger is SuggestionTrigger.CUSTOMER_MESSAGE

    clock(world).advance(MIN_GAP + timedelta(seconds=1))
    again = await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE)  # a failure retries
    assert again is not None
    ready = await suggestions(world).service.produce(again, raise_errors=False)
    assert ready.status is SuggestionStatus.READY


async def test_a_burst_and_nothing_new_make_no_second_suggestion(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    await customer_says(world, "Quiero hablar con supervisión, esto es un robo")
    runtime.suggestion_script.append(FULL)
    prepared = await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE)
    assert prepared is not None
    await suggestions(world).service.produce(prepared, raise_errors=False)

    await customer_says(world, "Y además me cobraron dos veces")
    assert await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE) is None  # a burst

    clock(world).advance(MIN_GAP + timedelta(seconds=1))
    again = await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE)
    assert again is not None  # a new message after the gap
    runtime.suggestion_script.append(())
    await suggestions(world).service.produce(again, raise_errors=False)

    clock(world).advance(MIN_GAP + timedelta(seconds=1))
    assert await prepare(world, case_id, SuggestionTrigger.CUSTOMER_MESSAGE) is None  # nothing new


async def test_a_handover_suggests_even_though_the_assistant_spoke_last(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)

    prepared = await prepare(world, case_id, SuggestionTrigger.HANDOVER)

    assert prepared is not None
    roles = [t["rol"] for t in prepared.input["turnos"]]  # type: ignore[index,union-attr]
    assert roles[-1] == "asistente"
    assert prepared.input["motivo_llegada"] == "assistant_handoff"


async def test_a_case_the_assistant_still_holds_gets_no_suggestion(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola, ¿en qué te ayudo?"))
    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    await settle(world)

    prepared = await prepare(world, result.conversation.case_id, SuggestionTrigger.HANDOVER)

    assert prepared is None


async def test_an_unknown_case_gets_no_suggestion(world: Container) -> None:
    assert await prepare(world, "CASE-" + "0" * 25 + "9", SuggestionTrigger.HANDOVER) is None


# ----------------------------------------------------------------------------- the audit
async def test_every_suggestion_event_is_described_and_carries_no_text(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    case_id = await case_with_daniela(world, runtime)
    runtime.suggestion_script.extend([FULL, AgentRuntimeUnavailableError("down"), ()])
    first = await request(world, case_id, "key-00000001")
    await suggestions(world).link.reply_sent(
        actor_for(ANALYST), case_id, first.suggestion.id, sent_text=DRAFT
    )
    await suggestions(world).link.escalated(actor_for(ANALYST), case_id, first.suggestion.id)
    clock(world).advance(timedelta(minutes=1))
    with pytest.raises(AgentCoreUnavailableError):
        await request(world, case_id, "key-00000002")
    clock(world).advance(timedelta(minutes=1))
    await request(world, case_id, "key-00000003")

    async with world.uow() as uow:
        events = (await uow.event_log.page(case_id=case_id, limit=500)).items

    mine = [e for e in events if e.event_type.startswith("copilot.suggestion_")]
    assert {e.event_type for e in mine} == {
        "copilot.suggestion_requested",
        "copilot.suggestion_ready",
        "copilot.suggestion_none",
        "copilot.suggestion_failed",
        "copilot.suggestion_decided",
    }
    dumped = repr([e.payload for e in mine])
    for event in mine:
        assert describe(event, AuditNames()) != fallback_description(event.event_type)
    for secret in (DRAFT, "disputa por 120", "Dice que le robaron", "Ver los cargos", "Fraude"):
        assert secret not in dumped
