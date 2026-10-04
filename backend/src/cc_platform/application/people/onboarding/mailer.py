"""``OnboardingMailer``: composes and sends the two link emails of part 4.

Called by the commands **after** their Unit of Work committed (the link must exist before
anyone can click it). If delivery fails the invitation or reset exists without its email:
administration sends it again ("Reenviar invitación", "Enviar enlace para restablecer").
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from cc_platform.application.people.onboarding.emails import (
    invitation_email,
    password_reset_email,
)
from cc_platform.application.people.onboarding.links import AppLinks
from cc_platform.application.ports.email import EmailSender
from cc_platform.domain.people.invitation import INVITATION_TTL
from cc_platform.domain.people.password_reset import PASSWORD_RESET_TTL
from cc_platform.domain.people.staff import Staff


@dataclass(frozen=True, slots=True)
class OnboardingMailer:
    sender: EmailSender
    links: AppLinks
    invitation_ttl: timedelta = INVITATION_TTL
    reset_ttl: timedelta = PASSWORD_RESET_TTL

    async def invitation(self, staff: Staff, *, team_name: str, token: str) -> None:
        link = self.links.activation(token)
        await self.sender.send(
            invitation_email(staff, team_name=team_name, link=link, ttl=self.invitation_ttl)
        )

    async def password_reset(self, staff: Staff, *, token: str) -> None:
        link = self.links.password_reset(token)
        await self.sender.send(password_reset_email(staff, link=link, ttl=self.reset_ttl))
