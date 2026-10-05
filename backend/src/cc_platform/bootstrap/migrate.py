"""``cc-migrate``: the database schema, by Alembic revisions (docs/platform/deploy/database.md).

    cc-migrate              apply the pending migrations (same as ``cc-migrate upgrade``)
    cc-migrate check        exit 1 unless the database is at the head revision (changes nothing)
    cc-migrate current      print the database's revision and the head
    cc-migrate revision -m "what changed"
                            development: write the next revision from ``tables.py``

``upgrade`` is idempotent and holds the migration lock (Postgres advisory lock, or a file lock
next to a SQLite database), so several processes may run it at once. It only reads
``CC_DATABASE_URL`` (and ``CC_LOG_LEVEL`` / ``CC_LOG_FORMAT``): a migration job needs no other
secret than the database's.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import tempfile
from pathlib import Path
from typing import Literal

import structlog
from alembic import command
from pydantic_settings import BaseSettings, SettingsConfigDict

from cc_platform.bootstrap.settings import DEFAULT_DATABASE_URL
from cc_platform.infrastructure.logging import configure_logging
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.migrator import (
    alembic_config,
    current_revision,
    head_revision,
    migrate,
)

_log = structlog.get_logger("cc_platform.migrate")


class MigrateSettings(BaseSettings):
    """The part of ``Settings`` a migration needs (same variables, same ``.env``)."""

    model_config = SettingsConfigDict(
        env_prefix="CC_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = DEFAULT_DATABASE_URL
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cc-migrate", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("upgrade", help="apply the pending migrations (default)")
    commands.add_parser("check", help="exit 1 unless the database is at the head revision")
    commands.add_parser("current", help="print the database's revision and the head")
    revision = commands.add_parser("revision", help="development: write the next revision")
    revision.add_argument("-m", "--message", required=True)
    args = parser.parse_args(argv)

    settings = MigrateSettings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)
    if args.command == "revision":
        return _new_revision(args.message)
    return asyncio.run(_run(args.command or "upgrade", Database(settings.database_url)))


async def _run(name: str, database: Database) -> int:
    try:
        if name == "upgrade":
            report = await migrate(database)
            _log.info(
                "database_migrated" if report.changed else "database_up_to_date",
                before=report.before,
                after=report.after,
                adopted=report.adopted,
                database=database.safe_url,
            )
            return 0
        current = await current_revision(database)
        if name == "current":
            print(f"current: {current or 'none'}\nhead: {head_revision()}")
            return 0
        if current != head_revision():
            _log.error("database_not_at_head", current=current, head=head_revision())
            return 1
        return 0
    finally:
        await database.dispose()


def _new_revision(message: str) -> int:
    """Autogenerate the next revision against a scratch SQLite database at head."""
    slug = re.sub(r"[^a-z0-9]+", "_", message.lower()).strip("_")[:24]
    number = int(head_revision().split("_", 1)[0]) + 1
    rev_id = f"{number:04d}_{slug}"
    with tempfile.TemporaryDirectory() as scratch:
        database = Database(f"sqlite+aiosqlite:///{Path(scratch) / 'head.db'}")

        async def _generate() -> None:
            try:
                await migrate(database)
                async with database.engine.begin() as connection:
                    await connection.run_sync(
                        lambda sync: command.revision(
                            alembic_config(sync), message=message, autogenerate=True, rev_id=rev_id
                        )
                    )
            finally:
                await database.dispose()

        asyncio.run(_generate())
    print(
        f"Wrote revision {rev_id}. Review it: use the frozen types (see 0001_baseline), "
        "a server_default for a new NOT NULL column, and a test in test_migrations.py."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
