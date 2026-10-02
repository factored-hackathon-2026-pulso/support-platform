"""In-memory realtime hub (single API process).

Each connection has a bounded queue. A subscriber that cannot keep up (queue full) is
disconnected instead of growing memory without limit; the client reconnects and refetches
(the REST API and the event log are the source of truth, the socket only signals changes).
Must be used from the event loop thread only.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

import structlog

from cc_platform.application.ports.realtime import RealtimeEnvelope

_log = structlog.get_logger(__name__)

DEFAULT_QUEUE_SIZE = 256

DISCONNECTED = "disconnected"
SESSION_ENDED = "session_ended"
SLOW_CONSUMER = "slow_consumer"


class _Connection:
    def __init__(self, connection_id: str, staff_id: str, session_id: str, queue_size: int) -> None:
        self._id = connection_id
        self.staff_id = staff_id
        self.session_id = session_id
        self._topics: set[str] = set()
        self._queue: asyncio.Queue[RealtimeEnvelope | None] = asyncio.Queue(maxsize=queue_size)
        self.closed = False
        self._close_reason: str | None = None

    @property
    def id(self) -> str:
        return self._id

    @property
    def topics(self) -> frozenset[str]:
        return frozenset(self._topics)

    @property
    def close_reason(self) -> str | None:
        return self._close_reason

    def add_topic(self, topic: str) -> None:
        self._topics.add(topic)

    def remove_topic(self, topic: str) -> None:
        self._topics.discard(topic)

    async def next_envelope(self) -> RealtimeEnvelope | None:
        if self.closed and self._queue.empty():
            return None
        return await self._queue.get()

    def deliver(self, envelope: RealtimeEnvelope) -> bool:
        if self.closed:
            return False
        try:
            self._queue.put_nowait(envelope)
        except asyncio.QueueFull:
            _log.warning("realtime_slow_consumer_dropped", connection_id=self._id)
            self.close(SLOW_CONSUMER)
            return False
        return True

    def close(self, reason: str) -> None:
        if self.closed:
            return
        self.closed = True
        self._close_reason = reason
        while not self._queue.empty():  # make room for the close sentinel
            self._queue.get_nowait()
        self._queue.put_nowait(None)


class InMemoryRealtimeHub:
    def __init__(self, *, queue_size: int = DEFAULT_QUEUE_SIZE) -> None:
        self._queue_size = queue_size
        self._connections: dict[str, _Connection] = {}
        self._subscribers: defaultdict[str, set[str]] = defaultdict(set)

    def connect(self, *, connection_id: str, staff_id: str, session_id: str) -> _Connection:
        connection = _Connection(connection_id, staff_id, session_id, self._queue_size)
        self._connections[connection_id] = connection
        return connection

    def disconnect(self, connection_id: str, reason: str = DISCONNECTED) -> None:
        connection = self._connections.pop(connection_id, None)
        if connection is None:
            return
        for topic in connection.topics:
            self._drop(topic, connection_id)
        connection.close(reason)

    def subscribe(self, connection_id: str, topic: str) -> None:
        connection = self._connections[connection_id]
        connection.add_topic(topic)
        self._subscribers[topic].add(connection_id)

    def unsubscribe(self, connection_id: str, topic: str) -> None:
        connection = self._connections.get(connection_id)
        if connection is not None:
            connection.remove_topic(topic)
        self._drop(topic, connection_id)

    async def publish(self, topic: str, envelope: RealtimeEnvelope) -> int:
        delivered = 0
        for connection_id in tuple(self._subscribers.get(topic, ())):
            connection = self._connections.get(connection_id)
            if connection is None:
                continue
            if connection.deliver(envelope):
                delivered += 1
            else:
                self.disconnect(connection_id, SLOW_CONSUMER)
        return delivered

    def close_session(self, session_id: str) -> int:
        doomed = [c.id for c in self._connections.values() if c.session_id == session_id]
        for connection_id in doomed:
            self.disconnect(connection_id, SESSION_ENDED)
        return len(doomed)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    def subscriber_count(self, topic: str) -> int:
        return len(self._subscribers.get(topic, ()))

    def _drop(self, topic: str, connection_id: str) -> None:
        subscribers = self._subscribers.get(topic)
        if subscribers is None:
            return
        subscribers.discard(connection_id)
        if not subscribers:
            del self._subscribers[topic]
