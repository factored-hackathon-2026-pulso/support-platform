"""``CopilotSuggestion`` persistence behaves the same on both adapters (ADR 0005)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta

import pytest

from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.ai.suggestion import (
    DRAFT_TTL,
    ActionSuggestion,
    CopilotSuggestion,
    EscalationSuggestion,
    ReplyDecision,
    ReplySuggestion,
    SuggestionStatus,
    SuggestionTrigger,
    ToolSuggestion,
    text_hash,
)
from cc_platform.domain.shared.errors import ConcurrentUpdateError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import seed_demo_staff, seed_staff_id
from tests.support import PlainHasher

DANIELA = seed_staff_id(1)
FELIPE = seed_staff_id(2)
CASE = seed_case_id(101)
OTHER_CASE = seed_case_id(102)
DRAFT = "Marcela, revisé el retiro y lo estamos validando."


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


def make(
    n: int,
    *,
    case_id: str = CASE,
    analyst_id: str = DANIELA,
    key: str | None = None,
    at_offset: timedelta = timedelta(0),
    clock: FixedClock | None = None,
) -> CopilotSuggestion:
    now = (clock or FixedClock()).now() + at_offset
    return CopilotSuggestion.request(
        suggestion_id=f"CPS-{n:026d}",
        case_id=case_id,
        analyst_id=analyst_id,
        agent="copiloto-sugerencias@prod",
        trigger=SuggestionTrigger.MANUAL if key else SuggestionTrigger.CUSTOMER_MESSAGE,
        based_on_sequence=3,
        request_key=key,
        at=now,
    )


def answer(suggestion: CopilotSuggestion, harness: Harness) -> None:
    suggestion.record_answer(
        raw=[
            ReplySuggestion(text=DRAFT, citations=("f1",), language="es"),
            ToolSuggestion(tool="leer_movimientos@1", label="Movimientos", why="Ver el retiro"),
            ActionSuggestion(tool="radicar_pqr@1", summary="Radicar una disputa"),
            EscalationSuggestion(
                reason_code="policy:fraude",
                evidence=("Dice que no lo hizo",),
                motive_draft="Fraude",
            ),
        ],
        run_id="run-1",
        trace_id="trace-1",
        at=harness.clock.now(),
    )


async def test_a_suggestion_round_trips_with_its_four_kinds(harness: Harness) -> None:
    s = make(1, key="k-1")
    answer(s, harness)
    s.escalation_taken(at=harness.clock.now())
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(s)
        await uow.commit()

    async with harness.uow() as uow:
        found = await uow.copilot_suggestions.get(s.id)

    assert found is not None
    assert found.status is SuggestionStatus.READY
    assert found.items == s.items
    assert found.kinds == ("reply", "tool", "action", "escalate")
    assert found.tool_ids == ("leer_movimientos@1", "radicar_pqr@1")
    assert found.reply_hash == text_hash(DRAFT)
    assert found.escalation_accepted is True
    assert (found.run_id, found.trace_id, found.request_key) == ("run-1", "trace-1", "k-1")
    assert found.created_at.tzinfo is not None
    assert found.version == 1


async def test_the_request_key_finds_the_same_manual_request(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(make(1, key="k-1"))
        await uow.commit()

    async with harness.uow() as uow:
        mine = await uow.copilot_suggestions.get_by_request_key(CASE, DANIELA, "k-1")
        other_analyst = await uow.copilot_suggestions.get_by_request_key(CASE, FELIPE, "k-1")
        other_case = await uow.copilot_suggestions.get_by_request_key(OTHER_CASE, DANIELA, "k-1")
        unknown = await uow.copilot_suggestions.get_by_request_key(CASE, DANIELA, "nope")

    assert mine is not None
    assert (other_analyst, other_case, unknown) == (None, None, None)


async def test_the_same_key_twice_for_one_case_and_analyst_is_a_retryable_conflict(
    harness: Harness,
) -> None:
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(make(1, key="k-1"))
        await uow.commit()

    async def add_twin() -> None:
        async with harness.uow() as uow:
            await uow.copilot_suggestions.add(make(2, key="k-1"))
            await uow.commit()

    with pytest.raises(ConcurrentUpdateError):
        await add_twin()


async def test_automatic_suggestions_have_no_key_and_never_clash(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(make(1))
        await uow.copilot_suggestions.add(make(2))
        await uow.commit()

    async with harness.uow() as uow:
        assert await uow.copilot_suggestions.get(make(1).id) is not None
        assert await uow.copilot_suggestions.get(make(2).id) is not None


async def test_latest_is_the_newest_of_that_analyst_on_that_case(harness: Harness) -> None:
    clock = harness.clock
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(make(1, clock=clock))
        await uow.copilot_suggestions.add(make(2, clock=clock, at_offset=timedelta(minutes=5)))
        await uow.copilot_suggestions.add(
            make(3, clock=clock, at_offset=timedelta(minutes=9), analyst_id=FELIPE)
        )
        await uow.copilot_suggestions.add(
            make(4, clock=clock, at_offset=timedelta(minutes=9), case_id=OTHER_CASE)
        )
        await uow.commit()

    async with harness.uow() as uow:
        latest = await uow.copilot_suggestions.latest_for(CASE, DANIELA)
        nobody = await uow.copilot_suggestions.latest_for(OTHER_CASE, FELIPE)

    assert latest is not None
    assert latest.id == make(2).id
    assert nobody is None


async def test_saving_persists_the_decision_and_a_stale_copy_conflicts(harness: Harness) -> None:
    s = make(1)
    answer(s, harness)
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(s)
        await uow.commit()

    async with harness.uow() as uow:
        first = await uow.copilot_suggestions.get(s.id)
        second = await uow.copilot_suggestions.get(s.id)
        assert first is not None
        assert second is not None
        assert first.reply_sent(sent_text=DRAFT + " Gracias.", at=harness.clock.now())
        await uow.copilot_suggestions.save(first)
        await uow.commit()

    async with harness.uow() as uow:
        saved = await uow.copilot_suggestions.get(s.id)
    assert saved is not None
    assert saved.reply_decision is ReplyDecision.EDITED
    assert saved.edit_distance_permille is not None
    assert saved.version == 2
    assert not any(isinstance(i, ReplySuggestion) for i in saved.items)

    async def save_the_stale_copy() -> None:
        async with harness.uow() as uow:
            assert second.discard_reply(at=harness.clock.now())
            await uow.copilot_suggestions.save(second)
            await uow.commit()

    with pytest.raises(ConcurrentUpdateError):
        await save_the_stale_copy()


async def test_only_ready_suggestions_with_texts_older_than_the_cutoff_are_expired(
    harness: Harness,
) -> None:
    clock = harness.clock
    old, fresh, purged, none, failed = (
        make(1, clock=clock),
        make(2, clock=clock, at_offset=timedelta(hours=23)),
        make(3, clock=clock),
        make(4, clock=clock),
        make(5, clock=clock),
    )
    for item in (old, fresh, purged):
        answer(item, harness)
    purged.purge(at=clock.now())
    none.record_answer(raw=[], run_id=None, trace_id="t", at=clock.now())
    failed.record_failure(code="agent_core_unavailable", at=clock.now())
    async with harness.uow() as uow:
        for item in (old, fresh, purged, none, failed):
            await uow.copilot_suggestions.add(item)
        await uow.commit()

    async with harness.uow() as uow:
        due = await uow.copilot_suggestions.list_expired(
            created_before=clock.now() + timedelta(hours=1), limit=10
        )
        limited = await uow.copilot_suggestions.list_expired(
            created_before=clock.now() + DRAFT_TTL, limit=1
        )

    assert [s.id for s in due] == [old.id]
    assert [s.id for s in limited] == [old.id]


async def test_a_purge_persists_empty_texts_and_keeps_what_was_proposed(
    harness: Harness,
) -> None:
    s = make(1)
    answer(s, harness)
    async with harness.uow() as uow:
        await uow.copilot_suggestions.add(s)
        await uow.commit()

    async with harness.uow() as uow:
        found = await uow.copilot_suggestions.get(s.id)
        assert found is not None
        assert found.purge(at=harness.clock.now()) is True
        await uow.copilot_suggestions.save(found)
        await uow.commit()

    async with harness.uow() as uow:
        again = await uow.copilot_suggestions.get(s.id)
    assert again is not None
    assert again.items == ()
    assert again.purged_at is not None
    assert again.reply_decision is ReplyDecision.IGNORED
    assert again.kinds == ("reply", "tool", "action", "escalate")
    assert again.reply_hash == text_hash(DRAFT)
