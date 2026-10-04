"""Administration read models (slice 4 §4): the directory and the teams.

Each query reads through one Unit of Work with a fixed number of queries whatever the
directory size (staff, login accounts, availability, open-case refs, teams), never one per
row. The directory is small (team-generated cap of 500 rows, no pagination: documented gap),
so filters, counts and search run in memory over the loaded rows.

The account status is derived at ``now`` (``AccountStatus``): an expired lock reads
``active`` and its counter ``0``, exactly like the next sign-in attempt would see it.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.cases.ports import OpenCaseRef
from cc_platform.application.people.admin.dto import (
    AccountStatus,
    AdminInvitationView,
    AdminTeamDetailView,
    AdminTeamListView,
    AdminTeamMemberView,
    AdminTeamView,
    AdminUserGuardsView,
    AdminUserListView,
    AdminUserView,
    InvitationStatus,
    OpenCaseCountsView,
    RoleCountsView,
    TeamStatusCountsView,
    TeamStatusFilter,
    UserFilters,
    UserStatusCountsView,
    UserStatusFilter,
)
from cc_platform.application.people.dto import TeamRefView
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.invitation import Invitation
from cc_platform.domain.people.login_account import TOTP_METHOD, LoginAccount
from cc_platform.domain.people.names import fold
from cc_platform.domain.people.staff import (
    Language,
    Staff,
    StaffRole,
    canonical_roles,
    sorted_languages,
)
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

#: Team-generated cap of ``GET /admin/users`` (§1.3).
MAX_DIRECTORY_ROWS = 500


#: Part 4: how administration reads a seeded account without an authenticator.
DEV_CODE_FACTOR = "dev_code"


def account_status(staff: Staff, account: LoginAccount | None, now: datetime) -> AccountStatus:
    if staff.is_withdrawn:
        return AccountStatus.CANCELLED
    if staff.is_invited:
        return AccountStatus.INVITED
    if not staff.active:
        return AccountStatus.INACTIVE
    if account is not None and account.is_locked(now):
        return AccountStatus.LOCKED
    return AccountStatus.ACTIVE


def _by_name(staff: Staff) -> tuple[str, str]:
    return (fold(staff.name), staff.id)


def not_found_person(staff_id: str) -> NotFoundError:
    return NotFoundError("No encontramos a esa persona.", staffId=staff_id)


def not_found_team(team_id: str) -> NotFoundError:
    return NotFoundError("No encontramos ese equipo.", teamId=team_id)


# ----------------------------------------------------------------------------- directory
@dataclass(frozen=True, slots=True)
class Directory:
    """Everything the directory views need, loaded with a fixed number of queries."""

    staff: tuple[Staff, ...]
    accounts: dict[str, LoginAccount]
    availability: dict[str, AnalystAvailability]
    open_cases: dict[str, list[OpenCaseRef]]
    teams: dict[str, Team]
    active_admin_ids: frozenset[str]
    invitations: dict[str, Invitation]

    @classmethod
    async def load(cls, uow: UnitOfWork, *, open_cases_of: set[str] | None = None) -> Directory:
        """``open_cases_of`` limits the open-case query to those people (one person's view)."""
        staff = tuple(await uow.staff.list())
        return cls(
            staff=staff,
            accounts={a.staff_id: a for a in await uow.login_accounts.list()},
            availability={a.staff_id: a for a in await uow.availability.list()},
            open_cases=await uow.cases.open_refs_by_assignee(open_cases_of),
            teams={team.id: team for team in await uow.teams.list()},
            active_admin_ids=frozenset(person.id for person in staff if person.is_active_admin),
            invitations={i.staff_id: i for i in await uow.invitations.list()},
        )

    def find(self, staff_id: str) -> Staff | None:
        return next((person for person in self.staff if person.id == staff_id), None)

    def team_ref(self, team_id: str) -> TeamRefView:
        team = self.teams.get(team_id)
        return TeamRefView.of(team) if team else TeamRefView(id=team_id, name=team_id)

    def user(self, staff: Staff, *, viewer_id: str, now: datetime) -> AdminUserView:
        account = self.accounts.get(staff.id)
        status = account_status(staff, account, now)
        counter = account.attempts.current(now) if account is not None else None
        availability: AvailabilityStatus | None = None
        if staff.has_role(StaffRole.ANALYST):
            row = self.availability.get(staff.id)
            availability = row.status if row is not None else AvailabilityStatus.PAUSED
        refs = self.open_cases.get(staff.id, [])
        invitation = self.invitations.get(staff.id) if staff.is_invited else None
        return AdminUserView(
            id=staff.id,
            name=staff.name,
            email=staff.email,
            roles=canonical_roles(staff.roles),
            languages=sorted_languages(staff.languages),
            team=self.team_ref(staff.team_id),
            status=status,
            locked_until=counter.locked_until
            if status is AccountStatus.LOCKED and counter
            else None,
            failed_attempts=counter.failed_attempts if counter is not None else 0,
            last_login_at=account.last_login_at if account is not None else None,
            availability=availability,
            open_cases=OpenCaseCountsView(
                total=len(refs),
                es=sum(ref.language is Language.SPANISH for ref in refs),
                pt=sum(ref.language is Language.PORTUGUESE for ref in refs),
            ),
            created_at=staff.created_at,
            guards=AdminUserGuardsView(
                is_self=staff.id == viewer_id,
                last_active_admin=staff.is_active_admin and self.active_admin_ids == {staff.id},
            ),
            version=staff.version,
            invitation=invitation_view(invitation, now) if invitation is not None else None,
            second_factor=_second_factor(account),
        )


def _second_factor(account: LoginAccount | None) -> str | None:
    if account is None:
        return None
    return TOTP_METHOD if account.uses_totp else DEV_CODE_FACTOR


def invitation_view(invitation: Invitation, now: datetime) -> AdminInvitationView:
    return AdminInvitationView(
        id=invitation.id,
        status=InvitationStatus(invitation.state_at(now).value),
        created_at=invitation.created_at,
        sent_at=invitation.sent_at,
        expires_at=invitation.expires_at,
        resend_count=invitation.resend_count,
    )


async def user_view(
    uow: UnitOfWork, staff_id: str, *, viewer_id: str, now: datetime
) -> AdminUserView | None:
    """One person as ``GET /admin/users/{id}`` returns her (``None`` when unknown)."""
    directory = await Directory.load(uow, open_cases_of={staff_id})
    staff = directory.find(staff_id)
    return directory.user(staff, viewer_id=viewer_id, now=now) if staff else None


def _status_matches(view: AdminUserView, status: UserStatusFilter) -> bool:
    match status:
        case UserStatusFilter.ALL:
            return True
        case UserStatusFilter.ACTIVE:
            return view.status in {AccountStatus.ACTIVE, AccountStatus.LOCKED}
        case UserStatusFilter.LOCKED:
            return view.status is AccountStatus.LOCKED
        case UserStatusFilter.INVITED:
            return view.status is AccountStatus.INVITED
        case UserStatusFilter.INACTIVE:
            return view.status is AccountStatus.INACTIVE


type _Check = Callable[[AdminUserView], bool]


def _checks(filters: UserFilters) -> dict[str, _Check]:
    """One predicate per active filter, by name (counts skip their own one)."""
    checks: dict[str, _Check] = {"status": lambda v: _status_matches(v, filters.status)}
    needle = fold(filters.query) if filters.query and filters.query.strip() else None
    if needle is not None:
        checks["q"] = lambda v: needle in fold(f"{v.name} {v.email} {v.id}")
    if filters.role is not None:
        role = filters.role
        checks["role"] = lambda v: role in v.roles
    if filters.team_id is not None:
        team_id = filters.team_id
        checks["team"] = lambda v: v.team.id == team_id
    if filters.language is not None:
        language = filters.language
        checks["language"] = lambda v: language in v.languages
    return checks


def _matching(
    views: Iterable[AdminUserView], checks: dict[str, _Check], *, skip: str | None = None
) -> list[AdminUserView]:
    active = [check for name, check in checks.items() if name != skip]
    return [view for view in views if all(check(view) for check in active)]


def _role_counts(views: Sequence[AdminUserView]) -> RoleCountsView:
    held = Counter(role for view in views for role in view.roles)
    return RoleCountsView(
        all=len(views),
        analyst=held[StaffRole.ANALYST],
        supervisor=held[StaffRole.SUPERVISOR],
        admin=held[StaffRole.ADMIN],
    )


def _status_counts(views: Sequence[AdminUserView]) -> UserStatusCountsView:
    statuses = Counter(view.status for view in views)
    return UserStatusCountsView(
        active=statuses[AccountStatus.ACTIVE] + statuses[AccountStatus.LOCKED],
        locked=statuses[AccountStatus.LOCKED],
        invited=statuses[AccountStatus.INVITED],
        inactive=statuses[AccountStatus.INACTIVE],
        all=len(views),
    )


@dataclass(frozen=True, slots=True)
class ListUsers:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, filters: UserFilters) -> AdminUserListView:
        now = self.clock.now()
        async with self.uow() as uow:
            directory = await Directory.load(uow)
        # Part 4: a cancelled invitation leaves the directory (``GET /admin/users/{id}`` still
        # answers, with status ``cancelled``).
        people = sorted((p for p in directory.staff if not p.is_withdrawn), key=_by_name)
        views = [directory.user(person, viewer_id=actor.staff_id, now=now) for person in people]
        checks = _checks(filters)
        return AdminUserListView(
            items=tuple(_matching(views, checks)[:MAX_DIRECTORY_ROWS]),
            role_counts=_role_counts(_matching(views, checks, skip="role")),
            status_counts=_status_counts(_matching(views, checks, skip="status")),
            server_time=now,
        )


