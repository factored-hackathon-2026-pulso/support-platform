"""Optimistic concurrency of the case lifecycle (in-memory UoW that yields before commit, so
concurrent commands really interleave between their read and their write)."""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from dataclasses import dataclass

import pytest

from cc_platform.application.cases.assignment import (
    AssignCase,
    DrainQueue,
    LanguageLeastLoadedStrategy,
    RepositoryAnalystDirectory,
)
from cc_platform.application.cases.commands import CloseCase, PostAnalystTurn
from cc_platform.application.cases.customer_chat import PostCustomerTurn
from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.sla import FirstResponseSlaPolicy
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases import (
    CaseClosedError,
    CaseStatus,
    CloseReason,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import seed_demo_availability, seed_demo_staff
from tests.support import ANALYST, PlainHasher, actor_for, customer_actor

MARCELA = seed_case_id(101)
CLOSE = CloseCaseCommand(reason=CloseReason.RESOLVED, note=None)


class YieldingUnitOfWork(InMemoryUnitOfWork):
    async def commit(self) -> None:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await super().commit()


@dataclass
class Kit:
    store: InMemoryStore
    uow: UnitOfWorkFactory
    post_customer: PostCustomerTurn
    post_analyst: PostAnalystTurn
    close: CloseCase
    drain: DrainQueue


async def kit() -> Kit:
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
    assign = AssignCase(clock, ids, LanguageLeastLoadedStrategy(), RepositoryAnalystDirectory())
    return Kit(
        store=store,
        uow=uow,
        post_customer=PostCustomerTurn(uow, clock, ids, FirstResponseSlaPolicy(), assign),
        post_analyst=PostAnalystTurn(uow, clock, ids),
        close=CloseCase(uow, clock, ids),
        drain=DrainQueue(uow, assign),
    )


def message(text: str, client_message_id: str | None = None) -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=client_message_id or str(uuid.uuid4()))


async def set_everyone(k: Kit, status: AvailabilityStatus) -> None:
    async with k.uow() as uow:
        for availability in await uow.availability.list():
            if availability.change(
                status, now=availability.since, actor=actor_for(ANALYST).acting_as()
            ):
                await uow.availability.save(availability)
        await uow.commit()


async def test_concurrent_first_messages_open_exactly_one_case() -> None:
    k = await kit()
    natalia = customer_actor(2001)
    results = await asyncio.gather(
        *(k.post_customer.execute(natalia, message(f"Mensaje {i}")) for i in range(8))
    )
    assert {r.conversation.case_id for r in results} == {results[0].conversation.case_id}
    assert sum(r.case_created for r in results) == 1
    case_id = results[0].conversation.case_id
    sequences = sorted(t.sequence for t in k.store.turns.values() if t.case_id == case_id)
    assert sequences == list(range(1, 11))  # 8 messages + notice + assignment banner, gap-free
    assert len([c for c in k.store.cases.values() if c.customer_id == natalia.customer_id]) == 1
    assert len([a for a in k.store.assignments.values() if a.case_id == case_id]) == 1


async def test_double_send_creates_one_turn() -> None:
    k = await kit()
    command = message("Hola, Beatriz. Ya la atiendo.")
    daniela = actor_for(ANALYST)
    results = await asyncio.gather(
        *(k.post_analyst.execute(daniela, seed_case_id(102), command) for _ in range(5))
    )
    assert len({r.turn.id for r in results}) == 1
    assert Counter(r.replayed for r in results) == {True: 4, False: 1}
    matching = [
        t for t in k.store.turns.values() if t.client_message_id == command.client_message_id
    ]
    assert len(matching) == 1


