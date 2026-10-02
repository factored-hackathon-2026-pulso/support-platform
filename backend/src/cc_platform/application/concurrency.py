"""Optimistic-concurrency retry for use cases (pairs with ``AggregateRoot.version``).

A command that loads aggregates, decides and saves runs inside ``retry_on_conflict``. When
a concurrent request committed one of those aggregates first, the repository raises
``ConcurrentUpdateError``, the Unit of Work rolls back, and the whole command re-runs on the
fresh state, so its business checks (lock still open? challenge still pending?) are
evaluated again instead of overwriting the other request's change.

Only wrap operations that are safe to repeat: expensive or side-effecting checks done before
the save (password hashing, an MFA provider call) must be cached by the caller.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from cc_platform.domain.shared.errors import ConcurrentUpdateError

DEFAULT_ATTEMPTS = 10


async def retry_on_conflict[T](
    operation: Callable[[], Awaitable[T]], *, attempts: int = DEFAULT_ATTEMPTS
) -> T:
    """Run ``operation``; re-run it on ``ConcurrentUpdateError`` up to ``attempts`` times."""
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    for _ in range(attempts - 1):
        try:
            return await operation()
        except ConcurrentUpdateError:
            await asyncio.sleep(0)  # let the winning transaction finish before re-reading
    return await operation()
