"""Inputs and outputs of the people use cases (plain dataclasses, no framework types)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.preferences import UiLanguage
from cc_platform.domain.people.staff import (
    Language,
    Staff,
    StaffRole,
    canonical_roles,
    sorted_languages,
)
from cc_platform.domain.people.team import Team


@dataclass(frozen=True, slots=True)
class TeamRefView:
    """A team as other views reference it (supervision rows, ``StaffOut.team``)."""

    id: str
    name: str

    @classmethod
    def of(cls, team: Team) -> TeamRefView:
        return cls(id=team.id, name=team.name)


@dataclass(frozen=True, slots=True)
class StaffView:
    id: str
    name: str
    email: str
    roles: tuple[StaffRole, ...]
    languages: tuple[Language, ...]
    team: TeamRefView
    active: bool

    @classmethod
    def from_staff(cls, staff: Staff, team: Team) -> StaffView:
        return cls(
            id=staff.id,
            name=staff.name,
            email=staff.email,
            roles=canonical_roles(staff.roles),
            languages=sorted_languages(staff.languages),
            team=TeamRefView.of(team),
            active=staff.active,
        )


@dataclass(frozen=True, slots=True)
class LoginCommand:
    email: str
    password: str


@dataclass(frozen=True, slots=True)
class LoginResult:
    challenge_id: str
    expires_at: datetime
    methods: tuple[MfaMethod, ...]
    mfa_required: bool = True


@dataclass(frozen=True, slots=True)
class VerifyMfaCommand:
    challenge_id: str
    code: str
    method: MfaMethod = MfaMethod.TOTP


@dataclass(frozen=True, slots=True)
class SessionGrant:
    token: str
    session_id: str
    expires_at: datetime
    staff: StaffView


@dataclass(frozen=True, slots=True)
class CurrentStaff:
    staff: StaffView
    session_id: str
    session_expires_at: datetime
    ui_language: UiLanguage
    """Slice 23: her own UI language (``StaffPreferences``)."""
