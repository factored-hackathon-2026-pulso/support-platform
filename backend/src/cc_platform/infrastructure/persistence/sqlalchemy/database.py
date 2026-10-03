"""Async engine and session factory lifecycle."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import Connection, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from cc_platform.infrastructure.persistence.sqlalchemy.tables import metadata


class Database:
    """Owns the engine. ``create_schema`` is the stand-in for migrations (known gap)."""

    def __init__(self, url: str, *, echo: bool = False) -> None:
        parsed = make_url(url)
        is_sqlite = parsed.get_backend_name() == "sqlite"
        in_memory = is_sqlite and parsed.database in (None, "", ":memory:")
        if is_sqlite and not in_memory and parsed.database:
            Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)

        # ``hide_parameters``: a DB error's text (logged with the traceback of a 500) must
        # never carry bind values: password hashes, temporary-password hashes, emails.
        engine_kwargs: dict[str, object] = {"echo": echo, "hide_parameters": True}
        if in_memory:
            # One shared connection, otherwise every session would see an empty database.
            engine_kwargs |= {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}}
        self.engine: AsyncEngine = create_async_engine(url, **engine_kwargs)
        if is_sqlite:
            event.listen(self.engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self.engine, expire_on_commit=False, autoflush=False
        )
        self.url = url

    async def create_schema(self) -> None:
        async with self.engine.begin() as connection:
            await connection.run_sync(_ensure_schema_is_current)
            await connection.run_sync(metadata.create_all)

    async def ping(self) -> bool:
        try:
            async with self.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception:
            return False
        return True

    async def dispose(self) -> None:
        await self.engine.dispose()


class OutdatedSchemaError(RuntimeError):
    """An existing database lacks columns of the current schema (no migrations yet)."""


def _ensure_schema_is_current(connection: Connection) -> None:
    """``create_all`` never alters existing tables; fail loudly instead of at the first query.

    Runs before ``create_all``. An empty database is created from scratch; a database that
    already has some of the tables must have all of them, with every column. Stand-in until
    Alembic exists (known gap): a local dev database created by an older build must be
    deleted and is re-created and re-seeded on the next start.
    """
    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    if not existing & {table.name for table in metadata.sorted_tables}:
        return  # a new database
    missing_tables = [t.name for t in metadata.sorted_tables if t.name not in existing]
    missing_columns = [
        f"{table.name}.{column.name}"
        for table in metadata.sorted_tables
        if table.name in existing
        for column in table.columns
        if column.name not in {c["name"] for c in inspector.get_columns(table.name)}
    ]
    if missing_tables or missing_columns:
        parts = []
        if missing_tables:
            parts.append("missing tables: " + ", ".join(missing_tables))
        if missing_columns:
            parts.append("missing columns: " + ", ".join(missing_columns))
        raise OutdatedSchemaError(
            "The database schema is older than the code ("
            + "; ".join(parts)
            + "). Delete the local database (e.g. backend/cc_platform.db) and restart; "
            "there are no migrations yet."
        )


def _enable_sqlite_foreign_keys(dbapi_connection: object, _record: object) -> None:
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


class DatabaseProbe:
    """``HealthProbe`` adapter for the database."""

    name = "database"

    def __init__(self, database: Database) -> None:
        self._database = database

    async def check(self) -> bool:
        return await self._database.ping()
