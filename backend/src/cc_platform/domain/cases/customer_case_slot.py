"""``CustomerCaseSlot``: at most one open case per customer.

Opening a case and closing it both compare-and-set the slot (optimistic ``version``), so
two concurrent "first messages" of the same customer create exactly one case: the loser
retries, finds the slot taken and appends to that case instead.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import ConflictError
from cc_platform.domain.shared.ids import IdPrefix, require_id


@dataclass(eq=False)
class CustomerCaseSlot(AggregateRoot):
    customer_id: str
    open_case_id: str | None = None

    def __post_init__(self) -> None:
        require_id(self.customer_id, IdPrefix.CUSTOMER)
        if self.open_case_id is not None:
            require_id(self.open_case_id, IdPrefix.CASE)

    def occupy(self, case_id: str) -> None:
        require_id(case_id, IdPrefix.CASE)
        if self.open_case_id is not None and self.open_case_id != case_id:
            raise ConflictError(
                "El cliente ya tiene un caso abierto.", openCaseId=self.open_case_id
            )
        self.open_case_id = case_id

    def release(self, case_id: str) -> None:
        """Free the slot if ``case_id`` holds it (idempotent)."""
        if self.open_case_id == case_id:
            self.open_case_id = None
