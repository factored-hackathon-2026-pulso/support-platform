"""Async engine and session factory lifecycle (SQLite for development and tests, Postgres in
production). The schema comes from the Alembic migrations (``migrator``), never from here."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

#: The async driver for Postgres (psycopg 3); ``postgresql://`` and ``postgres://`` mean it.
POSTGRES_DRIVER = "postgresql+psycopg"


@dataclass(frozen=True, slots=True)
class PoolOptions:
    """Connection pool of a server database (Postgres); SQLite ignores it."""

    size: int = 5
    max_overflow: int = 5
    #: Seconds a request waits for a free connection before failing.
    timeout_seconds: float = 10.0
    #: Connections older than this are replaced (proxies and failovers drop idle ones).
    recycle_seconds: int = 1800
    #: Seconds to wait for the server when opening a connection.
    connect_timeout_seconds: int = 5


def normalize_url(url: str) -> URL:
    """``postgres://`` / ``postgresql://`` (what infrastructure hands out) use psycopg 3."""
    parsed = make_url(url)
    if parsed.drivername in ("postgres", "postgresql"):
        parsed = parsed.set(drivername=POSTGRES_DRIVER)
    return parsed


class Database:
    """Owns the engine and the session factory."""

    def __init__(self, url: str, *, echo: bool = False, pool: PoolOptions | None = None) -> None:
        parsed = normalize_url(url)
        backend = parsed.get_backend_name()
        is_sqlite = backend == "sqlite"
        in_memory = is_sqlite and parsed.database in (None, "", ":memory:")
        if is_sqlite and not in_memory and parsed.database:
            Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)

        # ``hide_parameters``: a DB error's text (logged with the traceback of a 500) must
        # never carry bind values: password hashes, link-token hashes, sealed TOTP secrets, emails.
        engine_kwargs: dict[str, object] = {"echo": echo, "hide_parameters": True}
        if in_memory:
            # One shared connection, otherwise every session would see an empty database.
            engine_kwargs |= {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}}
        elif backend == "postgresql":
            options = pool or PoolOptions()
            engine_kwargs |= {
                "pool_size": options.size,
                "max_overflow": options.max_overflow,
                "pool_timeout": options.timeout_seconds,
                "pool_recycle": options.recycle_seconds,
                "pool_pre_ping": True,
                "connect_args": {
                    "connect_timeout": options.connect_timeout_seconds,
                    "application_name": "cc-platform",
                },
            }
        self.engine: AsyncEngine = create_async_engine(parsed, **engine_kwargs)
        if is_sqlite:
            event.listen(self.engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self.engine, expire_on_commit=False, autoflush=False
        )
        #: The URL as given (with its password): never log it; ``safe_url`` is for logs.
        self.url = parsed.render_as_string(hide_password=False)
        self.safe_url = parsed.render_as_string(hide_password=True)

    @property
    def dialect(self) -> str:
        return self.engine.dialect.name

    async def ping(self) -> bool:
        try:
            async with self.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        except Exception:
            return False
        return True

    async def dispose(self) -> None:
        await self.engine.dispose()


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
