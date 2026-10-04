"""The links the emails carry (part 4): SPA routes outside the staff shell.

``/activate?token=…`` (invitation) and ``/reset-password?token=…`` (password reset), on
``CC_PUBLIC_APP_URL`` (the SPA's origin; the e2e runner points it at its own web server).
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

ACTIVATION_PATH = "/activate"
PASSWORD_RESET_PATH = "/reset-password"  # noqa: S105 - a route, not a secret


@dataclass(frozen=True, slots=True)
class AppLinks:
    base_url: str

    def _link(self, path: str, token: str) -> str:
        return f"{self.base_url.rstrip('/')}{path}?token={quote(token, safe='')}"

    def activation(self, token: str) -> str:
        return self._link(ACTIVATION_PATH, token)

    def password_reset(self, token: str) -> str:
        return self._link(PASSWORD_RESET_PATH, token)
