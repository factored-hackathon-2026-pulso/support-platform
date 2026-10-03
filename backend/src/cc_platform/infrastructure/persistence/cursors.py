"""Opaque cursor helpers for sequence-based pagination."""

from __future__ import annotations

from cc_platform.application.pagination import decode_sequence_cursor

MAX_PAGE_SIZE = 500


def decode_cursor(cursor: str | None) -> int:
    if cursor is None or cursor == "":
        return 0
    return decode_sequence_cursor(cursor, minimum=0)


def encode_cursor(sequence: int) -> str:
    return str(sequence)


def clamp_limit(limit: int) -> int:
    return max(1, min(limit, MAX_PAGE_SIZE))
