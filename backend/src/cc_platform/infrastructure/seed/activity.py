"""The seeded activity in one Unit of Work: sessions, availability and cases.

The three parts tell one story (Julián signs in, Paula pauses, Daniela takes new cases
until she pauses, then the queue fills), so their events are recorded together, in
story-time order (``SeedTimeline``): the audit lists them as they happened, not part by
part. Each part stays idempotent on its own (an existing database keeps what it has).
"""

from __future__ import annotations

from datetime import timedelta

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.infrastructure.seed.cases import add_demo_cases
from cc_platform.infrastructure.seed.people import add_demo_availability, add_demo_sessions
from cc_platform.infrastructure.seed.timeline import SeedTimeline


async def seed_demo_activity(
    uow: UnitOfWorkFactory, ids: IdGenerator, clock: Clock, *, ttl: timedelta
) -> dict[str, int]:
    """Add what is missing; returns how many sessions, availability rows and cases."""
    t = clock.now()
    timeline = SeedTimeline()
    async with uow() as unit:
        created = {
            "sessions": await add_demo_sessions(unit, t, timeline, ttl=ttl),
            "availability": await add_demo_availability(unit, t, timeline),
            "cases": await add_demo_cases(unit, ids, t, timeline),
        }
        timeline.record_into(unit)
        await unit.commit()
    return created
