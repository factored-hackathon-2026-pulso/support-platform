"""Readiness of the database for ``GET /readyz``: reachable, and its schema is current.

``schema_is_current`` is the single hook that decides "migrated": today every table and column
of ``metadata`` exists (the stand-in for migrations, as ``Database.create_schema`` checks at
startup); with Alembic it becomes "the revision is at head".
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import Connection, inspect, text

from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.tables import metadata

type SchemaCheck = Callable[[Connection], bool]


def schema_is_current(connection: Connection) -> bool:
    """True when the database has every table and column the code expects."""
    inspector = inspect(connection)
    existing = set(inspector.get_table_names())
    for table in metadata.sorted_tables:
        if table.name not in existing:
            return False
        columns = {column["name"] for column in inspector.get_columns(table.name)}
        if any(column.name not in columns for column in table.columns):
            return False
    return True


class DatabaseReadinessProbe:
    """``ReadinessProbe``: ``ok``, ``unreachable`` or ``not_migrated``; critical."""

    name = "database"
    critical = True

    def __init__(
        self, database: Database, *, schema_check: SchemaCheck = schema_is_current
    ) -> None:
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
