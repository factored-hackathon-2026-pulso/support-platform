"""``cc-seed``: seed a database with synthetic data, idempotently (safe to run again).

Usage: ``uv run cc-seed --profile demo|volume`` (the ``CC_*`` settings say which database).

- ``demo``: what the API seeds on start with ``CC_SEED_DEMO_DATA=true``: the accounts per role,
  the demo customers and the story cases (RUNBOOK §5).
- ``volume``: ``demo`` plus about 1,300 synthetic cases over the last 90 days, with their turns
  and events (``infrastructure/seed/volume.py``; RUNBOOK §5.2).

Running it twice gives the same database: what exists is skipped. The volume's events go to the
event log through the Unit of Work like any other, but on a bus with **no** subscribers:
replaying 90 days must not notify anyone, move an AI stage or call agent-core.

Refused with ``CC_ENV=prod`` (synthetic data never goes to production).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from typing import Any

from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.bootstrap.settings import Settings
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.seed.volume import seed_volume

PROFILES = ("demo", "volume")


def quiet_uow(container: Container) -> UnitOfWork:
    """A Unit of Work on the container's database whose events reach the log and no one else."""
    if container.database is None:
        raise RuntimeError("The volume seed needs a database (CC_PERSISTENCE=sqlalchemy).")
    return SqlAlchemyUnitOfWork(
        container.database.session_factory,
        bus=InProcessEventBus(),
        ids=container.ids,
        clock=container.clock,
    )


async def run_seed(container: Container, profile: str) -> dict[str, Any]:
    """Prepare the schema, then seed ``profile``. Returns what was added (for the log)."""
    if profile not in PROFILES:
        raise ValueError(f"unknown profile {profile!r}; expected one of {', '.join(PROFILES)}")
    if container.database is not None:
        await container.database.create_schema()
    await container.seed_demo_data()
    summary: dict[str, Any] = {"profile": profile}
    if profile == "volume":
        result = await seed_volume(
            lambda: quiet_uow(container),
            container.ids,
            container.clock,
            hasher=container.password_hasher,
            rule=container.settings.stage_rule(),
        )
        summary |= {
            "volume_cases_planned": result.planned,
            "volume_cases_added": result.created,
            "volume_staff_added": result.staff,
            "volume_customers_added": result.customers,
            "stage_signals_updated": result.signals_updated,
        }
    return summary


async def _main(profile: str) -> dict[str, Any]:
    settings = Settings()
    if settings.env == "prod":
        raise SystemExit("cc-seed writes synthetic data: refused with CC_ENV=prod.")
    container = build_container(settings)
    try:
        return await run_seed(container, profile)
    finally:
        await container.shutdown()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cc-seed", description=__doc__.split("\n\n")[0])
    parser.add_argument("--profile", choices=PROFILES, default="demo")
    args = parser.parse_args(argv)
    started = time.monotonic()
    summary = asyncio.run(_main(args.profile))
    summary["seconds"] = round(time.monotonic() - started, 1)
    print(" ".join(f"{key}={value}" for key, value in summary.items()))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
