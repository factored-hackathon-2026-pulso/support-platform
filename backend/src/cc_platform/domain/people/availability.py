"""``AnalystAvailability``: whether an analyst takes new cases ("Disponible" / "En pausa").

A paused analyst keeps the cases she already has ("Los que ya tienes siguen contigo") but
the assignment policy skips her. A missing row means ``paused`` (safe default). No presence
yet: availability persists across sign-ins (documented gap).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cc_platform.domain.people.events import StaffAvailabilityChanged
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.ids import IdPrefix, require_id


class AvailabilityStatus(StrEnum):
    AVAILABLE = "available"
    PAUSED = "paused"


class AvailabilityChangeReason(StrEnum):
    """Why administration paused an analyst (``staff.availability_changed.reason``)."""

    DEACTIVATED = "deactivated"
    ROLE_REMOVED = "role_removed"


@dataclass(eq=False)
class AnalystAvailability(AggregateRoot):
    staff_id: str
    status: AvailabilityStatus
    since: datetime

    def __post_init__(self) -> None:
        require_id(self.staff_id, IdPrefix.STAFF)

    @classmethod
    def default(cls, staff_id: str, now: datetime) -> AnalystAvailability:
        return cls(staff_id=staff_id, status=AvailabilityStatus.PAUSED, since=now)

    @property
    def is_available(self) -> bool:
        return self.status is AvailabilityStatus.AVAILABLE

    def change(
        self,
        status: AvailabilityStatus,
        *,
        now: datetime,
        actor: ActorRef,
        reason: AvailabilityChangeReason | None = None,
    ) -> bool:
        """Switch status; returns False (and records nothing) when it is already ``status``.

        ``reason`` says why administration changed it on her behalf (slice 4 §3.2/§3.3);
        ``None`` when she changed it herself."""
        if status is self.status:
            return False
        previous = self.status
        self.status = status
        self.since = now
        self._record(
            StaffAvailabilityChanged(
                occurred_at=now,
                actor=actor,
                entity_id=self.staff_id,
                from_status=previous.value,
                to_status=status.value,
                reason=reason.value if reason is not None else None,
            )
        )
        return True