@dataclass(frozen=True, slots=True)
class GetUser:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, staff_id: str) -> AdminUserView:
        if not is_valid_id(staff_id, IdPrefix.STAFF):
            raise not_found_person(staff_id)
        async with self.uow() as uow:
            view = await user_view(uow, staff_id, viewer_id=actor.staff_id, now=self.clock.now())
        if view is None:
            raise not_found_person(staff_id)
        return view


# ----------------------------------------------------------------------------- teams
def team_view(team: Team, members: Iterable[Staff]) -> AdminTeamView:
    """Part 4: invited people count as members (they are on their way); a cancelled
    invitation is not a member at all."""
    mine = [p for p in members if p.team_id == team.id and not p.is_withdrawn]
    current = [person for person in mine if person.is_member]
    return AdminTeamView(
        id=team.id,
        name=team.name,
        active=team.active,
        member_count=len(current),
        analyst_count=sum(person.has_role(StaffRole.ANALYST) for person in current),
        inactive_member_count=len(mine) - len(current),
        created_at=team.created_at,
        version=team.version,
    )


async def load_team_view(uow: UnitOfWork, team_id: str) -> AdminTeamView | None:
    team = await uow.teams.get(team_id)
    if team is None:
        return None
    return team_view(team, await uow.staff.list())


