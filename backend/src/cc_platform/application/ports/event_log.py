"""Event log port: the append-only history shaped after ``contracts/platform_history.json``."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from cc_platform.application.events import EventPage, EventRecord


class EventLogRepository(Protocol):
    async def append(self, records: Sequence[EventRecord]) -> None:
        """Append records. Rows are never updated or deleted (corrections are new events)."""
        ...

    async def page(
        self,
        *,
        after: str | None = None,
        limit: int = 100,
        case_id: str | None = None,
        entity_id: str | None = None,
    ) -> EventPage:
        """Read events in ingestion order after an opaque cursor."""
        ...
