"""``Assignment``: why and how a case reached an analyst (one row per assignment).

``waited_seconds`` is the time the case spent in the language queue before a drain
assigned it (``queue_drained``); ``None`` when it was assigned on arrival. "Cómo llegó a
ti" is built from this row only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.cases.values import AssignmentReason
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


@dataclass(frozen=True, slots=True)
class Assignment:
    id: str
    case_id: str
    staff_id: str
    reason: AssignmentReason
    policy_rule_id: str | None
    open_cases_at_assignment: int
    strategy: str
    assigned_at: datetime
    assigned_by: ActorRef
    waited_seconds: int | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.ASSIGNMENT)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.staff_id, IdPrefix.STAFF)
        if self.open_cases_at_assignment < 0:
            raise InvalidValueError("open case count cannot be negative", field="open_cases")
        if self.waited_seconds is not None and self.waited_seconds < 0:
            raise InvalidValueError("queue wait cannot be negative", field="waited_seconds")
