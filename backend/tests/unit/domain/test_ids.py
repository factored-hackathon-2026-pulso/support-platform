from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import (
    BODY_LENGTH,
    CROCKFORD_ALPHABET,
    IdPrefix,
    encode_body,
    is_valid_id,
    make_id,
    prefix_of,
    require_id,
)
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator, UlidIdGenerator


def test_encode_body_has_fixed_length_and_crockford_alphabet() -> None:
    body = encode_body(1_790_000_000_000, 123456789)
    assert len(body) == BODY_LENGTH
    assert set(body) <= set(CROCKFORD_ALPHABET)


def test_encode_body_orders_by_timestamp() -> None:
    assert encode_body(1, 2**79) < encode_body(2, 0)


@pytest.mark.parametrize(("timestamp", "randomness"), [(-1, 0), (2**48, 0), (0, 2**80)])
def test_encode_body_rejects_out_of_range_values(timestamp: int, randomness: int) -> None:
    with pytest.raises(InvalidValueError):
        encode_body(timestamp, randomness)


def test_make_id_validates_and_round_trips_prefix() -> None:
    case_id = make_id(IdPrefix.CASE, "0" * BODY_LENGTH)
    assert case_id == "CASE-" + "0" * BODY_LENGTH
    assert is_valid_id(case_id)
    assert is_valid_id(case_id, IdPrefix.CASE)
    assert not is_valid_id(case_id, IdPrefix.TURN)
    assert prefix_of(case_id) is IdPrefix.CASE
    assert require_id(case_id, IdPrefix.CASE) == case_id


@pytest.mark.parametrize(
    "value",
    [
        "",
        "CASE",
        "CASE-123",
        "case-" + "0" * 26,
        "CASE-" + "I" * 26,
        "CASE-" + "0" * 27,
        "CASE_" + "0" * 26,
    ],
)
def test_malformed_ids_are_rejected(value: str) -> None:
    assert not is_valid_id(value)
    with pytest.raises(InvalidValueError):
        prefix_of(value)


def test_unknown_prefix_is_rejected() -> None:
    with pytest.raises(InvalidValueError):
        prefix_of("ZZZ-" + "0" * 26)
    with pytest.raises(InvalidValueError):
        make_id(IdPrefix.CASE, "short")


def test_require_id_rejects_other_prefix() -> None:
    with pytest.raises(InvalidValueError) as error:
        require_id(make_id(IdPrefix.TURN, "1" * 26), IdPrefix.CASE)
    assert error.value.code == "invalid_value"


def test_ulid_generator_is_prefixed_unique_and_time_ordered() -> None:
    clock = FixedClock(datetime(2026, 10, 2, tzinfo=UTC))
    generator = UlidIdGenerator(clock)
    same_ms = [generator.new_id(IdPrefix.TURN) for _ in range(50)]
    clock.advance(timedelta(milliseconds=5))
    later = generator.new_id(IdPrefix.TURN)

    assert all(is_valid_id(value, IdPrefix.TURN) for value in [*same_ms, later])
    assert len(set(same_ms)) == len(same_ms)
    assert same_ms == sorted(same_ms), "monotonic within the same millisecond"
    assert later > same_ms[-1]


def test_sequential_generator_counts_per_prefix() -> None:
    generator = SequentialIdGenerator()
    assert generator.new_id(IdPrefix.CASE).endswith("01")
    assert generator.new_id(IdPrefix.CASE).endswith("02")
    assert generator.new_id(IdPrefix.TURN).endswith("01")
