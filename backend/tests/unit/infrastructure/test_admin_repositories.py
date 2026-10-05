"""Slice 4 persistence (§2.6, §2.7): teams, the admin roster and the new staff columns on
both adapters, with the same uniqueness checks (at commit for the in-memory one)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.people.admin_roster import AdminRoster
from cc_platform.domain.people.errors import EmailTakenError, TeamNameTakenError
from cc_platform.domain.people.mfa import MfaChallenge, MfaChallengeStatus, MfaMethod, MfaPolicy
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import ConcurrentUpdateError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import OutdatedSchemaError, migrate
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import memory_container

NOW = datetime(2026, 10, 3, 14, tzinfo=UTC)
TEAM_A, TEAM_B = "TEAM-" + "0" * 25 + "1", "TEAM-" + "0" * 25 + "2"
ONE, TWO = "STF-" + "0" * 25 + "1", "STF-" + "0" * 25 + "2"


@pytest.fixture(params=["memory", "sqlite"])
async def factory(request: pytest.FixtureRequest) -> AsyncIterator[UnitOfWorkFactory]:
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()
    if request.param == "memory":
        store = InMemoryStore()

        def memory() -> UnitOfWork:
            return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

        yield memory
        return
    database = Database("sqlite+aiosqlite:///:memory:")
    await migrate(database)

    def sql() -> UnitOfWork:
        return SqlAlchemyUnitOfWork(database.session_factory, bus=bus, ids=ids, clock=clock)

    yield sql
    await database.dispose()


async def commit(
    factory: UnitOfWorkFactory, change: Callable[[UnitOfWork], Awaitable[None]]
) -> None:
    """Run ``change`` in its own Unit of Work and commit it."""
    async with factory() as uow:
        await change(uow)
        await uow.commit()


def team(team_id: str = TEAM_A, name: str = "Equipo Andes", key: str | None = None) -> Team:
    return Team(id=team_id, name=name, active=True, created_at=NOW, creation_key=key)


def person(
    staff_id: str = ONE, email: str = "ana@latambank.example", key: str | None = None
) -> Staff:
    return Staff(
        id=staff_id,
        name="Ana Gil",
        email=email,
        roles=frozenset({StaffRole.ANALYST}),
        languages=frozenset({Language.SPANISH}),
        team_id=TEAM_A,
        created_at=NOW,
        creation_key=key,
    )


async def test_teams_round_trip_and_list_by_name_key(factory: UnitOfWorkFactory) -> None:
    async with factory() as uow:
        await uow.teams.add(team(TEAM_B, "Ñandú", key="team-key-01"))
        await uow.teams.add(team(TEAM_A, "Andes"))
        await uow.commit()
    async with factory() as uow:
        listed = await uow.teams.list()
        many = await uow.teams.get_many({TEAM_A, "TEAM-" + "9" * 26})
        by_key = await uow.teams.get_by_creation_key("team-key-01")
    assert [t.name for t in listed] == ["Andes", "Ñandú"]
    assert list(many) == [TEAM_A]
    assert by_key is not None
    assert by_key.id == TEAM_B
    assert (by_key.version, by_key.created_at, by_key.name_key) == (1, NOW, "nandu")


async def test_team_names_are_unique_ignoring_case_and_accents(factory: UnitOfWorkFactory) -> None:
    async with factory() as uow:
        await uow.teams.add(team(TEAM_A, "Equipo Pacífico"))
        await uow.commit()
    with pytest.raises(TeamNameTakenError):
        await commit(factory, lambda uow: uow.teams.add(team(TEAM_B, "EQUIPO pacifico")))
    async with factory() as uow:
        await uow.teams.add(team(TEAM_B, "Equipo Andes"))
        await uow.commit()

    async def rename(uow: UnitOfWork) -> None:
        renamed = await uow.teams.get(TEAM_B)
        assert renamed is not None
        renamed.name = "Equipo Pacifico"
        await uow.teams.save(renamed)

    with pytest.raises(TeamNameTakenError):
        await commit(factory, rename)


async def test_staff_email_and_creation_key_are_unique(factory: UnitOfWorkFactory) -> None:
    async with factory() as uow:
        await uow.teams.add(team())
        await uow.staff.add(person(key="create-0001"))
        await uow.commit()
    with pytest.raises(EmailTakenError):
        await commit(factory, lambda uow: uow.staff.add(person(TWO)))
    replay = person(TWO, "bea@latambank.example", key="create-0001")
    with pytest.raises(ConcurrentUpdateError):  # a concurrent replay: retry and find it
        await commit(factory, lambda uow: uow.staff.add(replay))
    async with factory() as uow:
        await uow.staff.add(person(TWO, "bea@latambank.example"))
        await uow.commit()

    async def take_email(uow: UnitOfWork) -> None:
        bea = await uow.staff.get(TWO)
        assert bea is not None
        bea.email = "ana@latambank.example"
        await uow.staff.save(bea)

    with pytest.raises(EmailTakenError):
        await commit(factory, take_email)
    async with factory() as uow:
        found = await uow.staff.get_by_creation_key("create-0001")
    assert found is not None
    assert found.id == ONE


async def test_memory_checks_uniqueness_again_at_commit() -> None:
    store, clock, ids, bus = (
        InMemoryStore(),
        FixedClock(),
        SequentialIdGenerator(),
        InProcessEventBus(),
    )

    def uow() -> UnitOfWork:
        return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    async with uow() as first, uow() as second:
        await first.teams.add(team(TEAM_A, "Equipo Sur"))
        await second.teams.add(team(TEAM_B, "equipo sur"))
        await first.commit()
        with pytest.raises(TeamNameTakenError):
            await second.commit()
    assert list(store.teams) == [TEAM_A]


async def test_roster_round_trip_and_cas(factory: UnitOfWorkFactory) -> None:
    async with factory() as uow:
        assert await uow.admin_roster.get() is None
        await uow.admin_roster.add(AdminRoster(admin_ids=frozenset({ONE, TWO})))
        await uow.commit()
    second = AdminRoster(admin_ids=frozenset({ONE}))
    with pytest.raises(ConcurrentUpdateError):  # inserted twice: retry and load it
        await commit(factory, lambda uow: uow.admin_roster.add(second))
    async with factory() as a, factory() as b:
        mine, theirs = await a.admin_roster.get(), await b.admin_roster.get()
        assert mine is not None
        assert theirs is not None
        mine.revoke(TWO)
        theirs.revoke(ONE)
        await a.admin_roster.save(mine)
        await a.commit()
        with pytest.raises(ConcurrentUpdateError):
            await _save_and_commit(b, theirs)
    async with factory() as uow:
        stored = await uow.admin_roster.get()
    assert stored is not None
    assert (stored.admin_ids, stored.version) == ({ONE}, 2)


async def _save_and_commit(uow: UnitOfWork, roster: AdminRoster) -> None:
    await uow.admin_roster.save(roster)  # memory: stale at save; SQL: no row matches
    await uow.commit()


async def test_active_sessions_of_one_person(factory: UnitOfWorkFactory) -> None:
    def session(number: int, staff_id: str, ttl: timedelta) -> StaffSession:
        return StaffSession.start(
            session_id="SES-" + str(number).zfill(26),
            staff_id=staff_id,
            now=NOW,
            ttl=ttl,
            mfa_method=MfaMethod.TOTP,
            actor=ActorRef.system(),
        )

    async with factory() as uow:
        await uow.teams.add(team())
        await uow.staff.add(person())
        await uow.staff.add(person(TWO, "bea@latambank.example"))
        ended = session(3, ONE, timedelta(hours=8))
        ended.end(now=NOW, reason=SessionEndReason.LOGOUT, actor=ActorRef.system())
        for item in (session(1, ONE, timedelta(hours=8)), session(2, ONE, timedelta(minutes=1)),
                     ended, session(4, TWO, timedelta(hours=8))):  # fmt: skip
            await uow.sessions.add(item)
        await uow.commit()
    async with factory() as uow:
        active = await uow.sessions.list_active_for(ONE, NOW + timedelta(minutes=2))
        accounts = await uow.login_accounts.list()
    assert [s.id for s in active] == ["SES-" + "1".zfill(26)]
    assert accounts == []


async def test_pending_challenges_of_one_person(factory: UnitOfWorkFactory) -> None:
    """``list_pending_for`` (slice 4 §3.6): open challenges only, of that person only."""

    def challenge(number: int, staff_id: str, ttl: timedelta) -> MfaChallenge:
        return MfaChallenge.issue(
            challenge_id="MFA-" + str(number).zfill(26),
            staff_id=staff_id,
            now=NOW,
            policy=MfaPolicy(ttl=ttl),
            actor=ActorRef.system(),
        )

    async with factory() as uow:
        await uow.teams.add(team())
        await uow.staff.add(person())
        await uow.staff.add(person(TWO, "bea@latambank.example"))
        verified = challenge(3, ONE, timedelta(minutes=5))
        verified.complete(now=NOW, method=MfaMethod.TOTP)
        five, one = timedelta(minutes=5), timedelta(minutes=1)
        for item in (
            challenge(1, ONE, five),
            challenge(2, ONE, one),
            verified,
            challenge(4, TWO, five),
        ):
            await uow.mfa_challenges.add(item)
        await uow.commit()
    later = NOW + timedelta(minutes=2)
    async with factory() as uow:
        (pending,) = await uow.mfa_challenges.list_pending_for(ONE, later)
        assert pending.id == "MFA-" + "1".zfill(26)
        assert pending.cancel(now=later)
        await uow.mfa_challenges.save(pending)
        await uow.commit()
    async with factory() as uow:
        assert await uow.mfa_challenges.list_pending_for(ONE, later) == []
        stored = await uow.mfa_challenges.get(pending.id)
        assert stored is not None
        assert (stored.status, stored.version) == (MfaChallengeStatus.CANCELLED, 2)
        assert len(await uow.mfa_challenges.list_pending_for(TWO, later)) == 1


async def test_open_refs_by_assignee() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        everyone = await uow.cases.open_refs_by_assignee()
        daniela = await uow.cases.open_refs_by_assignee({seed_staff_id(1)})
        nobody = await uow.cases.open_refs_by_assignee(set())
    assert sorted(everyone) == [seed_staff_id(1), seed_staff_id(2)]
    refs = daniela[seed_staff_id(1)]
    assert [r.case_id for r in refs] == [seed_case_id(n) for n in (101, 102, 103, 107, 108, 117)]
    assert [r.language.value for r in refs].count("pt") == 1
    assert nobody == {}


async def test_open_refs_on_sqlite(tmp_path: Path) -> None:
    from cc_platform.bootstrap.container import build_container
    from tests.support import make_settings

    container = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'refs.db'}"),
        clock=FixedClock(),
        ids=SequentialIdGenerator(),
    )
    await container.startup()
    async with container.uow() as uow:
        refs = await uow.cases.open_refs_by_assignee({seed_staff_id(2), seed_staff_id(4)})
    assert {k: [r.case_id for r in v] for k, v in refs.items()} == {
        seed_staff_id(2): [seed_case_id(113), seed_case_id(114)]
    }
    await container.shutdown()


@pytest.mark.sqlite_only
async def test_a_slice_3_database_lists_the_missing_tables_and_columns(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'slice3.db'}"
    old = Database(url)
    async with old.engine.begin() as connection:  # slice 3 ``staff``: a team name, no team id
        await connection.execute(
            text(
                "CREATE TABLE staff (id VARCHAR(40) PRIMARY KEY, name VARCHAR(200), "
                "email VARCHAR(320), roles JSON, languages JSON, team VARCHAR(120), "
                "active BOOLEAN, version INTEGER)"
            )
        )
    await old.dispose()
    database = Database(url)
    with pytest.raises(OutdatedSchemaError) as raised:
        await migrate(database)
    message = str(raised.value)
    missing = set(message.split("missing: ")[1].split(")", maxsplit=1)[0].split(", "))
    assert {"teams", "admin_roster", "cases", "event_log"} <= missing
    assert "staff.team_id" in message
    assert "staff.created_at" in message
    await database.dispose()
