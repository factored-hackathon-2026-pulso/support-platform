"""``InMemoryUnknownLoginAttempts``: storage only (the rules are ``FailedAttemptCounter``)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.people.errors import AccountLockedError
from cc_platform.domain.people.login_account import FailedAttemptCounter, LockoutPolicy
from cc_platform.infrastructure.security.login_attempts import InMemoryUnknownLoginAttempts

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
POLICY = LockoutPolicy(max_failed_attempts=3, lock_duration=timedelta(minutes=15))


def fail(counter: FailedAttemptCounter) -> FailedAttemptCounter:
    return counter.register_failure(NOW, POLICY)


async def test_unknown_email_starts_with_an_empty_counter() -> None:
    assert (await InMemoryUnknownLoginAttempts().get("a@x.co")).is_clear


async def test_update_stores_the_domain_result_per_email() -> None:
    attempts = InMemoryUnknownLoginAttempts()
    counters = [await attempts.update("a@x.co", fail) for _ in range(3)]
    assert [c.remaining(POLICY) for c in counters] == [2, 1, 0]
    assert (await attempts.get("a@x.co")).locked_until == NOW + timedelta(minutes=15)
    assert (await attempts.get("b@x.co")).is_clear


async def test_errors_raised_by_the_change_leave_the_counter_untouched() -> None:
    attempts = InMemoryUnknownLoginAttempts()
    for _ in range(3):
        await attempts.update("a@x.co", fail)
    locked = await attempts.get("a@x.co")
    with pytest.raises(AccountLockedError):
        await attempts.update("a@x.co", fail)
    assert await attempts.get("a@x.co") == locked


async def test_parallel_updates_are_all_counted() -> None:
    attempts = InMemoryUnknownLoginAttempts()
    outcomes = await asyncio.gather(
        *(attempts.update("a@x.co", fail) for _ in range(10)), return_exceptions=True
    )
    assert sum(isinstance(o, FailedAttemptCounter) for o in outcomes) == 3
    assert sum(isinstance(o, AccountLockedError) for o in outcomes) == 7


async def test_a_clear_counter_is_not_stored() -> None:
    attempts = InMemoryUnknownLoginAttempts()
    await attempts.update("a@x.co", fail)
    await attempts.update("a@x.co", lambda _counter: FailedAttemptCounter())
    assert len(attempts) == 0


async def test_memory_is_bounded_by_evicting_the_least_recent_email() -> None:
    attempts = InMemoryUnknownLoginAttempts(max_entries=2)
    await attempts.update("a@x.co", fail)
    await attempts.update("b@x.co", fail)
    await attempts.update("a@x.co", fail)  # a is now most recent
    await attempts.update("c@x.co", fail)  # evicts b
    assert len(attempts) == 2
    assert (await attempts.get("b@x.co")).is_clear
    assert (await attempts.get("a@x.co")).failed_attempts == 2


def test_rejects_an_empty_capacity() -> None:
    with pytest.raises(ValueError, match="max_entries"):
        InMemoryUnknownLoginAttempts(max_entries=0)
