"""Errors of the public onboarding routes (codes registered in ``api/problems.py``)."""

from __future__ import annotations

from datetime import datetime

from cc_platform.application.errors import ApplicationError
from cc_platform.domain.shared.json import iso_utc


class LinkInvalidError(ApplicationError):
    """The link's token is unknown, expired, already used or cancelled. One answer for all
    of them (410): the response never says which, nor whose link it was."""

    code = "link_invalid"
    default_message = "El enlace venció o ya se usó."


class TooManyAttemptsError(ApplicationError):
    """Too many unusable links from this client (429): wait until ``unlockAt``."""

    code = "rate_limited"
    default_message = "Demasiados intentos. Espera unos minutos y vuelve a intentarlo."

    def __init__(self, unlock_at: datetime) -> None:
        super().__init__(None, unlockAt=iso_utc(unlock_at))
        self.unlock_at = unlock_at


class TotpCodeInvalidError(ApplicationError):
    """The 6-digit code of the enrollment does not match her new authenticator (422; never
    401, so a signed-in tab that opens the link keeps its own session)."""

    code = "totp_invalid"
    default_message = "El código no coincide. Escribe el código que muestra ahora tu app."

    def __init__(self, remaining_attempts: int) -> None:
        super().__init__(None, remainingAttempts=remaining_attempts)
        self.remaining_attempts = remaining_attempts
