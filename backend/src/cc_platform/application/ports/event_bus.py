"""Event bus port (publish/subscribe of committed domain events).

The Unit of Work publishes records **after** the transaction commits, so subscribers only
ever see facts that are durable in the event log. Subscribers (realtime projections, the
queue drainer, future audit projections) must be idempotent and must not raise: an
implementation isolates and logs handler failures.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Sequence
from typing import Protocol

from cc_platform.application.events import EventRecord
from cc_platform.domain.shared.events import DomainEvent

type EventHandler = Callable[[EventRecord], Awaitable[None]]
type Unsubscribe = Callable[[], None]


class EventBus(Protocol):
    def subscribe(
        self,
        handler: EventHandler,
        *,
        event_types: Iterable[type[DomainEvent]] | None = None,
    ) -> Unsubscribe:
        """Register ``handler`` for the given event classes (and subclasses); all if None."""
        ...

    async def publish(self, records: Sequence[EventRecord]) -> None:
        """Deliver records in order to every matching handler."""
        ...
