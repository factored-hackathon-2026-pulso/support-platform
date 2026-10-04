"""Password policy (part 4): what a password a person chooses must meet.

NIST SP 800-63B style: a minimum length and a short block list, no composition rules
(no "one upper case, one symbol"). Checked on the server for every password a person sets
(an invitation or a reset link); the SPA shows the same rules live (``PASSWORD_RULES`` in
``features/onboarding/model.ts``, pinned by a test to these values):

- at least ``MIN_LENGTH`` (12) characters (at most ``MAX_LENGTH``, 128: Argon2 hashes it);
- it does not contain her email name (the part before ``@``, or one of its pieces of three
  or more letters, e.g. ``bruna`` and ``esteves`` in ``bruna.esteves@…``) nor a word of
  three or more letters of her name; accents and case are ignored;
- it is not one of the common passwords below.

The thresholds and the block list are team-generated values.
"""

from __future__ import annotations

import re
from enum import StrEnum

from cc_platform.domain.people.names import fold

MIN_LENGTH = 12
MAX_LENGTH = 128
#: Pieces of the email name or of the person's name shorter than this are not checked
#: (initials, "de", "la").
MIN_PERSONAL_PIECE = 3

#: Team-generated block list (lower case, accents removed). Not exhaustive: a seam for a
#: real breached-password check (k-anonymity API) in production.
COMMON_PASSWORDS: frozenset[str] = frozenset(
    {
        "123456789012",
        "1234567890123",
        "contrasena123",
        "contrasena1234",
        "password1234",
        "password12345",
        "qwertyuiop12",
        "qwertyuiop123",
        "latambank2026",
        "latambank123",
        "bienvenido123",
        "bienvenido2026",
        "abcdefghijkl",
        "000000000000",
        "111111111111",
    }
)


class PasswordRule(StrEnum):
    """The rule a password breaks (``password_rejected.reasons``)."""

    MIN_LENGTH = "min_length"
    MAX_LENGTH = "max_length"
    PERSONAL_INFO = "personal_info"
    COMMON = "common"


def personal_pieces(*, email: str, name: str) -> tuple[str, ...]:
    """The folded words a password must not contain: the email name, its pieces and the
    words of her name (three or more letters each)."""
    local = fold(email.partition("@")[0])
    pieces = {local} | set(re.split(r"[^0-9a-z]+", local)) | set(re.split(r"\s+", fold(name)))
    return tuple(sorted(p for p in pieces if len(p) >= MIN_PERSONAL_PIECE))


def password_violations(password: str, *, email: str, name: str) -> tuple[PasswordRule, ...]:
    """Every rule ``password`` breaks, in a fixed order (empty: it is acceptable)."""
    violations: list[PasswordRule] = []
    if len(password) < MIN_LENGTH:
        violations.append(PasswordRule.MIN_LENGTH)
    if len(password) > MAX_LENGTH:
        violations.append(PasswordRule.MAX_LENGTH)
    folded = fold(password)
    if any(piece in folded for piece in personal_pieces(email=email, name=name)):
        violations.append(PasswordRule.PERSONAL_INFO)
    if folded in COMMON_PASSWORDS:
        violations.append(PasswordRule.COMMON)
    return tuple(violations)
