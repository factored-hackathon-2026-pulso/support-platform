"""Slice 1 repositories behave the same on both adapters (contract tests)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest

from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases import (
    OPEN_ASSIGNED_STATUSES,
    CaseStatus,
    CustomerCaseSlot,
    TurnAudience,
)
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.routing.values import Tier
from cc_platform.domain.shared.errors import ConcurrentUpdateError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_customer_id, seed_demo_customers
from cc_platform.infrastructure.seed.people import seed_demo_staff, seed_staff_id
from tests.support import PlainHasher

DANIELA = seed_staff_id(1)


@dataclass
class Harness:
    uow: UnitOfWorkFactory
    clock: FixedClock


@pytest.fixture(params=["memory", "sqlite"])
async def harness(request: pytest.FixtureRequest) -> AsyncIterator[Harness]:
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()
    database: Database | None = None
    if request.param == "memory":
        store = InMemoryStore()

        def factory() -> UnitOfWork:
            return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    else:
        database = Database("sqlite+aiosqlite:///:memory:")
        await database.create_schema()
        session_factory = database.session_factory

        def factory() -> UnitOfWork:
            return SqlAlchemyUnitOfWork(session_factory, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(factory, PlainHasher())
    await seed_demo_customers(factory)
    await seed_demo_cases(factory, ids, clock)
    yield Harness(factory, clock)
    if database is not None:
        await database.dispose()


async def test_case_round_trip_keeps_every_field(harness: Harness) -> None:
    async with harness.uow() as uow:
        web = await uow.cases.get(seed_case_id(101))
        call = await uow.cases.get(seed_case_id(105))
    assert web is not None
    assert call is not None
    assert (web.status, web.version, web.last_sequence, web.assignee_read_sequence) == (
        CaseStatus.IN_PROGRESS,
        1,
        6,
        6,
    )
    assert web.unread_sequences == ()
    assert call.entry_label == "IVR"
    assert call.live_since is not None
    assert call.live_since.tzinfo is not None
    assert call.queue_label == "Cola de disputas"


async def test_queries_by_assignee_status_customer_and_load(harness: Harness) -> None:
    async with harness.uow() as uow:
        mine = await uow.cases.list_for_assignee(DANIELA, OPEN_ASSIGNED_STATUSES)
        to_call = await uow.cases.list_by_status(CaseStatus.TO_CALL)
        latest = await uow.cases.latest_for_customer(seed_customer_id(1004))
        loads = await uow.cases.assignee_loads(OPEN_ASSIGNED_STATUSES)
        nobody = await uow.cases.latest_for_customer(seed_customer_id(2001))
    assert len(mine) == 7
    assert [c.id for c in to_call] == [seed_case_id(106)]
    assert latest is not None
    assert latest.id == seed_case_id(104)
    assert nobody is None
    assert loads[DANIELA].open_cases == 7
    assert loads[DANIELA].last_assigned_at is not None
    assert loads[DANIELA].last_assigned_at.tzinfo is not None


async def test_turn_pages_dedupe_lookup_and_audience(harness: Harness) -> None:
    case_id = seed_case_id(102)
    async with harness.uow() as uow:
        latest = await uow.turns.page(case_id, limit=2)
        before = await uow.turns.page(case_id, limit=10, before=3)
        after = await uow.turns.page(case_id, limit=2, after=2)
        public = await uow.turns.page(case_id, limit=10, audience=TurnAudience.EVERYONE)
        steps = await uow.routing_steps.list_for_case(case_id)
        assignment = await uow.assignments.latest_for_case(case_id)
        missing = await uow.turns.find_by_client_message_id(DANIELA, "nope-0000")
    assert [t.sequence for t in latest] == [5, 6]
    assert [t.sequence for t in before] == [1, 2]
    assert [t.sequence for t in after] == [3, 4]
    assert 3 not in [t.sequence for t in public]  # the staff-only routing banner
    assert [s.tier for s in steps] == [Tier.JUDGE, Tier.TREE]
    assert steps[1].handoff is not None
    assert steps[1].handoff.summary is not None
    assert assignment is not None
    assert assignment.staff_id == DANIELA
    assert missing is None


async def insert_slot_and_commit(uow: UnitOfWork, customer_id: str) -> None:
    """Memory detects the duplicate at ``add``; SQL at ``add`` (flush) or ``commit``."""
    await uow.case_slots.add(CustomerCaseSlot(customer_id=customer_id))
    await uow.commit()


async def test_slot_and_availability_insert_races_are_retryable(harness: Harness) -> None:
    customer = seed_customer_id(2001)
    first, second = harness.uow(), harness.uow()
    async with first as uow_a, second as uow_b:
        await uow_a.case_slots.add(CustomerCaseSlot(customer_id=customer))
        await uow_a.commit()
        with pytest.raises(ConcurrentUpdateError):
            await insert_slot_and_commit(uow_b, customer)

    staff = seed_staff_id(2)
    now = harness.clock.now()
    async with harness.uow() as uow:
        await uow.availability.add(AnalystAvailability(staff, AvailabilityStatus.AVAILABLE, now))
        await uow.commit()
    async with harness.uow() as uow:
        stored = await uow.availability.get(staff)
        listed = await uow.availability.list()
        with pytest.raises(ConcurrentUpdateError):
            await uow.availability.add(AnalystAvailability(staff, AvailabilityStatus.PAUSED, now))
    assert stored is not None
    assert stored.status is AvailabilityStatus.AVAILABLE
    assert [a.staff_id for a in listed] == [staff]


async def test_customers_read_model(harness: Harness) -> None:
    async with harness.uow() as uow:
        customers = await uow.customers.list()
        many = await uow.customers.get_many([seed_customer_id(2004), seed_customer_id(9999)])
    assert [c.id for c in customers] == sorted(c.id for c in customers)
    assert len(customers) == 12
    rafael = many[seed_customer_id(2004)]
    assert (rafael.locale.value, rafael.language.value, rafael.simulator) == ("pt-BR", "pt", True)
    assert len(rafael.suggestions) == 3
    assert list(many) == [seed_customer_id(2004)]
