"""Domain events of the people context.

Payloads never include passwords, MFA codes or token material: the event log is the audit
trail (contract principle: personal data masked, secrets never stored).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.shared.events import DomainEvent


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

    omitted_when_null = frozenset({"reason"})


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffUiLanguageChanged(DomainEvent):
    """Slice 23: a person changed the language of her own platform UI (actor = herself).

    ``from_language`` / ``to_language`` are ``UiLanguage`` values (``es`` | ``pt-BR``).
    """

    event_type = "staff.ui_language_changed"
    entity = "staff"

    from_language: str
    to_language: str


# ----------------------------------------------------------------------------- administration
# Slice 4 §2.4: every event below has ``actor = ActorRef(admin, <admin id>)`` and no case.
# Lists keep a canonical order (roles: analyst, supervisor, admin; languages sorted) and
# team names are the names at the time (a later rename never rewrites the log).


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffCreated(DomainEvent):
    event_type = "staff.created"
    free_text_keys = frozenset({"name", "team_name"})
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
    free_text_keys = frozenset({"from_name", "to_name"})
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
    free_text_keys = frozenset({"from_team_name", "to_team_name"})
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
    """Part 4: the person set a new password through a reset link (actor = herself). The
    password is never recorded; ``cleared_lock`` says whether a lock was cleared with it."""

    event_type = "staff.password_reset"
    entity = "staff"

    cleared_lock: bool


# ----------------------------------------------------------------------------- onboarding
# Part 4 (secure onboarding): administration never sees or hands out a password. A new
# person gets an invitation by email (a single-use link), sets her own password and enrolls
# a TOTP authenticator; a forgotten password is replaced through a reset link. Every event
# is about the person (``entity = staff``, ``entity_id`` = her id); none carries an email,
# a token, a password or a TOTP secret.


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffInvitationSent(DomainEvent):
    """Administration invited her (a new person, or one whose invitation was cancelled)."""

    event_type = "staff.invitation_sent"
    entity = "staff"

    invitation_id: str
    expires_at: datetime


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffInvitationResent(DomainEvent):
    """A new link replaced the previous one (which stops working)."""

    event_type = "staff.invitation_resent"
    entity = "staff"

    invitation_id: str
    expires_at: datetime
    resend_count: int


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffInvitationCancelled(DomainEvent):
    event_type = "staff.invitation_cancelled"
    entity = "staff"

    invitation_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffInvitationAccepted(DomainEvent):
    """She set her password and her authenticator: the account is active (actor: herself).
    The notification projector maps it to ``invitation_accepted`` for administration."""

    event_type = "staff.invitation_accepted"
    entity = "staff"

    invitation_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffMfaEnrolled(DomainEvent):
    """She configured two-step verification (an authenticator app, RFC 6238)."""

    event_type = "staff.mfa_enrolled"
    entity = "staff"

    method: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StaffPasswordResetLinkSent(DomainEvent):
    """Administration sent her a link to set a new password; her sessions ended now."""

    event_type = "staff.password_reset_link_sent"
    entity = "staff"

    reset_id: str
    expires_at: datetime
    revoked_sessions: int
    cleared_lock: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamCreated(DomainEvent):
    event_type = "team.created"
    free_text_keys = frozenset({"name"})
    entity = "team"

    name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamRenamed(DomainEvent):
    event_type = "team.renamed"
    free_text_keys = frozenset({"from_name", "to_name"})
    entity = "team"

    from_name: str
    to_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamDeactivated(DomainEvent):
    event_type = "team.deactivated"
    free_text_keys = frozenset({"name"})
    entity = "team"

    name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TeamReactivated(DomainEvent):
    event_type = "team.reactivated"
    free_text_keys = frozenset({"name"})
    entity = "team"

    name: str


#: Every event about a person's account (``staff.*`` minus availability): administration's
#: changes and, since part 4, the invitation and reset links (some recorded by herself).
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
    StaffInvitationSent,
    StaffInvitationResent,
    StaffInvitationCancelled,
    StaffInvitationAccepted,
    StaffMfaEnrolled,
    StaffPasswordResetLinkSent,
)

#: Part 4: what the onboarding links record (a subset of ``STAFF_ADMIN_EVENTS``).
ONBOARDING_EVENTS: tuple[type[DomainEvent], ...] = (
    StaffInvitationSent,
    StaffInvitationResent,
    StaffInvitationCancelled,
    StaffInvitationAccepted,
    StaffMfaEnrolled,
    StaffPasswordResetLinkSent,
)

#: Every event of the ``Team`` aggregate.
TEAM_EVENTS: tuple[type[DomainEvent], ...] = (
    TeamCreated,
    TeamRenamed,
    TeamDeactivated,
    TeamReactivated,
)
