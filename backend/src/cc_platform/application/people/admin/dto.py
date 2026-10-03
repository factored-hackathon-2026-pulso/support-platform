"""Inputs and outputs of the administration use cases (slice 4 §1.1, §4, §5.2).

Plain dataclasses; the API renders them with its schemas (``AdminUser.from_view`` …).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.application.people.dto import TeamRefView
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.staff import Language, StaffRole


class AccountStatus(StrEnum):
    """Derived, never stored (§1.1): ``inactive`` = ``Staff.active`` false; ``locked`` =
    active and the login account is locked now; else ``active``."""

    ACTIVE = "active"
    LOCKED = "locked"
    INACTIVE = "inactive"


class UserStatusFilter(StrEnum):
    """``active`` = every active account, locked ones included; ``locked`` = only those."""

    ACTIVE = "active"
    LOCKED = "locked"
    INACTIVE = "inactive"
    ALL = "all"


class TeamStatusFilter(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ALL = "all"


class SelfChangeAction(StrEnum):
    """Extension ``action`` of ``self_change_forbidden``."""

    REMOVE_OWN_ADMIN = "remove_own_admin"
    DEACTIVATE_SELF = "deactivate_self"
    RESET_OWN_PASSWORD = "reset_own_password"  # noqa: S105 - an action name, not a secret


class OpenCasesBlock(StrEnum):
    """Extension ``blockReason`` of ``staff_has_open_cases``."""

    DEACTIVATE = "deactivate"
    REMOVE_ANALYST = "remove_analyst"
    REMOVE_LANGUAGE = "remove_language"


# ----------------------------------------------------------------------------- users
@dataclass(frozen=True, slots=True)
class OpenCaseCountsView:
    total: int
    es: int
    pt: int


@dataclass(frozen=True, slots=True)
class AdminUserGuardsView:
    is_self: bool
    last_active_admin: bool


@dataclass(frozen=True, slots=True)
class AdminUserView:
    id: str
    name: str
    email: str
    roles: tuple[StaffRole, ...]
    languages: tuple[Language, ...]
    team: TeamRefView
    status: AccountStatus
    locked_until: datetime | None
    failed_attempts: int
    last_login_at: datetime | None
    availability: AvailabilityStatus | None
    open_cases: OpenCaseCountsView
    created_at: datetime
    guards: AdminUserGuardsView
    version: int


@dataclass(frozen=True, slots=True)
class RoleCountsView:
    all: int
    analyst: int
    supervisor: int
    admin: int


@dataclass(frozen=True, slots=True)
class UserStatusCountsView:
    active: int
    locked: int
    inactive: int
    all: int


@dataclass(frozen=True, slots=True)
class AdminUserListView:
    items: tuple[AdminUserView, ...]
    role_counts: RoleCountsView
    status_counts: UserStatusCountsView
    server_time: datetime


@dataclass(frozen=True, slots=True)
class UserFilters:
    query: str | None = None
    role: StaffRole | None = None
    status: UserStatusFilter = UserStatusFilter.ACTIVE
    team_id: str | None = None
    language: Language | None = None


@dataclass(frozen=True, slots=True)
class CreateUserCommand:
    name: str
    email: str
    roles: tuple[StaffRole, ...]
    languages: tuple[Language, ...]
    team_id: str
    idempotency_key: str | None = None


@dataclass(frozen=True, slots=True)
class UpdateUserCommand:
    """Absent (``None``) = unchanged."""

    expected_version: int
    name: str | None = None
    email: str | None = None
    roles: tuple[StaffRole, ...] | None = None
    languages: tuple[Language, ...] | None = None
    team_id: str | None = None


@dataclass(frozen=True, slots=True)
class CreatedUserView:
    user: AdminUserView
    temporary_password: str | None
    """``None`` only on an idempotent replay (the password was shown once)."""
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class AdminUserChangeView:
    changed: bool
    user: AdminUserView
    revoked_sessions: int = 0


@dataclass(frozen=True, slots=True)
class PasswordResetView:
    user: AdminUserView
    temporary_password: str
    revoked_sessions: int


# ----------------------------------------------------------------------------- teams
@dataclass(frozen=True, slots=True)
class AdminTeamView:
    id: str
    name: str
    active: bool
    member_count: int
    analyst_count: int
    inactive_member_count: int
    created_at: datetime
    version: int


@dataclass(frozen=True, slots=True)
class TeamStatusCountsView:
    active: int
    inactive: int
    all: int


@dataclass(frozen=True, slots=True)
class AdminTeamListView:
    items: tuple[AdminTeamView, ...]
    status_counts: TeamStatusCountsView


@dataclass(frozen=True, slots=True)
class AdminTeamMemberView:
    id: str
    name: str
    roles: tuple[StaffRole, ...]
    languages: tuple[Language, ...]
    status: AccountStatus


@dataclass(frozen=True, slots=True)
class AdminTeamDetailView:
    team: AdminTeamView
    members: tuple[AdminTeamMemberView, ...]


@dataclass(frozen=True, slots=True)
class CreatedTeamView:
    team: AdminTeamView
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class AdminTeamChangeView:
    changed: bool
    team: AdminTeamView
