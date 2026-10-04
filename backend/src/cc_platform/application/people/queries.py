"""Read-side use cases of the people context."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.people.dto import CurrentStaff, StaffView
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import Staff, StaffRole
from cc_platform.domain.shared.errors import NotFoundError


async def staff_view(uow: UnitOfWork, staff: Staff) -> StaffView:
    """``StaffView`` of one person with her team (``StaffOut``; the ``me.updated`` payload)."""
    team = await uow.teams.get(staff.team_id)
    if team is None:  # every staff row references a team (foreign key)
        raise NotFoundError("El equipo no existe.", teamId=staff.team_id)
    return StaffView.from_staff(staff, team)


@dataclass(frozen=True, slots=True)
class GetCurrentStaff:
    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor) -> CurrentStaff:
        async with self.uow() as uow:
            staff = await uow.staff.get(actor.staff_id)
            if staff is None:
                raise NotFoundError("La persona no existe.", staffId=actor.staff_id)
            view = await staff_view(uow, staff)
        return CurrentStaff(
            staff=view,
            session_id=actor.session_id,
            session_expires_at=actor.session_expires_at,
        )


@dataclass(frozen=True, slots=True)
class ListStaff:
    uow: UnitOfWorkFactory

    async def execute(
        self, *, role: StaffRole | None = None, include_inactive: bool = False
    ) -> list[StaffView]:
        # Part 4: people who never activated their account (invited, or whose invitation was
        # cancelled) never acted on the platform: the people pickers do not list them.
        async with self.uow() as uow:
            people = [
                person
                for person in await uow.staff.list(role=role)
                if (include_inactive or person.active)
                and not (person.is_invited or person.is_withdrawn)
            ]
            teams = await uow.teams.get_many({person.team_id for person in people})
        return [
            StaffView.from_staff(person, teams[person.team_id])
            for person in people
            if person.team_id in teams
        ]
