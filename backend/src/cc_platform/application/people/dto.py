"""Inputs and outputs of the people use cases (plain dataclasses, no framework types)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.staff import Language, Staff, StaffLevel, StaffRole


@dataclass(frozen=True, slots=True)
class StaffView:
    id: str
    name: str
    email: str
    roles: tuple[StaffRole, ...]
    level: StaffLevel
    languages: tuple[Language, ...]
    team: str
    requires_four_eyes: bool

    @classmethod
    def from_staff(cls, staff: Staff) -> StaffView:
        return cls(
            id=staff.id,
            name=staff.name,
            email=staff.email,
            roles=tuple(sorted(staff.roles, key=_role_order)),
            level=staff.level,
            languages=tuple(sorted(staff.languages)),
            team=staff.team,
            requires_four_eyes=staff.requires_four_eyes,
        )


def _role_order(role: StaffRole) -> int:
    return list(StaffRole).index(role)


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
