"""Staff session aggregate: what a signed session token points to.

The token itself is stateless (signed claims), but logout must work before expiry, so the
session is also stored and checked on every request (revocation list of size one).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.domain.people.events import SessionEnded, SessionStarted
from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


class SessionEndReason(StrEnum):
    LOGOUT = "logout"
    REVOKED = "revoked"


@dataclass(eq=False)
class StaffSession(AggregateRoot):
    id: str
    staff_id: str
    issued_at: datetime
    expires_at: datetime
    mfa_method: MfaMethod
    ended_at: datetime | None = None
    end_reason: SessionEndReason | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.SESSION)
        require_id(self.staff_id, IdPrefix.STAFF)
        if self.expires_at <= self.issued_at:
            raise InvalidValueError("session must expire after it starts", field="expires_at")

    @classmethod
    def start(
        cls,
        *,
        session_id: str,
        staff_id: str,
        now: datetime,
        ttl: timedelta,
        mfa_method: MfaMethod,
        actor: ActorRef,
    ) -> StaffSession:
        session = cls(
            id=session_id,
            staff_id=staff_id,
            issued_at=now,
            expires_at=now + ttl,
            mfa_method=mfa_method,
        )
        session._record(
            SessionStarted(
                occurred_at=now,
                actor=actor,
                entity_id=session_id,
                staff_id=staff_id,
                mfa_method=mfa_method.value,
                expires_at=session.expires_at,
            )
        )
        return session

    def is_active(self, now: datetime) -> bool:
        return self.ended_at is None and now < self.expires_at

    def is_expired(self, now: datetime) -> bool:
        return now >= self.expires_at

    def end(self, *, now: datetime, reason: SessionEndReason, actor: ActorRef) -> None:
        """End the session. Idempotent: ending an ended session records nothing."""
        if self.ended_at is not None:
            return
        self.ended_at = now
        self.end_reason = reason
        self._record(
            SessionEnded(
                occurred_at=now,
                actor=actor,
                entity_id=self.id,
                staff_id=self.staff_id,
                reason=reason.value,
            )
        )
