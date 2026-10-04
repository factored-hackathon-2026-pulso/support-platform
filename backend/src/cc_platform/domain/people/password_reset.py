"""Password reset link aggregate (part 4): administration sends a link, the person sets a
new password with it. Nobody else ever sees or types her password.

``SendPasswordResetLink`` (administration) issues a high-entropy, single-use token (only
its SHA-256 hash is stored) that lasts one hour (team-generated), ends her sessions and
records ``staff.password_reset_link_sent``. There is one row per person (``staff_id`` is
unique): sending another link replaces the token, so only the newest link works.
``CompletePasswordReset`` (the person, public route) uses it once (``use``) and replaces
the password hash of her login account (``staff.password_reset``).

States (stored): ``pending`` → ``used``; ``expired`` is derived (pending past
``expires_at``). Her password keeps working until she sets the new one (an attacker cannot
lock her out by asking for links), and her second factor never changes here: a reset link
alone cannot take over an account that has an authenticator.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.domain.people.events import StaffPasswordResetLinkSent
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

#: Team-generated: a reset link lasts one hour.
PASSWORD_RESET_TTL = timedelta(hours=1)


class PasswordResetState(StrEnum):
    PENDING = "pending"
    USED = "used"
    #: Derived (``state_at``): pending past ``expires_at``. Never stored.
    EXPIRED = "expired"


@dataclass(eq=False)
class PasswordReset(AggregateRoot):
    id: str
    staff_id: str
    token_hash: str
    sent_at: datetime
    expires_at: datetime
    created_by: str
    state: PasswordResetState = PasswordResetState.PENDING
    used_at: datetime | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.PASSWORD_RESET)
        require_id(self.staff_id, IdPrefix.STAFF)
        if not self.token_hash:
            raise InvalidValueError("token hash must not be empty", field="token_hash")
        if self.state is PasswordResetState.EXPIRED:
            raise InvalidValueError("expired is derived, never stored", field="state")
        if self.expires_at <= self.sent_at:
            raise InvalidValueError("a reset link expires after it is sent", field="expires_at")

    @classmethod
    def issue(
        cls,
        *,
        reset_id: str,
        staff_id: str,
        token_hash: str,
        now: datetime,
        actor: ActorRef,
        revoked_sessions: int,
        cleared_lock: bool,
        ttl: timedelta = PASSWORD_RESET_TTL,
    ) -> PasswordReset:
        reset = cls(
            id=reset_id,
            staff_id=staff_id,
            token_hash=token_hash,
            sent_at=now,
            expires_at=now + ttl,
            created_by=actor.actor_id or "",
        )
        reset._record_sent(now, actor, revoked_sessions=revoked_sessions, cleared_lock=cleared_lock)
        return reset

    def reissue(
        self,
        token_hash: str,
        *,
        now: datetime,
        actor: ActorRef,
        revoked_sessions: int,
        cleared_lock: bool,
        ttl: timedelta = PASSWORD_RESET_TTL,
    ) -> None:
        """A newer link (whatever the state of the previous one): only this token works."""
        if not token_hash:
            raise InvalidValueError("token hash must not be empty", field="token_hash")
        self.token_hash = token_hash
        self.sent_at = now
        self.expires_at = now + ttl
        self.created_by = actor.actor_id or self.created_by
        self.state = PasswordResetState.PENDING
        self.used_at = None
        self._record_sent(now, actor, revoked_sessions=revoked_sessions, cleared_lock=cleared_lock)

    def _record_sent(
        self, now: datetime, actor: ActorRef, *, revoked_sessions: int, cleared_lock: bool
    ) -> None:
        self._record(
            StaffPasswordResetLinkSent(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                reset_id=self.id,
                expires_at=self.expires_at,
                revoked_sessions=revoked_sessions,
                cleared_lock=cleared_lock,
            )
        )

    def state_at(self, now: datetime) -> PasswordResetState:
        if self.state is PasswordResetState.PENDING and now >= self.expires_at:
            return PasswordResetState.EXPIRED
        return self.state

    def is_usable(self, now: datetime) -> bool:
        return self.state_at(now) is PasswordResetState.PENDING

    def use(self, *, now: datetime) -> None:
        """Single use. No event of its own: ``staff.password_reset`` (her login account)
        is the audited fact."""
        if not self.is_usable(now):
            raise InvalidTransitionError("Este enlace ya no se puede usar.")
        self.state = PasswordResetState.USED
        self.used_at = now
