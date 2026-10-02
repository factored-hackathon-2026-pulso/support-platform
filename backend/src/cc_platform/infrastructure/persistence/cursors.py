"""Opaque cursor helpers for sequence-based pagination."""

from __future__ import annotations

from cc_platform.domain.shared.errors import InvalidValueError

MAX_PAGE_SIZE = 500


def decode_cursor(cursor: str | None) -> int:
    if cursor is None or cursor == "":
        return 0
    if not cursor.isdigit():
        raise InvalidValueError("El cursor no es válido.", field="cursor")
    return int(cursor)


def encode_cursor(sequence: int) -> str:
    return str(sequence)


def clamp_limit(limit: int) -> int:
    return max(1, min(limit, MAX_PAGE_SIZE))
