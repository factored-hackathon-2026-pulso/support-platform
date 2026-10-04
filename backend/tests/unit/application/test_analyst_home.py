"""``GetAnalystHome`` (slice 6 contract §2): ``since``, the "Mientras no estabas" rows (scope,
own actions, reassigned away, aggregation, "Volvió a escribir", cap) and the team snapshot,
over the real composition and both persistence adapters."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from cc_platform.application.cases.analyst_home import (
    FALLBACK_LOOKBACK,
    MAX_ACTIVITY_ITEMS,
    AnalystHomeView,
    HomeActivityItemView,
    HomeActivityKind,
    SinceSource,
    since_of,
)
from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.security import Actor
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.cases.values import AssignmentReason, CloseReason, InboxStatus
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import (
    ANALYST,
    JULIAN,
    SEBASTIAN,
    SUPERVISOR,
    TEAM_LEAD,
    actor_for,
    customer_actor,
    make_available_quietly,
    make_settings,
)

DANIELA_ID, SEBASTIAN_ID = seed_staff_id(ANALYST.number), seed_staff_id(SEBASTIAN.number)
LUCIA = actor_for(SUPERVISOR)
#: Daniela's seeded open cases (slice 2 §8.3): Larissa (pt, Nuevo), Beatriz (Por responder).
LARISSA_PT, BEATRIZ = seed_case_id(103), seed_case_id(102)
#: Simulator customers with no case yet (es-CO, es-MX, es-AR).
NATALIA, XIMENA, LUCAS = 2001, 2002, 2003


def daniela(session_id: str = "SES-" + "0" * 25 + "9") -> Actor:
    return replace(actor_for(ANALYST), session_id=session_id)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    """The seeded composition on either adapter (the reader has an SQL and a memory side)."""
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'home.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


def clock_of(container: Container) -> FixedClock:
    clock = container.clock
    assert isinstance(clock, FixedClock)
    return clock


async def add_session(
    container: Container,
    staff_id: str,
    *,
    session_id: str,
    issued_at: datetime,
    ttl: timedelta = timedelta(hours=8),
    ended_at: datetime | None = None,
) -> None:
    async with container.uow() as uow:
        session = StaffSession.start(
            session_id=session_id,
            staff_id=staff_id,
            now=issued_at,
            ttl=ttl,
            mfa_method=MfaMethod.TOTP,
            actor=ActorRef(ActorRole.ANALYST, staff_id),
        )
        if ended_at is not None:
            session.end(now=ended_at, reason=SessionEndReason.LOGOUT, actor=ActorRef.system())
        await uow.sessions.add(session)
        await uow.commit()


async def signed_out_at(container: Container) -> datetime:
    """Daniela signed out at the seed's time; the clock moves one minute on."""
    t = container.clock.now()
    await add_session(
        container,
        DANIELA_ID,
        session_id="SES-" + "0" * 25 + "8",
        issued_at=t - timedelta(hours=2),
        ended_at=t,
    )
    clock_of(container).advance(timedelta(minutes=1))
    return t


async def customer_writes(container: Container, number: int, text: str = "Hola") -> str:
    result = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(number), PostTurnCommand(text=text, client_message_id=str(uuid.uuid4()))
    )
    return result.conversation.case_id


async def becomes_available(container: Container, actor: Actor) -> None:
    await container.use_cases.people.set_availability.execute(actor, AvailabilityStatus.AVAILABLE)
    await container.background.drain()


async def home(container: Container, actor: Actor | None = None) -> AnalystHomeView:
    return await container.use_cases.cases.analyst_home.execute(actor or daniela())


def kinds(view: AnalystHomeView) -> list[tuple[HomeActivityKind, str]]:
    return [(item.kind, item.case_id) for item in view.activity.items]


def find(
    view: AnalystHomeView, predicate: Callable[[HomeActivityItemView], bool]
) -> HomeActivityItemView:
    return next(item for item in view.activity.items if predicate(item))


# ----------------------------------------------------------------------------- since
def test_since_falls_back_to_eight_hours_without_a_previous_session() -> None:
    now = datetime(2026, 10, 3, 18, tzinfo=UTC)
    assert since_of(None, now) == (now - timedelta(hours=8), SinceSource.FALLBACK)
    assert timedelta(hours=8) == FALLBACK_LOOKBACK


