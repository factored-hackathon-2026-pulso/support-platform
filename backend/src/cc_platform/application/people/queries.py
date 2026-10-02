"""Read-side use cases of the people context."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.people.dto import CurrentStaff, StaffView
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import NotFoundError


@dataclass(frozen=True, slots=True)
class GetCurrentStaff:
    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor) -> CurrentStaff:
        async with self.uow() as uow:
            staff = await uow.staff.get(actor.staff_id)
        if staff is None:
            raise NotFoundError("La persona no existe.", staffId=actor.staff_id)
        return CurrentStaff(
            staff=StaffView.from_staff(staff),
            session_id=actor.session_id,
            session_expires_at=actor.session_expires_at,
        )


@dataclass(frozen=True, slots=True)
class ListStaff:
    uow: UnitOfWorkFactory

    async def execute(self, *, role: StaffRole | None = None) -> list[StaffView]:
        async with self.uow() as uow:
            people = await uow.staff.list(role=role)
        return [StaffView.from_staff(person) for person in people if person.active]
