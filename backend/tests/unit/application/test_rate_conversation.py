"""``RateConversation`` and the 7-day rating figures of "Equipo y colas" (slice 7 contract
§2–§4), over the real composition and both persistence adapters; the races run on an
in-memory Unit of Work that yields before commit, so concurrent ratings really interleave."""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import pytest

from cc_platform.application.cases.customer_chat import RateConversation
from cc_platform.application.cases.dto import CloseCaseCommand, RateConversationCommand
from cc_platform.application.cases.ports import RatingTotals
from cc_platform.application.cases.supervision import RATING_WINDOW, rating_stats
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.cases import AlreadyRatedError, CaseNotClosedError, CloseReason
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
)
from tests.support import ANALYST, JULIAN, PlainHasher, actor_for, customer_actor, make_settings

#: Claudia's closed case (unrated), Héctor's (rated 3), Patricia's open 108, Marcela's open 101.
CLAUDIA_CLOSED, HECTOR_CLOSED, PATRICIA_OPEN, MARCELA = (
    seed_case_id(105),
    seed_case_id(106),
    seed_case_id(108),
    seed_case_id(101),
)
CLAUDIA, HECTOR, PATRICIA, MARCELA_CUSTOMER = 1005, 1006, 1004, 1001
DANIELA_ID, JULIAN_ID = seed_staff_id(ANALYST.number), seed_staff_id(JULIAN.number)


def rate(
    score: int, comment: str | None = None, key: str = "rating-key-0001"
) -> RateConversationCommand:
    return RateConversationCommand(score=score, comment=comment, idempotency_key=key)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'csat.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


async def events_of(container: Container, case_id: str) -> list[tuple[str, dict[str, object]]]:
    async with container.uow() as uow:
        page = await uow.event_log.page(case_id=case_id, limit=500)
    return [(e.event_type, dict(e.payload)) for e in page.items]


# ----------------------------------------------------------------------------- the rules
async def test_the_customer_rates_her_closed_conversation(world: Container) -> None:
    rated = await world.use_cases.cases.rate_conversation.execute(
        customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(2, "  Tardaron en contestar.  ")
    )
    assert rated.replayed is False
    rating = rated.conversation.rating
    assert rating is not None
    assert (rating.score, rating.comment) == (2, "Tardaron en contestar.")
    assert rating.rated_at == world.clock.now()
    assert rated.conversation.status.value == "closed"
    rated_events = [p for t, p in await events_of(world, CLAUDIA_CLOSED) if t == "case.rated"]
    assert rated_events == [
        {"score": 2, "comment": "Tardaron en contestar.", "analyst_id": DANIELA_ID}
    ]
    # The staff side reads the same rating (summary and detail).
    detail = await world.use_cases.cases.detail.execute(actor_for(ANALYST), CLAUDIA_CLOSED)
    assert detail.case.rating == rating
    # The customer's conversation carries it too (the simulator stops asking). Slice 12: her
    # current conversation is Daniela's follow-up call (116), so 105 is a past one.
    past = await world.use_cases.cases.past_conversation.execute(
        customer_actor(CLAUDIA), CLAUDIA_CLOSED
    )
    assert past.conversation.rating == rating


async def test_a_retry_with_the_same_key_and_answer_is_a_replay(world: Container) -> None:
    use_case = world.use_cases.cases.rate_conversation
    first = await use_case.execute(customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(4, "Gracias"))
    again = await use_case.execute(customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(4, " Gracias "))
    assert again.replayed is True
    assert again.conversation.rating == first.conversation.rating
    with pytest.raises(IdempotencyConflictError):
        await use_case.execute(customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(3, "Gracias"))
    with pytest.raises(AlreadyRatedError):
        await use_case.execute(
            customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(4, "Gracias", key="another-key-02")
        )
    rated = [t for t, _ in await events_of(world, CLAUDIA_CLOSED) if t == "case.rated"]
    assert rated == ["case.rated"]


async def test_a_seeded_rating_answers_already_rated(world: Container) -> None:
    with pytest.raises(AlreadyRatedError):
        await world.use_cases.cases.rate_conversation.execute(
            customer_actor(HECTOR), HECTOR_CLOSED, rate(1)
        )


async def test_an_open_conversation_cannot_be_rated(world: Container) -> None:
    with pytest.raises(CaseNotClosedError) as raised:
        await world.use_cases.cases.rate_conversation.execute(
            customer_actor(PATRICIA), PATRICIA_OPEN, rate(4)
        )
    assert raised.value.details == {"currentStatus": "assigned"}


