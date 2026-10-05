"""Slice 23c: the invitation and password-reset emails in the recipient's UI language (the
invitee's, as administration chose it; for a reset, her preference). Spanish is unchanged."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
from typing import cast

import pytest

from cc_platform.application.people.admin.dto import CreateUserCommand
from cc_platform.application.people.onboarding.emails import (
    invitation_email,
    password_reset_email,
)
from cc_platform.application.people.preferences import ui_language_of
from cc_platform.application.ports.email import SentEmail
from cc_platform.bootstrap.container import Container
from cc_platform.domain.people.preferences import UiLanguage
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.onboarding import BRUNA
from cc_platform.infrastructure.seed.people import seed_team_id
from tests.support import (
    ADMIN_ONLY,
    ANALYST,
    FixedLinkTokens,
    activate_invited,
    actor_for,
    link_token,
    memory_container,
)

PT = UiLanguage.PORTUGUESE_BRAZIL
CLIENT = "203.0.113.7"
LINK = "http://localhost:5173/activate?token=abc"
ANA_EMAIL = "ana.gil@latambank.example"


@pytest.fixture
async def container() -> Container:
    return await memory_container(clock=FixedClock(), tokens=FixedLinkTokens())


def ana(language: UiLanguage | None = None) -> CreateUserCommand:
    command = CreateUserCommand(
        name="Ana Gil",
        email=ANA_EMAIL,
        roles=(StaffRole.SUPERVISOR, StaffRole.ANALYST),
        languages=(Language.PORTUGUESE,),
        team_id=seed_team_id(2),
    )
    return command if language is None else replace(command, ui_language=language)


async def newest_to(container: Container, email: str) -> SentEmail:
    assert container.dev_mailbox is not None
    return next(m for m in await container.dev_mailbox.latest(200) if m.to == email)


@dataclass(frozen=True)
class _Recipient:
    """What the emails read of a person (name, email, roles)."""

    name: str = "Ana Gil"
    email: str = ANA_EMAIL
    roles: frozenset[StaffRole] = frozenset({StaffRole.ANALYST, StaffRole.SUPERVISOR})


def _staff() -> Staff:
    return cast("Staff", _Recipient())


def test_the_spanish_emails_are_unchanged() -> None:
    staff = _staff()
    invitation = invitation_email(
        staff, team_name="Equipo Andes", link=LINK, ttl=timedelta(hours=48)
    )
    assert invitation.subject == "Te invitaron a la Plataforma CC de LATAM Bank"
    assert invitation.text == (
        "Hola, Ana.\n\n"
        "Administración te invitó a la Plataforma CC de LATAM Bank con el rol de Analista y "
        "Supervisión en Equipo Andes.\n\n"
        "Para activar tu cuenta, abre este enlace, crea tu contraseña y configura la "
        "verificación en dos pasos con una app de autenticación:\n"
        f"{LINK}\n\n"
        "El enlace vence en 48 horas y sirve una sola vez. Nadie del banco conoce tu "
        "contraseña ni te la va a pedir.\n\n"
        "Si no esperabas esta invitación, ignora este correo."
    )
    reset = password_reset_email(staff, link=LINK, ttl=timedelta(hours=1))
    assert reset.subject == "Crea una contraseña nueva para la Plataforma CC"
    assert reset.text == (
        "Hola, Ana.\n\n"
        "Administración te envió un enlace para crear una contraseña nueva. Tus sesiones "
        "abiertas se cerraron.\n\n"
        "Abre este enlace y crea tu contraseña nueva:\n"
        f"{LINK}\n\n"
        "El enlace vence en 1 hora y sirve una sola vez. Tu verificación en dos pasos no "
        "cambia.\n\n"
        "Si no lo pediste, avisa a administración."
    )


def test_the_emails_in_portuguese() -> None:
    staff = _staff()
    invitation = invitation_email(
        staff, team_name="Equipo Andes", link=LINK, ttl=timedelta(hours=48), language=PT
    )
    assert invitation.subject == "Seu convite para a Plataforma CC do LATAM Bank"
    assert invitation.text == (
        "Olá, Ana.\n\n"
        "A Administração convidou você para a Plataforma CC do LATAM Bank com o perfil de "
        "Analista e Supervisão em Equipo Andes.\n\n"
        "Para ativar sua conta, abra este link, crie sua senha e configure a verificação em "
        "duas etapas com um app autenticador:\n"
        f"{LINK}\n\n"
        "O link vence em 48 horas e só pode ser usado uma vez. Ninguém do banco conhece sua "
        "senha nem vai pedi-la.\n\n"
        "Se você não esperava este convite, ignore este e-mail."
    )
    reset = password_reset_email(staff, link=LINK, ttl=timedelta(minutes=30), language=PT)
    assert reset.subject == "Crie uma nova senha para a Plataforma CC"
    assert "O link vence em 30 minutos e só pode ser usado uma vez." in reset.text
    assert reset.text.startswith("Olá, Ana.\n\nA Administração enviou um link")


async def test_an_invitation_in_portuguese_follows_her(container: Container) -> None:
    admin = container.use_cases.administration
    valeria = actor_for(ADMIN_ONLY)
    created = await admin.create_user.execute(valeria, ana(PT))
    email = await newest_to(container, ANA_EMAIL)
    assert email.subject == "Seu convite para a Plataforma CC do LATAM Bank"
    async with container.uow() as uow:
        assert await ui_language_of(uow, created.user.id) is PT
    # the activation screens learn her language from the link
    onboarding = container.use_cases.onboarding
    preview = await onboarding.check_invitation.execute(link_token(email.link), client=CLIENT)
    assert preview.ui_language is PT
    # a new link keeps the language
    await admin.resend_invitation.execute(valeria, created.user.id)
    assert (await newest_to(container, ANA_EMAIL)).subject.startswith("Seu convite")
    # once she is in, her reset link is in her language too
    await activate_invited(container, ANA_EMAIL)
    await admin.reset_password.execute(valeria, created.user.id)
    reset = await newest_to(container, ANA_EMAIL)
    assert reset.subject == "Crie uma nova senha para a Plataforma CC"
    check = await onboarding.check_password_reset.execute(link_token(reset.link), client=CLIENT)
    assert check.ui_language is PT


async def test_spanish_by_default_and_a_reset_follows_her_preference(
    container: Container,
) -> None:
    admin = container.use_cases.administration
    valeria = actor_for(ADMIN_ONLY)
    created = await admin.create_user.execute(valeria, ana())
    assert (await newest_to(container, ANA_EMAIL)).subject == (
        "Te invitaron a la Plataforma CC de LATAM Bank"
    )
    async with container.uow() as uow:
        assert await uow.preferences.get(created.user.id) is None  # the default: no row
    # Daniela switched her platform to Portuguese: her reset link arrives in Portuguese.
    daniela = actor_for(ANALYST)
    await container.use_cases.people.set_preferences.execute(daniela, PT)
    await admin.reset_password.execute(valeria, daniela.staff_id)
    reset = await newest_to(container, ANALYST.email)
    assert reset.subject == "Crie uma nova senha para a Plataforma CC"


async def test_the_seeded_invitation_is_in_portuguese(container: Container) -> None:
    email = await newest_to(container, BRUNA.email)
    assert email.subject == "Seu convite para a Plataforma CC do LATAM Bank"
    assert email.text.startswith("Olá, Bruna.")
