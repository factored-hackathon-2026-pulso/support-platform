"""Public onboarding use cases (part 4): the invitation and password-reset links.

No session: the link's token is the only credential. Every use case

- first asks ``LinkGuard`` whether this client may try (429 ``rate_limited`` after too many
  unusable links, like the login lockout of unknown emails: ``FailedAttemptCounter`` rules,
  process-local counters per client address);
- looks the token up by its hash and answers **one** problem, 410 ``link_invalid``, for a
  token that is unknown, expired, used or cancelled (and counts it on the guard): nothing
  tells an unknown token from another person's used one;
- runs its writes in ``retry_on_conflict`` (the invitation, the login account and the reset
  are saved with compare-and-set, so a link is redeemed once even under concurrent clicks).

The flows:

- **Invitation** (``/activate?token=…``): ``CheckInvitation`` (who she is, for the welcome
  line) → ``SetInvitationPassword`` (the password policy, checked here; Argon2id hash; a new
  TOTP secret, sealed; returns the ``otpauth://`` URI and the manual key, shown once) →
  ``ActivateInvitation`` (the 6-digit code of her app: the login account is created, she is
  active, the invitation is used up; ``staff.mfa_enrolled`` then
  ``staff.invitation_accepted``). Wrong codes count on the invitation (5 → 15 minutes,
  ``account_locked`` with ``unlockAt``).
- **Password reset** (``/reset-password?token=…``): ``CheckPasswordReset`` →
  ``CompletePasswordReset`` (policy, hash, ``staff.password_reset``; her sessions and pending
  MFA challenges end; her second factor does not change).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.people.admin.guards import load_roster, store_roster
from cc_platform.application.people.onboarding.dto import (
    ActivateCommand,
    ActivatedAccountView,
    InvitationPreview,
    PasswordResetDoneView,
    PasswordResetPreview,
    SetPasswordCommand,
    TotpEnrollmentView,
)
from cc_platform.application.people.onboarding.errors import (
    LinkInvalidError,
    TooManyAttemptsError,
    TotpCodeInvalidError,
)
from cc_platform.application.people.ports import UnknownLoginAttempts
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.security import (
    OneTimeTokens,
    PasswordHasher,
    SecretBox,
    TotpService,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.people.errors import AccountLockedError, PasswordRejectedError
from cc_platform.domain.people.invitation import Invitation
from cc_platform.domain.people.login_account import (
    FailedAttemptCounter,
    LockoutPolicy,
    LoginAccount,
)
from cc_platform.domain.people.password_policy import password_violations
from cc_platform.domain.people.password_reset import PasswordReset
from cc_platform.domain.people.session import SessionEndReason
from cc_platform.domain.people.staff import Staff, StaffRole, canonical_roles
from cc_platform.domain.shared.errors import InvalidTransitionError

#: Team-generated: 10 unusable links from one client lock the links for 15 minutes.
LINK_LOCKOUT = LockoutPolicy(max_failed_attempts=10)

#: Shape of a token as ``SecretsOneTimeTokens`` makes it (43 URL-safe characters); anything
#: else is unusable without a lookup.
_TOKEN_LENGTHS = range(16, 129)


# ----------------------------------------------------------------------------- the guard
@dataclass(frozen=True, slots=True)
class LinkGuard:
    """Per-client counter of unusable links (``UnknownLoginAttempts`` storage, keyed by
    ``link:<client address>``). A valid link never resets it (an attacker cannot interleave
    one to keep guessing)."""

    attempts: UnknownLoginAttempts
    clock: Clock
    policy: LockoutPolicy = LINK_LOCKOUT

    @staticmethod
    def _key(client: str) -> str:
        return f"link:{client}"

    async def ensure_open(self, client: str) -> None:
        counter = await self.attempts.get(self._key(client))
        try:
            counter.ensure_can_attempt(self.clock.now())
        except AccountLockedError as exc:
            raise TooManyAttemptsError(exc.unlock_at) from None

    async def unusable(self, client: str) -> LinkInvalidError:
        """Count one unusable link; returns the error to raise (429 once it locks)."""
        now, policy = self.clock.now(), self.policy

        def fail(counter: FailedAttemptCounter) -> FailedAttemptCounter:
            return counter.register_failure(now, policy)

        try:
            counter = await self.attempts.update(self._key(client), fail)
        except AccountLockedError as exc:
            raise TooManyAttemptsError(exc.unlock_at) from None
        if counter.locked_until is not None:
            raise TooManyAttemptsError(counter.locked_until)
        return LinkInvalidError()


def _plausible(token: str) -> bool:
    return len(token) in _TOKEN_LENGTHS


async def _invitation_for(
    uow: UnitOfWork, tokens: OneTimeTokens, token: str, now: datetime
) -> tuple[Invitation, Staff] | None:
    """The usable invitation of ``token`` and its invited person, else ``None``."""
    if not _plausible(token):
        return None
    invitation = await uow.invitations.get_by_token_hash(tokens.hash(token))
    if invitation is None or not invitation.is_usable(now):
        return None
    staff = await uow.staff.get(invitation.staff_id)
    if staff is None or not staff.is_invited:
        return None
    return invitation, staff


async def _reset_for(
    uow: UnitOfWork, tokens: OneTimeTokens, token: str, now: datetime
) -> tuple[PasswordReset, Staff, LoginAccount] | None:
    """The usable reset of ``token``, her (active) person and her login account."""
    if not _plausible(token):
        return None
    reset = await uow.password_resets.get_by_token_hash(tokens.hash(token))
    if reset is None or not reset.is_usable(now):
        return None
    staff = await uow.staff.get(reset.staff_id)
    account = await uow.login_accounts.get(reset.staff_id)
    if staff is None or not staff.active or account is None:
        return None
    return reset, staff, account


def ensure_password_policy(password: str, staff: Staff) -> None:
    violations = password_violations(password, email=staff.email, name=staff.name)
    if violations:
        raise PasswordRejectedError([rule.value for rule in violations])


@dataclass(slots=True)
class _OnceHash:
    """Hash one submitted password at most once per request (retries reuse it)."""

    hasher: PasswordHasher
    password: str
    _hash: str | None = field(default=None, repr=False)

    async def value(self) -> str:
        if self._hash is None:
            self._hash = await self.hasher.hash(self.password)
        return self._hash


# ----------------------------------------------------------------------------- invitation
@dataclass(frozen=True, slots=True)
class CheckInvitation:
    """``POST /onboarding/invitations/check``: who the link invites (the welcome line)."""

    uow: UnitOfWorkFactory
    tokens: OneTimeTokens
    clock: Clock
    guard: LinkGuard

    async def execute(self, token: str, *, client: str) -> InvitationPreview:
        await self.guard.ensure_open(client)
        now = self.clock.now()
        async with self.uow() as uow:
            found = await _invitation_for(uow, self.tokens, token, now)
            if found is None:
                raise await self.guard.unusable(client)
            invitation, staff = found
            team = await uow.teams.get(staff.team_id)
        return InvitationPreview(
            name=staff.name,
            email=staff.email,
            roles=canonical_roles(staff.roles),
            team_name=team.name if team is not None else "",
            expires_at=invitation.expires_at,
        )


@dataclass(frozen=True, slots=True)
class SetInvitationPassword:
    """``POST /onboarding/invitations/password``: step 1. Returns her authenticator setup."""

    uow: UnitOfWorkFactory
    tokens: OneTimeTokens
    clock: Clock
    guard: LinkGuard
    hasher: PasswordHasher
    totp: TotpService
    box: SecretBox

    async def execute(self, command: SetPasswordCommand, *, client: str) -> TotpEnrollmentView:
        await self.guard.ensure_open(client)
        hashed = _OnceHash(self.hasher, command.password)
        secret = self.totp.new_secret()  # one per request: a retry keeps the same one
        email = await retry_on_conflict(lambda: self._attempt(command, client, hashed, secret))
        return TotpEnrollmentView(
            otpauth_uri=self.totp.provisioning_uri(secret, account_name=email),
            secret=secret,
            account_name=email,
            issuer=self.totp.issuer,
            digits=self.totp.digits,
            period_seconds=self.totp.period_seconds,
        )

    async def _attempt(
        self, command: SetPasswordCommand, client: str, hashed: _OnceHash, secret: str
    ) -> str:
        now = self.clock.now()
        async with self.uow() as uow:
            found = await _invitation_for(uow, self.tokens, command.token, now)
            if found is None:
                raise await self.guard.unusable(client)
            invitation, staff = found
            ensure_password_policy(command.password, staff)
            invitation.start_enrollment(
                password_hash=await hashed.value(), totp_secret=self.box.seal(secret), now=now
            )
            await uow.invitations.save(invitation)
            await uow.commit()
        return staff.email


@dataclass(frozen=True, slots=True)
class ActivateInvitation:
    """``POST /onboarding/invitations/activate``: step 2, the first code of her app."""

    uow: UnitOfWorkFactory
    tokens: OneTimeTokens
    clock: Clock
    guard: LinkGuard
    totp: TotpService
    box: SecretBox
    lockout: LockoutPolicy

    async def execute(self, command: ActivateCommand, *, client: str) -> ActivatedAccountView:
        await self.guard.ensure_open(client)
        return await retry_on_conflict(lambda: self._attempt(command, client))

    async def _attempt(self, command: ActivateCommand, client: str) -> ActivatedAccountView:
        now = self.clock.now()
        async with self.uow() as uow:
            found = await _invitation_for(uow, self.tokens, command.token, now)
            if found is None:
                raise await self.guard.unusable(client)
            invitation, staff = found
            sealed, password_hash = invitation.totp_secret, invitation.password_hash
            if sealed is None or password_hash is None:
                raise InvalidTransitionError("Primero crea tu contraseña.")
            invitation.ensure_can_try_code(now)
            if not self.totp.verify(self.box.open(sealed), command.code.strip(), at=now):
                outcome = invitation.register_wrong_code(now=now, policy=self.lockout)
                await uow.invitations.save(invitation)
                await uow.commit()
                if outcome.locked_until is not None:
                    raise AccountLockedError(unlock_at=outcome.locked_until)
                raise TotpCodeInvalidError(remaining_attempts=outcome.remaining_attempts)

            team = await uow.teams.get(staff.team_id)
            if team is None:  # pragma: no cover - every person has a team
                raise await self.guard.unusable(client)
            herself = staff.actor_ref()
            staff.activate(team)  # her team must be active (TeamInactiveError otherwise)
            account = LoginAccount.open(
                staff_id=staff.id,
                password_hash=password_hash,
                totp_secret=sealed,
                now=now,
                actor=herself,
            )
            invitation.accept(now=now, actor=herself)
            if staff.has_role(StaffRole.ADMIN):
                roster, new = await load_roster(uow)
                roster.grant(staff.id)
                await store_roster(uow, roster, new=new)
            team.touch()  # an active member now: serialise with DeactivateTeam
            await uow.teams.save(team)
            await uow.login_accounts.add(account)
            await uow.staff.save(staff)
            await uow.invitations.save(invitation)
            await uow.commit()
        return ActivatedAccountView(name=staff.name, email=staff.email)


# ----------------------------------------------------------------------------- reset
@dataclass(frozen=True, slots=True)
class CheckPasswordReset:
    """``POST /onboarding/password-resets/check``."""

    uow: UnitOfWorkFactory
    tokens: OneTimeTokens
    clock: Clock
    guard: LinkGuard

    async def execute(self, token: str, *, client: str) -> PasswordResetPreview:
        await self.guard.ensure_open(client)
        async with self.uow() as uow:
            found = await _reset_for(uow, self.tokens, token, self.clock.now())
        if found is None:
            raise await self.guard.unusable(client)
        reset, staff, _account = found
        return PasswordResetPreview(name=staff.name, email=staff.email, expires_at=reset.expires_at)


@dataclass(frozen=True, slots=True)
class CompletePasswordReset:
    """``POST /onboarding/password-resets/complete``: her new password (single use)."""

    uow: UnitOfWorkFactory
    tokens: OneTimeTokens
    clock: Clock
    guard: LinkGuard
    hasher: PasswordHasher

    async def execute(self, command: SetPasswordCommand, *, client: str) -> PasswordResetDoneView:
        await self.guard.ensure_open(client)
        hashed = _OnceHash(self.hasher, command.password)
        return await retry_on_conflict(lambda: self._attempt(command, client, hashed))

    async def _attempt(
        self, command: SetPasswordCommand, client: str, hashed: _OnceHash
    ) -> PasswordResetDoneView:
        now = self.clock.now()
        async with self.uow() as uow:
            found = await _reset_for(uow, self.tokens, command.token, now)
            if found is None:
                raise await self.guard.unusable(client)
            reset, staff, account = found
            ensure_password_policy(command.password, staff)
            herself = staff.actor_ref()
            account.reset_password(await hashed.value(), now=now, actor=herself)
            reset.use(now=now)
            # A sign-in started with the old password must not finish, and every session
            # signs in again with the new one.
            for challenge in await uow.mfa_challenges.list_pending_for(staff.id, now):
                if challenge.cancel(now=now):
                    await uow.mfa_challenges.save(challenge)
            sessions = await uow.sessions.list_active_for(staff.id, now)
            for session in sessions:
                session.end(now=now, reason=SessionEndReason.REVOKED, actor=herself)
                await uow.sessions.save(session)
            await uow.login_accounts.save(account)
            await uow.password_resets.save(reset)
            await uow.commit()
        return PasswordResetDoneView(email=staff.email, revoked_sessions=len(sessions))
