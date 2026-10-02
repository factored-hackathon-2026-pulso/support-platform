"""Clock adapters."""

from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FixedClock:
    """Deterministic clock for tests: frozen until ``advance``/``set`` is called.

    Thread-safe because the Starlette ``TestClient`` runs the app in another thread.
    """

    def __init__(self, start: datetime | None = None) -> None:
        start = start or datetime(2026, 10, 2, 14, 0, tzinfo=UTC)
        if start.tzinfo is None:
            raise ValueError("FixedClock needs a timezone-aware datetime")
        self._now = start.astimezone(UTC)
        self._lock = threading.Lock()

    def now(self) -> datetime:
        with self._lock:
            return self._now

    def advance(self, delta: timedelta) -> datetime:
        with self._lock:
            self._now += delta
            return self._now

    def set(self, instant: datetime) -> None:
        with self._lock:
            self._now = instant.astimezone(UTC)
