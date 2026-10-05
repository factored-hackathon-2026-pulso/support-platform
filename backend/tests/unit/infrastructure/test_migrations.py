"""Schema migrations (Alembic): fresh database to head, pre-Alembic SQLite files adopted, a second
run is a no-op, concurrent runs do not race, ``event_log`` append-only on Postgres.

Runs on SQLite, and on Postgres with ``CC_TEST_DATABASE_URL`` (``tests/postgres_support.py``).
"""

from __future__ import annotations

import asyncio
import fcntl
import gzip
import os
import sqlite3
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import DBAPIError, OperationalError

from cc_platform.bootstrap.container import build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database, normalize_url
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import (
    ADVISORY_LOCK_KEY,
    SchemaNotMigratedError,
    current_revision,
    ensure_at_head,
    head_revision,
    migrate,
)
from cc_platform.infrastructure.persistence.sqlalchemy.tables import metadata
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import is_lock_contention
from tests.postgres_support import PostgresDatabases
from tests.support import make_settings

FIXTURES = Path(__file__).parents[2] / "fixtures" / "pre_alembic"
BACKEND_DIR = Path(__file__).parents[3]


@pytest.fixture
def empty_url(tmp_path: Path, postgres_databases: PostgresDatabases | None) -> Iterator[str]:
    """An empty database (no tables at all): a SQLite file, or a new Postgres database."""
    if postgres_databases is None:
        yield f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}"
        return
    name = postgres_databases.create()
    yield postgres_databases.url(name)
    postgres_databases.drop(name)


@pytest.fixture
async def empty_database(empty_url: str) -> AsyncIterator[Database]:
    database = Database(empty_url)
    yield database
    await database.dispose()


def _schema_diff(connection: Connection) -> list[object]:
    context = MigrationContext.configure(connection, opts={"compare_type": True})
    return list(compare_metadata(context, metadata))


async def diff_against_tables(database: Database) -> list[object]:
    async with database.engine.connect() as connection:
        return await connection.run_sync(_schema_diff)


# ----------------------------------------------------------------------------- fresh database
async def test_a_fresh_database_is_migrated_to_head(empty_database: Database) -> None:
    assert await current_revision(empty_database) is None

    report = await migrate(empty_database)

    assert (report.before, report.after, report.adopted) == (None, head_revision(), None)
    assert report.changed
    assert await current_revision(empty_database) == head_revision()
    assert await diff_against_tables(empty_database) == []


async def test_migrating_twice_is_a_no_op(empty_database: Database) -> None:
    await migrate(empty_database)

    again = await migrate(empty_database)

    assert (again.before, again.after, again.changed) == (head_revision(), head_revision(), False)


async def test_concurrent_migrations_in_one_process_do_not_race(empty_url: str) -> None:
    databases = [Database(empty_url) for _ in range(3)]
    try:
        reports = await asyncio.gather(*(migrate(database) for database in databases))
    finally:
        for database in databases:
            await database.dispose()

    assert sorted(report.changed for report in reports) == [False, False, True]
    checker = Database(empty_url)
    assert await diff_against_tables(checker) == []
    await checker.dispose()


