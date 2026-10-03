"""``Assignment``: why and how a case reached an analyst (one row per assignment).

``waited_seconds`` is the time the case spent in the language queue before it was assigned
from there (``queue_drained``, or ``manual`` from the queue); ``None`` when it was assigned
on arrival or reassigned. ``previous_staff_id`` is who held the case before a
reassignment (``None`` otherwise) and ``paused_override`` records that a supervisor
assigned it to a paused analyst on purpose. "Cómo llegó a ti" is built from this row only.

Rule 3 (language, policy ``H1``) lives here too: a case only goes to someone who speaks its
language, whoever assigns it (``ensure_speaks_case_language``).
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.cases.errors import LanguageMismatchError
from cc_platform.domain.cases.values import AssignmentReason
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


def ensure_speaks_case_language(
    case_language: Language, analyst_id: str, analyst_languages: Collection[Language]
) -> None:
    """Rule 3 (``H1``): a Portuguese case only to a Portuguese speaker (and so on)."""
    if case_language not in analyst_languages:
        raise LanguageMismatchError(case_language=case_language.value, analyst_id=analyst_id)


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
    previous_staff_id: str | None = None
    paused_override: bool = False

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.ASSIGNMENT)
        require_id(self.case_id, IdPrefix.CASE)
        require_id(self.staff_id, IdPrefix.STAFF)
        if self.previous_staff_id is not None:
            require_id(self.previous_staff_id, IdPrefix.STAFF)
            if self.previous_staff_id == self.staff_id:
                raise InvalidValueError(
                    "a reassignment needs another analyst", field="previous_staff_id"
                )
        if self.open_cases_at_assignment < 0:
            raise InvalidValueError("open case count cannot be negative", field="open_cases")
        if self.waited_seconds is not None and self.waited_seconds < 0:
            raise InvalidValueError("queue wait cannot be negative", field="waited_seconds")

    @property
    def is_manual(self) -> bool:
        return self.reason is AssignmentReason.MANUAL
