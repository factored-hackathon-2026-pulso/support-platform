"""Authentication use cases: password login → MFA → session; session check; logout.

Flow (canvas ``BoLogin`` → ``BoMfa`` → app, ``BoLocked`` on lockout):

1. ``LoginWithPassword``: email + password. Failed attempts are counted per account and
   persisted even though the call fails; the 5th consecutive failure locks the account for
   15 minutes (``LockoutPolicy``). Unknown emails run the same ``FailedAttemptCounter``
   rules through ``UnknownLoginAttempts`` so responses never reveal which emails exist.
   Success issues an ``MfaChallenge`` (the failure counter is kept until MFA succeeds).
2. ``VerifyMfa``: challenge id + one-time code. A wrong code counts on the challenge (3 per
   challenge) **and** on the account lockout, so new logins cannot buy unlimited guesses;
   a locked account cannot finish signing in. Success starts a ``StaffSession``, resets the
   counter and returns a signed session token carrying the session id, staff id and roles.
   Part 4: an account with an authenticator (every account created through an invitation)
   is checked with its own TOTP secret (RFC 6238, ``TotpService``); the development code
   (``000000``, ``MfaVerifier``) only works for the seeded accounts that have none, and
   only while a development verifier is configured (never in production).
3. ``AuthenticateSession``: resolves a token to an ``Actor`` on every request (signature,
   expiry via ``Clock``, revocation, staff still active, current roles).
4. ``Logout``: ends the session; the realtime hub closes its sockets on ``auth.session_ended``.

Commands run under ``retry_on_conflict``: parallel requests on the same account or
challenge are serialised by optimistic locking, so a burst of guesses is counted one by one
(at most ``max_failed_attempts`` are evaluated before the lock) and a challenge is redeemed
exactly once. The password hash / MFA check is computed once and reused across retries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import NoReturn

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.errors import (
    AuthenticationRequiredError,
    InvalidCredentialsError,
    InvalidMfaCodeError,
    SessionExpiredError,
)
from cc_platform.application.people.dto import (
    LoginCommand,
    LoginResult,
    SessionGrant,
    VerifyMfaCommand,
)
from cc_platform.application.people.ports import UnknownLoginAttempts
from cc_platform.application.people.queries import staff_view
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.security import (
    MfaVerifier,
    PasswordHasher,
    SecretBox,
    SessionClaims,
    SessionTokenService,
    TotpService,
)
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.errors import AccountLockedError, MfaChallengeInvalidError
from cc_platform.domain.people.login_account import (
    AuthFactor,
    FailedAttemptCounter,
    FailedAttemptOutcome,
    LockoutPolicy,
    LoginAccount,
)
from cc_platform.domain.people.mfa import MfaChallenge, MfaMethod, MfaPolicy
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import normalize_email
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

DEFAULT_MFA_METHODS: tuple[MfaMethod, ...] = (MfaMethod.TOTP, MfaMethod.SMS, MfaMethod.BACKUP_CODE)


def _password_rejection(
    outcome: FailedAttemptOutcome,
) -> AccountLockedError | InvalidCredentialsError:
    if outcome.locked_until is not None:
        return AccountLockedError(unlock_at=outcome.locked_until)
    return InvalidCredentialsError(remaining_attempts=outcome.remaining_attempts)


@dataclass(slots=True)
class _PasswordCheck:
    """One submitted password, verified at most once per stored hash (retries reuse it)."""

    hasher: PasswordHasher
    password: str
    _verdicts: dict[str | None, bool] = field(default_factory=dict)

    async def matches(self, password_hash: str | None) -> bool:
        if password_hash not in self._verdicts:
            self._verdicts[password_hash] = await self.hasher.verify(password_hash, self.password)
        return self._verdicts[password_hash]


@dataclass(slots=True)
class _MfaCodeCheck:
    """One submitted MFA code, checked at most once per staff member (retries reuse it).

    Her authenticator (TOTP secret, opened from the ``SecretBox``) when she has one; else the
    development verifier (seeded accounts), and no verifier means no second factor at all.
    """

    totp: TotpService
    box: SecretBox
    dev_verifier: MfaVerifier | None
    method: MfaMethod
    code: str
    _verdicts: dict[str, bool] = field(default_factory=dict)

    async def passes(self, account: LoginAccount, *, at: datetime) -> bool:
        staff_id = account.staff_id
        if staff_id not in self._verdicts:
            self._verdicts[staff_id] = await self._check(account, at=at)
        return self._verdicts[staff_id]

    async def _check(self, account: LoginAccount, *, at: datetime) -> bool:
        if account.totp_secret is not None:
            return self.totp.verify(self.box.open(account.totp_secret), self.code, at=at)
        if self.dev_verifier is None:
            return False
        return await self.dev_verifier.verify(
            staff_id=account.staff_id, method=self.method, code=self.code
        )


@dataclass(frozen=True, slots=True)
class LoginWithPassword:
    uow: UnitOfWorkFactory
    hasher: PasswordHasher
    clock: Clock
    ids: IdGenerator
    lockout: LockoutPolicy
    mfa: MfaPolicy
    unknown_attempts: UnknownLoginAttempts
    mfa_methods: tuple[MfaMethod, ...] = DEFAULT_MFA_METHODS

    async def execute(self, command: LoginCommand) -> LoginResult:
        check = _PasswordCheck(self.hasher, command.password)
        try:
            email = normalize_email(command.email)
        except InvalidValueError:
            await check.matches(None)
            raise InvalidCredentialsError() from None
        return await retry_on_conflict(lambda: self._attempt(email, check))

    async def _attempt(self, email: str, check: _PasswordCheck) -> LoginResult:
        async with self.uow() as uow:
            staff = await uow.staff.get_by_email(email)
            account = await uow.login_accounts.get(staff.id) if staff and staff.active else None
            if staff is None or account is None:
                await self._reject_unknown(email, check)

            now = self.clock.now()
            actor = staff.actor_ref()
            account.ensure_can_attempt(now)

            if not await check.matches(account.password_hash):
                outcome = account.register_failed_attempt(now=now, policy=self.lockout, actor=actor)
                await uow.login_accounts.save(account)
                await uow.commit()
                raise _password_rejection(outcome)

            account.register_password_accepted(now=now, actor=actor)
            challenge = MfaChallenge.issue(
                challenge_id=self.ids.new_id(IdPrefix.MFA_CHALLENGE),
                staff_id=staff.id,
                now=now,
                policy=self.mfa,
                actor=actor,
            )
            await uow.login_accounts.save(account)
            await uow.mfa_challenges.add(challenge)
            await uow.commit()

        return LoginResult(
            challenge_id=challenge.id,
            expires_at=challenge.expires_at,
            methods=self.mfa_methods,
        )

    async def _reject_unknown(self, email: str, check: _PasswordCheck) -> NoReturn:
        """Answer an unknown email exactly like a real account (countdown, then 423).

        Same steps and the same domain rules as the known-account path: a lock is reported
        before any hashing, a failure costs one (dummy) password hash, then it is counted
        atomically, re-checking the lock, like the versioned save of a real account.
        """
        now = self.clock.now()
        policy = self.lockout
        (await self.unknown_attempts.get(email)).ensure_can_attempt(now)
        await check.matches(None)

        def fail(counter: FailedAttemptCounter) -> FailedAttemptCounter:
            return counter.register_failure(now, policy)

        counter = await self.unknown_attempts.update(email, fail)
        raise _password_rejection(counter.outcome(policy))


@dataclass(frozen=True, slots=True)
class VerifyMfa:
    uow: UnitOfWorkFactory
    #: The development code verifier for seeded accounts without an authenticator; ``None``
    #: (production) means only authenticator codes are accepted.
    verifier: MfaVerifier | None
    tokens: SessionTokenService
    clock: Clock
    ids: IdGenerator
    lockout: LockoutPolicy
    session_ttl: timedelta
    totp: TotpService
    box: SecretBox

    async def execute(self, command: VerifyMfaCommand) -> SessionGrant:
        check = _MfaCodeCheck(
            self.totp, self.box, self.verifier, command.method, command.code.strip()
        )
        return await retry_on_conflict(lambda: self._attempt(command, check))

    async def _attempt(self, command: VerifyMfaCommand, check: _MfaCodeCheck) -> SessionGrant:
        async with self.uow() as uow:
            challenge = await uow.mfa_challenges.get(command.challenge_id)
            if challenge is None:
                raise MfaChallengeInvalidError()
            now = self.clock.now()
            challenge.ensure_open(now)

            staff = await uow.staff.get(challenge.staff_id)
            account = await uow.login_accounts.get(challenge.staff_id)
            if staff is None or not staff.active or account is None:
                raise MfaChallengeInvalidError()
            actor = staff.actor_ref()
            # A lock reached after the password step also blocks finishing the sign-in.
            account.ensure_can_attempt(now)

            if not await check.passes(account, at=now):
                challenge_left = challenge.register_failure(now=now, actor=actor)
                outcome = account.register_failed_attempt(
                    now=now, policy=self.lockout, actor=actor, factor=AuthFactor.MFA
                )
                await uow.mfa_challenges.save(challenge)
                await uow.login_accounts.save(account)
                await uow.commit()
                if outcome.locked_until is not None:
                    raise AccountLockedError(unlock_at=outcome.locked_until)
                raise InvalidMfaCodeError(
                    remaining_attempts=min(challenge_left, outcome.remaining_attempts)
                )

            challenge.complete(now=now, method=command.method)
            session = StaffSession.start(
                session_id=self.ids.new_id(IdPrefix.SESSION),
                staff_id=staff.id,
                now=now,
                ttl=self.session_ttl,
                mfa_method=command.method,
                actor=actor,
            )
            account.register_login(now=now)
            # Saving the challenge first makes a concurrent redemption lose (single use).
            await uow.mfa_challenges.save(challenge)
            await uow.login_accounts.save(account)
            await uow.sessions.add(session)
            view = await staff_view(uow, staff)
            await uow.commit()

        token = self.tokens.issue(
            SessionClaims(
                session_id=session.id,
                staff_id=staff.id,
                roles=staff.roles,
                issued_at=session.issued_at,
                expires_at=session.expires_at,
            )
        )
        return SessionGrant(
            token=token,
            session_id=session.id,
            expires_at=session.expires_at,
            staff=view,
        )


@dataclass(frozen=True, slots=True)
class AuthenticateSession:
    """Resolve a session token to an ``Actor`` (query: never commits)."""

    uow: UnitOfWorkFactory
    tokens: SessionTokenService
    clock: Clock

    async def execute(self, token: str | None) -> Actor:
        if not token:
            raise AuthenticationRequiredError()
        claims = self.tokens.read(token)
        now = self.clock.now()
        if now >= claims.expires_at:
            raise SessionExpiredError()

        async with self.uow() as uow:
            session = await uow.sessions.get(claims.session_id)
            if session is None or session.staff_id != claims.staff_id:
                raise AuthenticationRequiredError()
            if session.is_expired(now):
                raise SessionExpiredError()
            if not session.is_active(now):
                raise AuthenticationRequiredError()
            staff = await uow.staff.get(session.staff_id)
            if staff is None or not staff.active:
                raise AuthenticationRequiredError()

        # Roles come from the directory, not the token: a role change applies immediately.
        return Actor(
            staff_id=staff.id,
            name=staff.name,
            roles=staff.roles,
            session_id=session.id,
            session_expires_at=session.expires_at,
        )


@dataclass(frozen=True, slots=True)
class Logout:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor) -> None:
        await retry_on_conflict(lambda: self._attempt(actor))

    async def _attempt(self, actor: Actor) -> None:
        async with self.uow() as uow:
            session = await uow.sessions.get(actor.session_id)
            if session is None:
                raise NotFoundError("La sesión no existe.", sessionId=actor.session_id)
            session.end(
                now=self.clock.now(), reason=SessionEndReason.LOGOUT, actor=actor.acting_as()
            )
            await uow.sessions.save(session)
            await uow.commit()
