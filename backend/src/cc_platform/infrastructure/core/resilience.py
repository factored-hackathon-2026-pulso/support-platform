"""One resilience layer for every call to the Core (agent-core): timeouts per call kind, retries
with exponential backoff and jitter where a call is safe to repeat, and a circuit breaker shared by
every call to the same Core (deploy brief P4).

- **Timeouts.** Each kind of call has its own budget (``CoreTimeouts``): a customer's turn, an
  analyst's question, a suggestion, the builder's chat, a registry call, an evaluation. Past it the
  call fails with ``CoreTimeoutError`` (an ``AgentRuntimeUnavailableError``: every caller already
  falls back on it).
- **Retries** (``RetryPolicy``) only for calls agent-core makes idempotent (a run's
  ``Idempotency-Key``, a turn's ``client_turn_id``, a publish's ``Idempotency-Key``) or that only
  read, and only after a quick failure (network, 5xx). A timeout is not retried: it already spent
  the whole budget, and repeating it would multiply what the customer or the analyst waits.
- **Circuit breaker** (``CircuitBreaker``): after ``failure_threshold`` consecutive failures it
  opens and every call fails at once with ``CoreCircuitOpenError`` for ``reset_seconds``; then one
  call goes through as a probe (half-open): success closes it, failure opens it again. Only
  unavailability counts as a failure: an ``application/problem+json`` answer (a 4xx, a stable
  error code) means the Core is up.

``CoreGuard.call`` applies the three around one call. It also makes sure the call carries a W3C
trace (``application/tracing.py``) and logs failures and breaker transitions with its trace id
(never credentials or message text).
"""

from __future__ import annotations

import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

import structlog

from cc_platform.application.ai.registry import AgentRegistryError
from cc_platform.application.ai.runtime import AgentRuntimeError, AgentRuntimeUnavailableError
from cc_platform.application.tracing import current_trace, new_trace, use_trace

_log = structlog.get_logger("cc_platform.core")


class CallKind(StrEnum):
    """What a call to the Core is for: picks its timeout and names it in the logs."""

    ASSISTANT = "assistant"
    """The customer's conversation: runs, turns, handoffs."""
    COPILOT = "copilot"
    """The analyst's questions to the copilot."""
    SUGGESTIONS = "suggestions"
    """The copilot's suggestions for a case (a task run)."""
    BUILDER = "builder"
    """The supervisor's chat with the builder agent."""
    REGISTRY = "registry"
    """The registry: proposals, releases, aliases, versions."""
    EVALUATE = "evaluate"
    """A proposal's evaluation (runs the agent's eval suite)."""
    PROBE = "probe"
    """The readiness probe (``GET /healthz`` of the Core)."""


class CoreTimeoutError(AgentRuntimeUnavailableError):
    """The Core did not answer within the call kind's budget."""


class CoreCircuitOpenError(AgentRuntimeUnavailableError):
    """The Core is taken as down (its breaker is open): the call was not attempted."""


@dataclass(frozen=True, slots=True)
class CoreTimeouts:
    """Seconds each kind of call may take (``CC_CORE_TIMEOUT_*``)."""

    assistant: float = 60.0
    copilot: float = 60.0
    suggestions: float = 60.0
    builder: float = 60.0
    registry: float = 30.0
    evaluate: float = 120.0
    probe: float = 2.0

    def of(self, kind: CallKind) -> float:
        return {
            CallKind.ASSISTANT: self.assistant,
            CallKind.COPILOT: self.copilot,
            CallKind.SUGGESTIONS: self.suggestions,
            CallKind.BUILDER: self.builder,
            CallKind.REGISTRY: self.registry,
            CallKind.EVALUATE: self.evaluate,
            CallKind.PROBE: self.probe,
        }[kind]

    @property
    def longest(self) -> float:
        return max(self.of(kind) for kind in CallKind)


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """``attempts`` retries after the first try (0 = never retry). The n-th retry waits a random
    time in ``[0, min(max_delay, base_delay * 2**(n-1))]`` ("full jitter"), so many callers that
    failed together do not come back together."""

    attempts: int = 2
    base_delay: float = 0.2
    max_delay: float = 2.0

    def delay(self, retry: int, rng: Callable[[], float]) -> float:
        """The wait before retry number ``retry`` (1-based)."""
        ceiling = min(self.max_delay, self.base_delay * 2.0 ** (retry - 1))
        return ceiling * rng()


