"""Schema migrations (Alembic) under a lock: fresh databases, upgrades and pre-Alembic files.

``migrate`` brings a database to the head revision and is safe to run from several processes
at once: on Postgres it holds a transaction-level advisory lock (``pg_advisory_xact_lock``) for
the whole upgrade, which runs in that one transaction; on a SQLite file it holds an exclusive
``flock`` on a sidecar file (``<database>-migrate.lock``). Whoever waits sees the head when it
gets the lock, and does nothing. Running it again is a no-op.

A database created before migrations existed (``create_all`` at startup, slices up to 22 and
PR 17/25/27) has tables but no ``alembic_version``: it is *adopted*, stamped with the newest
pre-Alembic revision whose columns it has, then upgraded like any other.
"""

from __future__ import annotations

import asyncio
import fcntl
import os
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection

if TYPE_CHECKING:
    from cc_platform.infrastructure.persistence.sqlalchemy.database import Database

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

#: Key of the Postgres advisory lock (any constant 64-bit number; the ASCII of "ccmigrat").
ADVISORY_LOCK_KEY = int.from_bytes(b"ccmigrat", "big") >> 1

#: The revisions a pre-Alembic build could have produced, oldest first. Adoption stamps the
#: newest one whose columns the database has. Frozen: new revisions are never added here.
PRE_ALEMBIC_REVISIONS = (
    "0001_baseline",
    "0002_suggestion_truncated",
    "0003_engine_announce",
    "0004_engine_release",
)

VERSION_TABLE = "alembic_version"


class OutdatedSchemaError(RuntimeError):
    """A database created before migrations, by a build too old to adopt (before slice 22)."""


class SchemaNotMigratedError(RuntimeError):
    """The database is not at the head revision and this process must not migrate it."""


@dataclass(frozen=True, slots=True)
class MigrationReport:
    #: The revision before (``None``: an empty database, or a pre-Alembic one).
    before: str | None
    #: The revision now (always the head).
    after: str
    #: The pre-Alembic revision a ``create_all`` database was stamped with, if it was one.
    adopted: str | None = None

    @property
    def changed(self) -> bool:
        return self.adopted is not None or self.before != self.after


def alembic_config(connection: Connection | None = None) -> Config:
    """The Alembic configuration (no ``alembic.ini``); ``connection`` is the one to migrate."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("file_template", "%%(rev)s")  # the id already carries the slug
    if connection is not None:
        config.attributes["connection"] = connection
    return config


@cache
def head_revision() -> str:
    head = ScriptDirectory.from_config(alembic_config()).get_current_head()
    if head is None:  # pragma: no cover - the versions ship with the package
        raise RuntimeError(f"No migrations found in {MIGRATIONS_DIR}")
    return head


async def current_revision(database: Database) -> str | None:
    """The revision the database is at (``None``: empty, or created before migrations)."""
    async with database.engine.connect() as connection:
        return await connection.run_sync(_current_revision)


async def ensure_at_head(database: Database) -> None:
    """Fail fast when the database is not migrated (the process was told not to migrate)."""
    current = await current_revision(database)
    if current != head_revision():
        raise SchemaNotMigratedError(
            f"The database is at revision {current or 'none'}, the code needs "
            f"{head_revision()}: run `cc-migrate` (or start with CC_MIGRATE_ON_START=true)."
        )


async def migrate(database: Database) -> MigrationReport:
    """Upgrade to head (or create the schema), under the migration lock. Idempotent."""
    engine = database.engine
    if engine.dialect.name == "postgresql":
        async with engine.connect() as connection:
            # Held until the commit (or the rollback): the whole upgrade is one transaction.
            await connection.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
            return await _upgrade(connection)
    async with _sqlite_file_lock(database.url), engine.connect() as connection:
        return await _upgrade(connection)


async def _upgrade(connection: AsyncConnection) -> MigrationReport:
    try:
        report = await connection.run_sync(_upgrade_locked)
    except BaseException:
        await connection.rollback()
        raise
    await connection.commit()
    return report


def _upgrade_locked(connection: Connection) -> MigrationReport:
    before = _current_revision(connection)
    adopted = None
    if before is None and _has_tables(connection):
        adopted = _pre_alembic_revision(connection)
        command.stamp(alembic_config(connection), adopted)
    command.upgrade(alembic_config(connection), "head")
    return MigrationReport(before=before, after=head_revision(), adopted=adopted)


def _current_revision(connection: Connection) -> str | None:
    return MigrationContext.configure(connection).get_current_revision()


def _has_tables(connection: Connection) -> bool:
    return bool(set(inspect(connection).get_table_names()) - {VERSION_TABLE})


def _pre_alembic_revision(connection: Connection) -> str:
    """The newest pre-Alembic revision whose tables and columns the database has."""
    inspector = inspect(connection)
    existing = {
        table: {column["name"] for column in inspector.get_columns(table)}
        for table in inspector.get_table_names()
    }
    for revision in reversed(PRE_ALEMBIC_REVISIONS):
        if not _missing(_columns_at(revision), existing):
            return revision
    missing = _missing(_columns_at(PRE_ALEMBIC_REVISIONS[0]), existing)
    raise OutdatedSchemaError(
        "The database was created by a build older than slice 22, before migrations existed "
        f"(missing: {', '.join(missing)}). It cannot be upgraded: move it aside and start "
        "again (a development database; the seed recreates the sample data)."
    )


def _missing(expected: Mapping[str, frozenset[str]], existing: Mapping[str, set[str]]) -> list[str]:
    missing: list[str] = []
    for table, columns in sorted(expected.items()):
        if table not in existing:
            missing.append(table)
            continue
        missing.extend(f"{table}.{column}" for column in sorted(columns - existing[table]))
    return missing


@cache
def _columns_at(revision: str) -> Mapping[str, frozenset[str]]:
    """Tables and columns of the schema at ``revision`` (built in a scratch SQLite database)."""
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            command.upgrade(alembic_config(connection), revision)
            inspector = inspect(connection)
            return {
                table: frozenset(column["name"] for column in inspector.get_columns(table))
                for table in inspector.get_table_names()
                if table != VERSION_TABLE
            }
    finally:
        engine.dispose()


@asynccontextmanager
async def _sqlite_file_lock(url: str) -> AsyncIterator[None]:
    """An exclusive ``flock`` next to a SQLite file; nothing for an in-memory database."""
    path = make_url(url).database
    if not path or path == ":memory:":
        yield
        return
    lock_path = Path(f"{path}-migrate.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        # Blocking, so in a thread: the event loop keeps serving while another process migrates.
        await asyncio.to_thread(fcntl.flock, descriptor, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)
