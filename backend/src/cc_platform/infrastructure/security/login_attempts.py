"""Process-local ``UnknownLoginAttempts`` adapter (anti-enumeration counters).

Storage only: the lockout rules are the domain's ``FailedAttemptCounter``; this class keeps
one counter per email. ``update`` runs the change and the write under one lock, so parallel
guesses for the same email are counted one by one.

Bounded LRU: at most ``max_entries`` emails are tracked, so a flood of random emails cannot
grow memory without limit (evicting an entry only resets that email's countdown). With
several API workers each keeps its own counters; that is acceptable because no real account
sits behind them. A shared store (Redis ``WATCH``/``MULTI``) can implement the same port.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable

from cc_platform.domain.people.login_account import FailedAttemptCounter

DEFAULT_MAX_ENTRIES = 10_000


class InMemoryUnknownLoginAttempts:
    def __init__(self, *, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be >= 1")
        self._max_entries = max_entries
        self._counters: OrderedDict[str, FailedAttemptCounter] = OrderedDict()
        self._lock = threading.Lock()

    async def get(self, email: str) -> FailedAttemptCounter:
        with self._lock:
            return self._counters.get(email, FailedAttemptCounter())

    async def update(
        self, email: str, change: Callable[[FailedAttemptCounter], FailedAttemptCounter]
    ) -> FailedAttemptCounter:
        with self._lock:
            updated = change(self._counters.get(email, FailedAttemptCounter()))
            if updated.is_clear:
                self._counters.pop(email, None)
                return updated
            self._counters[email] = updated
            self._counters.move_to_end(email)
            while len(self._counters) > self._max_entries:
                self._counters.popitem(last=False)
            return updated

    def __len__(self) -> int:
        return len(self._counters)
