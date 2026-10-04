"""Slice 12 use cases: calls racing a close, a second call or themselves (an in-memory Unit of
Work that yields before commit, so concurrent commands interleave), and the email reply frame.
"""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from dataclasses import dataclass

from cc_platform.application.cases.assignment import (
    AssignCase,
    LanguageLeastLoadedStrategy,
    RepositoryAnalystDirectory,
)
from cc_platform.application.cases.calls import (
    AnswerCall,
    HangUpCall,
    StartInboundCall,
    StartOutboundCall,
)
from cc_platform.application.cases.commands import CloseCase
from cc_platform.application.cases.dto import (
    CloseCaseCommand,
    CustomerEmailCommand,
    EmailReplyCommand,
    StartOutboundCallCommand,
)
from cc_platform.application.cases.emails import ReplyEmail, SendCustomerEmail
from cc_platform.application.cases.sla import FirstResponseSlaPolicy
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases import CallState, CaseStatus, CloseReason
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import seed_demo_availability, seed_demo_staff
from tests.support import ANALYST, PlainHasher, actor_for, customer_actor, make_available_quietly
from tests.unit.application.test_cases_concurrency import YieldingUnitOfWork

PATRICIA_NEW = seed_case_id(108)
CLOSE = CloseCaseCommand(reason=CloseReason.RESOLVED, note=None)
DANIELA = actor_for(ANALYST)


@dataclass
class Kit:
    store: InMemoryStore
    uow: UnitOfWorkFactory
    outbound: StartOutboundCall
    inbound: StartInboundCall
    answer: AnswerCall
    hang_up: HangUpCall
    close: CloseCase
    send_email: SendCustomerEmail
    reply_email: ReplyEmail


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
    sla = FirstResponseSlaPolicy()
    return Kit(
        store=store,
        uow=uow,
        outbound=StartOutboundCall(uow, clock, ids),
        inbound=StartInboundCall(uow, clock, ids, sla, assign),
        answer=AnswerCall(uow, clock),
        hang_up=HangUpCall(uow, clock, ids),
        close=CloseCase(uow, clock, ids),
        send_email=SendCustomerEmail(uow, clock, ids, sla, assign),
        reply_email=ReplyEmail(uow, clock, ids),
    )


def call_command(reason: str = "Seguimiento") -> StartOutboundCallCommand:
    return StartOutboundCallCommand(reason=reason, idempotency_key=str(uuid.uuid4()))


async def test_a_call_and_a_close_never_leave_a_closed_case_with_an_active_call() -> None:
    k = await kit()
    outcomes = await asyncio.gather(
        k.outbound.execute(DANIELA, PATRICIA_NEW, call_command()),
        k.close.execute(DANIELA, PATRICIA_NEW, CLOSE),
        return_exceptions=True,
    )
    names = Counter(type(o).__name__ for o in outcomes)
    case = k.store.cases[PATRICIA_NEW]
    calls = [c for c in k.store.calls.values() if c.case_id == PATRICIA_NEW]
    # Exactly one wins: either the call started (the close is refused) or the case closed
    # (the call is refused); both re-check on fresh state after the compare-and-set.
    assert names in (
        Counter({"CallResult": 1, "CallInProgressError": 1}),
        Counter({"CaseDetailView": 1, "CaseClosedError": 1}),
    )
    if case.status is CaseStatus.CLOSED:
        assert calls == []
    else:
        assert [c.state for c in calls] == [CallState.RINGING]
        assert case.active_call_id == calls[0].id


async def test_a_hang_up_racing_a_close_keeps_the_invariant() -> None:
    k = await kit()
    started = await k.outbound.execute(DANIELA, PATRICIA_NEW, call_command())
    call_id = started.call.id
    outcomes = await asyncio.gather(
        k.hang_up.execute(DANIELA, PATRICIA_NEW, call_id),
        k.close.execute(DANIELA, PATRICIA_NEW, CLOSE),
        return_exceptions=True,
    )
    assert type(outcomes[0]).__name__ == "CallResult"  # the hang-up always lands
    case, call = k.store.cases[PATRICIA_NEW], k.store.calls[call_id]
    assert call.state is CallState.ENDED
    assert case.active_call_id is None
    # The close either saw the call (409 call_in_progress) or ran after the hang-up.
    assert type(outcomes[1]).__name__ in {"CaseDetailView", "CallInProgressError"}
    assert (case.status is CaseStatus.CLOSED) == (type(outcomes[1]).__name__ == "CaseDetailView")


async def test_two_outbound_calls_at_once_start_one() -> None:
    k = await kit()
    outcomes = await asyncio.gather(
        *(k.outbound.execute(DANIELA, PATRICIA_NEW, call_command()) for _ in range(3)),
        return_exceptions=True,
    )
    assert Counter(type(o).__name__ for o in outcomes) == {
        "CallResult": 1,
        "CallInProgressError": 2,
    }
    assert len([c for c in k.store.calls.values() if c.case_id == PATRICIA_NEW]) == 1


async def test_the_same_call_request_twice_is_one_call() -> None:
    k = await kit()
    await make_available_quietly(k.uow, DANIELA.staff_id)
    natalia = customer_actor(2001)
    results = await asyncio.gather(
        k.inbound.execute(natalia, "same-key-0001"), k.inbound.execute(natalia, "same-key-0001")
    )
    assert {r.call.id for r in results} == {results[0].call.id}
    assert sorted(r.replayed for r in results) == [False, True]
    mine = [c for c in k.store.cases.values() if c.customer_id == natalia.customer_id]
    assert len(mine) == 1
    assert mine[0].channel.value == "phone_inbound"


async def test_answering_twice_answers_once_and_counts_one_first_response() -> None:
    k = await kit()
    await make_available_quietly(k.uow, DANIELA.staff_id)
    started = await k.inbound.execute(customer_actor(2001), "ring-key-0001")
    case_id = started.call.case_id
    outcomes = await asyncio.gather(
        k.answer.execute(DANIELA, case_id, started.call.id),
        k.answer.execute(DANIELA, case_id, started.call.id),
        return_exceptions=True,
    )
    assert Counter(type(o).__name__ for o in outcomes) == {
        "CallResult": 1,
        "InvalidTransitionError": 1,
    }
    responded = [e for e in k.store.events if e.event_type == "case.first_responded"]
    assert [e.case_id for e in responded if e.case_id == case_id] == [case_id]


async def test_an_email_reply_is_framed_and_threads_the_subject() -> None:
    k = await kit()
    await make_available_quietly(k.uow, DANIELA.staff_id)
    sent = await k.send_email.execute(
        customer_actor(2003),
        CustomerEmailCommand(
            subject="  Cobro   doble ", body="¿Me ayudás?", client_message_id="mail-0001"
        ),
    )
    assert sent.email.subject == "Cobro doble"  # one line, trimmed
    reply = await k.reply_email.execute(
        DANIELA,
        sent.conversation.case_id,
        EmailReplyCommand(body="  Ya lo vemos.  ", client_message_id="mail-0002"),
    )
    assert reply.email.subject == "Re: Cobro doble"
    assert reply.email.body == "Hola, Lucas:\n\nYa lo vemos.\n\nSaludos,\nDaniela Ríos\nLATAM Bank"
    assert reply.case.first_response_at == reply.email.created_at
