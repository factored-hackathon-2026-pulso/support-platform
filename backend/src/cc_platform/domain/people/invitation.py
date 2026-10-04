"""Invitation aggregate (part 4): how a new person gets into the platform.

Administration never sees or hands out a password. Creating a person creates her ``Staff``
record in the ``invited`` setup (inactive: she cannot sign in) and one ``Invitation``: a
high-entropy, single-use token sent by email as a link (``/activar?token=…``). Only the
SHA-256 hash of the token is stored. With the link she

1. sets her own password (``start_enrollment``: the hash and a fresh TOTP secret, sealed,
   wait on the invitation; a new password starts over with a new secret), then
2. proves her authenticator app with a 6-digit code (``accept``): her login account is
   created with that password and that secret, her ``Staff`` becomes active, and the
   invitation is ``accepted`` (the token is used up).

States (stored): ``pending`` → ``accepted`` | ``cancelled``; ``cancelled`` → ``pending``
when she is invited again (``reissue``). ``expired`` is derived, never stored: a pending
invitation past ``expires_at`` (48 hours after the last send, team-generated). There is
one invitation per person (the repository keeps ``staff_id`` unique), so "one pending
invitation per person" holds by construction; resending replaces the token (the old link
stops working) and restarts the 48 hours.

Wrong codes during the enrollment count on the invitation with the login lockout rules
(``FailedAttemptCounter``: 5 wrong codes lock it for 15 minutes), so a stolen link cannot
buy unlimited guesses either. They record no event (security counter, like the unknown-email
counters of the login).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.domain.people.events import (
    StaffInvitationAccepted,
    StaffInvitationCancelled,
    StaffInvitationResent,
    StaffInvitationSent,
)
from cc_platform.domain.people.login_account import (
    FailedAttemptCounter,
    FailedAttemptOutcome,
    LockoutPolicy,
)
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

#: Team-generated: an invitation link lasts 48 hours after it was (re)sent.
INVITATION_TTL = timedelta(hours=48)


class InvitationState(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    CANCELLED = "cancelled"
    #: Derived (``state_at``): pending past ``expires_at``. Never stored.
    EXPIRED = "expired"


_STORED_STATES = frozenset(
    {InvitationState.PENDING, InvitationState.ACCEPTED, InvitationState.CANCELLED}
)


@dataclass(eq=False)
class Invitation(AggregateRoot):
    id: str
    staff_id: str
    token_hash: str
    created_at: datetime
    sent_at: datetime
    expires_at: datetime
    created_by: str
    state: InvitationState = InvitationState.PENDING
    resend_count: int = 0
    accepted_at: datetime | None = None
    cancelled_at: datetime | None = None
    #: Enrollment in progress (between her password and her code); cleared when it ends.
    password_hash: str | None = None
    totp_secret: str | None = None
    failed_codes: int = 0
    locked_until: datetime | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.INVITATION)
        require_id(self.staff_id, IdPrefix.STAFF)
        if not self.token_hash:
            raise InvalidValueError("token hash must not be empty", field="token_hash")
        if self.state not in _STORED_STATES:
            raise InvalidValueError("expired is derived, never stored", field="state")
        if self.expires_at <= self.sent_at:
            raise InvalidValueError("an invitation expires after it is sent", field="expires_at")
        if self.resend_count < 0:
            raise InvalidValueError("resend count cannot be negative", field="resend_count")
        FailedAttemptCounter(self.failed_codes, self.locked_until)  # validates the counter

    # ------------------------------------------------------------------ creation
    @classmethod
    def send(
        cls,
        *,
        invitation_id: str,
        staff_id: str,
        token_hash: str,
        now: datetime,
        actor: ActorRef,
        ttl: timedelta = INVITATION_TTL,
    ) -> Invitation:
        """A new invitation for a new person (records ``staff.invitation_sent``)."""
        invitation = cls(
            id=invitation_id,
            staff_id=staff_id,
            token_hash=token_hash,
            created_at=now,
            sent_at=now,
            expires_at=now + ttl,
            created_by=actor.actor_id or "",
        )
        invitation._record_sent(now, actor)
        return invitation

    def _record_sent(self, now: datetime, actor: ActorRef) -> None:
        self._record(
            StaffInvitationSent(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                invitation_id=self.id,
                expires_at=self.expires_at,
            )
        )

    # ------------------------------------------------------------------ queries
    def state_at(self, now: datetime) -> InvitationState:
        if self.state is InvitationState.PENDING and now >= self.expires_at:
            return InvitationState.EXPIRED
        return self.state

    def is_usable(self, now: datetime) -> bool:
        """The link works: pending and not expired."""
        return self.state_at(now) is InvitationState.PENDING

    @property
    def enrollment_started(self) -> bool:
        return self.password_hash is not None and self.totp_secret is not None

    @property
    def attempts(self) -> FailedAttemptCounter:
        return FailedAttemptCounter(self.failed_codes, self.locked_until)

    # ------------------------------------------------------------------ administration
    def resend(self, token_hash: str, *, now: datetime, actor: ActorRef, ttl: timedelta) -> None:
        """A new link (pending or expired): the previous token stops working, the 48 hours
        start again and an enrollment in progress starts over."""
        if self.state is not InvitationState.PENDING:
            raise InvalidTransitionError("Solo se reenvía una invitación pendiente.")
        self._new_link(token_hash, now=now, ttl=ttl)
        self.resend_count += 1
        self._record(
            StaffInvitationResent(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                invitation_id=self.id,
                expires_at=self.expires_at,
                resend_count=self.resend_count,
            )
        )

    def reissue(self, token_hash: str, *, now: datetime, actor: ActorRef, ttl: timedelta) -> None:
        """Invite again a person whose invitation was cancelled (records
        ``staff.invitation_sent``, as a first invitation)."""
        if self.state is not InvitationState.CANCELLED:
            raise InvalidTransitionError(
                "Solo se vuelve a invitar a quien tenía la invitación cancelada."
            )
        self.state = InvitationState.PENDING
        self.cancelled_at = None
        self.resend_count = 0
        self.created_by = actor.actor_id or self.created_by
        self._new_link(token_hash, now=now, ttl=ttl)
        self._record_sent(now, actor)

    def _new_link(self, token_hash: str, *, now: datetime, ttl: timedelta) -> None:
        if not token_hash:
            raise InvalidValueError("token hash must not be empty", field="token_hash")
        self.token_hash = token_hash
        self.sent_at = now
        self.expires_at = now + ttl
        self._clear_enrollment()

    def cancel(self, *, now: datetime, actor: ActorRef) -> None:
        """The link stops working and the account is not created (pending or expired)."""
        if self.state is not InvitationState.PENDING:
            raise InvalidTransitionError("Esta invitación ya no está pendiente.")
        self.state = InvitationState.CANCELLED
        self.cancelled_at = now
        self._clear_enrollment()
        self._record(
            StaffInvitationCancelled(
                occurred_at=now, actor=actor, entity_id=self.staff_id, invitation_id=self.id
            )
        )

    def _clear_enrollment(self) -> None:
        self.password_hash = None
        self.totp_secret = None

    # ------------------------------------------------------------------ the person
    def start_enrollment(self, *, password_hash: str, totp_secret: str, now: datetime) -> None:
        """Step 1: her password (hashed) and a new TOTP secret (sealed) wait here until she
        proves the code. Doing it again replaces both (the failure counter is kept)."""
        self._ensure_usable(now)
        if not password_hash or not totp_secret:
            raise InvalidValueError("enrollment needs a password hash and a secret")
        self.password_hash = password_hash
        self.totp_secret = totp_secret

    def ensure_can_try_code(self, now: datetime) -> None:
        """Raise ``AccountLockedError`` while wrong codes lock it; clear an expired lock."""
        counter = self.attempts.ensure_can_attempt(now)
        self.failed_codes, self.locked_until = counter.failed_attempts, counter.locked_until

    def register_wrong_code(self, *, now: datetime, policy: LockoutPolicy) -> FailedAttemptOutcome:
        counter = self.attempts.register_failure(now, policy)
        self.failed_codes, self.locked_until = counter.failed_attempts, counter.locked_until
        return counter.outcome(policy)

    def accept(self, *, now: datetime, actor: ActorRef) -> None:
        """Step 2 passed: the token is used up (records ``staff.invitation_accepted``)."""
        self._ensure_usable(now)
        if not self.enrollment_started:
            raise InvalidTransitionError("Primero crea tu contraseña.")
        self.state = InvitationState.ACCEPTED
        self.accepted_at = now
        self.failed_codes, self.locked_until = 0, None
        self._clear_enrollment()
        self._record(
            StaffInvitationAccepted(
                occurred_at=now, actor=actor, entity_id=self.staff_id, invitation_id=self.id
            )
        )

    def _ensure_usable(self, now: datetime) -> None:
        if not self.is_usable(now):
            raise InvalidTransitionError("Esta invitación ya no se puede usar.")
