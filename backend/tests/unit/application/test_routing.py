"""Routing: the null responder chain, the human tier, the queue and its drain."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from cc_platform.application.cases.dto import PostTurnCommand
from cc_platform.application.routing.ports import (
    ComponentRef,
    Handoff,
    RoutingContext,
    RoutingDecision,
    RoutingOutcome,
    Tier,
)
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import CaseStatus, TurnKind
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
)
from tests.support import (
    ANALYST,
    JULIAN,
    SEBASTIAN,
    PlainHasher,
    actor_for,
    customer_actor,
    memory_container,
)

NATALIA, RAFAEL = 2001, 2004
DANIELA_ID = seed_staff_id(1)


async def bare_container() -> Container:
    """Staff, customers and availability seeded; no cases (Daniela is the only available)."""
    container = await memory_container(seed=False)
    await seed_demo_staff(container.uow, PlainHasher())
    await seed_demo_customers(container.uow)
    await seed_demo_availability(container.uow, container.clock)
    return container


async def write(container: Container, customer: int, text: str = "No reconozco un cargo") -> str:
    result = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(customer), PostTurnCommand(text=text, client_message_id=str(uuid.uuid4()))
    )
    await container.background.drain()
    return result.conversation.case_id


async def set_availability(container: Container, seed: object, status: AvailabilityStatus) -> None:
    await container.use_cases.people.set_availability.execute(actor_for(seed), status)  # type: ignore[arg-type]
    await container.background.drain()


async def test_null_chain_records_every_tier_then_assigns_a_person() -> None:
    container = await bare_container()
    case_id = await write(container, NATALIA)
    async with container.uow() as uow:
        case = await uow.cases.get(case_id)
        steps = await uow.routing_steps.list_for_case(case_id)
        assignment = await uow.assignments.latest_for_case(case_id)
        turns = await uow.turns.page(case_id, limit=10)
        log = [e.event_type for e in (await uow.event_log.page(case_id=case_id)).items]
    assert case is not None
    assert case.status is CaseStatus.ASSIGNED
    assert case.assigned_analyst_id == DANIELA_ID
    assert [(s.tier, s.outcome, s.reason_code, str(s.component)) for s in steps] == [
        (Tier.JUDGE, RoutingOutcome.ABSTAINED, "component_not_connected", "null_judge@0.1.0"),
        (Tier.TREE, RoutingOutcome.ABSTAINED, "component_not_connected", "null_tree@0.1.0"),
        (Tier.AI_AGENT, RoutingOutcome.ABSTAINED, "component_not_connected", "null_ai_agent@0.1.0"),
    ]
    assert all(step.inputs_used == () for step in steps)
    assert assignment is not None
    assert (assignment.policy_rule_id, assignment.strategy) == (None, "language_least_loaded@1")
    assert [t.kind for t in turns] == [TurnKind.MESSAGE, TurnKind.NOTICE, TurnKind.ROUTING]
    assert turns[2].text.startswith("Ningún nivel automático está conectado todavía")
    assert turns[2].text.endswith("Asignado a Daniela Ríos porque está disponible y habla español.")
    # Contract order in the event log: the chain, then the assignment it led to.
    assert log == [
        "case.opened",
        "turn.created",
        "turn.created",
        "routing_step.recorded",
        "routing_step.recorded",
        "routing_step.recorded",
        "case.assigned",
        "turn.created",
    ]


async def test_portuguese_waits_for_a_portuguese_speaker_then_drains() -> None:
    clock = FixedClock()
    container = await memory_container(seed=False, clock=clock)
    await seed_demo_staff(container.uow, PlainHasher())
    await seed_demo_customers(container.uow)
    await seed_demo_availability(container.uow, clock)
    await set_availability(container, ANALYST, AvailabilityStatus.PAUSED)
    await set_availability(container, JULIAN, AvailabilityStatus.AVAILABLE)  # Spanish only

    case_id = await write(container, RAFAEL, "Olá, não reconheço uma compra")
    async with container.uow() as uow:
        case = await uow.cases.get(case_id)
        queued = (await uow.event_log.page(case_id=case_id)).items
    assert case is not None
    assert case.status is CaseStatus.QUEUED  # rule 3: Julián does not speak Portuguese
    assert case.queue_label == "Cola de disputas en portugués"
    event = next(e for e in queued if e.event_type == "case.queued")
    assert event.payload["policy_rule_id"] == "H1"
    assert event.payload["reason_code"] == "no_available_analyst"
    conversation = await container.use_cases.cases.customer_conversation.execute(
        customer_actor(RAFAEL)
    )
    assert conversation.conversation is not None
    assert conversation.conversation.status.value == "waiting_agent"

    clock.advance(timedelta(seconds=90))
    await set_availability(container, ANALYST, AvailabilityStatus.AVAILABLE)
    async with container.uow() as uow:
        case = await uow.cases.get(case_id)
        assignment = await uow.assignments.latest_for_case(case_id)
        turns = await uow.turns.page(case_id, limit=10)
    assert case is not None
    assert case.status is CaseStatus.ASSIGNED
    assert assignment is not None
    assert (assignment.staff_id, assignment.reason.value, assignment.policy_rule_id) == (
        DANIELA_ID,
        "queue_drained",
        "H1",
    )
    assert turns[-1].text == (
        "Asignado a Daniela Ríos después de 2 min en la cola de disputas en portugués."
    )
    assert turns[-2].text == (
        "No hay personas disponibles que hablen portugués: el caso espera en la cola de "
        "disputas en portugués."
    )


async def test_paused_analysts_get_nothing_and_least_loaded_wins() -> None:
    container = await memory_container()  # Daniela available with 7 seeded cases
    await set_availability(container, SEBASTIAN, AvailabilityStatus.AVAILABLE)  # 0 cases
    first = await write(container, NATALIA)
    async with container.uow() as uow:
        case = await uow.cases.get(first)
    assert case is not None
    assert case.assigned_analyst_id == seed_staff_id(SEBASTIAN.number)

    await set_availability(container, SEBASTIAN, AvailabilityStatus.PAUSED)
    second = await write(container, 2002)
    async with container.uow() as uow:
        case = await uow.cases.get(second)
    assert case is not None
    assert case.assigned_analyst_id == DANIELA_ID


async def test_route_case_is_idempotent() -> None:
    container = await bare_container()
    case_id = await write(container, NATALIA)
    await container.recover_routing.execute()  # nothing left in routing or queued
    async with container.uow() as uow:
        steps = await uow.routing_steps.list_for_case(case_id)
        case = await uow.cases.get(case_id)
    assert len(steps) == 3
    assert case is not None
    assert case.last_sequence == 3


JUDGE_UNDER_TEST = ComponentRef("judge.test", "1")
BROKEN_TREE = ComponentRef("tree.broken", "1")


@dataclass(frozen=True)
class HandingOffJudge:
    tier: Tier = Tier.JUDGE
    component: ComponentRef = JUDGE_UNDER_TEST

    async def respond(self, context: RoutingContext) -> RoutingDecision:
        assert context.transcript[0]["text"] == "No reconozco un cargo"
        return RoutingDecision(
            outcome=RoutingOutcome.HANDED_OFF,
            tier=self.tier,
            component=self.component,
            reason_code="customer_asked_human",
            inputs_used=("turn",),
            handoff=Handoff(summary="Pidió una persona."),
            component_name="Juez de prueba",
        )


@dataclass(frozen=True)
class BrokenTree:
    tier: Tier = Tier.TREE
    component: ComponentRef = BROKEN_TREE

    async def respond(self, context: RoutingContext) -> RoutingDecision:
        raise RuntimeError("model unavailable")


async def test_a_tier_that_hands_off_stops_the_chain() -> None:
    container = await bare_container()
    container.responders.register(HandingOffJudge())
    case_id = await write(container, NATALIA)
    async with container.uow() as uow:
        steps = await uow.routing_steps.list_for_case(case_id)
        turns = await uow.turns.page(case_id, limit=10)
    assert [(s.tier, s.outcome) for s in steps] == [(Tier.JUDGE, RoutingOutcome.HANDED_OFF)]
    assert steps[0].handoff is not None
    assert steps[0].handoff.summary == "Pidió una persona."
    assert turns[-1].text == "Asignado a Daniela Ríos porque está disponible y habla español."


async def test_a_failing_component_abstains_instead_of_blocking() -> None:
    container = await bare_container()
    container.responders.register(BrokenTree())
    case_id = await write(container, NATALIA)
    async with container.uow() as uow:
        steps = await uow.routing_steps.list_for_case(case_id)
        case = await uow.cases.get(case_id)
    assert [(s.tier, s.reason_code) for s in steps] == [
        (Tier.JUDGE, "component_not_connected"),
        (Tier.TREE, "component_error"),
        (Tier.AI_AGENT, "component_not_connected"),
    ]
    assert case is not None
    assert case.status is CaseStatus.ASSIGNED
