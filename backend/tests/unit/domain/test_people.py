from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.people import (
    AccountLocked,
    AccountLockedError,
    AuthFactor,
    FailedAttemptCounter,
    Language,
    LockoutPolicy,
    LoginAccount,
    LoginFailed,
    MfaChallenge,
    MfaChallengeInvalidError,
    MfaChallengeStatus,
    MfaMethod,
    MfaPolicy,
    PasswordAccepted,
    SessionEnded,
    SessionEndReason,
    Staff,
    StaffLevel,
    StaffRole,
    StaffSession,
)
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError

NOW = datetime(2026, 10, 2, 14, 0, tzinfo=UTC)
STAFF_ID = "STF-" + "0" * 25 + "1"
ACTOR = ActorRef(ActorRole.ANALYST, STAFF_ID)


def make_staff(**overrides: object) -> Staff:
    values: dict[str, object] = {
        "id": STAFF_ID,
        "name": "Daniela Ríos",
        "email": "  Daniela.Rios@LatamBank.example ",
        "roles": frozenset({StaffRole.ANALYST}),
        "level": StaffLevel.SPECIALIST,
        "languages": frozenset({Language.SPANISH, Language.PORTUGUESE}),
        "team": "Disputas · Equipo Andes",
    }
    values.update(overrides)
    return Staff(**values)  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- staff
def test_staff_normalises_email_and_exposes_roles() -> None:
    staff = make_staff()
    assert staff.email == "daniela.rios@latambank.example"
    assert staff.speaks(Language.PORTUGUESE)
    assert staff.primary_role is StaffRole.ANALYST
    assert not staff.requires_four_eyes


@pytest.mark.parametrize(
    "overrides",
    [
        {"roles": frozenset()},
        {"languages": frozenset()},
        {"email": "not-an-email"},
        {"name": " "},
        {"team": ""},
        {"id": "CASE-" + "0" * 26},
    ],
)
def test_staff_invariants(overrides: dict[str, object]) -> None:
    with pytest.raises(InvalidValueError):
        make_staff(**overrides)


def test_automation_plus_admin_requires_four_eyes() -> None:
    staff = make_staff(roles=frozenset({StaffRole.AUTOMATION, StaffRole.ADMIN}))
    assert staff.requires_four_eyes
    assert staff.primary_role is StaffRole.AUTOMATION
    assert staff.actor_ref(StaffRole.ADMIN).role is ActorRole.ADMIN
    # A role the person does not hold falls back to the primary role.
    assert staff.actor_ref(StaffRole.SUPERVISOR).role is ActorRole.AUTOMATION


# ----------------------------------------------------------------------------- lockout
def test_failed_attempts_count_down_then_lock_for_fifteen_minutes() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h")
    policy = LockoutPolicy()
    remaining = [
        account.register_failed_attempt(now=NOW, policy=policy, actor=ACTOR).remaining_attempts
        for _ in range(4)
    ]
    assert remaining == [4, 3, 2, 1]
    assert not account.is_locked(NOW)

    outcome = account.register_failed_attempt(now=NOW, policy=policy, actor=ACTOR)
    assert outcome.locked
    assert outcome.locked_until == NOW + timedelta(minutes=15)
    assert account.is_locked(NOW + timedelta(minutes=14, seconds=59))

    events = account.pull_events()
    assert [type(e) for e in events] == [LoginFailed] * 5 + [AccountLocked]
    assert events[-1].payload()["locked_until"] == "2026-10-02T14:15:00Z"


def test_locked_account_rejects_attempts_until_unlock() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h", failed_attempts=5,
                           locked_until=NOW + timedelta(minutes=15))  # fmt: skip
    with pytest.raises(AccountLockedError) as error:
        account.ensure_can_attempt(NOW)
    assert error.value.code == "account_locked"
    assert error.value.details["unlockAt"] == "2026-10-02T14:15:00Z"
    with pytest.raises(AccountLockedError):
        account.register_password_accepted(now=NOW, actor=ACTOR)


def test_expired_lock_resets_the_counter() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h", failed_attempts=5,
                           locked_until=NOW)  # fmt: skip
    account.ensure_can_attempt(NOW)
    assert account.failed_attempts == 0
    assert account.locked_until is None


def test_password_accepted_keeps_failures_until_the_second_factor_passes() -> None:
    """Otherwise every new login would buy fresh MFA guesses without ever locking."""
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h", failed_attempts=3)
    account.register_password_accepted(now=NOW, actor=ACTOR)
    assert account.failed_attempts == 3
    assert isinstance(account.pull_events()[0], PasswordAccepted)

    account.register_login(now=NOW)
    assert account.failed_attempts == 0
    assert account.last_login_at == NOW


def test_mfa_failures_count_toward_the_same_lockout() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h", failed_attempts=4)
    outcome = account.register_failed_attempt(
        now=NOW, policy=LockoutPolicy(), actor=ACTOR, factor=AuthFactor.MFA
    )
    assert outcome.locked_until == NOW + timedelta(minutes=15)
    failed, locked = account.pull_events()
    assert failed.payload() == {"factor": "mfa", "failed_attempts": 5, "remaining_attempts": 0}
    assert isinstance(locked, AccountLocked)


