"""Availability use cases ("Disponible" / "En pausa" in the Workspace list header).

Becoming available triggers ``DrainQueue`` (the ``QueueDrainer`` process manager listens to
``staff.availability_changed``), so a queued case lands on the analyst right away.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.staff import StaffRole


@dataclass(frozen=True, slots=True)
class AvailabilityView:
    status: AvailabilityStatus
    since: datetime

    @classmethod
    def of(cls, availability: AnalystAvailability) -> AvailabilityView:
        return cls(status=availability.status, since=availability.since)


@dataclass(frozen=True, slots=True)
class GetMyAvailability:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor) -> AvailabilityView:
        async with self.uow() as uow:
            stored = await uow.availability.get(actor.staff_id)
        return AvailabilityView.of(
            stored or AnalystAvailability.default(actor.staff_id, self.clock.now())
        )


@dataclass(frozen=True, slots=True)
class SetMyAvailability:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, status: AvailabilityStatus) -> AvailabilityView:
        return await retry_on_conflict(lambda: self._attempt(actor, status))

    async def _attempt(self, actor: Actor, status: AvailabilityStatus) -> AvailabilityView:
        now = self.clock.now()
        async with self.uow() as uow:
            stored = await uow.availability.get(actor.staff_id)
            availability = stored or AnalystAvailability.default(actor.staff_id, now)
            changed = availability.change(
                status, now=now, actor=actor.acting_as({StaffRole.ANALYST})
            )
            if stored is None:
                await uow.availability.add(availability)
            elif changed:
                await uow.availability.save(availability)
            await uow.commit()
        return AvailabilityView.of(availability)
