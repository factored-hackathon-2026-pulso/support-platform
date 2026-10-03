"""``SeedTimeline``: the seed's events go to the log in story-time order.

The audit reads the event log by ``sequence`` (newest first), so the log must be written in
the order things happened. A Unit of Work records events in the order the code produced
them, but the seed builds its stories one after the other (a case from twenty days ago
right after one from today, a pause after the cases it explains). The timeline takes the
pending events of every seeded aggregate (and the loose ones, such as a supervisor's
``case.viewed``) and records them into the Unit of Work sorted by ``occurred_at``; events
with the same time keep their recording order.

Every aggregate that recorded events must be handed to ``take`` before ``record_into``:
anything left pending would be logged by the Unit of Work ahead of the sorted events.
"""

from __future__ import annotations

from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.shared.aggregate import AggregateRoot, next_event_stamp
from cc_platform.domain.shared.events import DomainEvent


class SeedTimeline:
    def __init__(self) -> None:
        self._stamped: list[tuple[int, DomainEvent]] = []

    def take(self, *aggregates: AggregateRoot) -> None:
        """Move the aggregates' pending events onto the timeline."""
        for aggregate in aggregates:
            self._stamped.extend(aggregate.pull_stamped_events())

    def add(self, *events: DomainEvent) -> None:
        """Events that belong to no aggregate."""
        self._stamped.extend((next_event_stamp(), event) for event in events)

    def record_into(self, unit: UnitOfWork) -> None:
        """Queue every collected event in ``unit``, oldest ``occurred_at`` first."""
        ordered = sorted(self._stamped, key=lambda item: (item[1].occurred_at, item[0]))
        self._stamped.clear()
        unit.record(*(event for _stamp, event in ordered))
