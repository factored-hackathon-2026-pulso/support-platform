"""Part 4 use cases over the real composition (in-memory) and the seed: the invitation
links (check, password, activation), resend / cancel / invite again, the password-reset
links, TOTP at sign-in, the link rate limit and the dev mailbox."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

import pytest

from cc_platform.application.errors import InvalidCredentialsError, InvalidMfaCodeError
from cc_platform.application.people.admin.dto import (
    AccountStatus,
    CreateUserCommand,
    InvitationStatus,
    UserFilters,
    UserStatusFilter,
)
from cc_platform.application.people.dto import LoginCommand, VerifyMfaCommand
from cc_platform.application.people.onboarding.dev_mailbox import ListDevMailbox
from cc_platform.application.people.onboarding.dto import ActivateCommand, SetPasswordCommand
from cc_platform.application.people.onboarding.errors import (
    LinkInvalidError,
    TooManyAttemptsError,
    TotpCodeInvalidError,
)
from cc_platform.application.ports.email import EmailKind
from cc_platform.application.security import Actor
from cc_platform.bootstrap.container import Container
from cc_platform.domain.notifications.notification import NotificationKind
from cc_platform.domain.people.errors import (
    AccountLockedError,
    MfaChallengeInvalidError,
    PasswordRejectedError,
)
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.errors import InvalidTransitionError, NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.onboarding import BRUNA, TATIANA, TATIANA_TOTP_SECRET
from cc_platform.infrastructure.seed.people import seed_staff_id, seed_team_id
from tests.support import (
    ADMIN_ONLY,
    ANALYST,
    INVITED_PASSWORD,
    PASSWORD,
    TOMAS,
    FixedLinkTokens,
    actor_for,
    latest_link,
    memory_container,
)

VALERIA_ID, CAROLINA_ID = seed_staff_id(7), seed_staff_id(9)
TOMAS_ID = seed_staff_id(8)
PACIFICO = seed_team_id(2)
CLIENT = "203.0.113.7"


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock()


@pytest.fixture
async def container(clock: FixedClock) -> Container:
    return await memory_container(clock=clock, tokens=FixedLinkTokens())


@pytest.fixture
def valeria() -> Actor:
    return actor_for(ADMIN_ONLY)


def ana() -> CreateUserCommand:
    return CreateUserCommand(
        name="Ana Gil",
        email="ana.gil@latambank.example",
        roles=(StaffRole.ANALYST,),
        languages=(Language.PORTUGUESE,),
        team_id=PACIFICO,
    )


async def set_password(container: Container, token: str, password: str = INVITED_PASSWORD) -> str:
    enrollment = await container.use_cases.onboarding.set_invitation_password.execute(
        SetPasswordCommand(token=token, password=password), client=CLIENT
    )
    return enrollment.secret


async def activate(container: Container, token: str, code: str) -> None:
    await container.use_cases.onboarding.activate_invitation.execute(
        ActivateCommand(token=token, code=code), client=CLIENT
    )


async def sign_in(container: Container, email: str, password: str, code: str) -> str:
    people = container.use_cases.people
    login = await people.login.execute(LoginCommand(email=email, password=password))
    grant = await people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code=code)
    )
    return grant.token


async def event_types(container: Container, since: int = 0) -> list[str]:
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=2000)
    return [e.event_type for e in page.items if e.sequence > since]


async def last_sequence(container: Container) -> int:
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=2000)
    return page.items[-1].sequence


# ----------------------------------------------------------------------------- seed
async def test_the_seed_has_an_accepted_and_a_pending_invitation(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    tatiana = await admin.get_user.execute(valeria, TATIANA.id)
    assert (tatiana.status, tatiana.second_factor, tatiana.invitation) == (
        AccountStatus.ACTIVE,
        "totp",
        None,
    )
    bruna = await admin.get_user.execute(valeria, BRUNA.id)
    assert bruna.status is AccountStatus.INVITED
    assert bruna.invitation is not None
    assert bruna.invitation.status is InvitationStatus.PENDING
    assert bruna.invitation.expires_at == container.clock.now() + timedelta(hours=45)
    daniela = await admin.get_user.execute(valeria, seed_staff_id(1))
    assert daniela.second_factor == "dev_code"
    # Bruna's invitation email is in the dev mailbox; Tatiana's acceptance notified admins.
    token = await latest_link(container, BRUNA.email)
    preview = await container.use_cases.onboarding.check_invitation.execute(token, client=CLIENT)
    assert (preview.name, preview.team_name, preview.roles) == (
        "Bruna Esteves",
        "Equipo Andes",
        (StaffRole.ANALYST,),
    )
    async with container.uow() as uow:
        mine = await uow.notifications.page(VALERIA_ID, before=None, limit=100)
    accepted = [n for n in mine if n.kind is NotificationKind.INVITATION_ACCEPTED]
    assert [n.target_id for n in accepted] == [TATIANA.id]


async def test_tatiana_signs_in_with_her_authenticator_never_the_dev_code(
    container: Container,
) -> None:
    now = container.clock.now()
    code = container.totp.code_at(TATIANA_TOTP_SECRET, now)
    assert await sign_in(container, TATIANA.email, PASSWORD, code)
    with pytest.raises(InvalidMfaCodeError):
        await sign_in(container, TATIANA.email, PASSWORD, "000000")
    # Seeded accounts without an authenticator keep the dev code.
    assert await sign_in(container, ANALYST.email, PASSWORD, "000000")


# ----------------------------------------------------------------------------- activation
async def test_the_whole_activation(container: Container, valeria: Actor) -> None:
    created = await container.use_cases.administration.create_user.execute(valeria, ana())
    token = await latest_link(container, "ana.gil@latambank.example")
    messages = await container.dev_mailbox.latest(1) if container.dev_mailbox else []
    assert messages[0].kind is EmailKind.INVITATION
    assert f"/activar?token={token}" in messages[0].link
    assert "48 horas" in messages[0].text
    assert "contraseña" in messages[0].text
    assert INVITED_PASSWORD not in messages[0].text

    preview = await container.use_cases.onboarding.check_invitation.execute(token, client=CLIENT)
    assert (preview.name, preview.email) == ("Ana Gil", "ana.gil@latambank.example")
    with pytest.raises(PasswordRejectedError) as rejected:
        await set_password(container, token, "ana-gil-corta")
    assert rejected.value.details == {"reasons": ["personal_info"]}
    with pytest.raises(PasswordRejectedError) as short:
        await set_password(container, token, "corta")
    assert short.value.details == {"reasons": ["min_length"]}

    enrollment = await container.use_cases.onboarding.set_invitation_password.execute(
        SetPasswordCommand(token=token, password=INVITED_PASSWORD), client=CLIENT
    )
    assert enrollment.otpauth_uri.startswith("otpauth://totp/")
    assert "issuer=LATAM%20Bank%20CC" in enrollment.otpauth_uri
    assert f"secret={enrollment.secret}" in enrollment.otpauth_uri
    assert (enrollment.digits, enrollment.period_seconds) == (6, 30)
    async with container.uow() as uow:
        stored = await uow.invitations.get_for_staff(created.user.id)
    assert stored is not None
    assert stored.totp_secret is not None
    assert enrollment.secret not in stored.totp_secret  # sealed at rest
    assert container.secret_box.open(stored.totp_secret) == enrollment.secret
    assert stored.password_hash != INVITED_PASSWORD

    before = await last_sequence(container)
    now = container.clock.now()
    await activate(container, token, container.totp.code_at(enrollment.secret, now))
    assert await event_types(container, before) == [
        "staff.mfa_enrolled",
        "staff.invitation_accepted",
    ]
    person = await container.use_cases.administration.get_user.execute(valeria, created.user.id)
    assert (person.status, person.second_factor, person.invitation) == (
        AccountStatus.ACTIVE,
        "totp",
        None,
    )
    # The link is used up; her sign-in takes her app's code, never the dev code.
    with pytest.raises(LinkInvalidError):
        await container.use_cases.onboarding.check_invitation.execute(token, client=CLIENT)
    code = container.totp.code_at(enrollment.secret, now)
    assert await sign_in(container, "ana.gil@latambank.example", INVITED_PASSWORD, code)
    with pytest.raises(InvalidMfaCodeError):
        await sign_in(container, "ana.gil@latambank.example", INVITED_PASSWORD, "000000")
    # Administration hears it (never the person herself).
    async with container.uow() as uow:
        for admin_id in (VALERIA_ID, CAROLINA_ID):
            items = await uow.notifications.page(admin_id, before=None, limit=100)
            assert any(
                n.kind is NotificationKind.INVITATION_ACCEPTED and n.target_id == created.user.id
                for n in items
            )
        assert await uow.notifications.page(created.user.id, before=None, limit=10) == []


async def test_a_new_password_starts_the_enrollment_over(container: Container) -> None:
    token = await latest_link(container, BRUNA.email)
    first = await set_password(container, token)
    second = await set_password(container, token)
    assert first != second
    now = container.clock.now()
    with pytest.raises(TotpCodeInvalidError):
        await activate(container, token, container.totp.code_at(first, now))
    await activate(container, token, container.totp.code_at(second, now))


async def test_codes_are_checked_with_one_step_of_drift(
    container: Container, clock: FixedClock
) -> None:
    token = await latest_link(container, BRUNA.email)
    secret = await set_password(container, token)
    previous = container.totp.code_at(secret, clock.now() - timedelta(seconds=30))
    stale = container.totp.code_at(secret, clock.now() - timedelta(seconds=90))
    if stale != previous:
        with pytest.raises(TotpCodeInvalidError):
            await activate(container, token, stale)
    await activate(container, token, previous)


async def test_activation_needs_the_password_first(container: Container) -> None:
    token = await latest_link(container, BRUNA.email)
    with pytest.raises(InvalidTransitionError):
        await activate(container, token, "123456")


async def test_wrong_codes_lock_the_activation(container: Container, clock: FixedClock) -> None:
    token = await latest_link(container, BRUNA.email)
    secret = await set_password(container, token)
    good = container.totp.code_at(secret, clock.now())
    wrong = "000000" if good != "000000" else "111111"
    for left in (4, 3, 2, 1):
        with pytest.raises(TotpCodeInvalidError) as error:
            await activate(container, token, wrong)
        assert error.value.details == {"remainingAttempts": left}
    with pytest.raises(AccountLockedError) as locked:
        await activate(container, token, wrong)
    assert locked.value.unlock_at == clock.now() + timedelta(minutes=15)
    with pytest.raises(AccountLockedError):  # even the right code waits
        await activate(container, token, good)
    # A new password does not reset the counter.
    secret = await set_password(container, token)
    clock.advance(timedelta(minutes=15))
    await activate(container, token, container.totp.code_at(secret, clock.now()))


async def test_an_expired_link_is_unusable(container: Container, clock: FixedClock) -> None:
    token = await latest_link(container, BRUNA.email)
    clock.advance(timedelta(hours=45))  # Bruna was invited three hours before the seed
    with pytest.raises(LinkInvalidError):
        await container.use_cases.onboarding.check_invitation.execute(token, client=CLIENT)
    with pytest.raises(LinkInvalidError):
        await set_password(container, token)


# ----------------------------------------------------------------------------- administration
async def test_resend_invalidates_the_previous_link(
    container: Container, clock: FixedClock, valeria: Actor
) -> None:
    old = await latest_link(container, BRUNA.email)
    clock.advance(timedelta(hours=46))  # expired: resending works anyway
    result = await container.use_cases.administration.resend_invitation.execute(valeria, BRUNA.id)
    invitation = result.user.invitation
    assert invitation is not None
    assert (invitation.status, invitation.resend_count) == (InvitationStatus.PENDING, 1)
    assert invitation.expires_at == clock.now() + timedelta(hours=48)
    new = await latest_link(container, BRUNA.email)
    assert new != old
    with pytest.raises(LinkInvalidError):
        await container.use_cases.onboarding.check_invitation.execute(old, client=CLIENT)
    assert await container.use_cases.onboarding.check_invitation.execute(new, client=CLIENT)


async def test_cancel_hides_her_and_inviting_the_email_again_reuses_her(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    old = await latest_link(container, BRUNA.email)
    before = await last_sequence(container)
    cancelled = await admin.cancel_invitation.execute(valeria, BRUNA.id)
    assert cancelled.user.status is AccountStatus.CANCELLED
    assert await event_types(container, before) == ["staff.invitation_cancelled"]
    with pytest.raises(LinkInvalidError):
        await container.use_cases.onboarding.check_invitation.execute(old, client=CLIENT)
    listing = await admin.list_users.execute(valeria, UserFilters(status=UserStatusFilter.ALL))
    assert BRUNA.id not in {item.id for item in listing.items}
    with pytest.raises(InvalidTransitionError):
        await admin.cancel_invitation.execute(valeria, BRUNA.id)
    with pytest.raises(InvalidTransitionError):
        await admin.resend_invitation.execute(valeria, BRUNA.id)

    again = await admin.create_user.execute(
        valeria,
        replace(ana(), name="Bruna Esteves", email=BRUNA.email, languages=(Language.SPANISH,)),
    )
    assert again.user.id == BRUNA.id
    assert (again.user.status, again.user.languages, again.user.team.id) == (
        AccountStatus.INVITED,
        (Language.SPANISH,),
        PACIFICO,
    )
    types = await event_types(container, before)
    assert types[-1] == "staff.invitation_sent"
    assert "staff.languages_changed" in types
    assert "staff.team_changed" in types
    token = await latest_link(container, BRUNA.email)
    assert await container.use_cases.onboarding.check_invitation.execute(token, client=CLIENT)


async def test_invitation_commands_need_an_invited_person(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    for command in (admin.resend_invitation, admin.cancel_invitation):
        with pytest.raises(InvalidTransitionError):
            await command.execute(valeria, TATIANA.id)  # already active
        with pytest.raises(NotFoundError):
            await command.execute(valeria, "STF-" + "9" * 26)


# ----------------------------------------------------------------------------- reset
async def test_the_whole_password_reset(container: Container, valeria: Actor) -> None:
    people = container.use_cases.people
    await sign_in(container, TOMAS.email, PASSWORD, "000000")
    await container.use_cases.administration.reset_password.execute(valeria, TOMAS_ID)
    token = await latest_link(container, TOMAS.email)
    (message,) = [m for m in await container.dev_mailbox.latest(5) if m.to == TOMAS.email]
    assert message.kind is EmailKind.PASSWORD_RESET
    assert "/restablecer?token=" in message.link
    assert "1 hora" in message.text

    onboarding = container.use_cases.onboarding
    preview = await onboarding.check_password_reset.execute(token, client=CLIENT)
    assert (preview.name, preview.email) == (TOMAS.name, TOMAS.email)
    with pytest.raises(PasswordRejectedError) as rejected:
        await onboarding.complete_password_reset.execute(
            SetPasswordCommand(token=token, password="tomas-arango-2026"), client=CLIENT
        )
    assert rejected.value.details == {"reasons": ["personal_info"]}
    # A sign-in started with the old password before she completes it…
    pending = await people.login.execute(LoginCommand(email=TOMAS.email, password=PASSWORD))
    second_session = await sign_in(container, TOMAS.email, PASSWORD, "000000")
    before = await last_sequence(container)
    done = await onboarding.complete_password_reset.execute(
        SetPasswordCommand(token=token, password=INVITED_PASSWORD), client=CLIENT
    )
    assert (done.email, done.revoked_sessions) == (TOMAS.email, 1)
    assert await event_types(container, before) == ["staff.password_reset", "auth.session_ended"]
    with pytest.raises(MfaChallengeInvalidError):  # …cannot finish
        await people.verify_mfa.execute(
            VerifyMfaCommand(challenge_id=pending.challenge_id, code="000000")
        )
    assert second_session  # (ended)
    with pytest.raises(InvalidCredentialsError):
        await people.login.execute(LoginCommand(email=TOMAS.email, password=PASSWORD))
    assert await sign_in(container, TOMAS.email, INVITED_PASSWORD, "000000")  # seeded: dev code
    with pytest.raises(LinkInvalidError):  # single use
        await onboarding.check_password_reset.execute(token, client=CLIENT)


async def test_a_reset_link_expires_after_one_hour(
    container: Container, clock: FixedClock, valeria: Actor
) -> None:
    await container.use_cases.administration.reset_password.execute(valeria, TOMAS_ID)
    token = await latest_link(container, TOMAS.email)
    clock.advance(timedelta(hours=1))
    with pytest.raises(LinkInvalidError):
        await container.use_cases.onboarding.complete_password_reset.execute(
            SetPasswordCommand(token=token, password=INVITED_PASSWORD), client=CLIENT
        )


async def test_a_reset_link_of_a_deactivated_person_is_unusable(
    container: Container, valeria: Actor
) -> None:
    admin = container.use_cases.administration
    await admin.reset_password.execute(valeria, TOMAS_ID)
    token = await latest_link(container, TOMAS.email)
    tomas = await admin.get_user.execute(valeria, TOMAS_ID)
    await admin.deactivate_user.execute(valeria, TOMAS_ID, tomas.version)
    with pytest.raises(LinkInvalidError):
        await container.use_cases.onboarding.check_password_reset.execute(token, client=CLIENT)


# ----------------------------------------------------------------------------- the guard
async def test_unusable_links_are_rate_limited_per_client(
    container: Container, clock: FixedClock
) -> None:
    onboarding = container.use_cases.onboarding
    good = await latest_link(container, BRUNA.email)
    for _ in range(9):
        with pytest.raises(LinkInvalidError):
            await onboarding.check_invitation.execute("x" * 43, client=CLIENT)
    with pytest.raises(TooManyAttemptsError) as limited:  # the tenth locks
        await onboarding.check_password_reset.execute("y" * 43, client=CLIENT)
    assert limited.value.unlock_at == clock.now() + timedelta(minutes=15)
    with pytest.raises(TooManyAttemptsError):  # a valid link waits too
        await onboarding.check_invitation.execute(good, client=CLIENT)
    assert await onboarding.check_invitation.execute(good, client="198.51.100.1")  # another
    clock.advance(timedelta(minutes=15))
    assert await onboarding.check_invitation.execute(good, client=CLIENT)


async def test_unknown_expired_used_and_malformed_tokens_answer_the_same(
    container: Container, valeria: Actor
) -> None:
    onboarding = container.use_cases.onboarding
    await container.use_cases.administration.cancel_invitation.execute(valeria, BRUNA.id)
    cancelled = await latest_link(container, BRUNA.email)
    for token in ("", "short", "z" * 300, "x" * 43, cancelled):
        with pytest.raises(LinkInvalidError) as error:
            await onboarding.check_invitation.execute(token, client=f"client-{len(token)}")
        assert error.value.details == {}
        assert error.value.message == "El enlace venció o ya se usó."


# ----------------------------------------------------------------------------- dev mailbox
async def test_the_dev_mailbox_lists_the_newest_first(container: Container, valeria: Actor) -> None:
    await container.use_cases.administration.create_user.execute(valeria, ana())
    view = await container.use_cases.onboarding.dev_mailbox.execute(10)
    assert [m.to for m in view.items] == ["ana.gil@latambank.example", BRUNA.email]
    assert container.use_cases.onboarding.dev_mailbox.enabled


async def test_without_the_dev_mailbox_the_listing_does_not_exist() -> None:
    disabled = ListDevMailbox(None)
    assert not disabled.enabled
    with pytest.raises(NotFoundError):
        await disabled.execute()
