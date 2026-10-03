"""``AdminRoster`` (slice 4 §2.3): the set of active people holding Administración.

"There is always at least one active admin" spans several ``Staff`` rows, so two concurrent
demotions on different rows would both pass a count check (write skew). This singleton
aggregate serialises every change to that set through its compare-and-set ``version``:
every command that adds or removes an active admin loads it, changes it and saves it with
the staff row, so the second of two concurrent demotions fails its save, retries on fresh
state and is refused there. It records no events (the staff events say what happened).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.people.errors import LastAdminError
from cc_platform.domain.shared.aggregate import AggregateRoot

ROSTER_ID = "default"


@dataclass(eq=False)
class AdminRoster(AggregateRoot):
    admin_ids: frozenset[str]
    id: str = ROSTER_ID

    def grant(self, staff_id: str) -> None:
        self.admin_ids = self.admin_ids | {staff_id}

    def revoke(self, staff_id: str) -> None:
        """Remove ``staff_id``; leaving the roster empty raises ``LastAdminError``."""
        remaining = self.admin_ids - {staff_id}
        if not remaining:
            raise LastAdminError()
        self.admin_ids = remaining

    def is_last(self, staff_id: str) -> bool:
        return self.admin_ids == frozenset({staff_id})