def _team_status_matches(team: Team, status: TeamStatusFilter) -> bool:
    match status:
        case TeamStatusFilter.ALL:
            return True
        case TeamStatusFilter.ACTIVE:
            return team.active
        case TeamStatusFilter.INACTIVE:
            return not team.active


@dataclass(frozen=True, slots=True)
class ListTeams:
    uow: UnitOfWorkFactory

    async def execute(self, _actor: Actor, status: TeamStatusFilter) -> AdminTeamListView:
        async with self.uow() as uow:
            teams = await uow.teams.list()
            staff = await uow.staff.list()
        ordered = sorted(teams, key=lambda team: (fold(team.name), team.id))
        active = sum(team.active for team in teams)
        return AdminTeamListView(
            items=tuple(
                team_view(team, staff) for team in ordered if _team_status_matches(team, status)
            ),
            status_counts=TeamStatusCountsView(
                active=active, inactive=len(teams) - active, all=len(teams)
            ),
        )


@dataclass(frozen=True, slots=True)
class GetTeam:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, _actor: Actor, team_id: str) -> AdminTeamDetailView:
        if not is_valid_id(team_id, IdPrefix.TEAM):
            raise not_found_team(team_id)
        now = self.clock.now()
        async with self.uow() as uow:
            team = await uow.teams.get(team_id)
            if team is None:
                raise not_found_team(team_id)
            staff = await uow.staff.list()
            accounts = {a.staff_id: a for a in await uow.login_accounts.list()}
        members = sorted(
            (p for p in staff if p.team_id == team.id and not p.is_withdrawn),
            key=lambda person: (not person.is_member, *_by_name(person)),
        )
        return AdminTeamDetailView(
            team=team_view(team, staff),
            members=tuple(
                AdminTeamMemberView(
                    id=person.id,
                    name=person.name,
                    roles=canonical_roles(person.roles),
                    languages=sorted_languages(person.languages),
                    status=account_status(person, accounts.get(person.id), now),
                )
                for person in members
            ),
        )
