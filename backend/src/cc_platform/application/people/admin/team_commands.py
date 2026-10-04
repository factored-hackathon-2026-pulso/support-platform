"""Administration commands on teams (slice 4 §3.7).

Same discipline as the people commands (``commands.py``): retry on conflict, fresh actor
check, ``changed: false`` for a no-op, ``version_conflict`` for a stale ``expectedVersion``.
Membership has one write path, ``UpdateUser`` with ``teamId``; there is no members endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.people.admin.dto import AdminTeamChangeView, CreatedTeamView
from cc_platform.application.people.admin.guards import (
    ensure_team_version,
    fresh_admin,
    load_team,
)
from cc_platform.application.people.admin.queries import load_team_view, not_found_team
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.people.errors import TeamNameTakenError
from cc_platform.domain.people.names import normalize_team_name, team_name_key
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.ids import IdPrefix


async def _ensure_name_free(uow: UnitOfWork, name: str, *, own_id: str | None = None) -> None:
    """``team_name_taken`` unless no other team has that name (case and accents ignored)."""
    key = team_name_key(name)
    for team in await uow.teams.list():
        if team.name_key == key and team.id != own_id:
            raise TeamNameTakenError()


async def _read_back(uow_factory: UnitOfWorkFactory, team_id: str) -> AdminTeamChangeView:
    async with uow_factory() as uow:
        view = await load_team_view(uow, team_id)
    if view is None:  # pragma: no cover - teams are never deleted
        raise not_found_team(team_id)
    return AdminTeamChangeView(changed=False, team=view)


@dataclass(frozen=True, slots=True)
class CreateTeam:
    """``POST /admin/teams`` (+ ``Idempotency-Key``)."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, name: str, *, idempotency_key: str | None = None
    ) -> CreatedTeamView:
        team_id, replayed = await retry_on_conflict(
            lambda: self._attempt(actor, name, idempotency_key)
        )
        result = await _read_back(self.uow, team_id)
        return CreatedTeamView(team=result.team, replayed=replayed)

    async def _attempt(self, actor: Actor, name: str, key: str | None) -> tuple[str, bool]:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            if key is not None:
                existing = await uow.teams.get_by_creation_key(key)
                if existing is not None:
                    return _replay(existing, name), True
            normalized = normalize_team_name(name)
            await _ensure_name_free(uow, normalized)
            team = Team.create(
                team_id=self.ids.new_id(IdPrefix.TEAM),
                name=normalized,
                now=now,
                actor=admin,
                creation_key=key,
            )
            await uow.teams.add(team)
            await uow.commit()
        return team.id, False


def _replay(existing: Team, name: str) -> str:
    """Same key + same name (case and accents ignored) → the existing team; else 409."""
    if team_name_key(name) != existing.name_key:
        raise IdempotencyConflictError("Esa clave ya se usó para crear otro equipo.")
    return existing.id


@dataclass(frozen=True, slots=True)
class RenameTeam:
    """``PATCH /admin/teams/{teamId}``. A change of case or accents of the same team is
    allowed (same ``name_key``, its own row)."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, team_id: str, expected_version: int, name: str
    ) -> AdminTeamChangeView:
        changed = await retry_on_conflict(
            lambda: self._attempt(actor, team_id, expected_version, name)
        )
        result = await _read_back(self.uow, team_id)
        return AdminTeamChangeView(changed=changed, team=result.team)

    async def _attempt(self, actor: Actor, team_id: str, expected_version: int, name: str) -> bool:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            team = await load_team(uow, team_id)
            await ensure_team_version(uow, team, expected_version)
            normalized = normalize_team_name(name)
            if normalized == team.name:
                return False
            await _ensure_name_free(uow, normalized, own_id=team.id)
            team.rename(normalized, now=now, actor=admin)
            await uow.teams.save(team)
            await uow.commit()
        return True


@dataclass(frozen=True, slots=True)
class DeactivateTeam:
    """``POST /admin/teams/{teamId}/deactivate``: only without active members."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, team_id: str, expected_version: int
    ) -> AdminTeamChangeView:
        changed = await retry_on_conflict(lambda: self._attempt(actor, team_id, expected_version))
        result = await _read_back(self.uow, team_id)
        return AdminTeamChangeView(changed=changed, team=result.team)

    async def _attempt(self, actor: Actor, team_id: str, expected_version: int) -> bool:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            team = await load_team(uow, team_id)
            await ensure_team_version(uow, team, expected_version)
            if not team.active:
                return False
            # Part 4: an invited person counts too (her activation needs an active team).
            members = sum(
                person.is_member and person.team_id == team.id for person in await uow.staff.list()
            )
            team.deactivate(active_members=members, now=now, actor=admin)
            # A move into this team saves it too (``touch``), so the two serialise: when the
            # move commits first, this retry finds the version it was sent stale
            # (``version_conflict``, whose ``current`` shows the new member; sent again
            # fresh, ``team_not_empty``); when this commits first, the move's retry finds
            # an inactive team (``team_inactive``).
            await uow.teams.save(team)
            await uow.commit()
        return True


@dataclass(frozen=True, slots=True)
class ReactivateTeam:
    """``POST /admin/teams/{teamId}/reactivate``."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, team_id: str, expected_version: int
    ) -> AdminTeamChangeView:
        changed = await retry_on_conflict(lambda: self._attempt(actor, team_id, expected_version))
        result = await _read_back(self.uow, team_id)
        return AdminTeamChangeView(changed=changed, team=result.team)

    async def _attempt(self, actor: Actor, team_id: str, expected_version: int) -> bool:
        now = self.clock.now()
        async with self.uow() as uow:
            admin = await fresh_admin(uow, actor)
            team = await load_team(uow, team_id)
            await ensure_team_version(uow, team, expected_version)
            if not team.reactivate(now=now, actor=admin):
                return False
            await uow.teams.save(team)
            await uow.commit()
        return True
