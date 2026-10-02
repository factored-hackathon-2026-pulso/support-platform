"""Realtime hub port: fan-out of typed envelopes to WebSocket subscribers by topic.

Wire format (brief §4.4): ``{"type", "id", "occurredAt", "data"}``. Envelopes derived from
domain events use the event type (``turn.created``) and the event id; control messages
(``subscribed``, ``pong``, ``error``) use the same shape so clients need one parser.

The in-memory implementation serves a single API process. A multi-process deployment
swaps it for a broker-backed hub (Redis pub/sub, Postgres LISTEN/NOTIFY) behind this port.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from cc_platform.domain.shared.json import JsonObject, iso_utc


@dataclass(frozen=True, slots=True)
class RealtimeEnvelope:
    type: str
    id: str
    occurred_at: datetime
    data: JsonObject = field(default_factory=dict)

    def to_wire(self) -> JsonObject:
        return {
            "type": self.type,
            "id": self.id,
            "occurredAt": iso_utc(self.occurred_at),
            "data": self.data,
        }


class RealtimeConnection(Protocol):
    """Server-side handle of one client connection, read by the transport (WebSocket)."""

    @property
    def id(self) -> str: ...

    @property
    def topics(self) -> frozenset[str]: ...

    @property
    def close_reason(self) -> str | None:
        """Why the hub closed the connection: ``session_ended`` or ``slow_consumer``."""
        ...

    async def next_envelope(self) -> RealtimeEnvelope | None:
        """Wait for the next envelope; ``None`` means the hub closed the connection."""
        ...


class RealtimeHub(Protocol):
    def connect(
        self, *, connection_id: str, principal_id: str, session_id: str
    ) -> RealtimeConnection:
        """Register a socket of a staff member (``STF-…``) or a customer (``CUS-…``)."""
        ...

    def disconnect(self, connection_id: str) -> None: ...

    def subscribe(self, connection_id: str, topic: str) -> None: ...

    def unsubscribe(self, connection_id: str, topic: str) -> None: ...

    async def publish(self, topic: str, envelope: RealtimeEnvelope) -> int:
        """Queue the envelope for every subscriber of ``topic``; returns how many."""
        ...

    async def publish_many(self, topics: Iterable[str], envelope: RealtimeEnvelope) -> int:
        """Queue the envelope **once per connection** subscribed to any of ``topics``.

        One event often concerns several topics (``case:<id>`` and ``inbox:<staff>``); a
        socket subscribed to more than one of them must still receive it once, or every
        client handler (and the refetches it triggers) runs twice. Returns how many
        connections it reached.
        """
        ...

    def close_session(self, session_id: str) -> int:
        """Close every connection opened with ``session_id`` (logout); returns how many."""
        ...
