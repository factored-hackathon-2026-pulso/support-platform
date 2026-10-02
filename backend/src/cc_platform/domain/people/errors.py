"""Errors of the people context (staff accounts, MFA challenges, sessions)."""

from __future__ import annotations

from datetime import datetime

from cc_platform.domain.shared.errors import DomainError
from cc_platform.domain.shared.json import iso_utc


class AccountLockedError(DomainError):
    """Too many failed password attempts; the account is locked until ``unlock_at``."""

    code = "account_locked"
    default_message = "Tu cuenta está bloqueada temporalmente por intentos fallidos."

    def __init__(self, unlock_at: datetime) -> None:
        super().__init__(None, unlockAt=iso_utc(unlock_at))
        self.unlock_at = unlock_at


class MfaChallengeInvalidError(DomainError):
    """The MFA challenge does not exist, expired, was already used or ran out of attempts."""

    code = "mfa_challenge_invalid"
    default_message = (
        "El código venció o ya no es válido. Vuelve a ingresar tu correo y contraseña."
    )
