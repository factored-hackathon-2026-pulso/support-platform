"""The seeded activity in one Unit of Work: sessions, availability, cases and the admin story.

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
from cc_platform.domain.ai.maturity import StageRule
from cc_platform.infrastructure.seed.cases import add_demo_cases
from cc_platform.infrastructure.seed.maturity import add_demo_maturity
from cc_platform.infrastructure.seed.onboarding import SeedOnboarding, add_demo_invitations
from cc_platform.infrastructure.seed.people import (
    add_demo_admin_story,
    add_demo_availability,
    add_demo_sessions,
)
from cc_platform.infrastructure.seed.timeline import SeedTimeline


async def seed_demo_activity(
    uow: UnitOfWorkFactory,
    ids: IdGenerator,
    clock: Clock,
    *,
    ttl: timedelta,
    onboarding: SeedOnboarding | None = None,
    stage_rule: StageRule | None = None,
) -> dict[str, int]:
    """Add what is missing; returns how many sessions, availability rows and cases (and
    whether the admin story and the invitations ran). Part 4: with ``onboarding``, the
    seeded invitations too (their emails are queued on ``onboarding.emails``). Slice 21: the AI
    stages per case type (sample values, climbed with ``stage_rule``)."""
    t = clock.now()
    timeline = SeedTimeline()
    async with uow() as unit:
        created = {
            "sessions": await add_demo_sessions(unit, t, timeline, ttl=ttl),
            "availability": await add_demo_availability(unit, t, timeline),
            "cases": await add_demo_cases(unit, ids, t, timeline),
            "admin_story": await add_demo_admin_story(unit, t, timeline),
            "maturity": await add_demo_maturity(unit, t, timeline, stage_rule),
        }
        if onboarding is not None:
            created["invitations"] = await add_demo_invitations(
                unit, t, timeline, onboarding=onboarding
            )
        timeline.record_into(unit)
        await unit.commit()
    return created
