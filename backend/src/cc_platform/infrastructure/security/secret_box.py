"""Secrets at rest (``SecretBox`` port): Fernet (AES-128-CBC + HMAC-SHA256, from the
``cryptography`` package) seals every stored TOTP secret.

The key comes from ``CC_TOTP_SECRET_KEY`` (a Fernet key: 32 url-safe base64 bytes). In
development and tests, when it is not set, it is derived from the session secret
(``derive_key``), so a local database keeps working across restarts; production must set its
own key (and keep it out of the database backups' reach). Rotating keys (``MultiFernet``) is a
documented seam, not built.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

_DERIVATION_LABEL = b"cc-platform/totp-secret-box/v1:"


def derive_key(secret: str) -> bytes:
    """A Fernet key derived from another secret (development fallback)."""
    digest = hashlib.sha256(_DERIVATION_LABEL + secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


class FernetSecretBox:
    def __init__(self, key: bytes) -> None:
        self._fernet = Fernet(key)

    def seal(self, plain: str) -> str:
        return self._fernet.encrypt(plain.encode()).decode()

    def open(self, sealed: str) -> str:
        try:
            return self._fernet.decrypt(sealed.encode()).decode()
        except InvalidToken as exc:
            raise ValueError("the sealed secret cannot be opened with this key") from exc
