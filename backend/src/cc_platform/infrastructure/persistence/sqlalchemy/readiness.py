"""Readiness of the database for ``GET /readyz``: reachable, and Alembic is at head.

``schema_at_head`` is the single hook that decides "migrated": the revision recorded in
``alembic_version`` is the head revision of the migrations this build ships (the same check
``ensure_at_head`` makes when the process is told not to migrate).
"""

from __future__ import annotations

from collections.abc import Callable

from alembic.runtime.migration import MigrationContext
from sqlalchemy import Connection, text

from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import head_revision

type SchemaCheck = Callable[[Connection], bool]


def schema_at_head(connection: Connection) -> bool:
    """True when the database is at the head Alembic revision."""
    return MigrationContext.configure(connection).get_current_revision() == head_revision()


class DatabaseReadinessProbe:
    """``ReadinessProbe``: ``ok``, ``unreachable`` or ``not_migrated``; critical."""

    name = "database"
    critical = True

    def __init__(self, database: Database, *, schema_check: SchemaCheck = schema_at_head) -> None:
        self._database = database
        self._schema_check = schema_check

    async def state(self) -> str:
        try:
            async with self._database.engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
                current = await connection.run_sync(self._schema_check)
        except Exception:  # never the error text: it may carry the host or credentials
            return "unreachable"
        return "ok" if current else "not_migrated"
