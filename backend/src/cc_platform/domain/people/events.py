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
    """An analyst switched between "Disponible" and "En pausa"."""

    event_type = "staff.availability_changed"
    entity = "staff"

    from_status: str
    to_status: str