def test_since_is_the_previous_session_end_never_in_the_future() -> None:
    now = datetime(2026, 10, 3, 18, tzinfo=UTC)
    ended = now - timedelta(hours=3)
    assert since_of(ended, now) == (ended, SinceSource.PREVIOUS_SESSION)
    assert since_of(now + timedelta(minutes=5), now) == (now, SinceSource.PREVIOUS_SESSION)


async def test_first_sign_in_uses_the_fallback(world: Container) -> None:
    view = await home(world)
    now = world.clock.now()
    assert (view.since, view.since_source) == (now - FALLBACK_LOOKBACK, SinceSource.FALLBACK)
    assert view.server_time == now


async def test_since_is_the_latest_ended_or_expired_session_other_than_the_current(
    world: Container,
) -> None:
    t = world.clock.now()
    current = daniela("SES-" + "0" * 25 + "1")
    # Older logout, a later expiry (the latest end), and sessions that do not count: the
    # current one (even if ended), one still active, and another analyst's.
    await add_session(
        world, DANIELA_ID, session_id="SES-" + "0" * 25 + "2",
        issued_at=t - timedelta(hours=10), ended_at=t - timedelta(hours=9),
    )  # fmt: skip
    await add_session(
        world,
        DANIELA_ID,
        session_id="SES-" + "0" * 25 + "3",
        issued_at=t - timedelta(hours=10),
        ttl=timedelta(hours=8),
    )  # fmt: skip  (expired at t − 2 h)
    await add_session(
        world, DANIELA_ID, session_id=current.session_id,
        issued_at=t - timedelta(minutes=30), ended_at=t - timedelta(minutes=1),
    )  # fmt: skip
    await add_session(
        world, DANIELA_ID, session_id="SES-" + "0" * 25 + "4", issued_at=t - timedelta(hours=1)
    )
    await add_session(
        world, seed_staff_id(JULIAN.number), session_id="SES-" + "0" * 25 + "5",
        issued_at=t - timedelta(hours=1), ended_at=t - timedelta(minutes=5),
    )  # fmt: skip

    view = await home(world, current)
    assert (view.since, view.since_source) == (t - timedelta(hours=2), SinceSource.PREVIOUS_SESSION)


# ----------------------------------------------------------------------------- activity
async def test_nothing_new_since_the_previous_session(world: Container) -> None:
    await signed_out_at(world)
    view = await home(world)
    assert view.activity.items == ()
    assert view.activity.total == 0


async def test_queue_drain_and_new_arrivals_reach_her_feed(world: Container) -> None:
    await signed_out_at(world)
    clock_of(world).advance(timedelta(minutes=5))
    await becomes_available(world, daniela())  # her own change; the drain is the system
    natalia_case = await customer_writes(world, NATALIA)

    view = await home(world)
    drained = [i for i in view.activity.items if i.kind is HomeActivityKind.ASSIGNED_FROM_QUEUE]
    assert len(drained) == 3  # the two Spanish and the Portuguese queued cases
    assert all(item.reason is AssignmentReason.QUEUE_DRAINED for item in drained)
    assert all(item.waited_seconds and item.waited_seconds > 0 for item in drained)
    assert {item.language for item in drained} == {Language.SPANISH, Language.PORTUGUESE}
    arrival = find(view, lambda i: i.case_id == natalia_case)
    assert arrival.kind is HomeActivityKind.ASSIGNED_ON_ARRIVAL
    assert arrival.reason is AssignmentReason.LANGUAGE_LEAST_LOADED
    assert (arrival.actor_name, arrival.read_only) == (None, False)
    assert arrival.customer_name == "Natalia Guzmán Rincón"
    assert arrival.inbox_status is InboxStatus.NEW
    # The customer's opening message is how the case arrived, not a separate row.
    assert (HomeActivityKind.CUSTOMER_MESSAGES, natalia_case) not in kinds(view)
    # Newest first.
    times = [item.occurred_at for item in view.activity.items]
    assert times == sorted(times, reverse=True)


