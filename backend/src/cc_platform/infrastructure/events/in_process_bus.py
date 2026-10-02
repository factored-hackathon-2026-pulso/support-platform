"""In-process asynchronous event bus (Observer).

Handlers run sequentially in subscription order for each record, records in publish order,
so subscribers observe a consistent order. A failing handler is logged and isolated: it
neither stops other handlers nor propagates to the publisher (the state change is already
committed; the event log is the source of truth and subscribers can catch up from it).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import structlog

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.event_bus import EventHandler, Unsubscribe
from cc_platform.domain.shared.events import DomainEvent

_log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True, eq=False)
class _Subscription:
    handler: EventHandler
    event_types: tuple[type[DomainEvent], ...] | None

    def matches(self, event: DomainEvent) -> bool:
        return self.event_types is None or isinstance(event, self.event_types)


class InProcessEventBus:
    def __init__(self) -> None:
        self._subscriptions: list[_Subscription] = []

    def subscribe(
        self,
        handler: EventHandler,
        *,
        event_types: Iterable[type[DomainEvent]] | None = None,
    ) -> Unsubscribe:
        subscription = _Subscription(
            handler=handler,
            event_types=None if event_types is None else tuple(event_types),
        )
        self._subscriptions.append(subscription)

        def unsubscribe() -> None:
            if subscription in self._subscriptions:
                self._subscriptions.remove(subscription)

        return unsubscribe

    async def publish(self, records: Sequence[EventRecord]) -> None:
        for record in records:
            for subscription in tuple(self._subscriptions):
                if not subscription.matches(record.event):
                    continue
                try:
                    await subscription.handler(record)
                except Exception:
                    _log.exception(
                        "event_handler_failed",
                        event_type=record.event_type,
                        event_id=record.event_id,
                        handler=getattr(
                            subscription.handler, "__qualname__", repr(subscription.handler)
                        ),
                    )

    @property
    def subscriber_count(self) -> int:
        return len(self._subscriptions)
