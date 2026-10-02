"""Auth use cases over the in-memory Unit of Work (lockout, MFA, sessions, expiry)."""

from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import replace
from datetime import timedelta

import pytest

from cc_platform.application.errors import (
    ApplicationError,
    AuthenticationRequiredError,
    InvalidCredentialsError,
    InvalidMfaCodeError,
    SessionExpiredError,
)
from cc_platform.application.people.dto import LoginCommand, SessionGrant, VerifyMfaCommand
from cc_platform.domain.people.errors import AccountLockedError, MfaChallengeInvalidError
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import DomainError
from cc_platform.infrastructure.seed.people import seed_demo_staff
from tests.support import (
    ANALYST,
    DEV_MFA_CODE,
    PASSWORD,
    AuthKit,
    RecordingHandler,
    YieldingHasher,
    YieldingMfaVerifier,
    build_auth_kit,
)


@pytest.fixture
async def kit(auth_kit: AuthKit) -> AuthKit:
    await seed_demo_staff(auth_kit.uow, auth_kit.hasher)
    return auth_kit


async def sign_in(kit: AuthKit, email: str = ANALYST.email) -> SessionGrant:
    login = await kit.login.execute(LoginCommand(email=email, password=PASSWORD))
    return await kit.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
    )


async def event_types(kit: AuthKit) -> list[str]:
    async with kit.uow() as uow:
        page = await uow.event_log.page(limit=500)
    return [event.event_type for event in page.items]


# ----------------------------------------------------------------------------- password step
async def test_login_issues_an_mfa_challenge(kit: AuthKit) -> None:
    result = await kit.login.execute(
        LoginCommand(email=" DANIELA.rios@latambank.example ", password=PASSWORD)
    )
    assert result.mfa_required
    assert result.challenge_id.startswith("MFA-")
    assert result.expires_at == kit.clock.now() + timedelta(minutes=5)
    assert await event_types(kit) == ["auth.password_accepted", "auth.mfa_challenge_issued"]


async def test_wrong_password_reports_remaining_attempts(kit: AuthKit) -> None:
    with pytest.raises(InvalidCredentialsError) as error:
        await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    assert error.value.remaining_attempts == 4
    assert error.value.details == {"remainingAttempts": 4}
    assert await event_types(kit) == ["auth.login_failed"]


async def test_malformed_email_fails_without_counting(kit: AuthKit) -> None:
    with pytest.raises(InvalidCredentialsError) as error:
        await kit.login.execute(LoginCommand(email="not an email", password=PASSWORD))
    assert error.value.remaining_attempts is None
    assert await event_types(kit) == []


async def test_unknown_email_answers_exactly_like_a_real_account(kit: AuthKit) -> None:
    """Anti-enumeration: same countdown and same 423 lock, but nothing in the event log."""
    ghost = "ghost@latambank.example"
    for expected in (4, 3, 2, 1):
        with pytest.raises(InvalidCredentialsError) as error:
            await kit.login.execute(LoginCommand(email=ghost, password=PASSWORD))
        assert error.value.details == {"remainingAttempts": expected}
    with pytest.raises(AccountLockedError) as locked:
        await kit.login.execute(LoginCommand(email=f" {ghost.upper()} ", password=PASSWORD))
    assert locked.value.unlock_at == kit.clock.now() + timedelta(minutes=15)

    kit.clock.advance(timedelta(minutes=14))
    with pytest.raises(AccountLockedError):
        await kit.login.execute(LoginCommand(email=ghost, password=PASSWORD))

    kit.clock.advance(timedelta(minutes=1))
    with pytest.raises(InvalidCredentialsError) as error:
        await kit.login.execute(LoginCommand(email=ghost, password=PASSWORD))
    assert error.value.remaining_attempts == 4
    assert await event_types(kit) == []


async def test_fifth_failure_locks_the_account_for_fifteen_minutes(kit: AuthKit) -> None:
    for _ in range(4):
        with pytest.raises(InvalidCredentialsError):
            await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    with pytest.raises(AccountLockedError) as locked:
        await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    assert locked.value.unlock_at == kit.clock.now() + timedelta(minutes=15)

    # Even the right password is refused while locked.
    kit.clock.advance(timedelta(minutes=14))
    with pytest.raises(AccountLockedError):
        await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))

    # After the lock expires the counter starts again.
    kit.clock.advance(timedelta(minutes=1))
    assert (
        await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    ).mfa_required
    types = await event_types(kit)
    assert types.count("auth.login_failed") == 5
    assert types.count("auth.account_locked") == 1


async def test_only_a_completed_sign_in_resets_failed_attempts(kit: AuthKit) -> None:
    for _ in range(3):
        with pytest.raises(InvalidCredentialsError):
            await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    # A correct password alone keeps the count (MFA has not passed yet)...
    await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    with pytest.raises(InvalidCredentialsError) as error:
        await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    assert error.value.remaining_attempts == 1
    # ...a full sign-in (password + MFA) resets it.
    await sign_in(kit)
    with pytest.raises(InvalidCredentialsError) as error:
        await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    assert error.value.remaining_attempts == 4


