"""Part 4 domain: ``Invitation``, ``PasswordReset``, the password policy, the ``Staff``
account setup and ``LoginAccount.open``."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.people import (
    INVITATION_TTL,
    PASSWORD_RESET_TTL,
    AccountLockedError,
    AccountSetup,
    Invitation,
    InvitationState,
    Language,
    LockoutPolicy,
    LoginAccount,
    PasswordReset,
    PasswordResetState,
    PasswordRule,
    Staff,
    StaffInvitationAccepted,
    StaffInvitationCancelled,
    StaffInvitationResent,
    StaffInvitationSent,
    StaffInvitedError,
    StaffMfaEnrolled,
    StaffPasswordResetLinkSent,
    StaffRole,
    Team,
    TeamInactiveError,
    password_violations,
)
from cc_platform.domain.people.password_policy import COMMON_PASSWORDS, personal_pieces
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError

NOW = datetime(2026, 10, 3, 14, tzinfo=UTC)
ADMIN = ActorRef(ActorRole.ADMIN, "STF-" + "0" * 25 + "7")
STAFF_ID = "STF-" + "0" * 24 + "15"
HERSELF = ActorRef(ActorRole.ANALYST, STAFF_ID)
INVITATION_ID = "INV-" + "0" * 25 + "1"
RESET_ID = "PWR-" + "0" * 25 + "1"
TEAM_ID = "TEAM-" + "0" * 25 + "1"
POLICY = LockoutPolicy()


def invitation(*, at: datetime = NOW, token_hash: str = "hash-1") -> Invitation:  # noqa: S107
    return Invitation.send(
        invitation_id=INVITATION_ID, staff_id=STAFF_ID, token_hash=token_hash, now=at, actor=ADMIN
    )


def team(*, active: bool = True) -> Team:
    return Team(id=TEAM_ID, name="Equipo Andes", active=active, created_at=NOW)


def invited_person() -> Staff:
    return Staff.create(
        staff_id=STAFF_ID,
        name="Bruna Esteves",
        email="bruna.esteves@latambank.example",
        roles={StaffRole.ANALYST},
        languages={Language.PORTUGUESE},
        team=team(),
        now=NOW,
        actor=ADMIN,
    )


# ----------------------------------------------------------------------------- invitation
def test_send_records_the_invitation_without_secrets() -> None:
    sent = invitation()
    assert (sent.state, sent.sent_at, sent.expires_at) == (
        InvitationState.PENDING,
        NOW,
        NOW + timedelta(hours=48),
    )
    assert timedelta(hours=48) == INVITATION_TTL
    (event,) = sent.pull_events()
    assert isinstance(event, StaffInvitationSent)
    assert event.entity_id == STAFF_ID
    assert event.payload() == {"invitation_id": INVITATION_ID, "expires_at": "2026-10-05T14:00:00Z"}
    assert "hash-1" not in str(event.payload())


def test_expired_is_derived_never_stored() -> None:
    sent = invitation()
    assert sent.state_at(NOW + timedelta(hours=47, minutes=59)) is InvitationState.PENDING
    assert sent.is_usable(NOW + timedelta(hours=47, minutes=59))
    assert sent.state_at(NOW + INVITATION_TTL) is InvitationState.EXPIRED
    assert not sent.is_usable(NOW + INVITATION_TTL)
    assert sent.state is InvitationState.PENDING
    with pytest.raises(InvalidValueError):
        Invitation(
            id=INVITATION_ID,
            staff_id=STAFF_ID,
            token_hash="h",
            created_at=NOW,
            sent_at=NOW,
            expires_at=NOW + INVITATION_TTL,
            created_by=ADMIN.actor_id or "",
            state=InvitationState.EXPIRED,
        )


def test_resend_replaces_the_token_and_restarts_the_48_hours() -> None:
    sent = invitation()
    sent.pull_events()
    later = NOW + timedelta(hours=50)  # already expired: resending revives it
    sent.start_enrollment(password_hash="p", totp_secret="s", now=NOW + timedelta(hours=1))
    sent.resend("hash-2", now=later, actor=ADMIN, ttl=INVITATION_TTL)
    assert (sent.token_hash, sent.sent_at, sent.expires_at) == (
        "hash-2",
        later,
        later + INVITATION_TTL,
    )
    assert (sent.resend_count, sent.created_at) == (1, NOW)
    assert not sent.enrollment_started  # a new link starts the enrollment over
    (event,) = sent.pull_events()
    assert isinstance(event, StaffInvitationResent)
    assert event.payload()["resend_count"] == 1


def test_cancel_then_reissue() -> None:
    sent = invitation()
    sent.cancel(now=NOW, actor=ADMIN)
    assert (sent.state, sent.cancelled_at) == (InvitationState.CANCELLED, NOW)
    assert not sent.is_usable(NOW)
    with pytest.raises(InvalidTransitionError):
        sent.cancel(now=NOW, actor=ADMIN)
    with pytest.raises(InvalidTransitionError):
        sent.resend("hash-2", now=NOW, actor=ADMIN, ttl=INVITATION_TTL)
    sent.reissue("hash-3", now=NOW + timedelta(days=1), actor=ADMIN, ttl=INVITATION_TTL)
    assert (sent.state, sent.token_hash, sent.resend_count) == (
        InvitationState.PENDING,
        "hash-3",
        0,
    )
    types = [type(e) for e in sent.pull_events()]
    assert types == [StaffInvitationSent, StaffInvitationCancelled, StaffInvitationSent]
    with pytest.raises(InvalidTransitionError):
        sent.reissue("hash-4", now=NOW, actor=ADMIN, ttl=INVITATION_TTL)


def test_accept_is_single_use_and_needs_the_password_first() -> None:
    sent = invitation()
    with pytest.raises(InvalidTransitionError):
        sent.accept(now=NOW, actor=HERSELF)
    sent.start_enrollment(password_hash="p", totp_secret="s", now=NOW)
    sent.accept(now=NOW + timedelta(minutes=2), actor=HERSELF)
    assert (sent.state, sent.accepted_at) == (InvitationState.ACCEPTED, NOW + timedelta(minutes=2))
    assert (sent.password_hash, sent.totp_secret) == (None, None)  # moved to her account
    assert not sent.is_usable(NOW)
    with pytest.raises(InvalidTransitionError):
        sent.accept(now=NOW, actor=HERSELF)
    with pytest.raises(InvalidTransitionError):
        sent.start_enrollment(password_hash="p", totp_secret="s", now=NOW)
    with pytest.raises(InvalidTransitionError):
        sent.cancel(now=NOW, actor=ADMIN)
    accepted = sent.pull_events()[-1]
    assert isinstance(accepted, StaffInvitationAccepted)
    assert (accepted.actor, accepted.entity_id) == (HERSELF, STAFF_ID)


def test_an_expired_invitation_cannot_be_used() -> None:
    sent = invitation()
    with pytest.raises(InvalidTransitionError):
        sent.start_enrollment(password_hash="p", totp_secret="s", now=NOW + INVITATION_TTL)


def test_wrong_codes_lock_the_enrollment_like_the_login() -> None:
    sent = invitation()
    for left in (4, 3, 2, 1):
        sent.ensure_can_try_code(NOW)
        outcome = sent.register_wrong_code(now=NOW, policy=POLICY)
        assert (outcome.remaining_attempts, outcome.locked_until) == (left, None)
    outcome = sent.register_wrong_code(now=NOW, policy=POLICY)
    assert outcome.locked_until == NOW + timedelta(minutes=15)
    with pytest.raises(AccountLockedError):
        sent.ensure_can_try_code(NOW + timedelta(minutes=14))
    sent.ensure_can_try_code(NOW + timedelta(minutes=15))  # the lock ran out
    assert (sent.failed_codes, sent.locked_until) == (0, None)
    assert not sent.has_pending_events or all(
        isinstance(e, StaffInvitationSent) for e in sent.pull_events()
    )


# ----------------------------------------------------------------------------- reset
def test_reset_link_issue_reissue_and_single_use() -> None:
    reset = PasswordReset.issue(
        reset_id=RESET_ID,
        staff_id=STAFF_ID,
        token_hash="r1",
        now=NOW,
        actor=ADMIN,
        revoked_sessions=2,
        cleared_lock=True,
    )
    assert reset.expires_at == NOW + PASSWORD_RESET_TTL == NOW + timedelta(hours=1)
    (event,) = reset.pull_events()
    assert isinstance(event, StaffPasswordResetLinkSent)
    assert event.payload() == {
        "reset_id": RESET_ID,
        "expires_at": "2026-10-03T15:00:00Z",
        "revoked_sessions": 2,
        "cleared_lock": True,
    }
    assert reset.state_at(NOW + timedelta(hours=1)) is PasswordResetState.EXPIRED
    reset.use(now=NOW + timedelta(minutes=5))
    assert (reset.state, reset.used_at) == (PasswordResetState.USED, NOW + timedelta(minutes=5))
    with pytest.raises(InvalidTransitionError):
        reset.use(now=NOW + timedelta(minutes=6))
    reset.reissue("r2", now=NOW + timedelta(hours=2), actor=ADMIN, revoked_sessions=0,
                  cleared_lock=False)  # fmt: skip
    assert (reset.state, reset.token_hash, reset.used_at) == (
        PasswordResetState.PENDING,
        "r2",
        None,
    )
    assert reset.is_usable(NOW + timedelta(hours=2, minutes=59))


# ----------------------------------------------------------------------------- policy
@pytest.mark.parametrize(
    ("password", "violations"),
    [
        ("Verde-Andes-27", ()),
        ("corta-123", (PasswordRule.MIN_LENGTH,)),
        ("x" * 129, (PasswordRule.MAX_LENGTH,)),
        ("mi-clave-BRUNA-2026", (PasswordRule.PERSONAL_INFO,)),
        ("esteves-lago-norte", (PasswordRule.PERSONAL_INFO,)),
        ("bruna.esteves.2026", (PasswordRule.PERSONAL_INFO,)),
        ("Brúna-con-tilde-27", (PasswordRule.PERSONAL_INFO,)),  # accents are ignored
        ("Contraseña123", (PasswordRule.COMMON,)),
        ("Password1234", (PasswordRule.COMMON,)),
        ("bruna", (PasswordRule.MIN_LENGTH, PasswordRule.PERSONAL_INFO)),
    ],
)
def test_password_policy(password: str, violations: tuple[PasswordRule, ...]) -> None:
    assert (
        password_violations(password, email="bruna.esteves@latambank.example", name="Bruna Esteves")
        == violations
    )


def test_personal_pieces_skip_short_words() -> None:
    assert personal_pieces(email="ana.de.la.cruz@latambank.example", name="Ana de la Cruz") == (
        "ana",
        "ana.de.la.cruz",
        "cruz",
    )
    assert all(len(p) >= 12 for p in COMMON_PASSWORDS)


# ----------------------------------------------------------------------------- staff
def test_an_invited_person_is_inactive_until_she_activates() -> None:
    staff = invited_person()
    assert (staff.setup, staff.active, staff.is_member) == (AccountSetup.INVITED, False, True)
    assert not staff.deactivate(revoked_sessions=0, now=NOW, actor=ADMIN)  # nothing to do
    with pytest.raises(StaffInvitedError):
        staff.reactivate(team(), now=NOW, actor=ADMIN)
    with pytest.raises(TeamInactiveError):
        staff.activate(team(active=False))
    staff.activate(team())
    assert (staff.setup, staff.active) == (AccountSetup.COMPLETE, True)
    with pytest.raises(ValueError, match="invited"):
        staff.activate(team())


def test_withdraw_and_reinvite() -> None:
    staff = invited_person()
    staff.withdraw()
    assert (staff.setup, staff.is_member, staff.active) == (AccountSetup.WITHDRAWN, False, False)
    with pytest.raises(StaffInvitedError):
        staff.reactivate(team(), now=NOW, actor=ADMIN)
    staff.reinvite(creation_key="again-0001")
    assert (staff.setup, staff.creation_key) == (AccountSetup.INVITED, "again-0001")
    with pytest.raises(ValueError, match="withdrawn"):
        staff.reinvite(creation_key=None)


def test_only_a_complete_account_can_be_active() -> None:
    with pytest.raises(InvalidValueError):
        Staff(
            id=STAFF_ID,
            name="Bruna Esteves",
            email="bruna.esteves@latambank.example",
            roles=frozenset({StaffRole.ANALYST}),
            languages=frozenset({Language.PORTUGUESE}),
            team_id=TEAM_ID,
            created_at=NOW,
            active=True,
            setup=AccountSetup.INVITED,
        )


def test_an_invited_account_opens_with_her_authenticator() -> None:
    account = LoginAccount.open(
        staff_id=STAFF_ID, password_hash="h", totp_secret="sealed", now=NOW, actor=HERSELF
    )
    assert (account.uses_totp, account.totp_secret) == (True, "sealed")
    (event,) = account.pull_events()
    assert isinstance(event, StaffMfaEnrolled)
    assert event.payload() == {"method": "totp"}
    with pytest.raises(InvalidValueError):
        LoginAccount.open(staff_id=STAFF_ID, password_hash="h", totp_secret="", now=NOW,
                          actor=HERSELF)  # fmt: skip
    assert not LoginAccount(staff_id=STAFF_ID, password_hash="h").uses_totp  # seeded: dev code
