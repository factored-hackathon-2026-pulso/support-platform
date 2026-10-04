"""Single-use link tokens (part 4: invitations, password resets).

``secrets.token_urlsafe(32)``: 256 random bits, 43 URL-safe characters. Only the SHA-256 of
a token is stored; a plain hash (no salt, no key) is enough because the token itself is
high-entropy (nothing to brute-force), and a deterministic hash lets the repository look the
token up by an indexed column.
"""

from __future__ import annotations

import hashlib
import secrets

from cc_platform.application.ports.security import IssuedToken

TOKEN_BYTES = 32


class SecretsOneTimeTokens:
    def issue(self) -> IssuedToken:
        token = secrets.token_urlsafe(TOKEN_BYTES)
        return IssuedToken(token=token, hash=self.hash(token))

    def hash(self, token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()
