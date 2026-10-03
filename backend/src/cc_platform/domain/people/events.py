"""Domain events of the people context.

Payloads never include passwords, MFA codes or token material: the event log is the audit
trail (contract principle: personal data masked, secrets never stored).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject


@dataclass(frozen=True, kw_only=True, slots=True)
class LoginFailed(DomainEvent):
    event_type = "auth.login_failed"
    entity = "staff"

    factor: str  # "password" or "mfa" (AuthFactor)
    failed_attempts: int
    remaining_attempts: int


@dataclass(frozen=True, kw_only=True, slots=True)
class AccountLocked(DomainEvent):
    event_type = "auth.account_locked"
    entity = "staff"

    locked_until: datetime
    failed_attempts: int


@dataclass(frozen=True, kw_only=True, slots=True)
class PasswordAccepted(DomainEvent):
    event_type = "auth.password_accepted"
    entity = "staff"


@dataclass(frozen=True, kw_only=True, slots=True)
class MfaChallengeIssued(DomainEvent):
    event_type = "auth.mfa_challenge_issued"
    entity = "mfa_challenge"

    staff_id: str
    expires_at: datetime


@dataclass(frozen=True, kw_only=True, slots=True)
class MfaVerificationFailed(DomainEvent):
    event_type = "auth.mfa_failed"
    entity = "mfa_challenge"

    staff_id: str
    attempts: int
    remaining_attempts: int


@dataclass(frozen=True, kw_only=True, slots=True)
class SessionStarted(DomainEvent):
    event_type = "auth.session_started"
    entity = "staff_session"

    staff_id: str
    mfa_method: str
    expires_at: datetime


@dataclass(frozen=True, kw_only=True, slots=True)
class SessionEnded(DomainEvent):
    event_type = "auth.session_ended"
    entity = "staff_session"

    staff_id: str
    reason: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffAvailabilityChanged(DomainEvent):
    """An analyst switched between "Disponible" and "En pausa".

    ``reason`` is set only when administration paused her (``deactivated`` or
    ``role_removed``); it is absent from the payload when she changed it herself.
    """

    event_type = "staff.availability_changed"
    entity = "staff"

    from_status: str
    to_status: str
    reason: str | None = None

    def payload(self) -> JsonObject:
        payload = DomainEvent.payload(self)
        if payload.get("reason") is None:
            payload.pop("reason", None)
        return payload


# ----------------------------------------------------------------------------- administration
# Slice 4 §2.4: every event below has ``actor = ActorRef(admin, <admin id>)`` and no case.
# Lists keep a canonical order (roles: analyst, supervisor, admin; languages sorted) and
# team names are the names at the time (a later rename never rewrites the log).


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffCreated(DomainEvent):
    event_type = "staff.created"
    entity = "staff"

    name: str
    roles: tuple[str, ...]
    languages: tuple[str, ...]
    team_id: str
    team_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffProfileUpdated(DomainEvent):
    """Name and/or email changed (one event for both). Never carries the email."""

    event_type = "staff.profile_updated"
    entity = "staff"

    changed_fields: tuple[str, ...]
    from_name: str
    to_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffRolesChanged(DomainEvent):
    event_type = "staff.roles_changed"
    entity = "staff"

    from_roles: tuple[str, ...]
    to_roles: tuple[str, ...]
    added: tuple[str, ...]
    removed: tuple[str, ...]


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffLanguagesChanged(DomainEvent):
    event_type = "staff.languages_changed"
    entity = "staff"

    from_languages: tuple[str, ...]
    to_languages: tuple[str, ...]
    added: tuple[str, ...]
    removed: tuple[str, ...]


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffTeamChanged(DomainEvent):
    event_type = "staff.team_changed"
    entity = "staff"

    from_team_id: str
    from_team_name: str
    to_team_id: str
    to_team_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffDeactivated(DomainEvent):
    event_type = "staff.deactivated"
    entity = "staff"

    revoked_sessions: int


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffReactivated(DomainEvent):
    event_type = "staff.reactivated"
    entity = "staff"


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffAccountUnlocked(DomainEvent):
    event_type = "staff.account_unlocked"
    entity = "staff"

    was_locked: bool
    failed_attempts: int


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffPasswordReset(DomainEvent):
    """A new temporary password was issued (the password itself is never recorded)."""

    event_type = "staff.password_reset"
    entity = "staff"

    revoked_sessions: int
    cleared_lock: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamCreated(DomainEvent):
    event_type = "team.created"
    entity = "team"

    name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamRenamed(DomainEvent):
    event_type = "team.renamed"
    entity = "team"

    from_name: str
    to_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamDeactivated(DomainEvent):
    event_type = "team.deactivated"
    entity = "team"

    name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamReactivated(DomainEvent):
    event_type = "team.reactivated"
    entity = "team"

    name: str


#: Every event administration records about a person (``staff.*`` minus availability).
STAFF_ADMIN_EVENTS: tuple[type[DomainEvent], ...] = (
    StaffCreated,
    StaffProfileUpdated,
    StaffRolesChanged,
    StaffLanguagesChanged,
    StaffTeamChanged,
    StaffDeactivated,
    StaffReactivated,
    StaffAccountUnlocked,
    StaffPasswordReset,
)

#: Every event of the ``Team`` aggregate.
TEAM_EVENTS: tuple[type[DomainEvent], ...] = (
    TeamCreated,
    TeamRenamed,
    TeamDeactivated,
    TeamReactivated,
)
