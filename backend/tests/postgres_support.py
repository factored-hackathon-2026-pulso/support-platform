"""Run the suite on Postgres: ``CC_TEST_DATABASE_URL`` names a server (an admin connection,
e.g. ``postgresql://postgres:<password>@127.0.0.1:<port>/postgres``; ``scripts/test-postgres.sh``
starts a throwaway one).

Tests keep writing SQLite URLs; while the variable is set, every SQLite URL a test opens becomes
its own fresh Postgres database, cloned from a template migrated to head once per session (the
same file URL twice in one test is the same database, like the file). They are dropped at the
end of the test. Tests marked ``sqlite_only`` keep SQLite (they test SQLite itself).
"""

from __future__ import annotations

import asyncio
import itertools
import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import sql
from sqlalchemy.engine import URL, make_url

from cc_platform.infrastructure.persistence.sqlalchemy.database import Database, normalize_url
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import migrate

ENV_VAR = "CC_TEST_DATABASE_URL"


def postgres_server_url() -> URL | None:
    raw = os.environ.get(ENV_VAR)
    return normalize_url(raw) if raw else None


class PostgresDatabases:
    """Creates and drops the per-test databases of one session."""

    def __init__(self, server: URL) -> None:
        self._server = server
        self._prefix = f"cc_test_{os.getpid()}"
        self._counter = itertools.count(1)
        self.template = f"{self._prefix}_template"

    def url(self, database: str) -> str:
        return self._server.set(database=database).render_as_string(hide_password=False)

    @contextmanager
    def _admin(self) -> Iterator[psycopg.Connection]:
        dsn = self._server.set(drivername="postgresql").render_as_string(hide_password=False)
        with psycopg.connect(dsn, autocommit=True) as connection:
            yield connection

    def create(self, *, template: str | None = None, name: str | None = None) -> str:
        """A new database: a clone of the migrated template, or empty (``template0``)."""
        name = name or f"{self._prefix}_{next(self._counter)}"
        with self._admin() as admin:
            admin.execute(
                sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(
                    sql.Identifier(name), sql.Identifier(template or "template0")
                )
            )
        return name

    def drop(self, name: str) -> None:
        with self._admin() as admin:
            admin.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
            )

    def prepare_template(self) -> None:
        self.drop(self.template)
        self.create(name=self.template)
        database = Database(self.url(self.template))

        async def _migrate() -> None:
            try:
                await migrate(database)
            finally:
                await database.dispose()

        asyncio.run(_migrate())

    def drop_leftovers(self) -> None:
        with self._admin() as admin:
            names = admin.execute(
                "SELECT datname FROM pg_database WHERE datname LIKE %s",
                (f"{self._prefix}_%",),
            ).fetchall()
        for (name,) in names:
            self.drop(name)


class SqliteToPostgres:
    """One test's mapping of SQLite URLs to fresh Postgres databases."""

    def __init__(self, databases: PostgresDatabases) -> None:
        self._databases = databases
        self._by_url: dict[str, str] = {}
        self.created: list[str] = []

    def translate(self, url: str) -> str:
        parsed = make_url(url)
        if parsed.get_backend_name() != "sqlite":
            return url
        in_memory = parsed.database in (None, "", ":memory:")
        if not in_memory and url in self._by_url:
            return self._databases.url(self._by_url[url])
        name = self._databases.create(template=self._databases.template)
        self.created.append(name)
        if not in_memory:
            self._by_url[url] = name
        return self._databases.url(name)

    def drop_all(self) -> None:
        for name in self.created:
            self._databases.drop(name)
