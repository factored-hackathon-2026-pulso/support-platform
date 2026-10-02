"""Development MFA verifier: accepts one fixed code for every method.

Replace with a TOTP/SMS provider adapter behind the same ``MfaVerifier`` port. The container
refuses to build this adapter when ``CC_ENV=prod``.
"""

from __future__ import annotations

import hmac

from cc_platform.domain.people.mfa import MfaMethod


class DevMfaVerifier:
    def __init__(self, code: str = "000000") -> None:
        self._code = code

    async def verify(self, *, staff_id: str, method: MfaMethod, code: str) -> bool:
        return hmac.compare_digest(code.encode(), self._code.encode())
