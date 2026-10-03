"""Temporary passwords for new accounts and resets (slice 4 §1.3, team-generated format).

Twelve characters from an alphabet without look-alikes (no ``0/o``, ``1/l/i``), drawn with
``secrets.choice`` and shown as ``xxxx-xxxx-xxxx`` (the dashes are part of the password, so
what the admin copies is exactly what the person types). The password is returned once and
only its hash is stored; it is never logged nor written to an event.
"""

from __future__ import annotations

import secrets

ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
GROUPS = 3
GROUP_LENGTH = 4


class SecretsTemporaryPasswordGenerator:
    def generate(self) -> str:
        return "-".join(
            "".join(secrets.choice(ALPHABET) for _ in range(GROUP_LENGTH)) for _ in range(GROUPS)
        )
