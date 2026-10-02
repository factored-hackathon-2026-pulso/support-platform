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