async def test_other_analysts_events_and_her_own_actions_are_left_out(world: Container) -> None:
    await signed_out_at(world)
    me = daniela()
    await make_available_quietly(world.uow, seed_staff_id(JULIAN.number))
    julian_case = await customer_writes(world, NATALIA)  # Julián is the only one available
    # Her own reply and close in her own case: no row.
    await world.use_cases.cases.post_analyst_turn.execute(
        me, BEATRIZ, PostTurnCommand(text="Ya lo reviso", client_message_id=str(uuid.uuid4()))
    )
    await world.use_cases.cases.close.execute(
        me, BEATRIZ, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )

    view = await home(world, me)
    assert all(item.case_id not in (julian_case, BEATRIZ) for item in view.activity.items)
    assert view.activity.total == 0
    # Julián sees his arrival.
    julian = await home(world, actor_for(JULIAN))
    assert (HomeActivityKind.ASSIGNED_ON_ARRIVAL, julian_case) in kinds(julian)


async def test_a_supervisor_assigning_to_herself_is_her_own_action(world: Container) -> None:
    """Felipe (Analista + Supervisora) takes a queued case himself: not news to him."""
    await signed_out_at(world)
    felipe = actor_for(TEAM_LEAD)
    rosa_es = seed_case_id(111)
    await world.use_cases.cases.set_assignee.execute(
        felipe,
        rosa_es,
        SetAssigneeCommand(
            analyst_id=felipe.staff_id, expected_analyst_id=None, confirm_paused=True
        ),
    )
    view = await home(world, felipe)
    assert view.activity.total == 0


async def test_assigned_by_a_supervisor_and_reassigned_away(world: Container) -> None:
    await signed_out_at(world)
    rosa_es = seed_case_id(111)
    await world.use_cases.cases.set_assignee.execute(
        LUCIA,
        rosa_es,
        SetAssigneeCommand(analyst_id=DANIELA_ID, expected_analyst_id=None, confirm_paused=True),
    )
    await world.use_cases.cases.set_assignee.execute(
        LUCIA,
        LARISSA_PT,
        SetAssigneeCommand(
            analyst_id=SEBASTIAN_ID, expected_analyst_id=DANIELA_ID, confirm_paused=True
        ),
    )

    view = await home(world)
    given = find(view, lambda i: i.case_id == rosa_es)
    assert given.kind is HomeActivityKind.ASSIGNED_BY_SUPERVISOR
    assert (given.actor_name, given.reason, given.read_only) == (
        "Lucía Herrera",
        AssignmentReason.MANUAL,
        False,
    )
    away = find(view, lambda i: i.case_id == LARISSA_PT)
    assert away.kind is HomeActivityKind.REASSIGNED_AWAY
    assert (away.actor_name, away.target_name, away.read_only) == (
        "Lucía Herrera",
        "Sebastián Cárdenas",
        True,
    )
    assert away.language is Language.PORTUGUESE
    # Sebastián got it from a supervisor; he never sees "lo pasó a" for it.
    sebastian = await home(world, actor_for(SEBASTIAN))
    assert (HomeActivityKind.ASSIGNED_BY_SUPERVISOR, LARISSA_PT) in kinds(sebastian)
    assert (HomeActivityKind.REASSIGNED_AWAY, LARISSA_PT) not in kinds(sebastian)


async def test_customer_messages_are_one_row_per_case_with_the_count(world: Container) -> None:
    await signed_out_at(world)
    clock = clock_of(world)
    await customer_writes(world, 1002, "¿Hay alguien?")  # Beatriz, Daniela's Por responder
    clock.advance(timedelta(minutes=2))
    await customer_writes(world, 1002, "contesten!!")

    view = await home(world)
    (row,) = [i for i in view.activity.items if i.case_id == BEATRIZ]
    assert row.kind is HomeActivityKind.CUSTOMER_MESSAGES
    assert row.message_count == 2
    assert row.occurred_at == clock.now()
    assert row.inbox_status is InboxStatus.TO_REPLY
    assert row.customer_name == "Beatriz Salcedo Prieto"


async def test_messages_of_a_case_reassigned_away_do_not_count(world: Container) -> None:
    await signed_out_at(world)
    await world.use_cases.cases.set_assignee.execute(
        LUCIA,
        BEATRIZ,
        SetAssigneeCommand(
            analyst_id=SEBASTIAN_ID, expected_analyst_id=DANIELA_ID, confirm_paused=True
        ),
    )
    clock_of(world).advance(timedelta(minutes=1))
    await customer_writes(world, 1002, "¿Me escuchan?")

    view = await home(world)
    assert kinds(view) == [(HomeActivityKind.REASSIGNED_AWAY, BEATRIZ)]


