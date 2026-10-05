"""The two emails of part 4 (fixed templates, no AI), in the recipient's UI language
(slice 23c): the invitee's, as administration chose it; for a reset, her preference. The
words are the server catalogs' ``email.*`` keys (``application/i18n``), Spanish the source.

Each carries one link and says how long it lasts. Neither ever contains a password.
"""

from __future__ import annotations

from datetime import timedelta

from cc_platform.application.i18n import Texts, texts
from cc_platform.application.ports.email import EmailKind, EmailMessage
from cc_platform.domain.people.preferences import DEFAULT_UI_LANGUAGE, UiLanguage
from cc_platform.domain.people.staff import Staff, StaffRole, canonical_roles


def first_name(name: str) -> str:
    return name.split(" ", 1)[0]


def duration(span: timedelta, t: Texts) -> str:
    """ "48 horas", "1 hora", "30 minutos"."""
    minutes = int(span.total_seconds() // 60)
    if minutes % 60 == 0:
        return t.plural("duration.hours", minutes // 60)
    return t.plural("duration.minutes", minutes)


def _roles(staff: Staff, t: Texts) -> str:
    held = set(canonical_roles(staff.roles))
    return t.join([t(f"role.{role.value}") for role in StaffRole if role in held])


def invitation_email(
    staff: Staff,
    *,
    team_name: str,
    link: str,
    ttl: timedelta,
    language: UiLanguage = DEFAULT_UI_LANGUAGE,
) -> EmailMessage:
    t = texts(language)
    text = t(
        "email.invitation.body",
        name=first_name(staff.name),
        roles=_roles(staff, t),
        team=team_name,
        link=link,
        duration=duration(ttl, t),
    )
    return EmailMessage(
        kind=EmailKind.INVITATION,
        to=staff.email,
        subject=t("email.invitation.subject"),
        text=text,
        link=link,
    )


def password_reset_email(
    staff: Staff, *, link: str, ttl: timedelta, language: UiLanguage = DEFAULT_UI_LANGUAGE
) -> EmailMessage:
    t = texts(language)
    text = t(
        "email.reset.body",
        name=first_name(staff.name),
        link=link,
        duration=duration(ttl, t),
    )
    return EmailMessage(
        kind=EmailKind.PASSWORD_RESET,
        to=staff.email,
        subject=t("email.reset.subject"),
        text=text,
        link=link,
    )
