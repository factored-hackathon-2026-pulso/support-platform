"""Security ports: password hashing, session tokens and the second authentication factor."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.domain.people.mfa import MfaMethod
from cc_platform.domain.people.staff import StaffRole


class PasswordHasher(Protocol):
    async def hash(self, password: str) -> str: ...

    async def verify(self, password_hash: str | None, password: str) -> bool:
        """Check a password. ``password_hash=None`` means *unknown account*: the adapter
        must still spend comparable time (against a dummy hash) and return False, so the
        response time does not reveal which emails exist."""
        ...


@dataclass(frozen=True, slots=True)
class SessionClaims:
    session_id: str
    staff_id: str
    roles: frozenset[StaffRole]
    issued_at: datetime
    expires_at: datetime


class SessionTokenService(Protocol):
    def issue(self, claims: SessionClaims) -> str:
        """Return a signed token carrying the claims."""
        ...

    def read(self, token: str) -> SessionClaims:
        """Verify the signature and return the claims.

        Expiry is **not** checked here (the use case compares ``expires_at`` with the
        ``Clock`` so tests can control time). Raises ``AuthenticationRequiredError`` when
        the token is malformed or its signature is invalid.
        """
        ...


class MfaVerifier(Protocol):
    async def verify(self, *, staff_id: str, method: MfaMethod, code: str) -> bool:
        """Check a one-time code. Dev implementation accepts a fixed code (``000000``)."""
        ...


@dataclass(frozen=True, slots=True)
class IssuedToken:
    """A one-time link token: ``token`` travels once (in the email link), only ``hash``
    is stored."""

    token: str
    hash: str


class OneTimeTokens(Protocol):
    """Single-use link tokens (part 4: invitations and password resets).

    ``issue`` returns a high-entropy random token (at least 256 bits) and its hash; ``hash``
    recomputes the hash of a presented token for the lookup. Tests use a predictable fake.
    """

    def issue(self) -> IssuedToken: ...

    def hash(self, token: str) -> str: ...


class TotpService(Protocol):
    """Time-based one-time passwords (RFC 6238: 30-second steps, 6 digits, HMAC-SHA1 for
    authenticator-app compatibility). Time comes from the caller (the ``Clock``)."""

    @property
    def issuer(self) -> str:
        """The name the authenticator app shows above the codes."""
        ...

    @property
    def digits(self) -> int: ...

    @property
    def period_seconds(self) -> int: ...

    def new_secret(self) -> str:
        """A fresh random base32 secret (160 bits)."""
        ...

    def provisioning_uri(self, secret: str, *, account_name: str) -> str:
        """The ``otpauth://totp/…`` URI an authenticator app reads from the QR code."""
        ...

    def verify(self, secret: str, code: str, *, at: datetime) -> bool:
        """Whether ``code`` is valid at ``at`` (one step of clock drift either way)."""
        ...


class SecretBox(Protocol):
    """Seals secrets kept at rest (the TOTP secrets): authenticated encryption."""

    def seal(self, plain: str) -> str: ...

    def open(self, sealed: str) -> str:
        """The plain secret; raises ``ValueError`` when the box cannot open it."""
        ...