@pytest.mark.parametrize("case_id", [CLAUDIA_CLOSED, seed_case_id(999), "CASE-1", "nope"])
async def test_someone_elses_or_an_unknown_case_is_not_found(
    world: Container, case_id: str
) -> None:
    with pytest.raises(NotFoundError):
        await world.use_cases.cases.rate_conversation.execute(
            customer_actor(HECTOR), case_id, rate(4)
        )
    async with world.uow() as uow:
        claudia = await uow.cases.get(CLAUDIA_CLOSED)
    assert claudia is not None
    assert claudia.rating is None


@pytest.mark.parametrize(("score", "comment"), [(0, None), (5, None), (3, "x" * 501)])
async def test_an_invalid_answer_is_rejected(
    world: Container, score: int, comment: str | None
) -> None:
    with pytest.raises(InvalidValueError):
        await world.use_cases.cases.rate_conversation.execute(
            customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(score, comment)
        )


# ----------------------------------------------------------------------------- 7-day figures
def test_rating_stats_average_and_empty() -> None:
    assert rating_stats(None).count == 0
    assert rating_stats(None).average is None
    assert rating_stats(RatingTotals(count=0, score_sum=0)).average is None
    stats = rating_stats(RatingTotals(count=9, score_sum=32))
    assert (stats.count, stats.average) == (9, pytest.approx(32 / 9))


async def test_team_overview_rates_whoever_closed_in_the_last_seven_days(
    world: Container,
) -> None:
    def ratings_of(view: object, staff_id: str) -> tuple[int, float | None]:
        row = next(a for a in view.analysts if a.id == staff_id)  # type: ignore[attr-defined]
        return row.recent_ratings.count, row.recent_ratings.average

    team = world.use_cases.cases.team_overview
    # Seed: Daniela closed 104 (rated 4) and 106 (rated 3) this week, 105 unrated; Julián's
    # rated 110 closed 20 days ago (outside the window).
    view = await team.execute()
    assert ratings_of(view, DANIELA_ID) == (2, pytest.approx(3.5))
    assert ratings_of(view, JULIAN_ID) == (0, None)

    await world.use_cases.cases.rate_conversation.execute(
        customer_actor(CLAUDIA), CLAUDIA_CLOSED, rate(1)
    )
    assert ratings_of(await team.execute(), DANIELA_ID) == (3, pytest.approx(8 / 3))

    # Daniela closes Marcela's case; the rating counts for her (who closed it).
    await world.use_cases.cases.close.execute(
        actor_for(ANALYST), MARCELA, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )
    await world.use_cases.cases.rate_conversation.execute(
        customer_actor(MARCELA_CUSTOMER), MARCELA, rate(4)
    )
    assert ratings_of(await team.execute(), DANIELA_ID) == (4, pytest.approx(3.0))

    # The window follows the close: 104 (closed two days ago) leaves it after 7 days.
    clock = world.clock
    assert isinstance(clock, FixedClock)
    clock.advance(RATING_WINDOW - timedelta(days=2) + timedelta(minutes=1))
    count, _average = ratings_of(await team.execute(), DANIELA_ID)
    assert count == 3


# ----------------------------------------------------------------------------- races
class YieldingUnitOfWork(InMemoryUnitOfWork):
    async def commit(self) -> None:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await super().commit()


async def racing_kit() -> tuple[InMemoryStore, RateConversation]:
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
    return store, RateConversation(uow, clock)


async def test_two_different_ratings_racing_store_exactly_one() -> None:
    store, use_case = await racing_kit()
    claudia = customer_actor(CLAUDIA)
    results = await asyncio.gather(
        *(
            use_case.execute(claudia, CLAUDIA_CLOSED, rate(score, key=f"race-key-{score:04d}"))
            for score in (1, 2, 3, 4)
        ),
        return_exceptions=True,
    )
    winners = [r for r in results if not isinstance(r, BaseException)]
    losers = [r for r in results if isinstance(r, BaseException)]
    assert len(winners) == 1
    assert len(losers) == 3
    assert all(isinstance(r, AlreadyRatedError) for r in losers)
    stored = store.cases[CLAUDIA_CLOSED].rating
    assert stored is not None
    assert winners[0].conversation.rating is not None
    assert stored.score == winners[0].conversation.rating.score
    rated = [
        e for e in store.events if e.event_type == "case.rated" and e.case_id == CLAUDIA_CLOSED
    ]
    assert len(rated) == 1


async def test_a_double_submit_rates_once_and_replays() -> None:
    store, use_case = await racing_kit()
    claudia = customer_actor(CLAUDIA)
    results = await asyncio.gather(
        *(use_case.execute(claudia, CLAUDIA_CLOSED, rate(4, "Muy bien")) for _ in range(4))
    )
    assert Counter(r.replayed for r in results) == {False: 1, True: 3}
    rated = [
        e for e in store.events if e.event_type == "case.rated" and e.case_id == CLAUDIA_CLOSED
    ]
    assert len(rated) == 1
