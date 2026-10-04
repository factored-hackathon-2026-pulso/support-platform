"""Seeded notifications (slice 10): the seed story's facts already notified people (the
``NotificationProjector`` wrote them while the seed committed). What happened more than
``SEEN_AFTER`` before the seed ran is marked read, so each person starts with a few new
ones ("Nuevas") and older ones ("Anteriores"), like the canvas boards."""

from __future__ import annotations

from datetime import datetime, timedelta

from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory

#: Team-generated: seeded facts older than this start read.
SEEN_AFTER = timedelta(minutes=30)


async def mark_seed_notifications_seen(uow: UnitOfWorkFactory, *, now: datetime) -> int:
    """Read every notification of the seed story older than ``now − SEEN_AFTER``."""
    cutoff = now - SEEN_AFTER
    marked = 0
    async with uow() as unit:
        for person in await unit.staff.list():
            for item in await unit.notifications.page(person.id, before=None, limit=500):
                if item.created_at < cutoff and item.mark_read(at=now):
                    await unit.notifications.save(item)
                    marked += 1
        await unit.commit()
    return marked