# ----------------------------------------------------------------------------- MFA step
async def test_mfa_success_starts_a_session_with_signed_token(kit: AuthKit) -> None:
    grant = await sign_in(kit)
    assert grant.staff.email == ANALYST.email
    assert grant.expires_at == kit.clock.now() + timedelta(hours=8)
    claims = kit.tokens.read(grant.token)
    assert claims.staff_id == grant.staff.id
    assert claims.session_id == grant.session_id
    assert claims.roles == frozenset({StaffRole.ANALYST})
    assert "auth.session_started" in await event_types(kit)


async def test_wrong_mfa_code_counts_down_then_invalidates_the_challenge(kit: AuthKit) -> None:
    login = await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    remaining = []
    for _ in range(3):
        with pytest.raises(InvalidMfaCodeError) as error:
            await kit.verify_mfa.execute(
                VerifyMfaCommand(challenge_id=login.challenge_id, code="123456")
            )
        remaining.append(error.value.remaining_attempts)
    assert remaining == [2, 1, 0]
    with pytest.raises(MfaChallengeInvalidError):
        await kit.verify_mfa.execute(
            VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
        )
    types = await event_types(kit)
    assert types.count("auth.mfa_failed") == 3
    assert types.count("auth.login_failed") == 3  # MFA failures also count on the account


async def test_new_logins_do_not_buy_unlimited_mfa_guesses(kit: AuthKit) -> None:
    """login → 3 wrong codes → login → ... locks the account (OWASP ASVS 2.2.1)."""
    guesses = 0

    async def guess_until_locked() -> None:
        nonlocal guesses
        for _ in range(10):
            login = await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
            for _ in range(3):
                guesses += 1
                try:
                    await kit.verify_mfa.execute(
                        VerifyMfaCommand(challenge_id=login.challenge_id, code="123456")
                    )
                except InvalidMfaCodeError:
                    continue

    with pytest.raises(AccountLockedError) as locked:
        await guess_until_locked()
    assert guesses == 5
    assert locked.value.unlock_at == kit.clock.now() + timedelta(minutes=15)
    # While locked, neither the password step nor an open challenge can sign in.
    with pytest.raises(AccountLockedError):
        await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))


async def test_mfa_countdown_reports_the_tighter_of_challenge_and_account(kit: AuthKit) -> None:
    for _ in range(3):
        with pytest.raises(InvalidCredentialsError):
            await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    login = await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    with pytest.raises(InvalidMfaCodeError) as error:
        await kit.verify_mfa.execute(VerifyMfaCommand(challenge_id=login.challenge_id, code="1234"))
    assert error.value.remaining_attempts == 1  # account: 4 failures of 5; challenge: 2 left
    with pytest.raises(AccountLockedError):
        await kit.verify_mfa.execute(VerifyMfaCommand(challenge_id=login.challenge_id, code="1234"))


async def test_a_locked_account_cannot_finish_signing_in(kit: AuthKit) -> None:
    login = await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    for _ in range(5):
        with pytest.raises((InvalidCredentialsError, AccountLockedError)):
            await kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
    with pytest.raises(AccountLockedError):
        await kit.verify_mfa.execute(
            VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
        )


async def test_expired_or_reused_challenge_is_rejected(kit: AuthKit) -> None:
    login = await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    kit.clock.advance(timedelta(minutes=5))
    with pytest.raises(MfaChallengeInvalidError):
        await kit.verify_mfa.execute(
            VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
        )

    login = await kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    await kit.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
    )
    with pytest.raises(MfaChallengeInvalidError):
        await kit.verify_mfa.execute(
            VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
        )


async def test_unknown_challenge_is_rejected(kit: AuthKit) -> None:
    with pytest.raises(MfaChallengeInvalidError):
        await kit.verify_mfa.execute(
            VerifyMfaCommand(challenge_id="MFA-" + "9" * 26, code=DEV_MFA_CODE)
        )


# ----------------------------------------------------------------------------- sessions
async def test_authenticate_returns_the_actor_with_current_roles(kit: AuthKit) -> None:
    grant = await sign_in(kit)
    actor = await kit.authenticate.execute(grant.token)
    assert actor.staff_id == grant.staff.id
    assert actor.roles == frozenset({StaffRole.ANALYST})

    # Roles come from the directory, so a promotion applies to the existing session.
    async with kit.uow() as uow:
        staff = await uow.staff.get(grant.staff.id)
        assert staff is not None
        staff.roles = frozenset({StaffRole.ANALYST, StaffRole.SUPERVISOR})
        await uow.staff.save(staff)
        await uow.commit()
    assert StaffRole.SUPERVISOR in (await kit.authenticate.execute(grant.token)).roles


