"""Administration schemas (slice 4 contract §5.2): users, roles, languages and teams.

Response members are always present (``T | null`` where nullable). Request bodies reject
unknown fields (``RequestModel``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Self

from pydantic import Field, model_validator

from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.api.schemas.people import TeamRef
from cc_platform.application.people.admin.dto import (
    AccountStatus,
    AdminTeamChangeView,
    AdminTeamDetailView,
    AdminTeamListView,
    AdminTeamMemberView,
    AdminTeamView,
    AdminUserChangeView,
    AdminUserGuardsView,
    AdminUserListView,
    AdminUserView,
    CreatedUserView,
    OpenCaseCountsView,
    PasswordResetView,
    RoleCountsView,
    TeamStatusCountsView,
    UserStatusCountsView,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.names import PERSON_NAME_LENGTH, TEAM_NAME_LENGTH
from cc_platform.domain.people.staff import MAX_EMAIL_LENGTH, Language, StaffRole

# Generous transport limits; the domain applies the real ones after trimming (§1.3) and
# answers ``invalid_value`` with the field, so the UI can show its own copy.
_NAME_MAX = PERSON_NAME_LENGTH[1] * 2
_TEAM_NAME_MAX = TEAM_NAME_LENGTH[1] * 2
_EMAIL_MAX = MAX_EMAIL_LENGTH + 64
_ID_MAX = 64


# ----------------------------------------------------------------------------- users
class OpenCaseCounts(ApiModel):
    total: int
    es: int
    pt: int

    @classmethod
    def from_view(cls, view: OpenCaseCountsView) -> OpenCaseCounts:
        return cls(total=view.total, es=view.es, pt=view.pt)


class AdminUserGuards(ApiModel):
    is_self: bool = Field(description="She is the caller.")
    last_active_admin: bool = Field(
        description="She is active, holds admin and is the only such person."
    )

    @classmethod
    def from_view(cls, view: AdminUserGuardsView) -> AdminUserGuards:
        return cls(is_self=view.is_self, last_active_admin=view.last_active_admin)


class AdminUser(ApiModel):
    id: str
    name: str
    email: str
    roles: list[StaffRole] = Field(description="Canonical order: analyst, supervisor, admin.")
    languages: list[Language] = Field(description="Sorted; may be [] only without analyst.")
    team: TeamRef
    status: AccountStatus = Field(description="At serverTime (derived, never stored).")
    locked_until: datetime | None = Field(description="null unless locked now.")
    failed_attempts: int = Field(description="The current counter (0 after an expired lock).")
    last_login_at: datetime | None
    availability: AvailabilityStatus | None = Field(
        description="Analysts only (no row = paused); null otherwise."
    )
    open_cases: OpenCaseCounts = Field(description="Her assigned | in_progress cases.")
    created_at: datetime
    guards: AdminUserGuards
    version: int = Field(description="Send it back as expectedVersion.")

    @classmethod
    def from_view(cls, view: AdminUserView) -> AdminUser:
        return cls(
            id=view.id,
            name=view.name,
            email=view.email,
            roles=list(view.roles),
            languages=list(view.languages),
            team=TeamRef.from_view(view.team),
            status=view.status,
            locked_until=view.locked_until,
            failed_attempts=view.failed_attempts,
            last_login_at=view.last_login_at,
            availability=view.availability,
            open_cases=OpenCaseCounts.from_view(view.open_cases),
            created_at=view.created_at,
            guards=AdminUserGuards.from_view(view.guards),
            version=view.version,
        )


class RoleCounts(ApiModel):
    all: int
    analyst: int
    supervisor: int
    admin: int

    @classmethod
    def from_view(cls, view: RoleCountsView) -> RoleCounts:
        return cls(all=view.all, analyst=view.analyst, supervisor=view.supervisor, admin=view.admin)


class UserStatusCounts(ApiModel):
    active: int = Field(description="Every active account, locked ones included.")
    locked: int
    inactive: int
    all: int

    @classmethod
    def from_view(cls, view: UserStatusCountsView) -> UserStatusCounts:
        return cls(active=view.active, locked=view.locked, inactive=view.inactive, all=view.all)


class AdminUserList(ApiModel):
    items: list[AdminUser] = Field(description="By name (accent-insensitive), then id; ≤ 500.")
    role_counts: RoleCounts = Field(description="Over every filter except role.")
    status_counts: UserStatusCounts = Field(description="Over every filter except status.")
    server_time: datetime

    @classmethod
    def from_view(cls, view: AdminUserListView) -> AdminUserList:
        return cls(
            items=[AdminUser.from_view(item) for item in view.items],
            role_counts=RoleCounts.from_view(view.role_counts),
            status_counts=UserStatusCounts.from_view(view.status_counts),
            server_time=view.server_time,
        )


class CreateUserRequest(RequestModel):
    name: str = Field(max_length=_NAME_MAX, description="2–120 characters after trimming.")
    email: str = Field(max_length=_EMAIL_MAX, description="At most 254 after normalising.")
    roles: list[StaffRole] = Field(min_length=1, max_length=3, description="Unique.")
    languages: list[Language] = Field(
        max_length=2, description="Unique; at least one with analyst (else invalid_value)."
    )
    team_id: str = Field(max_length=_ID_MAX, description="An active team (TEAM-…).")

    @model_validator(mode="after")
    def _unique_items(self) -> Self:
        _ensure_unique(self.roles, "roles")
        _ensure_unique(self.languages, "languages")
        return self


class CreatedUser(ApiModel):
    user: AdminUser
    temporary_password: str | None = Field(
        description="Shown once (xxxx-xxxx-xxxx); null only on an idempotent replay."
    )

    @classmethod
    def from_view(cls, view: CreatedUserView) -> CreatedUser:
        return cls(user=AdminUser.from_view(view.user), temporary_password=view.temporary_password)


class UpdateUserRequest(RequestModel):
    expected_version: int = Field(ge=1, description="The version the admin saw.")
    name: str | None = Field(default=None, max_length=_NAME_MAX)
    email: str | None = Field(default=None, max_length=_EMAIL_MAX)
    roles: list[StaffRole] | None = Field(default=None, min_length=1, max_length=3)
    languages: list[Language] | None = Field(default=None, max_length=2)
    team_id: str | None = Field(default=None, max_length=_ID_MAX)

    @model_validator(mode="after")
    def _something_to_change(self) -> Self:
        changes = (self.name, self.email, self.roles, self.languages, self.team_id)
        if all(value is None for value in changes):
            raise ValueError("send at least one field to change besides expectedVersion")
        if self.roles is not None:
            _ensure_unique(self.roles, "roles")
        if self.languages is not None:
            _ensure_unique(self.languages, "languages")
        return self


class VersionRequest(RequestModel):
    expected_version: int = Field(ge=1, description="The version the admin saw.")


class AdminUserChange(ApiModel):
    changed: bool = Field(description="false: nothing changed (no event, same version).")
    user: AdminUser
    revoked_sessions: int = Field(description="> 0 only on a deactivation.")

    @classmethod
    def from_view(cls, view: AdminUserChangeView) -> AdminUserChange:
        return cls(
            changed=view.changed,
            user=AdminUser.from_view(view.user),
            revoked_sessions=view.revoked_sessions,
        )


class PasswordResetResult(ApiModel):
    user: AdminUser
    temporary_password: str = Field(description="Shown once (xxxx-xxxx-xxxx).")
    revoked_sessions: int

    @classmethod
    def from_view(cls, view: PasswordResetView) -> PasswordResetResult:
        return cls(
            user=AdminUser.from_view(view.user),
            temporary_password=view.temporary_password,
            revoked_sessions=view.revoked_sessions,
        )


# ----------------------------------------------------------------------------- teams
class AdminTeam(ApiModel):
    id: str
    name: str
    active: bool
    member_count: int = Field(description="Active people.")
    analyst_count: int = Field(description="Active analysts.")
    inactive_member_count: int
    created_at: datetime
    version: int = Field(description="Send it back as expectedVersion.")

    @classmethod
    def from_view(cls, view: AdminTeamView) -> AdminTeam:
        return cls(
            id=view.id,
            name=view.name,
            active=view.active,
            member_count=view.member_count,
            analyst_count=view.analyst_count,
            inactive_member_count=view.inactive_member_count,
            created_at=view.created_at,
            version=view.version,
        )


class TeamStatusCounts(ApiModel):
    active: int
    inactive: int
    all: int

    @classmethod
    def from_view(cls, view: TeamStatusCountsView) -> TeamStatusCounts:
        return cls(active=view.active, inactive=view.inactive, all=view.all)


class AdminTeamList(ApiModel):
    items: list[AdminTeam] = Field(description="By name (accent-insensitive).")
    status_counts: TeamStatusCounts

    @classmethod
    def from_view(cls, view: AdminTeamListView) -> AdminTeamList:
        return cls(
            items=[AdminTeam.from_view(item) for item in view.items],
            status_counts=TeamStatusCounts.from_view(view.status_counts),
        )


class AdminTeamMember(ApiModel):
    id: str
    name: str
    roles: list[StaffRole]
    languages: list[Language]
    status: AccountStatus

    @classmethod
    def from_view(cls, view: AdminTeamMemberView) -> AdminTeamMember:
        return cls(
            id=view.id,
            name=view.name,
            roles=list(view.roles),
            languages=list(view.languages),
            status=view.status,
        )


class AdminTeamDetail(ApiModel):
    team: AdminTeam
    members: list[AdminTeamMember] = Field(description="Active first, then inactive; each by name.")

    @classmethod
    def from_view(cls, view: AdminTeamDetailView) -> AdminTeamDetail:
        return cls(
            team=AdminTeam.from_view(view.team),
            members=[AdminTeamMember.from_view(member) for member in view.members],
        )


class CreateTeamRequest(RequestModel):
    name: str = Field(max_length=_TEAM_NAME_MAX, description="2–80 characters after trimming.")


class RenameTeamRequest(RequestModel):
    expected_version: int = Field(ge=1, description="The version the admin saw.")
    name: str = Field(max_length=_TEAM_NAME_MAX, description="2–80 characters after trimming.")


class AdminTeamChange(ApiModel):
    changed: bool = Field(description="false: nothing changed (no event, same version).")
    team: AdminTeam

    @classmethod
    def from_view(cls, view: AdminTeamChangeView) -> AdminTeamChange:
        return cls(changed=view.changed, team=AdminTeam.from_view(view.team))


def _ensure_unique(values: list[StaffRole] | list[Language], field: str) -> None:
    if len(set(values)) != len(values):
        raise ValueError(f"{field} must not repeat values")
