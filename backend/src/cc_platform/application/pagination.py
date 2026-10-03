"""Sequence cursors: the one decoder for every opaque ``cursor`` the API hands out.

Turn pages and the audit log page by ``sequence`` (an integer column). A cursor is the
decimal sequence, so a tampered one must fail as a 422 ``invalid_value`` before it reaches
the database: only ASCII digits (``str.isdigit`` also accepts "²" or "٣"), at most
``MAX_SEQUENCE_DIGITS`` of them, and a value that fits a signed 64-bit column (SQLite
``INTEGER``, Postgres ``BIGINT``).
"""

from __future__ import annotations

from cc_platform.domain.shared.errors import InvalidValueError

MAX_SEQUENCE = 2**63 - 1
"""Largest sequence a database column can hold (signed 64-bit)."""

MAX_SEQUENCE_DIGITS = len(str(MAX_SEQUENCE))


def decode_sequence_cursor(cursor: str, *, minimum: int = 1, field: str = "cursor") -> int:
    """The sequence a cursor stands for; ``InvalidValueError`` for anything else."""
    if (
        not cursor
        or len(cursor) > MAX_SEQUENCE_DIGITS
        or not cursor.isascii()
        or not cursor.isdigit()
    ):
        raise InvalidValueError("El cursor no es válido.", field=field)
    value = int(cursor)
    if value < minimum or value > MAX_SEQUENCE:
        raise InvalidValueError("El cursor no es válido.", field=field)
    return value