def test_two_processes_starting_at_once_do_not_race(empty_url: str) -> None:
    """Three ``cc-migrate`` processes on the same empty database: one migrates, the others wait
    on the lock and find the head; all succeed."""
    env = {
        **os.environ,
        "CC_DATABASE_URL": empty_url,
        "CC_LOG_FORMAT": "console",
        "CC_LOG_LEVEL": "WARNING",
    }
    command = [sys.executable, "-m", "cc_platform.bootstrap.migrate", "upgrade"]
    processes = [
        subprocess.Popen(  # noqa: S603 - our own module, fixed arguments
            command,
            cwd=BACKEND_DIR,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        for _ in range(3)
    ]
    outputs = [process.communicate(timeout=120)[0].decode() for process in processes]

    assert [process.returncode for process in processes] == [0, 0, 0], outputs

    async def _check() -> tuple[str | None, list[object]]:
        database = Database(empty_url)
        try:
            return await current_revision(database), await diff_against_tables(database)
        finally:
            await database.dispose()

    assert asyncio.run(_check()) == (head_revision(), [])


async def test_a_waiting_migration_runs_once_the_lock_is_released(empty_url: str) -> None:
    """The lock is real: while someone holds it, ``migrate`` waits, then finds the work done."""
    holder = Database(empty_url)
    waiter = Database(empty_url)
    try:
        async with _held_migration_lock(holder, empty_url):
            waiting = asyncio.create_task(migrate(waiter))
            await asyncio.sleep(0.5)
            assert not waiting.done()
            await migrate_inside_lock(holder)
        report = await asyncio.wait_for(waiting, timeout=30)
    finally:
        await holder.dispose()
        await waiter.dispose()

    assert report.before == head_revision()
    assert not report.changed


async def migrate_inside_lock(database: Database) -> None:
    """What the lock holder does: migrate without taking the lock again (it has it)."""
    from cc_platform.infrastructure.persistence.sqlalchemy import migrator

    async with database.engine.connect() as connection:
        await connection.run_sync(migrator._upgrade_locked)
        await connection.commit()


@asynccontextmanager
async def _held_migration_lock(database: Database, url: str) -> AsyncIterator[None]:
    """Holds the migration lock the way another process would."""
    if database.dialect == "postgresql":
        connection = await database.engine.connect()
        await connection.execute(text("SELECT pg_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY})
        await connection.commit()
        try:
            yield
        finally:
            await connection.execute(
                text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
            await connection.close()
        return
    descriptor = os.open(f"{normalize_url(url).database}-migrate.lock", os.O_RDWR | os.O_CREAT)
    fcntl.flock(descriptor, fcntl.LOCK_EX)
    try:
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


# ----------------------------------------------------------------------------- startup
async def test_startup_migrates_by_default(empty_url: str) -> None:
    container = build_container(
        make_settings(database_url=empty_url, seed_demo_data=False),
        clock=FixedClock(),
        ids=SequentialIdGenerator(),
    )
    await container.startup()
    try:
        assert container.database is not None
        assert await current_revision(container.database) == head_revision()
    finally:
        await container.shutdown()
        assert container.database is not None
        await container.database.dispose()


async def test_startup_without_migrations_refuses_an_unmigrated_database(empty_url: str) -> None:
    container = build_container(
        make_settings(database_url=empty_url, migrate_on_start=False),
        clock=FixedClock(),
        ids=SequentialIdGenerator(),
    )
    assert container.database is not None
    with pytest.raises(SchemaNotMigratedError, match="cc-migrate"):
        await container.startup()

    await migrate(container.database)
    await ensure_at_head(container.database)
    await container.startup()  # migrated by someone else (``cc-migrate``): it starts
    await container.shutdown()
    await container.database.dispose()


# ----------------------------------------------------------------------------- pre-Alembic files
def _load_dump(name: str, path: Path) -> dict[str, int]:
    """A SQLite file made by an old build (``create_all`` + seed), and its row counts."""
    with gzip.open(FIXTURES / name, "rt", encoding="utf-8") as dump:
        script = dump.read()
    with sqlite3.connect(path) as connection:
        connection.executescript(script)
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {
            table: connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]  # noqa: S608
            for table in tables
        }


@pytest.mark.sqlite_only
@pytest.mark.parametrize(
    ("dump", "adopted"),
    [
        # The slice-22 build (S22 merge): before PR 25, PR 17 and PR 27.
        ("slice22-6ce2581.sql.gz", "0001_baseline"),
        # The last build without migrations (main at PR 28).
        ("main-pr28-5261ecf.sql.gz", "0004_engine_release"),
    ],
)
async def test_a_pre_alembic_database_is_adopted_and_upgraded(
    tmp_path: Path, dump: str, adopted: str
) -> None:
    path = tmp_path / "legacy.db"
    before = _load_dump(dump, path)
    database = Database(f"sqlite+aiosqlite:///{path}")

    report = await migrate(database)

    assert (report.before, report.adopted, report.after) == (None, adopted, head_revision())
    assert await diff_against_tables(database) == []
    async with database.engine.connect() as connection:
        for table, count in before.items():
            query = text(f'SELECT count(*) FROM "{table}"')  # noqa: S608 - fixture names
            rows = (await connection.execute(query)).scalar()
            assert rows == count, table
        keys = await connection.run_sync(
            lambda sync: inspect(sync).get_foreign_keys("builder_proposals")
        )
    assert keys == []  # PR 17: ``registered_by`` may be ``engine``
    assert not (await migrate(database)).changed
    await database.dispose()

    # The app starts on it and reads the old rows.
    container = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{path}", seed_demo_data=True),
        clock=FixedClock(),
        ids=SequentialIdGenerator(),
    )
    await container.startup()
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=500)
    assert len(page.items) >= before["event_log"]
    await container.shutdown()
    assert container.database is not None
    await container.database.dispose()


# ----------------------------------------------------------------------------- event_log
@pytest.mark.postgres_only
async def test_event_log_is_append_only_on_postgres(empty_database: Database) -> None:
    await migrate(empty_database)
    async with empty_database.engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO event_log (event_id, event_type, entity, entity_id, actor_role, "
                "actor_id, event_time, ingested_at, payload) VALUES ('EVT-1', 'case.opened', "
                "'case', 'CASE-1', 'system', 'cc-platform', now(), now(), '{}')"
            )
        )
    for statement in (
        "UPDATE event_log SET event_type = 'case.closed'",
        "DELETE FROM event_log",
        "TRUNCATE event_log",
    ):
        with pytest.raises(DBAPIError, match="event_log is append-only"):
            async with empty_database.engine.begin() as connection:
                await connection.execute(text(statement))
    async with empty_database.engine.connect() as connection:
        rows = (await connection.execute(text("SELECT event_type FROM event_log"))).all()
    assert [row[0] for row in rows] == ["case.opened"]


