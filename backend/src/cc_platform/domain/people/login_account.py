"""Login account aggregate: password credential and brute-force lockout of a staff member.

Kept apart from ``Staff`` on purpose: profile data (name, roles, team) and security state
(password hash, failed attempts) change for different reasons and are read by different
use cases. One ``LoginAccount`` per staff member, keyed by ``staff_id``.

Lockout rules live in one value object, ``FailedAttemptCounter``. The aggregate uses it for
real accounts, and the login use case uses the very same object for emails that match no
account (``UnknownLoginAttempts`` only stores it), so both answer identically: the
countdown never reveals which emails belong to staff.

Both factors count: a wrong password and a wrong MFA code each add one failure, and the
counter is only reset by a complete sign-in (``register_login``). A correct password alone
does not reset it, otherwise "log in again → three fresh MFA guesses" would be unlimited.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.domain.people.errors import AccountLockedError
from cc_platform.domain.people.events import (
    AccountLocked,
    LoginFailed,
    PasswordAccepted,
    StaffAccountUnlocked,
    StaffPasswordReset,
)
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


class AuthFactor(StrEnum):
    """Which step of the sign-in failed (recorded on ``auth.login_failed``)."""

    PASSWORD = "password"  # noqa: S105 - factor name, not a secret
    MFA = "mfa"


@dataclass(frozen=True, slots=True)
class LockoutPolicy:
    """Canvas ``BoLogin``/``BoLocked``: 5 failed attempts lock the account for 15 minutes."""

    max_failed_attempts: int = 5
    lock_duration: timedelta = timedelta(minutes=15)

    def __post_init__(self) -> None:
        if self.max_failed_attempts < 1:
            raise InvalidValueError("max_failed_attempts must be >= 1", field="max_failed_attempts")
        if self.lock_duration <= timedelta(0):
            raise InvalidValueError("lock_duration must be positive", field="lock_duration")


@dataclass(frozen=True, slots=True)
class FailedAttemptOutcome:
    remaining_attempts: int
    locked_until: datetime | None

    @property
    def locked(self) -> bool:
        return self.locked_until is not None


@dataclass(frozen=True, slots=True)
class FailedAttemptCounter:
    """Consecutive failed sign-in attempts and the lock they caused (immutable value object).

    Every transition returns a new counter; callers store it. The rules:

    - while ``locked_until`` is in the future, any attempt raises ``AccountLockedError``;
    - once the lock is over the counter starts again from zero;
    - the ``policy.max_failed_attempts``-th failure locks for ``policy.lock_duration``.
    """

    failed_attempts: int = 0
    locked_until: datetime | None = None

    def __post_init__(self) -> None:
        if self.failed_attempts < 0:
            raise InvalidValueError("failed attempts cannot be negative", field="failed_attempts")

    @property
    def is_clear(self) -> bool:
        return self.failed_attempts == 0 and self.locked_until is None

    def is_locked(self, now: datetime) -> bool:
        return self.locked_until is not None and now < self.locked_until

    def current(self, now: datetime) -> FailedAttemptCounter:
        """This counter, or a fresh one when its lock has already expired."""
        if self.locked_until is not None and now >= self.locked_until:
            return FailedAttemptCounter()
        return self

    def ensure_can_attempt(self, now: datetime) -> FailedAttemptCounter:
        """Raise ``AccountLockedError`` while locked; otherwise return the current counter."""
        counter = self.current(now)
        if counter.locked_until is not None:
            raise AccountLockedError(unlock_at=counter.locked_until)
        return counter

    def register_failure(self, now: datetime, policy: LockoutPolicy) -> FailedAttemptCounter:
        counter = self.ensure_can_attempt(now)
        failed = counter.failed_attempts + 1
        locked_until = now + policy.lock_duration if failed >= policy.max_failed_attempts else None
        return FailedAttemptCounter(failed_attempts=failed, locked_until=locked_until)

    def remaining(self, policy: LockoutPolicy) -> int:
        return max(policy.max_failed_attempts - self.failed_attempts, 0)

    def outcome(self, policy: LockoutPolicy) -> FailedAttemptOutcome:
        return FailedAttemptOutcome(
            remaining_attempts=0 if self.locked_until else self.remaining(policy),
            locked_until=self.locked_until,
        )


@dataclass(eq=False)
class LoginAccount(AggregateRoot):
    staff_id: str
    password_hash: str
    failed_attempts: int = 0
    locked_until: datetime | None = None
    last_login_at: datetime | None = None

    def __post_init__(self) -> None:
        require_id(self.staff_id, IdPrefix.STAFF)
        if not self.password_hash:
            raise InvalidValueError("password hash must not be empty", field="password_hash")
        self._apply(self.attempts)  # validates the counter fields

    @property
    def attempts(self) -> FailedAttemptCounter:
        return FailedAttemptCounter(self.failed_attempts, self.locked_until)

    def _apply(self, counter: FailedAttemptCounter) -> None:
        self.failed_attempts = counter.failed_attempts
        self.locked_until = counter.locked_until

    def is_locked(self, now: datetime) -> bool:
        return self.attempts.is_locked(now)

    def ensure_can_attempt(self, now: datetime) -> None:
        """Raise ``AccountLockedError`` while locked; clear an expired lock otherwise."""
        self._apply(self.attempts.ensure_can_attempt(now))

    def register_failed_attempt(
        self,
        *,
        now: datetime,
        policy: LockoutPolicy,
        actor: ActorRef,
        factor: AuthFactor = AuthFactor.PASSWORD,
    ) -> FailedAttemptOutcome:
        counter = self.attempts.register_failure(now, policy)
        self._apply(counter)
        outcome = counter.outcome(policy)
        self._record(
            LoginFailed(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                factor=factor.value,
                failed_attempts=counter.failed_attempts,
                remaining_attempts=counter.remaining(policy),
            )
        )
        if counter.locked_until is not None:
            self._record(
                AccountLocked(
                    occurred_at=now,
                    actor=actor,
                    entity_id=self.staff_id,
                    locked_until=counter.locked_until,
                    failed_attempts=counter.failed_attempts,
                )
            )
        return outcome

    def register_password_accepted(self, *, now: datetime, actor: ActorRef) -> None:
        """First factor passed. The failure counter is kept until the second factor passes."""
        self.ensure_can_attempt(now)
        self._record(PasswordAccepted(occurred_at=now, actor=actor, entity_id=self.staff_id))

    def register_login(self, *, now: datetime) -> None:
        """Called once the second factor succeeded and a session exists: resets the counter."""
        self.ensure_can_attempt(now)
        self._apply(FailedAttemptCounter())
        self.last_login_at = now

    def unlock(self, *, now: datetime, actor: ActorRef) -> bool:
        """Administration clears the failure counter (and a lock, if any).

        ``False`` (nothing recorded) when the counter is already clear: no failures, no
        lock, or a lock that has already expired (it would reset on its own).
        """
        current = self.attempts.current(now)
        if current.is_clear:
            return False
        was_locked = current.is_locked(now)
        self._apply(FailedAttemptCounter())
        self._record(
            StaffAccountUnlocked(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                was_locked=was_locked,
                failed_attempts=current.failed_attempts,
            )
        )
        return True

    def reset_password(
        self, new_hash: str, *, now: datetime, actor: ActorRef, revoked_sessions: int
    ) -> None:
        """A new (temporary) password: replaces the hash and clears the counter and lock."""
        cleared_lock = self.is_locked(now)
        self.change_password_hash(new_hash)
        self._apply(FailedAttemptCounter())
        self._record(
            StaffPasswordReset(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                revoked_sessions=revoked_sessions,
                cleared_lock=cleared_lock,
            )
        )

    def change_password_hash(self, new_hash: str) -> None:
        if not new_hash:
            raise InvalidValueError("password hash must not be empty", field="password_hash")
        self.password_hash = new_hash
