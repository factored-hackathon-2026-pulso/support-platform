"""Email delivery port (part 4): invitations and password-reset links.

``EmailSender`` is the seam: the development adapter is a "dev mailbox" (memory or SQLite,
no external service) that ``GET /api/v1/dev/mailbox`` lists while ``CC_DEV_MAILBOX`` is on
(never in production). A production adapter (SMTP or a provider's API) is not built: the
container refuses to start with ``CC_ENV=prod`` until it exists (see the README).

Messages are plain text in Spanish (neutral), composed by the application
(``application/people/onboarding/emails.py``); adapters only deliver them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol


class EmailKind(StrEnum):
    INVITATION = "invitation"
    PASSWORD_RESET = "password_reset"  # noqa: S105 - a kind of email, not a secret


@dataclass(frozen=True, slots=True)
class EmailMessage:
    kind: EmailKind
    to: str
    subject: str
    text: str
    #: The one link of the message (the invitation or the reset link).
    link: str


@dataclass(frozen=True, slots=True)
class SentEmail:
    """A message as the dev mailbox keeps it."""

    id: str
    kind: EmailKind
    to: str
    subject: str
    text: str
    link: str
    sent_at: datetime


class EmailSender(Protocol):
    async def send(self, message: EmailMessage) -> None:
        """Deliver one message (after the Unit of Work committed what it announces)."""
        ...


class DevMailbox(EmailSender, Protocol):
    """The development adapter: it keeps what it "sent" so the demo can open the links."""

    async def latest(self, limit: int) -> list[SentEmail]:
        """The newest messages first."""
        ...