@pytest.mark.postgres_only
def test_the_suite_really_runs_on_postgres() -> None:
    """``CC_TEST_DATABASE_URL`` turns every SQLite URL of a test into a Postgres database."""
    database = Database("sqlite+aiosqlite:///:memory:")
    assert database.dialect == "postgresql"
    asyncio.run(database.dispose())


# ----------------------------------------------------------------------------- configuration
@pytest.mark.parametrize(
    "url",
    [
        "postgres://app:pw@db.internal:5432/platform",
        "postgresql://app:pw@db.internal:5432/platform",
        "postgresql+psycopg://app:pw@db.internal:5432/platform",
    ],
)
def test_postgres_urls_use_psycopg(url: str) -> None:
    assert normalize_url(url).drivername == "postgresql+psycopg"


def test_sqlite_urls_are_kept() -> None:
    assert normalize_url("sqlite+aiosqlite:///x.db").drivername == "sqlite+aiosqlite"


def test_the_password_stays_out_of_the_loggable_url() -> None:
    database = Database("postgresql://app:not-a-real-password@db.internal:5432/platform")
    assert "not-a-real-password" not in database.safe_url
    assert database.safe_url == "postgresql+psycopg://app:***@db.internal:5432/platform"
    asyncio.run(database.dispose())


@pytest.mark.parametrize(
    ("sqlstate", "contention"),
    [("40001", True), ("40P01", True), ("55P03", True), ("23505", False)],
)
def test_postgres_lock_contention_is_a_concurrent_update(sqlstate: str, contention: bool) -> None:
    orig = SimpleNamespace(sqlstate=sqlstate)
    error = OperationalError("UPDATE ...", None, orig)  # type: ignore[arg-type]
    assert is_lock_contention(error) is contention
