"""RFC 6238 time-based one-time passwords (``TotpService`` port), through ``pyotp``.

30-second steps, 6 digits, HMAC-SHA1: what authenticator apps (Google Authenticator,
Microsoft Authenticator, 1Password…) expect by default. ``verify`` accepts the previous and
the next step too (one step of clock drift, RFC 6238 §5.2). Time always comes from the
caller (the application ``Clock``), so tests verify against a fixed clock.

Known gap: a code is not remembered after use, so it can be replayed within its window
(about a minute); a production MFA provider would keep the last accepted step.
"""

from __future__ import annotations

import re
from datetime import datetime

import pyotp

DIGITS = 6
PERIOD_SECONDS = 30
VALID_WINDOW = 1
_CODE = re.compile(rf"^\d{{{DIGITS}}}$")


class PyotpTotpService:
    def __init__(self, *, issuer: str) -> None:
        self._issuer = issuer

    @property
    def issuer(self) -> str:
        return self._issuer

    @property
    def digits(self) -> int:
        return DIGITS

    @property
    def period_seconds(self) -> int:
        return PERIOD_SECONDS

    def new_secret(self) -> str:
        return pyotp.random_base32()  # 32 base32 characters = 160 bits (RFC 4226 §4)

    def provisioning_uri(self, secret: str, *, account_name: str) -> str:
        return self._totp(secret).provisioning_uri(name=account_name, issuer_name=self._issuer)

    def verify(self, secret: str, code: str, *, at: datetime) -> bool:
        if not _CODE.match(code):
            return False
        return bool(self._totp(secret).verify(code, for_time=at, valid_window=VALID_WINDOW))

    def code_at(self, secret: str, at: datetime) -> str:
        """The code of ``at`` (seed docs, tests and the e2e helpers compute it this way)."""
        return self._totp(secret).at(at)

    @staticmethod
    def _totp(secret: str) -> pyotp.TOTP:
        return pyotp.TOTP(secret, digits=DIGITS, interval=PERIOD_SECONDS)