# ----------------------------------------------------------------------------- counter (VO)
POLICY_3 = LockoutPolicy(max_failed_attempts=3, lock_duration=timedelta(minutes=15))


def test_counter_counts_down_then_locks_and_is_immutable() -> None:
    empty = FailedAttemptCounter()
    first = empty.register_failure(NOW, POLICY_3)
    assert empty.is_clear
    assert first.outcome(POLICY_3).remaining_attempts == 2
    third = first.register_failure(NOW, POLICY_3).register_failure(NOW, POLICY_3)
    assert third.outcome(POLICY_3).locked_until == NOW + timedelta(minutes=15)
    assert third.outcome(POLICY_3).remaining_attempts == 0


def test_counter_refuses_attempts_while_locked_and_restarts_after() -> None:
    locked = FailedAttemptCounter(failed_attempts=3, locked_until=NOW + timedelta(minutes=15))
    with pytest.raises(AccountLockedError):
        locked.ensure_can_attempt(NOW + timedelta(minutes=14))
    with pytest.raises(AccountLockedError):
        locked.register_failure(NOW, POLICY_3)
    later = NOW + timedelta(minutes=15)
    assert locked.current(later).is_clear
    assert locked.register_failure(later, POLICY_3).failed_attempts == 1


def test_counter_rejects_negative_attempts() -> None:
    with pytest.raises(InvalidValueError):
        FailedAttemptCounter(failed_attempts=-1)


def test_login_account_delegates_to_the_counter() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h", failed_attempts=2)
    assert account.attempts == FailedAttemptCounter(failed_attempts=2)
    with pytest.raises(InvalidValueError):
        LoginAccount(staff_id=STAFF_ID, password_hash="h", failed_attempts=-1)


def test_aggregates_start_unversioned_and_accept_a_persisted_version() -> None:
    account = LoginAccount(staff_id=STAFF_ID, password_hash="h")
    assert account.version == 0
    account.mark_persisted(3)
    assert account.version == 3
    with pytest.raises(ValueError, match="negative"):
        account.mark_persisted(-1)


def test_lockout_policy_validation() -> None:
    with pytest.raises(InvalidValueError):
        LockoutPolicy(max_failed_attempts=0)
    with pytest.raises(InvalidValueError):
        LockoutPolicy(lock_duration=timedelta(0))


# ----------------------------------------------------------------------------- MFA
def issue_challenge(policy: MfaPolicy | None = None) -> MfaChallenge:
    return MfaChallenge.issue(
        challenge_id="MFA-" + "0" * 25 + "1",
        staff_id=STAFF_ID,
        now=NOW,
        policy=policy or MfaPolicy(),
        actor=ACTOR,
    )


def test_challenge_is_exhausted_after_max_attempts() -> None:
    challenge = issue_challenge()
    assert challenge.register_failure(now=NOW, actor=ACTOR) == 2
    assert challenge.register_failure(now=NOW, actor=ACTOR) == 1
    assert challenge.register_failure(now=NOW, actor=ACTOR) == 0
    assert challenge.status is MfaChallengeStatus.EXHAUSTED
    with pytest.raises(MfaChallengeInvalidError):
        challenge.ensure_open(NOW)


def test_challenge_expires() -> None:
    challenge = issue_challenge(MfaPolicy(ttl=timedelta(minutes=5)))
    challenge.ensure_open(NOW + timedelta(minutes=4))
    with pytest.raises(MfaChallengeInvalidError):
        challenge.ensure_open(NOW + timedelta(minutes=5))


def test_challenge_completes_once() -> None:
    challenge = issue_challenge()
    challenge.complete(now=NOW, method=MfaMethod.TOTP)
    assert challenge.status is MfaChallengeStatus.VERIFIED
    with pytest.raises(InvalidTransitionError):
        challenge.complete(now=NOW, method=MfaMethod.TOTP)
    with pytest.raises(MfaChallengeInvalidError):
        challenge.register_failure(now=NOW, actor=ACTOR)


# ----------------------------------------------------------------------------- sessions
def test_session_lifecycle_and_idempotent_end() -> None:
    session = StaffSession.start(
        session_id="SES-" + "0" * 25 + "1",
        staff_id=STAFF_ID,
        now=NOW,
        ttl=timedelta(hours=8),
        mfa_method=MfaMethod.TOTP,
        actor=ACTOR,
    )
    assert session.is_active(NOW)
    assert session.is_expired(NOW + timedelta(hours=8))
    session.end(now=NOW, reason=SessionEndReason.LOGOUT, actor=ACTOR)
    session.end(now=NOW, reason=SessionEndReason.LOGOUT, actor=ACTOR)
    assert not session.is_active(NOW)
    ended = [e for e in session.pull_events() if isinstance(e, SessionEnded)]
    assert len(ended) == 1
    assert ended[0].payload() == {"staff_id": STAFF_ID, "reason": "logout"}
