"""Clock port. Every use case reads time through it so tests can freeze and advance it."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime:
        """Current instant as a timezone-aware UTC datetime."""
        ...
