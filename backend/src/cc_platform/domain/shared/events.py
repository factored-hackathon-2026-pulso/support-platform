"""Domain event base class.

A domain event is an immutable fact that already happened. Subclasses declare two class
variables, ``event_type`` (dotted, stable, e.g. ``auth.session_started``) and ``entity``
(contract entity name, e.g. ``case`` or ``staff``), and add their own fields; everything
that is not part of the base envelope becomes the event ``payload``.

Identity (``event_id``) and ingestion time are not part of the fact: the Unit of Work
assigns them when the event is appended to the log (see ``application.events.EventRecord``).

Every payload written to the log also carries ``schema_version`` (the class variable of the
same name, an integer per event type): the version of that type's payload in the event
catalog (``docs/platform/api/engine-signals.md``, ``EVENT_CATALOG_VERSION``). Bump it when a
type's payload changes; additive changes keep their new keys nullable.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, fields
from datetime import datetime
from typing import ClassVar

from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.json import JsonObject, to_json_value

#: The version of the platform's event catalog (every type, its payload and its
#: ``schema_version``), documented in ``docs/platform/api/engine-signals.md``.
EVENT_CATALOG_VERSION = "1.3.0"

#: The payload key that carries the type's ``schema_version`` in the event log.
SCHEMA_VERSION_KEY = "schema_version"

_ENVELOPE_FIELDS = frozenset({"occurred_at", "actor", "entity_id", "case_id"})


@dataclass(frozen=True, kw_only=True, slots=True)
class DomainEvent:
    event_type: ClassVar[str] = "domain.event"
    entity: ClassVar[str] = "unknown"
    schema_version: ClassVar[int] = 1
    """The version of this type's payload (see the module docstring)."""
    payload_keys: ClassVar[Mapping[str, str]] = {}
    """Fields published under another key (``from_priority`` is ``from``: a Python keyword)."""
    omitted_when_null: ClassVar[frozenset[str]] = frozenset()
    """Fields left out of the payload when they are ``None`` (instead of a ``null``)."""
    free_text_keys: ClassVar[frozenset[str]] = frozenset()
    """Payload keys that carry free text or a person's name (a message, a note, a staff name):
    declared so the event catalog lists them and a consumer that must not read them (the
    improvement engine) can drop them. Every other key is an id, an enum, a counter, a flag or
    a time."""

    occurred_at: datetime
    actor: ActorRef
    entity_id: str
    case_id: str | None = None

    def payload(self) -> JsonObject:
        """Event-specific fields as JSON-safe values (never secrets or answers)."""
        data: JsonObject = {}
        for field in fields(self):
            if field.name in _ENVELOPE_FIELDS:
                continue
            value = getattr(self, field.name)
            if value is None and field.name in self.omitted_when_null:
                continue
            data[self.payload_keys.get(field.name, field.name)] = to_json_value(value)
        return data
