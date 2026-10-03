"""HMAC-signed customer tokens (JWT HS256, audience ``cc-customer``).

Separate audience from staff tokens (``cc-backoffice``): a staff token never authenticates
a customer route and vice versa. Stateless (no revocation list yet: documented gap).
"""

from __future__ import annotations

from datetime import UTC, datetime

import jwt

from cc_platform.application.customers.ports import CustomerSessionClaims
from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.domain.cases.values import CaseChannel
from cc_platform.infrastructure.security.tokens import MIN_SECRET_BYTES

_ALGORITHM = "HS256"
_REQUIRED_CLAIMS = ["sub", "sid", "channel", "iat", "exp", "iss", "aud"]
CUSTOMER_AUDIENCE = "cc-customer"


class HmacCustomerTokenService:
    def __init__(
        self, secret: str, *, issuer: str = "cc-platform", audience: str = CUSTOMER_AUDIENCE
    ) -> None:
        if len(secret.encode()) < MIN_SECRET_BYTES:
            raise ValueError(f"session secret must be at least {MIN_SECRET_BYTES} bytes")
        self._secret = secret
        self._issuer = issuer
        self._audience = audience

    def issue(self, claims: CustomerSessionClaims) -> str:
        payload = {
            "sub": claims.customer_id,
            "sid": claims.session_id,
            "channel": claims.channel.value,
            "iat": int(claims.issued_at.timestamp()),
            "exp": int(claims.expires_at.timestamp()),
            "iss": self._issuer,
            "aud": self._audience,
        }
        return jwt.encode(payload, self._secret, algorithm=_ALGORITHM)

    def read(self, token: str) -> CustomerSessionClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[_ALGORITHM],
                audience=self._audience,
                issuer=self._issuer,
                options={"require": _REQUIRED_CLAIMS, "verify_exp": False, "verify_iat": False},
            )
            channel = CaseChannel(str(payload["channel"]))  # every channel is a chat
            return CustomerSessionClaims(
                session_id=str(payload["sid"]),
                customer_id=str(payload["sub"]),
                channel=channel,
                issued_at=datetime.fromtimestamp(int(payload["iat"]), tz=UTC),
                expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=UTC),
            )
        except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
            raise AuthenticationRequiredError() from exc