async def test_double_close_closes_once() -> None:
    k = await kit()
    daniela = actor_for(ANALYST)
    outcomes = await asyncio.gather(
        *(k.close.execute(daniela, MARCELA, CLOSE) for _ in range(3)), return_exceptions=True
    )
    assert Counter(type(o).__name__ for o in outcomes) == {
        "CaseDetailView": 1,
        "CaseClosedError": 2,
    }
    notices = [
        t
        for t in k.store.turns.values()
        if t.case_id == MARCELA and t.kind is TurnKind.NOTICE and t.sequence > 2
    ]
    assert len(notices) == 1  # one closed notice
    closed = [e for e in k.store.events if e.event_type == "case.closed"]
    assert [e.case_id for e in closed if e.case_id == MARCELA] == [MARCELA]


async def test_parallel_replies_and_a_close_never_write_after_the_close() -> None:
    k = await kit()
    daniela = actor_for(ANALYST)
    case_id = seed_case_id(102)
    outcomes = await asyncio.gather(
        *(k.post_analyst.execute(daniela, case_id, message(f"Respuesta {i}")) for i in range(4)),
        k.close.execute(daniela, case_id, CLOSE),
        return_exceptions=True,
    )
    assert not [
        o for o in outcomes if isinstance(o, Exception) and not isinstance(o, CaseClosedError)
    ]
    turns = sorted(
        (t for t in k.store.turns.values() if t.case_id == case_id), key=lambda t: t.sequence
    )
    assert [t.sequence for t in turns] == list(range(1, len(turns) + 1))
    assert turns[-1].kind is TurnKind.NOTICE  # the closing notice is the last turn
    assert k.store.cases[case_id].status is CaseStatus.CLOSED


@pytest.mark.parametrize("close_first", [True, False], ids=["close-wins", "message-wins"])
async def test_close_racing_the_customers_next_message_loses_nothing(close_first: bool) -> None:
    """Both start from the same state; the case's compare-and-set lets one commit. If the
    message wins, it stays in the old case and the closed notice follows it; if the close
    wins, the message retries, finds the slot free and opens a new linked case."""
    k = await kit()
    marcela = customer_actor(1001)
    close = k.close.execute(actor_for(ANALYST), MARCELA, CLOSE)
    post = k.post_customer.execute(marcela, message("¿Sigue ahí?"))
    if close_first:
        closed, posted = await asyncio.gather(close, post)
    else:
        posted, closed = await asyncio.gather(post, close)
    assert closed.case.status is CaseStatus.CLOSED
    old = sorted(
        (t for t in k.store.turns.values() if t.case_id == MARCELA), key=lambda t: t.sequence
    )
    assert old[-1].kind is TurnKind.NOTICE  # nothing is ever written after the close
    in_old = [t for t in old if t.text == "¿Sigue ahí?"]
    slot = k.store.case_slots[marcela.customer_id]
    if close_first:
        assert posted.case_created
        assert in_old == []
        assert posted.conversation.previous_case_id == MARCELA
        assert slot.open_case_id == posted.conversation.case_id
    else:
        assert not posted.case_created
        assert posted.conversation.case_id == MARCELA
        assert len(in_old) == 1
        assert slot.open_case_id is None
    customer_messages = [
        t
        for t in k.store.turns.values()
        if t.text == "¿Sigue ahí?" and t.author_role is TurnAuthorRole.CUSTOMER
    ]
    assert len(customer_messages) == 1  # never lost, never duplicated


async def test_two_drains_assign_each_queued_case_once() -> None:
    k = await kit()
    await set_everyone(k, AvailabilityStatus.PAUSED)
    case_ids = []
    for number in (2001, 2002, 2003):
        result = await k.post_customer.execute(customer_actor(number), message("Hola"))
        case_ids.append(result.conversation.case_id)
    assert {k.store.cases[c].status for c in case_ids} == {CaseStatus.QUEUED}

    await set_everyone(k, AvailabilityStatus.AVAILABLE)
    drained = await asyncio.gather(k.drain.execute(), k.drain.execute())
    assert sum(drained) == 4  # the three new ones + the seeded Portuguese case (109)
    assert {k.store.cases[c].status for c in case_ids} == {CaseStatus.ASSIGNED}
    per_case = Counter(a.case_id for a in k.store.assignments.values() if a.case_id in case_ids)
    assert per_case == dict.fromkeys(case_ids, 1)
