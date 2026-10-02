"""Optimistic concurrency of slice 1 commands (in-memory UoW that yields before commit, so
concurrent commands really interleave between their read and their write)."""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from dataclasses import dataclass

from cc_platform.application.cases.commands import CloseCase, PostAnalystTurn
from cc_platform.application.cases.customer_chat import PostCustomerTurn
from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.sla import SyntheticSlaPolicy
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.routing.assignment import (
    LanguageLeastLoadedPolicy,
    RepositoryAnalystDirectory,
)
from cc_platform.application.routing.route_case import DrainQueue, HumanTier, RouteCase
from cc_platform.domain.cases import (
    CaseClosedError,
    CaseStatus,
    ContactReason,
    FollowUp,
    TurnKind,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.routing.null_responders import null_ai_agent, null_judge, null_tree
from cc_platform.infrastructure.routing.registry import InMemoryResponderRegistry
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import seed_demo_availability, seed_demo_staff
from tests.support import ANALYST, PlainHasher, actor_for, customer_actor


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
    route: RouteCase
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
    responders = InMemoryResponderRegistry()
    for responder in (null_judge(), null_tree(), null_ai_agent()):
        responders.register(responder)
    human = HumanTier(clock, ids, LanguageLeastLoadedPolicy(), RepositoryAnalystDirectory())
    return Kit(
        store=store,
        uow=uow,
        post_customer=PostCustomerTurn(uow, clock, ids, SyntheticSlaPolicy()),
        post_analyst=PostAnalystTurn(uow, clock, ids),
        close=CloseCase(uow, clock, ids),
        route=RouteCase(uow, clock, ids, responders, human),
        drain=DrainQueue(uow, human),
    )


def message(text: str, client_message_id: str | None = None) -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=client_message_id or str(uuid.uuid4()))


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
    assert sequences == list(range(1, 10))  # 8 messages + 1 notice, gap-free
    assert len([c for c in k.store.cases.values() if c.customer_id == natalia.customer_id]) == 1


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


async def test_parallel_replies_and_a_close_never_write_after_the_close() -> None:
    k = await kit()
    daniela = actor_for(ANALYST)
    case_id = seed_case_id(102)
    close = CloseCaseCommand(
        resolved=True,
        contact_reason=ContactReason.QUEJA,
        resolution_code=None,
        follow_up=FollowUp.NONE,
        send_csat_survey=False,
    )
    outcomes = await asyncio.gather(
        *(k.post_analyst.execute(daniela, case_id, message(f"Respuesta {i}")) for i in range(4)),
        k.close.execute(daniela, case_id, close),
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


async def test_two_analysts_draining_the_queue_assign_each_case_once() -> None:
    k = await kit()
    # Nobody available: three new cases wait in the queue.
    async with k.uow() as uow:
        for availability in await uow.availability.list():
            if availability.is_available:
                availability.change(
                    AvailabilityStatus.PAUSED,
                    now=availability.since,
                    actor=actor_for(ANALYST).acting_as(),
                )
                await uow.availability.save(availability)
        await uow.commit()
    case_ids = []
    for number in (2001, 2002, 2003):
        result = await k.post_customer.execute(customer_actor(number), message("Hola"))
        await k.route.execute(result.conversation.case_id)
        case_ids.append(result.conversation.case_id)
    assert {k.store.cases[c].status for c in case_ids} == {CaseStatus.QUEUED}

    async with k.uow() as uow:
        for availability in await uow.availability.list():
            availability.change(
                AvailabilityStatus.AVAILABLE,
                now=availability.since,
                actor=actor_for(ANALYST).acting_as(),
            )
            await uow.availability.save(availability)
        await uow.commit()
    drained = await asyncio.gather(k.drain.execute(), k.drain.execute())
    assert sum(drained) == 3
    assert {k.store.cases[c].status for c in case_ids} == {CaseStatus.ASSIGNED}
    per_case = Counter(a.case_id for a in k.store.assignments.values() if a.case_id in case_ids)
    assert per_case == dict.fromkeys(case_ids, 1)
