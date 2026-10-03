"""Sequence cursors: only ASCII digits that fit a signed 64-bit column."""

from __future__ import annotations

import pytest

from cc_platform.application.pagination import MAX_SEQUENCE, decode_sequence_cursor
from cc_platform.domain.shared.errors import InvalidValueError


@pytest.mark.parametrize("cursor", ["1", "42", str(MAX_SEQUENCE)])
def test_valid_cursors(cursor: str) -> None:
    assert decode_sequence_cursor(cursor) == int(cursor)


@pytest.mark.parametrize(
    "cursor",
    ["", "0", "-1", "+1", " 1", "1.0", "abc", "²", "٣", "１", str(MAX_SEQUENCE + 1), "9" * 32],
)
def test_tampered_cursors_are_invalid_values(cursor: str) -> None:
    with pytest.raises(InvalidValueError) as raised:
        decode_sequence_cursor(cursor)
    assert raised.value.details["field"] == "cursor"


def test_a_lower_minimum() -> None:
    assert decode_sequence_cursor("0", minimum=0) == 0
