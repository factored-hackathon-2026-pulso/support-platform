"""Both Unit of Work adapters must behave the same (contract tests)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.people.login_account import LockoutPolicy, LoginAccount
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import (
    ConcurrentUpdateError,
    ConflictError,
    InvalidValueError,
    NotFoundError,
)
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import (
    Database,
    OutdatedSchemaError,
)
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from tests.support import RecordingHandler, emit

STAFF_ID = "STF-" + "0" * 25 + "1"
CASE_ID = "CASE-" + "0" * 25 + "1"


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseNoted(DomainEvent):
    event_type = "case.noted"
    entity = "case"
    note: str


@dataclass
class Harness:
    uow: UnitOfWorkFactory
    clock: FixedClock
    published: RecordingHandler


@pytest.fixture(params=["memory", "sqlite"])
async def harness(request: pytest.FixtureRequest) -> AsyncIterator[Harness]:
    clock = FixedClock()
    ids = SequentialIdGenerator()
    bus = InProcessEventBus()
    published = RecordingHandler()
    bus.subscribe(published)
    if request.param == "memory":
        store = InMemoryStore()

        def memory() -> UnitOfWork:
            return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

        yield Harness(memory, clock, published)
        return

    database = Database("sqlite+aiosqlite:///:memory:")
    await database.create_schema()

    def sql() -> UnitOfWork:
        return SqlAlchemyUnitOfWork(database.session_factory, bus=bus, ids=ids, clock=clock)

    yield Harness(sql, clock, published)
    await database.dispose()


def make_staff(staff_id: str = STAFF_ID, email: str = "daniela.rios@latambank.example") -> Staff:
    return Staff(
        id=staff_id,
        name="Daniela Ríos",
        email=email,
        roles=frozenset({StaffRole.ANALYST, StaffRole.SUPERVISOR}),
        languages=frozenset({Language.SPANISH, Language.PORTUGUESE}),
        team="Disputas · Equipo Andes",
    )


def noted(note: str) -> CaseNoted:
    return CaseNoted(
        occurred_at=datetime(2026, 10, 2, 13, 59, tzinfo=UTC),
        actor=ActorRef(ActorRole.ANALYST, STAFF_ID),
        entity_id=CASE_ID,
        case_id=CASE_ID,
        note=note,
    )


async def test_round_trips_aggregates(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        await uow.login_accounts.add(LoginAccount(staff_id=STAFF_ID, password_hash="h"))
        await uow.commit()

    async with harness.uow() as uow:
        staff = await uow.staff.get(STAFF_ID)
        by_email = await uow.staff.get_by_email("daniela.rios@latambank.example")
        supervisors = await uow.staff.list(role=StaffRole.SUPERVISOR)
        admins = await uow.staff.list(role=StaffRole.ADMIN)
    assert staff is not None
    assert by_email is not None
    assert staff.roles == frozenset({StaffRole.ANALYST, StaffRole.SUPERVISOR})
    assert staff.languages == frozenset({Language.SPANISH, Language.PORTUGUESE})
    assert [s.id for s in supervisors] == [STAFF_ID]
    assert admins == []


async def test_commit_appends_events_then_publishes(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        account = LoginAccount(staff_id=STAFF_ID, password_hash="h")
        await uow.login_accounts.add(account)
        await uow.commit()

    harness.clock.advance(timedelta(seconds=30))
    async with harness.uow() as uow:
        loaded = await uow.login_accounts.get(STAFF_ID)
        assert loaded is not None
        loaded.register_failed_attempt(
            now=harness.clock.now(),
            policy=LockoutPolicy(),
            actor=ActorRef(ActorRole.ANALYST, STAFF_ID),
        )
        await uow.login_accounts.save(loaded)
        await uow.commit()

    async with harness.uow() as uow:
        page = await uow.event_log.page()
        reloaded = await uow.login_accounts.get(STAFF_ID)
    assert reloaded is not None
    assert reloaded.failed_attempts == 1
    assert [e.event_type for e in page.items] == ["auth.login_failed"]
    stored = page.items[0]
    assert stored.event_id.startswith("EVT-")
    assert stored.sequence == 1
    assert stored.entity == "staff"
    assert stored.entity_id == STAFF_ID
    assert stored.actor_role == "analyst"
    assert stored.ingested_at == harness.clock.now()
    assert stored.event_time.tzinfo is not None
    assert stored.payload == {"factor": "password", "failed_attempts": 1, "remaining_attempts": 4}
    assert harness.published.event_types == ["auth.login_failed"]
    assert harness.published.records[0].event_id == stored.event_id


async def test_leaving_without_commit_discards_state_and_events(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        uow.record(noted("never"))

    async with harness.uow() as uow:
        assert await uow.staff.get(STAFF_ID) is None
        assert (await uow.event_log.page()).items == ()
    assert harness.published.records == []


async def test_error_inside_block_rolls_back(harness: Harness) -> None:
    async def add_then_fail() -> None:
        async with harness.uow() as uow:
            await uow.staff.add(make_staff())
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await add_then_fail()
    async with harness.uow() as uow:
        assert await uow.staff.get(STAFF_ID) is None


async def test_duplicate_insert_is_a_conflict(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        await uow.commit()

    async def add_same_email() -> None:
        async with harness.uow() as uow:
            await uow.staff.add(make_staff(staff_id="STF-" + "0" * 25 + "2"))
            await uow.commit()

    with pytest.raises(ConflictError):
        await add_same_email()


async def test_event_log_pages_with_opaque_cursor_and_filters(harness: Harness) -> None:
    await emit(harness.uow, *(noted(f"n{i}") for i in range(5)))

    async with harness.uow() as uow:
        first = await uow.event_log.page(limit=2)
        assert [e.payload["note"] for e in first.items] == ["n0", "n1"]
        assert first.next_cursor is not None
        second = await uow.event_log.page(after=first.next_cursor, limit=2)
        assert [e.payload["note"] for e in second.items] == ["n2", "n3"]
        last = await uow.event_log.page(after=second.next_cursor, limit=2)
        assert [e.payload["note"] for e in last.items] == ["n4"]
        assert last.next_cursor is None
        by_case = await uow.event_log.page(case_id=CASE_ID)
        assert len(by_case.items) == 5
        assert (await uow.event_log.page(case_id="CASE-" + "9" * 26)).items == ()
        with pytest.raises(InvalidValueError):
            await uow.event_log.page(after="not-a-cursor")


async def test_repository_reads_are_isolated_from_unsaved_mutations(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        await uow.commit()
    async with harness.uow() as uow:
        staff = await uow.staff.get(STAFF_ID)
        assert staff is not None
        staff.name = "Changed without save"
        await uow.commit()
    async with harness.uow() as uow:
        again = await uow.staff.get(STAFF_ID)
    assert again is not None
    assert again.name == "Daniela Ríos"


# ----------------------------------------------------------------------------- optimistic locking
async def test_versions_start_at_one_and_bump_on_every_save(harness: Harness) -> None:
    async with harness.uow() as uow:
        staff = make_staff()
        await uow.staff.add(staff)
        assert staff.version == 1
        await uow.commit()
    async with harness.uow() as uow:
        loaded = await uow.staff.get(STAFF_ID)
        assert loaded is not None
        assert loaded.version == 1
        loaded.name = "Daniela R."
        await uow.staff.save(loaded)
        loaded.team = "Otro equipo"
        await uow.staff.save(loaded)  # a second save in the same unit is fine
        assert loaded.version == 3
        await uow.commit()
    async with harness.uow() as uow:
        again = await uow.staff.get(STAFF_ID)
        listed = await uow.staff.list()
    assert again is not None
    assert (again.version, again.name, again.team) == (3, "Daniela R.", "Otro equipo")
    assert [s.version for s in listed] == [3]


async def test_stale_save_is_a_concurrent_update_and_changes_nothing(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        await uow.commit()

    # Two requests load the same revision; the first one commits.
    first, second = harness.uow(), harness.uow()
    async with first as uow_a:
        mine = await uow_a.staff.get(STAFF_ID)
        async with second as uow_b:
            theirs = await uow_b.staff.get(STAFF_ID)
            assert mine is not None
            assert theirs is not None
            mine.name = "Primera"
            await uow_a.staff.save(mine)
            await uow_a.commit()

            theirs.name = "Segunda"
            with pytest.raises(ConcurrentUpdateError) as conflict:
                await uow_b.staff.save(theirs)
    assert conflict.value.code == "concurrent_update"

    async with harness.uow() as uow:
        stored = await uow.staff.get(STAFF_ID)
    assert stored is not None
    assert stored.name == "Primera"


async def test_saving_an_aggregate_that_was_never_stored_is_not_found(harness: Harness) -> None:
    async with harness.uow() as uow:
        await uow.staff.add(make_staff())
        await uow.commit()
    async with harness.uow() as uow:
        with pytest.raises(NotFoundError):
            await uow.staff.save(make_staff())  # fresh object, version 0


async def test_in_memory_commit_rechecks_versions_before_applying() -> None:
    """Both units saved before either committed: the second commit applies nothing."""
    store = InMemoryStore()
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()

    def uow() -> UnitOfWork:
        return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    async with uow() as setup:
        await setup.staff.add(make_staff())
        await setup.commit()

    async with uow() as uow_a, uow() as uow_b:
        mine, theirs = await uow_a.staff.get(STAFF_ID), await uow_b.staff.get(STAFF_ID)
        assert mine is not None
        assert theirs is not None
        mine.name, theirs.name = "Primera", "Segunda"
        await uow_a.staff.save(mine)
        await uow_b.staff.save(theirs)
        await uow_a.commit()
        with pytest.raises(ConcurrentUpdateError):
            await uow_b.commit()
    assert store.staff[STAFF_ID].name == "Primera"


async def test_an_outdated_database_fails_fast_at_startup(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'old.db'}"
    old = Database(url)
    async with old.engine.begin() as connection:  # a build before optimistic locking
        await connection.execute(
            text("CREATE TABLE staff (id VARCHAR(40) PRIMARY KEY, name VARCHAR(200))")
        )
    await old.dispose()

    database = Database(url)
    with pytest.raises(OutdatedSchemaError, match=r"staff\.version"):
        await database.create_schema()
    await database.dispose()


async def test_a_slice_2_database_lists_the_new_assignment_columns(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'slice2.db'}"
    old = Database(url)
    async with old.engine.begin() as connection:  # slice 2 ``assignments``, no slice 3 columns
        await connection.execute(
            text(
                "CREATE TABLE assignments (id VARCHAR(40) PRIMARY KEY, case_id VARCHAR(40), "
                "staff_id VARCHAR(40), reason VARCHAR(40), policy_rule_id VARCHAR(20), "
                "open_cases_at_assignment INTEGER, strategy VARCHAR(80), assigned_at DATETIME, "
                "assigned_by_role VARCHAR(20), assigned_by_id VARCHAR(120), "
                "waited_seconds INTEGER)"
            )
        )
    await old.dispose()

    database = Database(url)
    with pytest.raises(OutdatedSchemaError) as raised:
        await database.create_schema()
    assert "assignments.previous_staff_id" in str(raised.value)
    assert "assignments.paused_override" in str(raised.value)
    await database.dispose()