async def test_a_customer_who_comes_back_replaces_the_arrival_row(world: Container) -> None:
    await signed_out_at(world)
    clock = clock_of(world)
    me = daniela()
    await becomes_available(world, me)
    first = await customer_writes(world, XIMENA, "Primera vez")
    await world.use_cases.cases.close.execute(
        me, first, CloseCaseCommand(reason=CloseReason.CUSTOMER_UNRESPONSIVE)
    )
    clock.advance(timedelta(minutes=3))
    second = await customer_writes(world, XIMENA, "Otra vez yo")

    view = await home(world, me)
    case_rows = [item for item in view.activity.items if item.case_id == second]
    assert [item.kind for item in case_rows] == [HomeActivityKind.CUSTOMER_RETURNED]
    (back,) = case_rows
    assert (back.previous_cases_count, back.last_close_reason) == (
        1,
        CloseReason.CUSTOMER_UNRESPONSIVE,
    )
    assert back.occurred_at == clock.now()
    # The first case keeps its own arrival row.
    assert (HomeActivityKind.ASSIGNED_ON_ARRIVAL, first) in kinds(view)


async def test_a_customer_who_comes_back_to_someone_else_is_not_hers(world: Container) -> None:
    """Patricia wrote again after her closed cases (seeded); a new case of a customer she
    once had, assigned to another analyst, is not in her feed."""
    await signed_out_at(world)
    me = daniela()
    await becomes_available(world, me)
    first = await customer_writes(world, LUCAS)
    await world.use_cases.cases.close.execute(
        me, first, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )
    await world.use_cases.people.set_availability.execute(me, AvailabilityStatus.PAUSED)
    await make_available_quietly(world.uow, seed_staff_id(JULIAN.number))
    second = await customer_writes(world, LUCAS, "Sigo con el problema")

    view = await home(world, me)
    assert all(item.case_id != second for item in view.activity.items)


async def test_rows_are_capped_at_ten_with_the_total(world: Container) -> None:
    await signed_out_at(world)
    clock = clock_of(world)
    me = daniela()
    await becomes_available(world, me)  # 3 rows (queue)
    for number in (1001, 1002, 1003, 1004, 1007):  # her 5 seeded open cases: 5 rows
        clock.advance(timedelta(seconds=10))
        await customer_writes(world, number, "Sigo esperando")
    for number in (NATALIA, XIMENA, LUCAS):  # 3 new arrivals
        clock.advance(timedelta(seconds=10))
        await customer_writes(world, number)

    view = await home(world, me)
    assert view.activity.total == 11
    assert len(view.activity.items) == MAX_ACTIVITY_ITEMS
    times = [item.occurred_at for item in view.activity.items]
    assert times == sorted(times, reverse=True)
    assert len(set(kinds(view))) == len(view.activity.items)


# ----------------------------------------------------------------------------- team now
async def test_team_snapshot_counts_her_team_and_her_languages(world: Container) -> None:
    view = await home(world)
    team = view.team_now
    # Equipo Andes: Daniela, Julián and Felipe (Andrés is deactivated); nobody available.
    assert (team.team_name, team.analyst_count, team.available_count) == (
        "Equipo Andes",
        3,
        0,
    )
    assert [(q.language, q.waiting) for q in team.queues] == [
        (Language.SPANISH, 2),
        (Language.PORTUGUESE, 1),
    ]
    assert all(q.oldest_queued_at is not None for q in team.queues)

    await make_available_quietly(world.uow, DANIELA_ID, seed_staff_id(JULIAN.number))
    julian = await home(world, actor_for(JULIAN))
    assert julian.team_now.available_count == 2
    # Julián speaks Spanish only.
    assert [q.language for q in julian.team_now.queues] == [Language.SPANISH]


async def test_an_empty_queue_has_no_oldest_time(world: Container) -> None:
    await becomes_available(world, daniela())
    view = await home(world)
    assert [(q.waiting, q.oldest_queued_at) for q in view.team_now.queues] == [
        (0, None),
        (0, None),
    ]
    assert view.team_now.available_count == 1
