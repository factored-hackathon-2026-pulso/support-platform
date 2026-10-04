"""The fresh second factor behind approving, rejecting, publishing, promoting and revoking.

agent-core's registry lets only a *human* at ``step_up`` do those (``registry/roles.py``). The
platform is the identity issuer, so it decides when a person has earned that level: **only
while she types a fresh code from her authenticator app**, in the very request that asks for the
operation (``stepUpCode``). The check is the one of sign-in (her own TOTP secret; the development
code only for seeded accounts that have none), with the same consequences: a wrong code counts
toward the account lock (a stolen session cannot guess codes for free). A good code raises that
one call to ``step_up`` (the credential lives two minutes); nothing is remembered, so the next
operation asks again.

Known gap, shared with sign-in: a code is not remembered after use, so it can be replayed inside
its window (about a minute). A production MFA provider would keep the last accepted step.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ai.errors import BuilderStepUpInvalidError
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.errors import ForbiddenError
from cc_platform.application.people.auth import MfaCodeCheck
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.security import MfaVerifier, SecretBox, TotpService
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.people.errors import AccountLockedError
from cc_platform.domain.people.login_account import AuthFactor, LockoutPolicy
from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.staff import StaffRole

#: Who may build agents (and who may be asked for a step-up).
BUILDER_ROLES = frozenset({StaffRole.SUPERVISOR, StaffRole.ADMIN})


@dataclass(frozen=True, slots=True)
class BuilderStepUp:
    uow: UnitOfWorkFactory
    clock: Clock
    lockout: LockoutPolicy
    totp: TotpService
    box: SecretBox
    #: The development code for seeded accounts without an authenticator; ``None`` in production.
    dev_verifier: MfaVerifier | None

    async def verify(self, actor: Actor, code: str) -> None:
        """Returns when ``code`` is the person's current code; raises ``builder_step_up_invalid``
        (counted toward her lock) or ``account_locked`` otherwise."""
        check = MfaCodeCheck(self.totp, self.box, self.dev_verifier, MfaMethod.TOTP, code.strip())
        await retry_on_conflict(lambda: self._attempt(actor, check))

    async def _attempt(self, actor: Actor, check: MfaCodeCheck) -> None:
        async with self.uow() as uow:
            account = await uow.login_accounts.get(actor.staff_id)
            if account is None:
                raise ForbiddenError(role.value for role in BUILDER_ROLES)
            now = self.clock.now()
            account.ensure_can_attempt(now)  # a locked account cannot try codes
            if await check.passes(account, at=now):
                return
            outcome = account.register_failed_attempt(
                now=now,
                policy=self.lockout,
                actor=actor.acting_as(BUILDER_ROLES),
                factor=AuthFactor.MFA,
            )
            await uow.login_accounts.save(account)
            await uow.commit()
            if outcome.locked_until is not None:
                raise AccountLockedError(unlock_at=outcome.locked_until)
            raise BuilderStepUpInvalidError(outcome.remaining_attempts)
