"""Guard rails shared by the administration commands (slice 4 §3).

- ``fresh_admin``: every command first re-reads **the actor** and refuses (403) unless she
  is still an active admin. Together with the ``AdminRoster`` compare-and-set this settles
  two admins demoting each other: the second one retries and is no longer an admin.
- ``ensure_not_self``: nobody removes her own Administración, deactivates herself or resets
  her own password.
- ``open_cases_of`` / ``blocking_*``: administration never moves cases (§3.6), it refuses.
- ``load_roster`` / ``store_roster``: the singleton is created on demand from the active
  admins when missing (a database seeded before it existed, or a test store).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from cc_platform.application.cases.ports import OpenCaseRef
from cc_platform.application.errors import ForbiddenError, VersionConflictError
from cc_platform.application.people.admin.dto import (
    OpenCasesBlock,
    SelfChangeAction,
)
from cc_platform.application.people.admin.errors import (
    SelfChangeForbiddenError,
    StaffHasOpenCasesError,
)
from cc_platform.application.people.admin.queries import (
    load_team_view,
    not_found_person,
    not_found_team,
    user_view,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.admin_roster import AdminRoster
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


async def fresh_admin(uow: UnitOfWork, actor: Actor) -> ActorRef:
    """The actor, re-read now: an active staff member holding admin (else 403)."""
    staff = await uow.staff.get(actor.staff_id)
    if staff is None or not staff.is_active_admin:
        raise ForbiddenError([StaffRole.ADMIN.value])
    return staff.actor_ref(StaffRole.ADMIN)


def ensure_not_self(actor: Actor, staff_id: str, action: SelfChangeAction) -> None:
    if staff_id == actor.staff_id:
        raise SelfChangeForbiddenError(action)


async def load_target(uow: UnitOfWork, staff_id: str) -> Staff:
    staff = await uow.staff.get(staff_id) if is_valid_id(staff_id, IdPrefix.STAFF) else None
    if staff is None:
        raise not_found_person(staff_id)
    return staff


async def load_team(uow: UnitOfWork, team_id: str) -> Team:
    """A team addressed in a path (``/admin/teams/{teamId}``): 404 when unknown."""
    team = await uow.teams.get(team_id) if is_valid_id(team_id, IdPrefix.TEAM) else None
    if team is None:
        raise not_found_team(team_id)
    return team


async def destination_team(uow: UnitOfWork, team_id: str) -> Team:
    """A team named in a body (``teamId``): unknown → 422 ``invalid_value``. Whether it is
    active is the caller's check (``team_inactive``)."""
    team = await uow.teams.get(team_id) if is_valid_id(team_id, IdPrefix.TEAM) else None
    if team is None:
        raise InvalidValueError("Ese equipo no existe.", field="teamId")
    return team


async def ensure_user_version(
    uow: UnitOfWork, staff: Staff, expected: int, *, actor: Actor, now: datetime
) -> None:
    """``409 version_conflict`` (never retried) with the person as ``GET`` returns her."""
    if staff.version != expected:
        current = await user_view(uow, staff.id, viewer_id=actor.staff_id, now=now)
        raise VersionConflictError(current_version=staff.version, current_view=current)


async def ensure_team_version(uow: UnitOfWork, team: Team, expected: int) -> None:
    if team.version != expected:
        current = await load_team_view(uow, team.id)
        raise VersionConflictError(current_version=team.version, current_view=current)


# ----------------------------------------------------------------------------- open cases
async def open_cases_of(uow: UnitOfWork, staff_id: str) -> list[OpenCaseRef]:
    return (await uow.cases.open_refs_by_assignee({staff_id})).get(staff_id, [])


def ensure_no_open_cases(refs: Sequence[OpenCaseRef], block: OpenCasesBlock) -> None:
    if refs:
        raise StaffHasOpenCasesError(block, [ref.case_id for ref in refs])


def ensure_languages_not_in_use(refs: Sequence[OpenCaseRef], removed: frozenset[Language]) -> None:
    """Rule 3: an open case cannot stay with someone who no longer speaks its language."""
    for language in sorted(removed):
        blocking = [ref.case_id for ref in refs if ref.language is language]
        if blocking:
            raise StaffHasOpenCasesError(
                OpenCasesBlock.REMOVE_LANGUAGE, blocking, case_language=language
            )


# ----------------------------------------------------------------------------- admin roster
async def load_roster(uow: UnitOfWork) -> tuple[AdminRoster, bool]:
    """The roster and whether it is new (built from the active admins, not stored yet)."""
    roster = await uow.admin_roster.get()
    if roster is not None:
        return roster, False
    admins = await uow.staff.list(role=StaffRole.ADMIN)
    return AdminRoster(admin_ids=frozenset(s.id for s in admins if s.active)), True


async def store_roster(uow: UnitOfWork, roster: AdminRoster, *, new: bool) -> None:
    if new:
        await uow.admin_roster.add(roster)
    else:
        await uow.admin_roster.save(roster)


async def ensure_admin_roster(uow_factory: UnitOfWorkFactory) -> bool:
    """Bootstrap (idempotent): create the roster from the active admins when missing."""
    async with uow_factory() as uow:
        roster, new = await load_roster(uow)
        if not new:
            return False
        await store_roster(uow, roster, new=True)
        await uow.commit()
    return True
