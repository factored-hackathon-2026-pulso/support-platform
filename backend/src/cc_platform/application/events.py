"""Event log records.

``EventRecord`` is a domain event once it has been accepted by the platform: it has an
``event_id`` and an ``ingested_at`` (contract principle: every event carries event_time and
ingested_at). It is what the Unit of Work appends to the event log and what the event bus
delivers to subscribers.

``StoredEvent`` is the same row read back from the log (the original Python event class is
not reconstructed: readers work with the flat, contract-shaped row). Rows written since event
catalog 1.3.0 carry ``schema_version`` in their payload; older rows do not.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.shared.events import SCHEMA_VERSION_KEY, DomainEvent
from cc_platform.domain.shared.json import JsonObject


@dataclass(frozen=True, slots=True)
class EventRecord:
    event_id: str
    event: DomainEvent
    ingested_at: datetime

    @property
    def event_type(self) -> str:
        return self.event.event_type

    @property
    def entity(self) -> str:
        return self.event.entity

    @property
    def entity_id(self) -> str:
        return self.event.entity_id

    @property
    def case_id(self) -> str | None:
        return self.event.case_id

    @property
    def event_time(self) -> datetime:
        return self.event.occurred_at

    @property
    def actor_role(self) -> str:
        return self.event.actor.role.value

    @property
    def actor_id(self) -> str:
        return self.event.actor.actor_id

    def payload(self) -> JsonObject:
        """The event's payload plus its type's ``schema_version`` (event catalog 1.3.0): what
        the event log stores and the sockets carry."""
        return {**self.event.payload(), SCHEMA_VERSION_KEY: self.event.schema_version}


@dataclass(frozen=True, slots=True)
class StoredEvent:
    """One row of the append-only ``event_log`` table (shape of platform_history)."""

    sequence: int
    event_id: str
    event_type: str
    entity: str
    entity_id: str
    case_id: str | None
    actor_role: str
    actor_id: str
    event_time: datetime
    ingested_at: datetime
    payload: JsonObject


@dataclass(frozen=True, slots=True)
class EventPage:
    """A page of the event log. ``next_cursor`` is opaque to clients (a sequence number)."""

    items: tuple[StoredEvent, ...]
    next_cursor: str | None
