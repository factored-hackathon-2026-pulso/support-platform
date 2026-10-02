"""Template Method base for Unit of Work implementations.

Subclasses provide the storage-specific ``_begin``/``_commit``/``_rollback``/``_close`` and
the repositories; this class owns the event pipeline shared by all of them:

collect pending domain events → wrap as ``EventRecord`` (id + ingested_at) → append to the
event log inside the transaction → commit → publish on the bus.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from types import TracebackType
from typing import Self

from cc_platform.application.events import EventRecord
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.event_log import EventLogRepository
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.ids import IdPrefix


class BaseUnitOfWork(ABC):
    event_log: EventLogRepository

    def __init__(self, *, bus: EventBus, ids: IdGenerator, clock: Clock) -> None:
        self._bus = bus
        self._ids = ids
        self._clock = clock
        self._tracked: dict[int, AggregateRoot] = {}
        self._loose_events: list[DomainEvent] = []

    # ------------------------------------------------------------------ lifecycle
    async def __aenter__(self) -> Self:
        self._tracked.clear()
        self._loose_events.clear()
        await self._begin()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        try:
            await self.rollback()
        finally:
            await self._close()

    async def commit(self) -> None:
        records = self._collect_records()
        if records:
            await self.event_log.append(records)
        await self._commit()
        if records:
            await self._bus.publish(records)

    async def rollback(self) -> None:
        for aggregate in self._tracked.values():
            aggregate.pull_events()
        self._tracked.clear()
        self._loose_events.clear()
        await self._rollback()

    # ------------------------------------------------------------------ events
    def track(self, aggregate: AggregateRoot) -> None:
        """Called by repositories for every aggregate they load or store."""
        self._tracked.setdefault(id(aggregate), aggregate)

    def record(self, *events: DomainEvent) -> None:
        self._loose_events.extend(events)

    def _collect_records(self) -> list[EventRecord]:
        events: list[DomainEvent] = []
        for aggregate in self._tracked.values():
            events.extend(aggregate.pull_events())
        events.extend(self._loose_events)
        self._loose_events.clear()
        ingested_at = self._clock.now()
        return [
            EventRecord(
                event_id=self._ids.new_id(IdPrefix.EVENT), event=event, ingested_at=ingested_at
            )
            for event in events
        ]

    # ------------------------------------------------------------------ storage hooks
    @abstractmethod
    async def _begin(self) -> None: ...

    @abstractmethod
    async def _commit(self) -> None: ...

    @abstractmethod
    async def _rollback(self) -> None: ...

    @abstractmethod
    async def _close(self) -> None: ...
