"""Repository ports of the cases context (one per aggregate or append-only entity)."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import CaseStatus, TurnAudience


@dataclass(frozen=True, slots=True)
class AssigneeLoad:
    """How busy an analyst is, for the assignment strategy."""

    open_cases: int
    last_assigned_at: datetime | None


class CaseRepository(Protocol):
    async def get(self, case_id: str) -> Case | None: ...

    async def add(self, case: Case) -> None: ...

    async def save(self, case: Case) -> None:
        """Compare-and-set on ``version``; raises ``ConcurrentUpdateError`` when stale."""
        ...

    async def list_for_assignee(
        self, staff_id: str, statuses: Collection[CaseStatus]
    ) -> list[Case]:
        """Cases assigned to ``staff_id`` in one of ``statuses`` (any order)."""
        ...

    async def list_by_status(self, status: CaseStatus) -> list[Case]:
        """Cases in ``status``, oldest ``opened_at`` first."""
        ...

    async def latest_for_customer(self, customer_id: str) -> Case | None:
        """The customer's most recently opened case, if any."""
        ...

    async def assignee_loads(
        self, open_statuses: Collection[CaseStatus]
    ) -> dict[str, AssigneeLoad]:
        """Per assigned analyst: cases in ``open_statuses`` and the last assignment time."""
        ...


class TurnRepository(Protocol):
    """Append-only transcript storage. Unique ``(case_id, sequence)`` and, when set,
    ``(author_id, client_message_id)`` (message dedupe)."""

    async def add(self, turn: Turn) -> None: ...

    async def page(
        self,
        case_id: str,
        *,
        limit: int,
        before: int | None = None,
        after: int | None = None,
        audience: TurnAudience | None = None,
    ) -> list[Turn]:
        """Turns in ascending ``sequence``.

        ``after`` → the first ``limit`` turns with ``sequence > after``; otherwise the
        latest ``limit`` turns with ``sequence < before`` (all when ``before`` is None).
        ``audience`` filters (``everyone`` for the customer's view).
        """
        ...

    async def find_by_client_message_id(
        self, author_id: str, client_message_id: str
    ) -> Turn | None: ...


class AssignmentRepository(Protocol):
    async def add(self, assignment: Assignment) -> None: ...

    async def latest_for_case(self, case_id: str) -> Assignment | None: ...


class CustomerCaseSlotRepository(Protocol):
    async def get(self, customer_id: str) -> CustomerCaseSlot | None: ...

    async def add(self, slot: CustomerCaseSlot) -> None:
        """Insert; a concurrent insert of the same customer raises ``ConcurrentUpdateError``
        (so the losing command retries and finds the slot)."""
        ...

    async def save(self, slot: CustomerCaseSlot) -> None: ...
