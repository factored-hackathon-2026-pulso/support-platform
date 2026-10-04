"""Escalations to supervision (slice 9) over the real composition and both persistence
adapters: who escalates, withdraws, answers, takes; reassigning and closing end it; "Entendido";
"Escalados"; and races on an in-memory Unit of Work that yields before commit.

Seed (``infrastructure/seed/cases.py``): Daniela's 101 and Julián's 113 are open escalations,
Daniela's 107 was answered by Lucía, Paula's 114 ended when Lucía reassigned it to Julián.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.cases.dto import CloseCaseCommand
from cc_platform.application.cases.errors import AnalystNotEligibleError, CaseNotAssignedError
from cc_platform.application.cases.escalations import (
    EscalateCase,
    EscalateCommand,
    RespondEscalation,
    WithdrawEscalation,
)
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.cases import (
    CaseClosedError,
    CloseReason,
    EscalationNotOpenError,
    EscalationOpenError,
    EscalationState,
    LanguageMismatchError,
    TurnAudience,
    TurnKind,
)
from cc_platform.domain.shared.errors import (
    InvalidTransitionError,
    InvalidValueError,
    NotFoundError,
)
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.seed.cases import (
    seed_case_id,
    seed_demo_cases,
    seed_escalation_id,
)
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
)
from tests.support import (
    ANALYST,
    JULIAN,
    SUPERVISOR,
    TEAM_LEAD,
    PlainHasher,
    actor_for,
    customer_actor,
    make_settings,
)

MARCELA, CAMILA, JOAQUIN, ESTEBAN, PATRICIA, LARISSA, CLAUDIA = (
    seed_case_id(n) for n in (101, 113, 107, 114, 108, 103, 105)
)
ESC_MARCELA, ESC_CAMILA, ESC_JOAQUIN, ESC_ESTEBAN = (
    seed_escalation_id(n) for n in (101, 113, 107, 114)
)
DANIELA_ID, JULIAN_ID, LUCIA_ID, FELIPE_ID = (
    seed_staff_id(n) for n in (ANALYST.number, JULIAN.number, SUPERVISOR.number, 11)
)
DANIELA, JULIAN_A, LUCIA, FELIPE = (
    actor_for(seed) for seed in (ANALYST, JULIAN, SUPERVISOR, TEAM_LEAD)
)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'escalations.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


def escalate(
    motive: str = "La clienta pide hablar con supervisión.", key: str = "esc-k-001"
) -> EscalateCommand:
    return EscalateCommand(motive=motive, idempotency_key=key)


async def event_types(container: Container, case_id: str) -> list[str]:
    async with container.uow() as uow:
        page = await uow.event_log.page(case_id=case_id, limit=500)
    return [e.event_type for e in page.items]


async def last_turn(container: Container, case_id: str) -> tuple[TurnKind, TurnAudience, str]:
    page = await container.use_cases.cases.turns.execute(LUCIA, case_id)
    turn = page.items[-1]
    return (turn.kind, turn.audience, turn.text)


# ----------------------------------------------------------------------------- escalate
async def test_the_assignee_escalates_and_keeps_the_case(world: Container) -> None:
    cases = world.use_cases.cases
    result = await cases.escalate.execute(DANIELA, PATRICIA, escalate("  Pide supervisión.  "))
    view = result.escalation
    assert (view.state, view.motive, view.case_id) == (
        EscalationState.OPEN,
        "Pide supervisión.",
        PATRICIA,
    )
    assert (view.escalated_by_id, view.escalated_by_name) == (DANIELA_ID, "Daniela Ríos")
    assert view.customer_name == "Patricia Lozano Vega"
    assert (result.case.escalated, result.case.assigned_analyst_id) == (True, DANIELA_ID)
    assert await last_turn(world, PATRICIA) == (
        TurnKind.ROUTING,
        TurnAudience.STAFF,
        "Daniela Ríos escaló el caso a supervisión.",
    )
    assert (await event_types(world, PATRICIA))[-2:] == ["escalation.opened", "turn.created"]
    detail = await cases.detail.execute(DANIELA, PATRICIA)
    assert detail.escalation is not None
    assert detail.escalation.id == view.id
    assert (detail.case.escalated, detail.capabilities.can_escalate) == (True, False)
    # The customer never sees it.
    conversation = await cases.customer_conversation.execute(customer_actor(1004))
    assert all("escal" not in turn.text for turn in conversation.turns)


async def test_a_retry_with_the_same_key_replays_it(world: Container) -> None:
    cases = world.use_cases.cases
    first = await cases.escalate.execute(DANIELA, PATRICIA, escalate(key="esc-same-1"))
    again = await cases.escalate.execute(DANIELA, PATRICIA, escalate(key="esc-same-1"))
    assert (again.replayed, again.escalation.id) == (True, first.escalation.id)
    assert (await event_types(world, PATRICIA)).count("escalation.opened") == 1
    with pytest.raises(InvalidValueError):  # the same key for another case
        await cases.escalate.execute(DANIELA, LARISSA, escalate(key="esc-same-1"))


async def test_one_open_escalation_per_case(world: Container) -> None:
    with pytest.raises(EscalationOpenError) as raised:
        await world.use_cases.cases.escalate.execute(DANIELA, MARCELA, escalate())
    assert raised.value.details == {"escalationId": ESC_MARCELA}


@pytest.mark.parametrize("who", ["julian", "lucia", "felipe"])
async def test_only_the_assignee_escalates(world: Container, who: str) -> None:
    actor = {"julian": JULIAN_A, "lucia": LUCIA, "felipe": FELIPE}[who]
    with pytest.raises(CaseNotAssignedError):
        await world.use_cases.cases.escalate.execute(actor, PATRICIA, escalate())


async def test_a_closed_case_cannot_be_escalated(world: Container) -> None:
    with pytest.raises(CaseClosedError):
        await world.use_cases.cases.escalate.execute(DANIELA, CLAUDIA, escalate())


@pytest.mark.parametrize("motive", ["   ", "x" * 501])
async def test_the_motive_is_required(world: Container, motive: str) -> None:
    with pytest.raises(InvalidValueError):
        await world.use_cases.cases.escalate.execute(DANIELA, PATRICIA, escalate(motive))


# ----------------------------------------------------------------------------- withdraw
async def test_the_assignee_withdraws_while_it_is_open(world: Container) -> None:
    cases = world.use_cases.cases
    with pytest.raises(CaseNotAssignedError):
        await cases.withdraw_escalation.execute(JULIAN_A, MARCELA, ESC_MARCELA)
    with pytest.raises(NotFoundError):  # an escalation of another case
        await cases.withdraw_escalation.execute(DANIELA, MARCELA, ESC_CAMILA)
    result = await cases.withdraw_escalation.execute(DANIELA, MARCELA, ESC_MARCELA)
    assert (result.escalation.state, result.case.escalated) == (EscalationState.WITHDRAWN, False)
    assert result.escalation.resolved_by_id == DANIELA_ID
    assert (await last_turn(world, MARCELA))[2] == "Daniela Ríos retiró el escalamiento."
    with pytest.raises(EscalationNotOpenError) as raised:
        await cases.withdraw_escalation.execute(DANIELA, MARCELA, ESC_MARCELA)
    assert raised.value.details == {"currentState": "withdrawn"}
    # Withdrawn ones leave "Escalados"; she may escalate it again.
    overview = await cases.escalation_overview.execute(LUCIA)
    assert ESC_MARCELA not in {item.escalation.id for item in overview.items}
    again = await cases.escalate.execute(DANIELA, MARCELA, escalate(key="esc-again-1"))
    assert again.escalation.id != ESC_MARCELA


# ----------------------------------------------------------------------------- respond
async def test_supervision_answers_and_the_case_stays_with_the_analyst(world: Container) -> None:
    cases = world.use_cases.cases
    with pytest.raises(InvalidValueError):
        await cases.respond_escalation.execute(LUCIA, ESC_CAMILA, "   ")
    result = await cases.respond_escalation.execute(LUCIA, ESC_CAMILA, " Sigue tú con ella. ")
    view = result.escalation
    assert (view.state, view.note, view.resolved_by_name) == (
        EscalationState.ANSWERED,
        "Sigue tú con ella.",
        "Lucía Herrera",
    )
    assert (result.case.assigned_analyst_id, result.case.escalated) == (JULIAN_ID, False)
    assert (await last_turn(world, CAMILA))[2] == "Lucía Herrera respondió el escalamiento."
    with pytest.raises(EscalationNotOpenError):
        await cases.respond_escalation.execute(LUCIA, ESC_CAMILA, "Otra vez")
    for unknown in (seed_escalation_id(999), "nope"):
        with pytest.raises(NotFoundError):
            await cases.respond_escalation.execute(LUCIA, unknown, "Hola")


# ----------------------------------------------------------------------------- take
async def test_a_supervisor_who_is_also_an_analyst_takes_the_case(world: Container) -> None:
    cases = world.use_cases.cases
    result = await cases.take_escalated_case.execute(FELIPE, ESC_MARCELA)
    assert (result.escalation.state, result.escalation.reassigned_to_id) == (
        EscalationState.TAKEN,
        FELIPE_ID,
    )
    assert (result.case.assigned_analyst_id, result.case.escalated) == (FELIPE_ID, False)
    page = await cases.turns.execute(LUCIA, MARCELA)
    assert [(t.kind, t.text) for t in page.items[-2:]] == [
        (TurnKind.ROUTING, "Felipe Echeverri tomó el caso de Daniela Ríos."),
        (TurnKind.NOTICE, "Ahora te atiende Felipe, de nuestro equipo."),
    ]
    types = await event_types(world, MARCELA)
    assert "escalation.taken" in types
    assert "case.assigned" in types
    detail = await cases.detail.execute(FELIPE, MARCELA)
    assert detail.assignment is not None
    assert (detail.assignment.previous_analyst_id, detail.assignment.assigned_by_name) == (
        DANIELA_ID,
        "Felipe Echeverri",
    )
    # Daniela keeps reading it (history access) and acknowledges what happened.
    read = await cases.acknowledge_escalation.execute(DANIELA, MARCELA, ESC_MARCELA)
    assert read.escalation.acknowledged_at is not None


async def test_taking_is_only_for_analysts_who_speak_the_language(world: Container) -> None:
    cases = world.use_cases.cases
    with pytest.raises(AnalystNotEligibleError):  # Lucía holds only Supervisión
        await cases.take_escalated_case.execute(LUCIA, ESC_MARCELA)
    portuguese = await cases.escalate.execute(DANIELA, LARISSA, escalate(key="esc-pt-0001"))
    with pytest.raises(LanguageMismatchError):  # Felipe speaks only Spanish (rule 3)
        await cases.take_escalated_case.execute(FELIPE, portuguese.escalation.id)
    with pytest.raises(EscalationNotOpenError):
        await cases.take_escalated_case.execute(FELIPE, ESC_JOAQUIN)  # already answered


# ----------------------------------------------------------------------------- reassign, close
async def test_reassigning_the_case_ends_the_escalation(world: Container) -> None:
    cases = world.use_cases.cases
    await cases.set_assignee.execute(
        LUCIA, MARCELA, SetAssigneeCommand(JULIAN_ID, DANIELA_ID, confirm_paused=True)
    )
    detail = await cases.detail.execute(LUCIA, MARCELA)
    assert detail.escalation is not None
    assert (detail.escalation.state, detail.escalation.reassigned_to_name) == (
        EscalationState.REASSIGNED,
        "Julián Ortega",
    )
    assert detail.case.escalated is False


async def test_closing_the_case_ends_the_escalation(world: Container) -> None:
    cases = world.use_cases.cases
    await cases.close.execute(DANIELA, MARCELA, CloseCaseCommand(CloseReason.RESOLVED))
    detail = await cases.detail.execute(DANIELA, MARCELA)
    assert detail.escalation is not None
    assert detail.escalation.state is EscalationState.CLOSED
    assert detail.case.escalated is False
    overview = await cases.escalation_overview.execute(LUCIA)
    assert ESC_MARCELA not in {item.escalation.id for item in overview.items}


# ----------------------------------------------------------------------------- "Entendido"
async def test_only_who_escalated_acknowledges_once(world: Container) -> None:
    cases = world.use_cases.cases
    with pytest.raises(CaseNotAssignedError):  # Lucía may read 107, but did not escalate it
        await cases.acknowledge_escalation.execute(LUCIA, JOAQUIN, ESC_JOAQUIN)
    first = await cases.acknowledge_escalation.execute(DANIELA, JOAQUIN, ESC_JOAQUIN)
    again = await cases.acknowledge_escalation.execute(DANIELA, JOAQUIN, ESC_JOAQUIN)
    assert first.escalation.acknowledged_at == again.escalation.acknowledged_at is not None
    assert (await event_types(world, JOAQUIN)).count("escalation.acknowledged") == 1
    with pytest.raises(InvalidTransitionError):  # still open: nothing to acknowledge
        await cases.acknowledge_escalation.execute(DANIELA, MARCELA, ESC_MARCELA)


# ----------------------------------------------------------------------------- read side
async def test_the_case_detail_carries_the_latest_escalation(world: Container) -> None:
    detail = await world.use_cases.cases.detail.execute(DANIELA, JOAQUIN)
    escalation = detail.escalation
    assert escalation is not None
    assert (escalation.state, escalation.resolved_by_name, escalation.acknowledged_at) == (
        EscalationState.ANSWERED,
        "Lucía Herrera",
        None,
    )
    assert escalation.note is not None
    assert escalation.note.startswith("Revisé el reclamo")
    assert (await world.use_cases.cases.detail.execute(DANIELA, PATRICIA)).escalation is None
    assert (await world.use_cases.cases.detail.execute(DANIELA, PATRICIA)).capabilities.can_escalate


async def test_escalados_lists_open_first_then_the_attended_ones(world: Container) -> None:
    overview = await world.use_cases.cases.escalation_overview.execute(LUCIA)
    assert [(item.escalation.id, item.escalation.state) for item in overview.items] == [
        (ESC_CAMILA, EscalationState.OPEN),  # waiting 21 min
        (ESC_MARCELA, EscalationState.OPEN),  # waiting 6 min
        (ESC_ESTEBAN, EscalationState.REASSIGNED),  # attended 32 min ago
        (ESC_JOAQUIN, EscalationState.ANSWERED),  # attended 35 min ago
    ]
    assert overview.open_count == 2
    camila = overview.items[0]
    assert (camila.assignee_name, camila.case.id, camila.can_take) == (
        "Julián Ortega",
        CAMILA,
        False,
    )
    felipe = await world.use_cases.cases.escalation_overview.execute(FELIPE)
    assert [item.can_take for item in felipe.items] == [True, True, False, False]


# ----------------------------------------------------------------------------- races
class YieldingUnitOfWork(InMemoryUnitOfWork):
    async def commit(self) -> None:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await super().commit()


async def racing_kit() -> tuple[InMemoryStore, EscalateCase, WithdrawEscalation, RespondEscalation]:
    clock, ids, bus, store = (
        FixedClock(),
        SequentialIdGenerator(),
        InProcessEventBus(),
        InMemoryStore(),
    )

    def uow() -> UnitOfWork:
        return YieldingUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(uow, PlainHasher())
    await seed_demo_customers(uow)
    await seed_demo_availability(uow, clock)
    await seed_demo_cases(uow, ids, clock)
    return (
        store,
        EscalateCase(uow, clock, ids),
        WithdrawEscalation(uow, clock, ids),
        RespondEscalation(uow, clock, ids),
    )


async def test_two_escalations_of_one_case_at_once_leave_one_open() -> None:
    store, escalate_case, _withdraw, _respond = await racing_kit()
    results = await asyncio.gather(
        escalate_case.execute(DANIELA, PATRICIA, escalate(key="race-key-1")),
        escalate_case.execute(DANIELA, PATRICIA, escalate(key="race-key-2")),
        return_exceptions=True,
    )
    winners = [r for r in results if not isinstance(r, BaseException)]
    losers = [r for r in results if isinstance(r, BaseException)]
    assert (len(winners), len(losers)) == (1, 1)
    assert isinstance(losers[0], EscalationOpenError)
    assert store.cases[PATRICIA].open_escalation_id == winners[0].escalation.id
    opened = [e for e in store.escalations.values() if e.case_id == PATRICIA]
    assert len(opened) == 1


async def test_a_withdrawal_racing_an_answer_ends_it_once() -> None:
    store, _escalate, withdraw, respond = await racing_kit()
    results = await asyncio.gather(
        withdraw.execute(DANIELA, MARCELA, ESC_MARCELA),
        respond.execute(LUCIA, ESC_MARCELA, "Sigue tú."),
        return_exceptions=True,
    )
    losers = [r for r in results if isinstance(r, BaseException)]
    assert len(losers) == 1
    assert isinstance(losers[0], EscalationNotOpenError)
    final = store.escalations[ESC_MARCELA]
    assert final.state in {EscalationState.WITHDRAWN, EscalationState.ANSWERED}
    assert store.cases[MARCELA].open_escalation_id is None
    ends = [
        e
        for e in store.events
        if e.case_id == MARCELA and e.event_type in {"escalation.withdrawn", "escalation.answered"}
    ]
    assert len(ends) == 1