async def test_token_expires_with_the_clock(kit: AuthKit) -> None:
    grant = await sign_in(kit)
    kit.clock.advance(timedelta(hours=8))
    with pytest.raises(SessionExpiredError):
        await kit.authenticate.execute(grant.token)


@pytest.mark.parametrize("token", [None, "", "garbage", "a.b.c"])
async def test_missing_or_malformed_token_is_unauthenticated(
    kit: AuthKit, token: str | None
) -> None:
    with pytest.raises(AuthenticationRequiredError):
        await kit.authenticate.execute(token)


async def test_token_for_unknown_session_is_rejected(kit: AuthKit) -> None:
    grant = await sign_in(kit)
    claims = kit.tokens.read(grant.token)
    forged = kit.tokens.issue(replace(claims, session_id="SES-" + "9" * 26))
    with pytest.raises(AuthenticationRequiredError):
        await kit.authenticate.execute(forged)


async def test_inactive_staff_cannot_use_their_session(kit: AuthKit) -> None:
    grant = await sign_in(kit)
    async with kit.uow() as uow:
        staff = await uow.staff.get(grant.staff.id)
        assert staff is not None
        staff.active = False
        await uow.staff.save(staff)
        await uow.commit()
    with pytest.raises(AuthenticationRequiredError):
        await kit.authenticate.execute(grant.token)


async def test_logout_revokes_the_session_and_publishes_session_ended(kit: AuthKit) -> None:
    recorder = RecordingHandler()
    kit.bus.subscribe(recorder)
    grant = await sign_in(kit)
    actor = await kit.authenticate.execute(grant.token)

    await kit.logout.execute(actor)

    with pytest.raises(AuthenticationRequiredError):
        await kit.authenticate.execute(grant.token)
    assert recorder.event_types[-1] == "auth.session_ended"
    assert recorder.records[-1].entity_id == grant.session_id


# ----------------------------------------------------------------------------- concurrency
@pytest.fixture
async def racing_kit() -> AuthKit:
    """Hashing yields to the loop, so parallel calls interleave like real requests."""
    kit = build_auth_kit(hasher=YieldingHasher(), verifier=YieldingMfaVerifier(DEV_MFA_CODE))
    await seed_demo_staff(kit.uow, kit.hasher)
    return kit


def outcome_codes(results: list[object]) -> Counter[str]:
    return Counter(
        result.code if isinstance(result, ApplicationError | DomainError) else "ok"
        for result in results
    )


async def test_parallel_wrong_passwords_cannot_bypass_the_lockout(racing_kit: AuthKit) -> None:
    results = await asyncio.gather(
        *(
            racing_kit.login.execute(LoginCommand(email=ANALYST.email, password="nope"))
            for _ in range(20)
        ),
        return_exceptions=True,
    )
    codes = outcome_codes(results)
    assert codes == Counter({"invalid_credentials": 4, "account_locked": 16})
    with pytest.raises(AccountLockedError):
        await racing_kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))


async def test_parallel_guesses_for_unknown_emails_answer_like_real_ones(
    racing_kit: AuthKit,
) -> None:
    async def burst(email: str) -> Counter[str]:
        return outcome_codes(
            await asyncio.gather(
                *(
                    racing_kit.login.execute(LoginCommand(email=email, password="nope"))
                    for _ in range(12)
                ),
                return_exceptions=True,
            )
        )

    assert await burst("nadie@latambank.example") == await burst(ANALYST.email)


async def test_a_challenge_is_redeemed_once_under_parallel_requests(racing_kit: AuthKit) -> None:
    login = await racing_kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    command = VerifyMfaCommand(challenge_id=login.challenge_id, code=DEV_MFA_CODE)
    results = await asyncio.gather(
        *(racing_kit.verify_mfa.execute(command) for _ in range(10)), return_exceptions=True
    )
    assert outcome_codes(results) == Counter({"ok": 1, "mfa_challenge_invalid": 9})
    async with racing_kit.uow() as uow:
        sessions = list((await uow.event_log.page(limit=500)).items)
    assert [e.event_type for e in sessions].count("auth.session_started") == 1


async def test_parallel_wrong_codes_respect_the_challenge_limit(racing_kit: AuthKit) -> None:
    login = await racing_kit.login.execute(LoginCommand(email=ANALYST.email, password=PASSWORD))
    command = VerifyMfaCommand(challenge_id=login.challenge_id, code="123456")
    results = await asyncio.gather(
        *(racing_kit.verify_mfa.execute(command) for _ in range(15)), return_exceptions=True
    )
    assert outcome_codes(results) == Counter({"mfa_invalid": 3, "mfa_challenge_invalid": 12})
    remaining = sorted(r.remaining_attempts for r in results if isinstance(r, InvalidMfaCodeError))
    assert remaining == [0, 1, 2]
