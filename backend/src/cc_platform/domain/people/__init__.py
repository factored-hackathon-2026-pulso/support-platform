"""People context: staff, their roles and how they sign in."""

from cc_platform.domain.people.errors import AccountLockedError, MfaChallengeInvalidError
from cc_platform.domain.people.events import (
    AccountLocked,
    LoginFailed,
    MfaChallengeIssued,
    MfaVerificationFailed,
    PasswordAccepted,
    SessionEnded,
    SessionStarted,
)
from cc_platform.domain.people.login_account import (
    AuthFactor,
    FailedAttemptCounter,
    FailedAttemptOutcome,
    LockoutPolicy,
    LoginAccount,
)
from cc_platform.domain.people.mfa import MfaChallenge, MfaChallengeStatus, MfaMethod, MfaPolicy
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import (
    ROLE_PRECEDENCE,
    Language,
    Staff,
    StaffLevel,
    StaffRole,
    normalize_email,
)

__all__ = [
    "ROLE_PRECEDENCE",
    "AccountLocked",
    "AccountLockedError",
    "AuthFactor",
    "FailedAttemptCounter",
    "FailedAttemptOutcome",
    "Language",
    "LockoutPolicy",
    "LoginAccount",
    "LoginFailed",
    "MfaChallenge",
    "MfaChallengeInvalidError",
    "MfaChallengeIssued",
    "MfaChallengeStatus",
    "MfaMethod",
    "MfaPolicy",
    "MfaVerificationFailed",
    "PasswordAccepted",
    "SessionEndReason",
    "SessionEnded",
    "SessionStarted",
    "Staff",
    "StaffLevel",
    "StaffRole",
    "StaffSession",
    "normalize_email",
]
