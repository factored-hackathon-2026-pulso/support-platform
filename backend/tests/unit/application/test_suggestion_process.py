"""The automatic suggestions (ADR 0005): a customer message or a hand-over makes one on its own,
quietly skips what has nothing to propose, never raises, and tells the analyst's inbox."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from cc_platform.application.ai import AgentRuntimeUnavailableError
from cc_platform.application.ai.suggestion_process import (
    SIGNAL_TYPE,
    SuggestionProcess,
    SuggestionSignal,
)
from cc_platform.application.ai.suggestions import MIN_GAP, Prepared, SuggestionService
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.realtime import RealtimeEnvelope
from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.events import CopilotSuggestionReady, CopilotSuggestionRequested
from cc_platform.domain.ai.suggestion import (
    EscalationSuggestion,
    ReplySuggestion,
    SuggestionStatus,
    SuggestionTrigger,
)
from cc_platform.domain.cases.events import CaseAssigned, TurnCreated
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import NATALIA, assistant_world, escalation, say, settle, turn
from tests.support import ANALYST, actor_for, customer_actor, make_available_quietly

DANIELA = seed_staff_id(ANALYST.number)
DRAFT = "Natalia, ya radiqué la disputa y te confirmo por este chat."
FULL = (
    ReplySuggestion(text=DRAFT),
    EscalationSuggestion(reason_code="policy:fraude", motive_draft="Posible robo de tarjeta."),
)
CASE = "CASE-" + "0" * 25 + "1"
NOW = datetime(2026, 10, 4, 14, tzinfo=UTC)


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
        copilot_suggestions_agent="copiloto-sugerencias@prod",
        copilot_suggestions_auto=True,
        copilot_suggestions_coalesce_seconds=0,
        # Slice 21: these cases have no type (stage 0); the process is what is under test here.
        stage_gates_suggestions=False,
    ):
        yield container


def clock(world: Container) -> FixedClock:
    assert isinstance(world.clock, FixedClock)
    return world.clock


def runs(runtime: InMemoryAgentRuntime) -> list[dict[str, object]]:
    return [
        c.arguments for c in runtime.calls if c.operation == "start_run" and "input" in c.arguments
    ]


async def latest(world: Container, case_id: str):  # type: ignore[no-untyped-def]
    assert world.use_cases.assistant is not None
    assert world.use_cases.assistant.suggestions is not None
    view = await world.use_cases.assistant.suggestions.latest.execute(actor_for(ANALYST), case_id)
    return view.latest.suggestion if view.latest else None


async def handed_over_case(world: Container, runtime: InMemoryAgentRuntime) -> str:
    """The assistant escalates to Daniela: the hand-over makes the first suggestion on its own."""
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    await settle(world)
    return result.conversation.case_id


async def customer_says(world: Container, text: str) -> None:
    await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say(text))
    await settle(world)


async def test_a_hand_over_makes_a_suggestion_on_its_own(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.suggestion_script.append(FULL)

    case_id = await handed_over_case(world, runtime)

    made = await latest(world, case_id)
    assert made is not None
    assert made.status is SuggestionStatus.READY
    assert made.trigger is SuggestionTrigger.HANDOVER
    assert made.kinds == ("reply", "escalate")
    (run,) = runs(runtime)
    assert run["input"]["motivo_llegada"] == "assistant_handoff"  # type: ignore[index]


async def test_a_real_customer_message_makes_one_and_a_greeting_does_not(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.suggestion_script.extend([(), FULL])
    case_id = await handed_over_case(world, runtime)
    assert len(runs(runtime)) == 1  # the hand-over proposed nothing
    clock(world).advance(MIN_GAP + timedelta(seconds=1))

    await customer_says(world, "hola")
    assert len(runs(runtime)) == 1  # a greeting costs no model call

    await customer_says(world, "Quiero hablar con supervisión, esto es un robo")

    assert len(runs(runtime)) == 2
    made = await latest(world, case_id)
    assert made is not None
    assert made.status is SuggestionStatus.READY
    assert made.trigger is SuggestionTrigger.CUSTOMER_MESSAGE
    assert runs(runtime)[1]["input"]["turnos"][-1]["texto"].startswith("Quiero hablar")  # type: ignore[index]


async def test_a_burst_of_messages_makes_one_suggestion(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.suggestion_script.extend([(), FULL])
    await handed_over_case(world, runtime)
    clock(world).advance(MIN_GAP + timedelta(seconds=1))

    await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say("Mire"))
    await world.use_cases.cases.post_customer_turn.execute(
        customer_actor(NATALIA), say("me cobraron dos veces")
    )
    await world.use_cases.cases.post_customer_turn.execute(
        customer_actor(NATALIA), say("y nadie me responde")
    )
    await settle(world)

    assert len(runs(runtime)) == 2  # the hand-over's and one for the whole burst


async def test_a_failure_is_stored_and_never_raised(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.suggestion_script.append(AgentRuntimeUnavailableError("down"))

    case_id = await handed_over_case(world, runtime)  # settle would show a raised failure

    made = await latest(world, case_id)
    assert made is not None
    assert made.status is SuggestionStatus.FAILED
    assert made.failure_code == "agent_core_unavailable"


async def test_a_case_the_assistant_still_holds_gets_nothing(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola, ¿en qué te ayudo?"))

    await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    await settle(world)
    await customer_says(world, "Quiero hablar con supervisión, esto es un robo")

    assert runs(runtime) == []


class Hub:
    """Captures what the signal publishes."""

    def __init__(self) -> None:
        self.sent: list[tuple[tuple[str, ...], RealtimeEnvelope]] = []

    async def publish_many(self, topics: object, envelope: RealtimeEnvelope) -> int:
        self.sent.append((tuple(topics), envelope))  # type: ignore[call-overload]
        return 0


def requested(trigger: str) -> EventRecord:
    event = CopilotSuggestionRequested(
        occurred_at=NOW,
        actor=ActorRef.system(),
        entity_id="CPS-" + "0" * 25 + "1",
        case_id=CASE,
        analyst_id=DANIELA,
        trigger=trigger,
        based_on_sequence=3,
    )
    return EventRecord(event_id="evt-1", event=event, ingested_at=NOW)


async def test_the_signal_carries_the_id_and_the_status_only() -> None:
    hub = Hub()
    signal = SuggestionSignal(hub)  # type: ignore[arg-type]
    ready = CopilotSuggestionReady(
        occurred_at=NOW,
        actor=ActorRef.system(),
        entity_id="CPS-" + "0" * 25 + "1",
        case_id=CASE,
        analyst_id=DANIELA,
        agent="copiloto-sugerencias@prod",
        kinds=("reply",),
        count=1,
        truncated=False,
        run_id="run-1",
        trace_id="t-1",
    )

    await signal(requested("customer_message"))
    await signal(EventRecord(event_id="evt-2", event=ready, ingested_at=NOW))
    await signal(requested("manual"))  # she asked: her own request is waiting

    assert [topics for topics, _ in hub.sent] == [(f"inbox:{DANIELA}",)] * 2
    kinds = [envelope.type for _, envelope in hub.sent]
    assert kinds == [SIGNAL_TYPE, SIGNAL_TYPE]
    payloads = [envelope.data["payload"] for _, envelope in hub.sent]
    assert payloads == [
        {"suggestionId": "CPS-" + "0" * 25 + "1", "status": "preparing"},
        {"suggestionId": "CPS-" + "0" * 25 + "1", "status": "ready"},
    ]
    assert "reply" not in json.dumps([e.data for _, e in hub.sent])


# ----------------------------------------------------------------------------- the coalescing
class Tasks:
    def __init__(self) -> None:
        self.jobs: list[Callable[[], Awaitable[object]]] = []

    def spawn(self, name: str, job: Callable[[], Awaitable[object]]) -> None:
        self.jobs.append(job)


class Service:
    def __init__(self) -> None:
        self.prepared: list[tuple[str, SuggestionTrigger]] = []
        self.produced = 0
        self.on_prepare: Callable[[], Awaitable[object]] | None = None

    async def prepare_automatic(self, case_id: str, trigger: SuggestionTrigger) -> Prepared | None:
        self.prepared.append((case_id, trigger))
        if self.on_prepare is not None:
            hook, self.on_prepare = self.on_prepare, None  # once: a message while the model works
            await hook()
        return Prepared(suggestion_id="CPS-x", credentials=None, input={}, language="es")  # type: ignore[arg-type]

    async def produce(self, prepared: Prepared, *, raise_errors: bool) -> None:
        assert raise_errors is False
        self.produced += 1


def message(case_id: str | None = CASE, author: str = "customer") -> EventRecord:
    event = TurnCreated(
        occurred_at=NOW,
        actor=ActorRef.system(),
        entity_id="TRN-" + "0" * 25 + "1",
        case_id=case_id,
        sequence=4,
        kind="message",
        audience="everyone",
        author_role=author,
        author_id=None,
        text="Quiero hablar con supervisión",
        language="es",
        client_message_id=None,
    )
    return EventRecord(event_id="evt-3", event=event, ingested_at=NOW)


async def test_it_waits_the_coalescing_window_once_and_runs_one_more_round_for_a_late_message() -> (
    None
):
    tasks, service, slept = Tasks(), Service(), []

    async def sleep(seconds: float) -> None:
        slept.append(seconds)

    process = SuggestionProcess(
        tasks,  # type: ignore[arg-type]
        service,  # type: ignore[arg-type]
        coalesce_seconds=3.0,
        sleep=sleep,
    )
    service.on_prepare = lambda: process(message())

    await process(message())
    await process(message())  # while the first waits: nothing new is spawned
    assert len(tasks.jobs) == 1
    await tasks.jobs[0]()

    assert slept == [3.0, 3.0]  # the late message asked for one more round, once
    assert len(service.prepared) == 2
    assert service.produced == 2
    assert all(trigger is SuggestionTrigger.CUSTOMER_MESSAGE for _, trigger in service.prepared)


async def test_a_hand_over_that_arrives_before_the_job_starts_keeps_its_reason() -> None:
    """A customer message spawns the job; the case then reaches the analyst before it runs: the
    job must propose as a hand-over (the assistant spoke last), not as a customer message."""
    tasks, service = Tasks(), Service()
    process = SuggestionProcess(tasks, service, coalesce_seconds=0)  # type: ignore[arg-type]
    assigned = CaseAssigned(
        occurred_at=NOW,
        actor=ActorRef.system(),
        entity_id=CASE,
        case_id=CASE,
        assignment_id="ASG-1",
        assigned_analyst_id=DANIELA,
        previous_analyst_id=None,
        reason="assistant_handoff",
        policy_rule_id=None,
        open_cases_at_assignment=1,
        strategy="least_loaded",
        waited_seconds=None,
        paused_override=False,
    )

    await process(message())
    await process(EventRecord(event_id="evt-5", event=assigned, ingested_at=NOW))
    await tasks.jobs[0]()

    assert service.prepared == [(CASE, SuggestionTrigger.HANDOVER)]


async def test_it_ignores_what_is_not_a_customer_message_or_an_assignment() -> None:
    tasks = Tasks()
    process = SuggestionProcess(tasks, Service(), coalesce_seconds=0)  # type: ignore[arg-type]

    await process(message(author="analyst"))
    await process(message(case_id=None))

    assert tasks.jobs == []


async def test_an_assignment_asks_for_a_hand_over_suggestion_but_a_call_does_not() -> None:
    tasks, service = Tasks(), Service()
    process = SuggestionProcess(tasks, service, coalesce_seconds=0)  # type: ignore[arg-type]

    def assigned(reason: str) -> EventRecord:
        event = CaseAssigned(
            occurred_at=NOW,
            actor=ActorRef.system(),
            entity_id="CASE-" + "0" * 25 + "1",
            case_id=CASE,
            assignment_id="ASG-1",
            assigned_analyst_id=DANIELA,
            previous_analyst_id=None,
            reason=reason,
            policy_rule_id=None,
            open_cases_at_assignment=1,
            strategy="least_loaded",
            waited_seconds=None,
            paused_override=False,
        )
        return EventRecord(event_id="evt-4", event=event, ingested_at=NOW)

    await process(assigned("outbound_call"))
    assert tasks.jobs == []
    await process(assigned("assistant_handoff"))
    await tasks.jobs[0]()

    assert service.prepared == [(CASE, SuggestionTrigger.HANDOVER)]


def test_the_purge_runs_on_a_schedule_only_with_suggestions(
    world: Container,
) -> None:
    assert world.suggestion_purge is not None
    assert isinstance(SuggestionService, type)


async def test_the_purge_is_not_scheduled_without_a_suggestions_agent(
    tmp_path: Path, runtime: InMemoryAgentRuntime
) -> None:
    async for container in assistant_world("memory", tmp_path, runtime):
        assert container.suggestion_purge is None
