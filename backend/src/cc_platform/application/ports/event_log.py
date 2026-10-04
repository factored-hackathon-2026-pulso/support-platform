"""Event log port: the append-only history.

Shaped after ``pulso-data/contracts/synthetic-sample/platform_history.json``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.application.events import EventPage, EventRecord, StoredEvent


@dataclass(frozen=True, slots=True)
class AuditFilters:
    """Audit search criteria (combined with AND). ``None`` means "no filter".

    ``event_types`` keeps only those types (an empty set matches nothing);
    ``exclude_event_types`` drops these. ``text`` is a case-insensitive *contains* on the
    id columns only (``event_id``, ``entity_id``, ``case_id``, ``actor_id``).
    ``occurred_from`` is inclusive and ``occurred_to`` exclusive, both on ``event_time``.
    """

    actor_roles: frozenset[str] | None = None
    actor_id: str | None = None
    case_id: str | None = None
    event_types: frozenset[str] | None = None
    exclude_event_types: frozenset[str] = frozenset()
    occurred_from: datetime | None = None
    occurred_to: datetime | None = None
    text: str | None = None


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

    async def search(
        self, filters: AuditFilters, *, before: int | None, limit: int
    ) -> list[StoredEvent]:
        """Up to ``limit`` matching events, newest first (``sequence`` descending), only
        those with ``sequence < before`` when given (cursor pagination)."""
        ...

    async def get(self, event_id: str) -> StoredEvent | None: ...

    async def latest(self, event_type: str, actor_id: str, case_id: str) -> StoredEvent | None:
        """The most recent event of that type by that actor on that case (dedupe)."""
        ...
