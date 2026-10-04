"""Prefixed opaque identifiers.

Every identifier the platform hands out is ``<PREFIX>-<BODY>`` where ``PREFIX`` names the
kind of entity (``CASE``, ``TRN``, ``STF``...) and ``BODY`` is a 26-character Crockford
base32 string (ULID layout: 48-bit millisecond timestamp + 80 random bits). Clients must
treat ids as opaque strings; the prefix only helps humans and logs.

Generation needs a clock and randomness, so it lives behind the ``IdGenerator`` port
(``cc_platform.application.ports.ids``). This module only defines the vocabulary and the
pure encoding/validation helpers.
"""

from __future__ import annotations

import re
from enum import StrEnum

from cc_platform.domain.shared.errors import InvalidValueError

CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
BODY_LENGTH = 26
_TIMESTAMP_BITS = 48
_RANDOM_BITS = 80
_MAX_TIMESTAMP = (1 << _TIMESTAMP_BITS) - 1
_MAX_RANDOM = (1 << _RANDOM_BITS) - 1

_ID_PATTERN = re.compile(
    rf"^(?P<prefix>[A-Z]{{2,5}})-(?P<body>[{CROCKFORD_ALPHABET}]{{{BODY_LENGTH}}})$"
)


class IdPrefix(StrEnum):
    """Registry of id prefixes. Add a member when a new kind of entity appears."""

    STAFF = "STF"
    SESSION = "SES"
    MFA_CHALLENGE = "MFA"
    EVENT = "EVT"
    MESSAGE = "MSG"
    CONNECTION = "CON"
    CUSTOMER = "CUS"
    CASE = "CASE"
    TURN = "TRN"
    ASSIGNMENT = "ASG"
    CUSTOMER_SESSION = "CSN"
    TEAM = "TEAM"
    ESCALATION = "ESC"
    NOTIFICATION = "NTF"
    INVITATION = "INV"
    PASSWORD_RESET = "PWR"  # noqa: S105 - an id prefix, not a secret
    EMAIL = "EML"
    CALL = "CALL"
    ASSISTANT_SESSION = "AST"


def encode_body(timestamp_ms: int, randomness: int) -> str:
    """Encode a ULID-style body: 10 chars of timestamp followed by 16 chars of randomness."""
    if not 0 <= timestamp_ms <= _MAX_TIMESTAMP:
        raise InvalidValueError("timestamp out of range for an id", field="timestamp_ms")
    if not 0 <= randomness <= _MAX_RANDOM:
        raise InvalidValueError("randomness out of range for an id", field="randomness")
    value = (timestamp_ms << _RANDOM_BITS) | randomness
    chars = []
    for _ in range(BODY_LENGTH):
        chars.append(CROCKFORD_ALPHABET[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def make_id(prefix: IdPrefix, body: str) -> str:
    """Join a prefix and an already-encoded body, validating the result."""
    candidate = f"{prefix.value}-{body}"
    if not is_valid_id(candidate, prefix):
        raise InvalidValueError("malformed id body", field="id", value=candidate)
    return candidate


def is_valid_id(value: str, prefix: IdPrefix | None = None) -> bool:
    """Return True when ``value`` is a well-formed id (optionally of the given prefix)."""
    match = _ID_PATTERN.match(value)
    if match is None:
        return False
    return prefix is None or match.group("prefix") == prefix.value


def prefix_of(value: str) -> IdPrefix:
    """Return the prefix of a well-formed id or raise ``InvalidValueError``."""
    match = _ID_PATTERN.match(value)
    if match is None:
        raise InvalidValueError("malformed id", field="id", value=value)
    try:
        return IdPrefix(match.group("prefix"))
    except ValueError as exc:
        raise InvalidValueError("unknown id prefix", field="id", value=value) from exc


def require_id(value: str, prefix: IdPrefix) -> str:
    """Validate that ``value`` is an id of ``prefix`` and return it unchanged."""
    if not is_valid_id(value, prefix):
        raise InvalidValueError(
            f"expected an id with prefix {prefix.value}", field="id", value=value
        )
    return value
