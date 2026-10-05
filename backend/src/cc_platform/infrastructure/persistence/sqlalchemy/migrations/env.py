"""Alembic environment of the platform's schema.

Run through ``cc-migrate`` or ``migrator.migrate`` only: they open the connection, take the
migration lock and pass the connection in ``config.attributes["connection"]``. There is no
``alembic.ini`` and no URL here on purpose (one way in, always under the lock).
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import Connection

from cc_platform.infrastructure.persistence.sqlalchemy.tables import metadata


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=metadata,
        # SQLite cannot ALTER most things: Alembic copies the table instead (batch mode).
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if not isinstance(connection, Connection):
    raise RuntimeError("Run the migrations with `cc-migrate` (no connection was given).")
_run(connection)
