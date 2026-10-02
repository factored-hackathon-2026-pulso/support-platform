"""HMAC-signed session tokens (JWT HS256) implementing ``SessionTokenService``."""

from __future__ import annotations

from datetime import UTC, datetime

import jwt

from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.application.ports.security import SessionClaims
from cc_platform.domain.people.staff import StaffRole

_ALGORITHM = "HS256"
_REQUIRED_CLAIMS = ["sub", "sid", "roles", "iat", "exp", "iss", "aud"]
MIN_SECRET_BYTES = 32


class HmacSessionTokenService:
    def __init__(
        self,
        secret: str,
        *,
        issuer: str = "cc-platform",
        audience: str = "cc-backoffice",
    ) -> None:
        if len(secret.encode()) < MIN_SECRET_BYTES:
            raise ValueError(f"session secret must be at least {MIN_SECRET_BYTES} bytes")
        self._secret = secret
        self._issuer = issuer
        self._audience = audience

    def issue(self, claims: SessionClaims) -> str:
        payload = {
            "sub": claims.staff_id,
            "sid": claims.session_id,
            "roles": sorted(role.value for role in claims.roles),
            "iat": int(claims.issued_at.timestamp()),
            "exp": int(claims.expires_at.timestamp()),
            "iss": self._issuer,
            "aud": self._audience,
        }
        return jwt.encode(payload, self._secret, algorithm=_ALGORITHM)

    def read(self, token: str) -> SessionClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[_ALGORITHM],
                audience=self._audience,
                issuer=self._issuer,
                # Expiry is checked by the use case against the injected Clock.
                options={"require": _REQUIRED_CLAIMS, "verify_exp": False, "verify_iat": False},
            )
            return SessionClaims(
                session_id=str(payload["sid"]),
                staff_id=str(payload["sub"]),
                roles=frozenset(StaffRole(role) for role in payload["roles"]),
                issued_at=datetime.fromtimestamp(int(payload["iat"]), tz=UTC),
                expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=UTC),
            )
        except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
            raise AuthenticationRequiredError() from exc
