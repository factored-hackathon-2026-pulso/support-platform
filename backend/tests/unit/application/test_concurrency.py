"""``retry_on_conflict``: re-runs a command that lost an optimistic-locking race."""

from __future__ import annotations

import pytest

from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.domain.shared.errors import ConcurrentUpdateError, ConflictError


async def test_retries_until_the_operation_wins() -> None:
    calls = 0

    async def operation() -> str:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise ConcurrentUpdateError()
        return "done"

    assert await retry_on_conflict(operation) == "done"
    assert calls == 3


async def test_gives_up_after_the_last_attempt() -> None:
    calls = 0

    async def operation() -> None:
        nonlocal calls
        calls += 1
        raise ConcurrentUpdateError()

    with pytest.raises(ConcurrentUpdateError):
        await retry_on_conflict(operation, attempts=4)
    assert calls == 4


async def test_other_errors_are_not_retried() -> None:
    calls = 0

    async def operation() -> None:
        nonlocal calls
        calls += 1
        raise ConflictError("duplicate")

    with pytest.raises(ConflictError):
        await retry_on_conflict(operation)
    assert calls == 1


async def test_rejects_zero_attempts() -> None:
    async def operation() -> None:
        return None

    with pytest.raises(ValueError, match="attempts"):
        await retry_on_conflict(operation, attempts=0)
