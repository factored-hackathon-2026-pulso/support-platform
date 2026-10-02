"""Aggregate root base: domain events until the Unit of Work pulls them, plus a version.

Optimistic concurrency (pattern used by every aggregate, brief §4.2): ``version`` is the
persisted revision the aggregate was loaded at (``0`` = never stored). Repositories write
with a compare-and-set (``UPDATE … WHERE id = :id AND version = :loaded``) and bump it. If a
concurrent request saved the same aggregate first, nothing matches and the repository raises
``ConcurrentUpdateError``; the use case then re-runs on fresh state (``retry_on_conflict``)
or the API answers 409 ``concurrent_update``. This is what keeps state machines (MFA
challenge, case status, approvals) and counters (lockout) free of lost updates.
"""

from __future__ import annotations

import itertools

from cc_platform.domain.shared.events import DomainEvent

_EVENTS_KEY = "_pending_events"
_VERSION_KEY = "_version"

#: Process-wide recording order of domain events. A Unit of Work that collects events from
#: several aggregates (and loose events) sorts them by this stamp, so the event log keeps
#: the order in which things happened inside one transaction (e.g. routing steps before
#: the assignment they led to), not the order in which aggregates were loaded.
_RECORDING_ORDER = itertools.count(1)


def next_event_stamp() -> int:
    """Stamp for an event recorded outside an aggregate (``UnitOfWork.record``)."""
    return next(_RECORDING_ORDER)


class AggregateRoot:
    """Mixin for aggregates that emit domain events and are saved with optimistic locking.

    Aggregates call ``_record`` inside their behaviour methods; the Unit of Work calls
    ``pull_events`` on every aggregate it tracked, appends the events to the event log in
    the same transaction and publishes them after commit.
    """

    def _pending(self) -> list[tuple[int, DomainEvent]]:
        pending: list[tuple[int, DomainEvent]] | None = self.__dict__.get(_EVENTS_KEY)
        if pending is None:
            pending = []
            self.__dict__[_EVENTS_KEY] = pending
        return pending

    def _record(self, event: DomainEvent) -> None:
        self._pending().append((next_event_stamp(), event))

    def pull_stamped_events(self) -> list[tuple[int, DomainEvent]]:
        """Pending events with their recording stamp (Unit of Work only)."""
        pending = self._pending()
        events = list(pending)
        pending.clear()
        return events

    def pull_events(self) -> list[DomainEvent]:
        return [event for _stamp, event in self.pull_stamped_events()]

    @property
    def has_pending_events(self) -> bool:
        return bool(self._pending())

    # ------------------------------------------------------------------ optimistic locking
    @property
    def version(self) -> int:
        """Persisted revision this instance is based on (``0`` until first stored)."""
        version: int = self.__dict__.get(_VERSION_KEY, 0)
        return version

    def mark_persisted(self, version: int) -> None:
        """Persistence adapters only: the revision now stored for this aggregate."""
        if version < 0:
            raise ValueError("version cannot be negative")
        self.__dict__[_VERSION_KEY] = version
