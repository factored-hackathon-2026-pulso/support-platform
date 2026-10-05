"""W3C Trace Context parsing and propagation (deploy brief P4)."""

from __future__ import annotations

import pytest

from cc_platform.application.tracing import current_trace, new_trace, parse_trace, use_trace

TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT = "00f067aa0ba902b7"
VALID = f"00-{TRACE}-{PARENT}-01"


def test_a_valid_traceparent_keeps_its_trace_and_state() -> None:
    trace = parse_trace(VALID, "congo=t61rcWkgMzE")

    assert trace is not None
    assert (trace.trace_id, trace.parent_id, trace.flags) == (TRACE, PARENT, "01")
    assert trace.traceparent == VALID
    assert trace.headers() == {"traceparent": VALID, "tracestate": "congo=t61rcWkgMzE"}


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "garbage",
        f"ff-{TRACE}-{PARENT}-01",  # version ff is invalid
        f"00-{'0' * 32}-{PARENT}-01",  # all-zero trace id
        f"00-{TRACE}-{'0' * 16}-01",  # all-zero parent id
        f"00-{TRACE.upper()}-{PARENT}-01",  # uppercase hex
        f"00-{TRACE}-{PARENT}-01-extra",  # version 00 has exactly four fields
        f"00-{TRACE[:-1]}-{PARENT}-01",
    ],
)
def test_an_invalid_traceparent_is_ignored(value: str | None) -> None:
    assert parse_trace(value) is None


def test_a_later_version_may_carry_more_fields() -> None:
    trace = parse_trace(f"01-{TRACE}-{PARENT}-00-whatever")

    assert trace is not None
    assert trace.trace_id == TRACE


def test_a_tracestate_that_is_not_plausible_is_dropped() -> None:
    trace = parse_trace(VALID, "x" * 600)

    assert trace is not None
    assert trace.state is None
    assert "tracestate" not in trace.headers()


def test_a_child_keeps_the_trace_with_a_new_parent() -> None:
    trace = parse_trace(VALID, "a=b")
    assert trace is not None

    child = trace.child()

    assert child.trace_id == TRACE
    assert child.state == "a=b"
    assert child.parent_id != PARENT
    assert len(child.parent_id) == 16


def test_a_new_trace_is_valid_w3c() -> None:
    trace = new_trace()

    assert parse_trace(trace.traceparent) == trace


def test_the_current_trace_is_bound_for_a_block() -> None:
    assert current_trace() is None
    trace = new_trace()
    with use_trace(trace):
        assert current_trace() == trace
    assert current_trace() is None
