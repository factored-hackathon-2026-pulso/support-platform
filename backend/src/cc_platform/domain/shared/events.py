"""Domain event base class.

A domain event is an immutable fact that already happened. Subclasses declare two class
variables, ``event_type`` (dotted, stable, e.g. ``auth.session_started``) and ``entity``
(contract entity name, e.g. ``case`` or ``staff``), and add their own fields; everything
that is not part of the base envelope becomes the event ``payload``.

Identity (``event_id``) and ingestion time are not part of the fact: the Unit of Work
assigns them when the event is appended to the log (see ``application.events.EventRecord``).
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from datetime import datetime
from typing import ClassVar

from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.json import JsonObject, to_json_value

_ENVELOPE_FIELDS = frozenset({"occurred_at", "actor", "entity_id", "case_id"})


@dataclass(frozen=True, kw_only=True, slots=True)
class DomainEvent:
    event_type: ClassVar[str] = "domain.event"
    entity: ClassVar[str] = "unknown"

    occurred_at: datetime
    actor: ActorRef
    entity_id: str
    case_id: str | None = None

    def payload(self) -> JsonObject:
        """Event-specific fields as JSON-safe values (never secrets or answers)."""
        return {
            field.name: to_json_value(getattr(self, field.name))
            for field in fields(self)
            if field.name not in _ENVELOPE_FIELDS
        }
