"""The Core's resilience layer (deploy brief P4): timeouts, retry policy and breaker transitions."""

from __future__ import annotations

import asyncio

import pytest

from cc_platform.application.ai.registry import AgentRegistryError
from cc_platform.application.ai.runtime import AgentRuntimeError, AgentRuntimeUnavailableError
from cc_platform.application.tracing import current_trace
from cc_platform.infrastructure.core.resilience import (
    BreakerState,
    CallKind,
    CircuitBreaker,
    CoreCircuitOpenError,
    CoreGuard,
    CoreTimeoutError,
    CoreTimeouts,
    RetryPolicy,
)


class Ticker:
    """A monotonic clock moved by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Sleeps:
    def __init__(self) -> None:
        self.waits: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


def guard(
    *,
    attempts: int = 2,
    threshold: int = 3,
    reset: float = 30.0,
    ticker: Ticker | None = None,
    sleeps: Sleeps | None = None,
    timeouts: CoreTimeouts | None = None,
) -> CoreGuard:
    return CoreGuard(
        timeouts=timeouts or CoreTimeouts(),
        retry=RetryPolicy(attempts=attempts, base_delay=0.2, max_delay=1.0),
        breaker=CircuitBreaker(
            failure_threshold=threshold, reset_seconds=reset, monotonic=ticker or Ticker()
        ),
        sleep=sleeps or Sleeps(),
        rng=lambda: 1.0,
    )


class Flaky:
    """Fails with ``errors`` in order, then answers ``"ok"``."""

    def __init__(self, *errors: Exception) -> None:
        self.errors = list(errors)
        self.calls = 0

    async def __call__(self) -> str:
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return "ok"


def down() -> AgentRuntimeUnavailableError:
    return AgentRuntimeUnavailableError("down")


# ----------------------------------------------------------------------------- retry policy
def test_the_backoff_doubles_up_to_the_ceiling_and_is_scaled_by_the_jitter() -> None:
    policy = RetryPolicy(attempts=5, base_delay=0.2, max_delay=1.0)

    assert [policy.delay(n, lambda: 1.0) for n in (1, 2, 3, 4, 5)] == [0.2, 0.4, 0.8, 1.0, 1.0]
    assert policy.delay(2, lambda: 0.5) == pytest.approx(0.2)
    assert policy.delay(3, lambda: 0.0) == 0.0


async def test_a_retryable_call_is_retried_after_a_quick_failure() -> None:
    sleeps = Sleeps()
    core = guard(sleeps=sleeps)
    attempt = Flaky(down(), down())

    assert await core.call(CallKind.ASSISTANT, "post_turn", attempt, retryable=True) == "ok"
    assert attempt.calls == 3
    assert sleeps.waits == [pytest.approx(0.2), pytest.approx(0.4)]
    assert core.breaker.consecutive_failures == 0  # the success reset the count


async def test_retries_stop_after_the_configured_attempts() -> None:
    core = guard(attempts=1, threshold=10)
    attempt = Flaky(down(), down(), down())

    with pytest.raises(AgentRuntimeUnavailableError):
        await core.call(CallKind.ASSISTANT, "start_run", attempt, retryable=True)
    assert attempt.calls == 2


async def test_a_call_that_is_not_safe_to_repeat_is_tried_once() -> None:
    core = guard()
    attempt = Flaky(down())

    with pytest.raises(AgentRuntimeUnavailableError):
        await core.call(CallKind.REGISTRY, "approve", attempt)
    assert attempt.calls == 1


@pytest.mark.parametrize(
    "answer",
    [
        AgentRuntimeError(status=409, code="run_closed"),
        AgentRegistryError(status=409, code="proposal_stale"),
    ],
)
async def test_a_problem_answer_is_not_retried_and_means_the_core_is_up(answer: Exception) -> None:
    core = guard(threshold=2)
    core.breaker.record_failure()
    attempt = Flaky(answer)

    with pytest.raises(type(answer)):
        await core.call(CallKind.ASSISTANT, "post_turn", attempt, retryable=True)
    assert attempt.calls == 1
    assert core.breaker.consecutive_failures == 0


# ----------------------------------------------------------------------------- timeouts
async def test_a_call_past_its_kind_budget_times_out_and_is_not_retried() -> None:
    core = guard(timeouts=CoreTimeouts(copilot=0.01))
    calls = 0

    async def slow() -> str:
        nonlocal calls
        calls += 1
        await asyncio.sleep(5)
        return "late"

    with pytest.raises(CoreTimeoutError):
        await core.call(CallKind.COPILOT, "post_turn", slow, retryable=True)
    assert calls == 1
    assert core.breaker.consecutive_failures == 1


async def test_each_kind_has_its_own_budget() -> None:
    timeouts = CoreTimeouts(
        assistant=1, copilot=2, suggestions=3, builder=4, registry=5, evaluate=6, probe=7
    )

    assert [timeouts.of(kind) for kind in CallKind] == [1, 2, 3, 4, 5, 6, 7]
    assert timeouts.longest == 7


async def test_a_timeout_is_an_unavailability_every_caller_already_handles() -> None:
    assert issubclass(CoreTimeoutError, AgentRuntimeUnavailableError)
    assert issubclass(CoreCircuitOpenError, AgentRuntimeUnavailableError)


# ----------------------------------------------------------------------------- breaker
async def test_the_breaker_opens_after_the_threshold_and_then_fails_fast() -> None:
    core = guard(attempts=0, threshold=3)
    attempt = Flaky(down(), down(), down())
    for _ in range(3):
        with pytest.raises(AgentRuntimeUnavailableError):
            await core.call(CallKind.ASSISTANT, "post_turn", attempt)

    assert core.breaker.state is BreakerState.OPEN
    assert not core.is_available()
    with pytest.raises(CoreCircuitOpenError):
        await core.call(CallKind.ASSISTANT, "post_turn", attempt)
    assert attempt.calls == 3  # the fourth was never attempted


async def test_a_success_in_between_resets_the_consecutive_count() -> None:
    breaker = CircuitBreaker(failure_threshold=2, reset_seconds=1, monotonic=Ticker())
    breaker.record_failure()
    breaker.record_success()
    breaker.record_failure()

    assert breaker.state is BreakerState.CLOSED


async def test_after_the_reset_time_one_probe_goes_through_and_a_success_closes_it() -> None:
    ticker = Ticker()
    breaker = CircuitBreaker(failure_threshold=1, reset_seconds=30, monotonic=ticker)
    breaker.record_failure()
    assert breaker.state is BreakerState.OPEN

    ticker.now += 30
    assert breaker.state is BreakerState.HALF_OPEN
    assert breaker.is_available()
    assert breaker.acquire()  # the probe
    assert not breaker.acquire()  # only one at a time
    assert not breaker.is_available()

    breaker.record_success()
    assert breaker.state is BreakerState.CLOSED
    assert breaker.acquire()


async def test_a_failed_probe_opens_the_breaker_again_for_a_full_period() -> None:
    ticker = Ticker()
    breaker = CircuitBreaker(failure_threshold=1, reset_seconds=30, monotonic=ticker)
    breaker.record_failure()
    ticker.now += 31
    assert breaker.acquire()

    breaker.record_failure()

    assert breaker.state is BreakerState.OPEN
    ticker.now += 29
    assert not breaker.acquire()
    ticker.now += 1
    assert breaker.acquire()


async def test_a_cancelled_probe_frees_the_slot_without_judging_the_core() -> None:
    ticker = Ticker()
    core = guard(threshold=1, ticker=ticker)
    core.breaker.record_failure()
    ticker.now += 30

    async def hang() -> str:
        await asyncio.sleep(5)
        return "late"

    task = asyncio.create_task(core.call(CallKind.ASSISTANT, "post_turn", hang))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert core.breaker.state is BreakerState.HALF_OPEN
    assert core.is_available()


async def test_the_breaker_is_shared_by_every_kind_of_call() -> None:
    core = guard(attempts=0, threshold=2)
    for kind in (CallKind.ASSISTANT, CallKind.REGISTRY):
        with pytest.raises(AgentRuntimeUnavailableError):
            await core.call(kind, "x", Flaky(down()))

    with pytest.raises(CoreCircuitOpenError):
        await core.call(CallKind.COPILOT, "post_turn", Flaky())


async def test_retries_stop_as_soon_as_the_breaker_opens() -> None:
    core = guard(attempts=5, threshold=2)
    attempt = Flaky(down(), down(), down())

    with pytest.raises(CoreCircuitOpenError):
        await core.call(CallKind.ASSISTANT, "post_turn", attempt, retryable=True)
    assert attempt.calls == 2


def test_the_breaker_refuses_nonsense_settings() -> None:
    with pytest.raises(ValueError, match="failure_threshold"):
        CircuitBreaker(failure_threshold=0)
    with pytest.raises(ValueError, match="reset_seconds"):
        CircuitBreaker(reset_seconds=0)


# ----------------------------------------------------------------------------- trace
async def test_a_call_outside_a_request_runs_with_a_trace_of_its_own() -> None:
    seen: list[str | None] = []

    async def attempt() -> str:
        trace = current_trace()
        seen.append(trace.trace_id if trace else None)
        return "ok"

    await guard().call(CallKind.SUGGESTIONS, "start_run", attempt)

    assert seen[0] is not None
    assert len(seen[0]) == 32
    assert current_trace() is None  # not left behind
