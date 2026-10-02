"""``Assignment``: why and how a case reached an analyst (one row per assignment)."""

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

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.ASSIGNMENT)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.staff_id, IdPrefix.STAFF)
        if self.open_cases_at_assignment < 0:
            raise InvalidValueError("open case count cannot be negative", field="open_cases")
