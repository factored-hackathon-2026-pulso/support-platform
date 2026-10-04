"""The two emails of part 4, in neutral Spanish (fixed templates, no AI).

Each carries one link and says how long it lasts. Neither ever contains a password.
"""

from __future__ import annotations

from datetime import timedelta

from cc_platform.application.people.admin.copy import join_es, role_labels
from cc_platform.application.ports.email import EmailKind, EmailMessage
from cc_platform.domain.people.staff import Staff, canonical_roles


def first_name(name: str) -> str:
    return name.split(" ", 1)[0]


def duration_es(span: timedelta) -> str:
    """ "48 horas", "1 hora", "30 minutos"."""
    minutes = int(span.total_seconds() // 60)
    if minutes % 60 == 0:
        hours = minutes // 60
        return "1 hora" if hours == 1 else f"{hours} horas"
    return "1 minuto" if minutes == 1 else f"{minutes} minutos"


def invitation_email(staff: Staff, *, team_name: str, link: str, ttl: timedelta) -> EmailMessage:
    roles = join_es(role_labels(role.value for role in canonical_roles(staff.roles)))
    text = (
        f"Hola, {first_name(staff.name)}.\n\n"
        f"Administración te invitó a la Plataforma CC de LATAM Bank con el rol de {roles} "
        f"en {team_name}.\n\n"
        "Para activar tu cuenta, abre este enlace, crea tu contraseña y configura la "
        "verificación en dos pasos con una app de autenticación:\n"
        f"{link}\n\n"
        f"El enlace vence en {duration_es(ttl)} y sirve una sola vez. Nadie del banco conoce "
        "tu contraseña ni te la va a pedir.\n\n"
        "Si no esperabas esta invitación, ignora este correo."
    )
    return EmailMessage(
        kind=EmailKind.INVITATION,
        to=staff.email,
        subject="Te invitaron a la Plataforma CC de LATAM Bank",
        text=text,
        link=link,
    )


def password_reset_email(staff: Staff, *, link: str, ttl: timedelta) -> EmailMessage:
    text = (
        f"Hola, {first_name(staff.name)}.\n\n"
        "Administración te envió un enlace para crear una contraseña nueva. Tus sesiones "
        "abiertas se cerraron.\n\n"
        "Abre este enlace y crea tu contraseña nueva:\n"
        f"{link}\n\n"
        f"El enlace vence en {duration_es(ttl)} y sirve una sola vez. Tu verificación en dos "
        "pasos no cambia.\n\n"
        "Si no lo pediste, avisa a administración."
    )
    return EmailMessage(
        kind=EmailKind.PASSWORD_RESET,
        to=staff.email,
        subject="Crea una contraseña nueva para la Plataforma CC",
        text=text,
        link=link,
    )
