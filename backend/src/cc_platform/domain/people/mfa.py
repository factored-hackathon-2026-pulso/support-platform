"""MFA challenge aggregate: the second step of the password login (canvas ``BoMfa``)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.domain.people.errors import MfaChallengeInvalidError
from cc_platform.domain.people.events import MfaChallengeIssued, MfaVerificationFailed
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


class MfaMethod(StrEnum):
    TOTP = "totp"
    SMS = "sms"
    BACKUP_CODE = "backup_code"


class MfaChallengeStatus(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    EXHAUSTED = "exhausted"


@dataclass(frozen=True, slots=True)
class MfaPolicy:
    ttl: timedelta = timedelta(minutes=5)
    max_attempts: int = 3

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise InvalidValueError("max_attempts must be >= 1", field="max_attempts")
        if self.ttl <= timedelta(0):
            raise InvalidValueError("ttl must be positive", field="ttl")


@dataclass(eq=False)
class MfaChallenge(AggregateRoot):
    id: str
    staff_id: str
    issued_at: datetime
    expires_at: datetime
    max_attempts: int
    attempts: int = 0
    status: MfaChallengeStatus = MfaChallengeStatus.PENDING
    verified_at: datetime | None = None
    method: MfaMethod | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.MFA_CHALLENGE)
        require_id(self.staff_id, IdPrefix.STAFF)
        if self.expires_at <= self.issued_at:
            raise InvalidValueError("challenge must expire after it is issued", field="expires_at")

    @classmethod
    def issue(
        cls,
        *,
        challenge_id: str,
        staff_id: str,
        now: datetime,
        policy: MfaPolicy,
        actor: ActorRef,
    ) -> MfaChallenge:
        challenge = cls(
            id=challenge_id,
            staff_id=staff_id,
            issued_at=now,
            expires_at=now + policy.ttl,
            max_attempts=policy.max_attempts,
        )
        challenge._record(
            MfaChallengeIssued(
                occurred_at=now,
                actor=actor,
                entity_id=challenge_id,
                staff_id=staff_id,
                expires_at=challenge.expires_at,
            )
        )
        return challenge

    @property
    def remaining_attempts(self) -> int:
        return max(self.max_attempts - self.attempts, 0)

    def is_open(self, now: datetime) -> bool:
        return self.status is MfaChallengeStatus.PENDING and now < self.expires_at

    def ensure_open(self, now: datetime) -> None:
        if not self.is_open(now):
            raise MfaChallengeInvalidError()

    def register_failure(self, *, now: datetime, actor: ActorRef) -> int:
        """Count a wrong code; returns the attempts left on this challenge."""
        self.ensure_open(now)
        self.attempts += 1
        if self.remaining_attempts == 0:
            self.status = MfaChallengeStatus.EXHAUSTED
        self._record(
            MfaVerificationFailed(
                occurred_at=now,
                actor=actor,
                entity_id=self.id,
                staff_id=self.staff_id,
                attempts=self.attempts,
                remaining_attempts=self.remaining_attempts,
            )
        )
        return self.remaining_attempts

    def complete(self, *, now: datetime, method: MfaMethod) -> None:
        if not self.is_open(now):
            raise InvalidTransitionError(
                "only an open challenge can be verified", currentStatus=self.status.value
            )
        self.status = MfaChallengeStatus.VERIFIED
        self.verified_at = now
        self.method = method