class BreakerState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """Consecutive-failure breaker. Not thread-safe; it lives on one event loop (one process)."""

    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        reset_seconds: float = 30.0,
        monotonic: Callable[[], float] = time.monotonic,
        name: str = "agent-core",
    ) -> None:
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be at least 1")
        if reset_seconds <= 0:
            raise ValueError("reset_seconds must be positive")
        self._threshold = failure_threshold
        self._reset = reset_seconds
        self._now = monotonic
        self._name = name
        self._state = BreakerState.CLOSED
        self._failures = 0
        self._opened_at = 0.0
        self._probing = False

    @property
    def state(self) -> BreakerState:
        """The state, with an open breaker past its reset time reported as half-open."""
        if self._state is BreakerState.OPEN and self._now() - self._opened_at >= self._reset:
            return BreakerState.HALF_OPEN
        return self._state

    @property
    def consecutive_failures(self) -> int:
        return self._failures

    def is_available(self) -> bool:
        """Whether a call would be let through now (no side effect)."""
        state = self.state
        if state is BreakerState.HALF_OPEN:
            return not self._probing
        return state is BreakerState.CLOSED

    def acquire(self) -> bool:
        """Ask to make one call. In half-open only one probe is let through at a time; a caller
        that got ``True`` must then call ``record_success``, ``record_failure`` or ``release``."""
        state = self.state
        if state is BreakerState.CLOSED:
            return True
        if state is BreakerState.HALF_OPEN and not self._probing:
            if self._state is not BreakerState.HALF_OPEN:
                self._transition(BreakerState.HALF_OPEN)
            self._probing = True
            return True
        return False

    def record_success(self) -> None:
        self._probing = False
        self._failures = 0
        if self._state is not BreakerState.CLOSED:
            self._transition(BreakerState.CLOSED)

    def record_failure(self) -> None:
        self._probing = False
        self._failures += 1
        if self._state is BreakerState.HALF_OPEN or (
            self._state is BreakerState.CLOSED and self._failures >= self._threshold
        ):
            self._opened_at = self._now()
            self._transition(BreakerState.OPEN)

    def release(self) -> None:
        """The call ended without telling whether the Core is up (cancelled, or a bug)."""
        self._probing = False

    def _transition(self, state: BreakerState) -> None:
        previous, self._state = self._state, state
        log = _log.warning if state is BreakerState.OPEN else _log.info
        log(
            "core_breaker_transition",
            core=self._name,
            previous=previous.value,
            state=state.value,
            consecutive_failures=self._failures,
        )


_ANSWERED: Final = (AgentRuntimeError, AgentRegistryError)


class CoreGuard:
    """Timeouts, retries and the breaker around the calls to one Core."""

    def __init__(
        self,
        *,
        timeouts: CoreTimeouts | None = None,
        retry: RetryPolicy | None = None,
        breaker: CircuitBreaker | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        rng: Callable[[], float] = random.random,
    ) -> None:
        self.timeouts = timeouts or CoreTimeouts()
        self.retry = retry or RetryPolicy()
        self.breaker = breaker or CircuitBreaker()
        self._sleep = sleep
        self._rng = rng

    def is_available(self) -> bool:
        """``CoreAvailability``: False while the breaker is open."""
        return self.breaker.is_available()

    async def call[T](
        self,
        kind: CallKind,
        operation: str,
        attempt: Callable[[], Awaitable[T]],
        *,
        retryable: bool = False,
    ) -> T:
        """Run ``attempt`` under the kind's timeout, retrying a quick failure when ``retryable``.

        Raises ``CoreCircuitOpenError`` without calling when the breaker is open,
        ``CoreTimeoutError`` past the budget, the inner ``AgentRuntimeUnavailableError`` after the
        last failed try, and whatever the Core answered (``AgentRuntimeError``,
        ``AgentRegistryError``) untouched."""
        trace = current_trace()
        if trace is None:  # a job outside a request (a sweep): the call starts its own trace
            with use_trace(new_trace()):
                return await self._call(kind, operation, attempt, retryable=retryable)
        return await self._call(kind, operation, attempt, retryable=retryable)

    async def _call[T](
        self,
        kind: CallKind,
        operation: str,
        attempt: Callable[[], Awaitable[T]],
        *,
        retryable: bool,
    ) -> T:
        retries = self.retry.attempts if retryable else 0
        budget = self.timeouts.of(kind)
        tried = 0
        while True:
            tried += 1
            if not self.breaker.acquire():
                _log.info("core_call_skipped", kind=kind.value, operation=operation, **_trace())
                raise CoreCircuitOpenError("agent-core is taken as down (circuit open)")
            try:
                async with asyncio.timeout(budget):
                    result = await attempt()
            except TimeoutError:
                self.breaker.record_failure()
                self._failed(kind, operation, tried, "timeout")
                raise CoreTimeoutError(f"agent-core did not answer within {budget:g}s") from None
            except AgentRuntimeUnavailableError as error:
                self.breaker.record_failure()
                self._failed(kind, operation, tried, type(error).__name__)
                if tried > retries:
                    raise
                await self._sleep(self.retry.delay(tried, self._rng))
                continue
            except _ANSWERED:
                self.breaker.record_success()  # a problem answer: the Core is up
                raise
            except BaseException:
                self.breaker.release()  # cancelled, or a bug: says nothing about the Core
                raise
            self.breaker.record_success()
            return result

    @staticmethod
    def _failed(kind: CallKind, operation: str, tried: int, reason: str) -> None:
        _log.warning(
            "core_call_failed",
            kind=kind.value,
            operation=operation,
            attempt=tried,
            reason=reason,
            **_trace(),
        )


def _trace() -> dict[str, str]:
    """The trace id for a log line (bound already on a request's lines; explicit on a job's)."""
    trace = current_trace()
    return {"trace_id": trace.trace_id} if trace is not None else {}
