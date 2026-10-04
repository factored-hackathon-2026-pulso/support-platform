"""Repository ports of the cases context (one per aggregate or append-only entity)."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.application.events import StoredEvent
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import CaseStatus, CloseReason, TurnAudience
from cc_platform.domain.people.staff import Language


@dataclass(frozen=True, slots=True)
class AssigneeLoad:
    """How busy an analyst is, for the assignment strategy."""

    open_cases: int
    last_assigned_at: datetime | None


@dataclass(frozen=True, slots=True)
class CaseRef:
    """The few case facts the audit needs per row (who the customer is, which language)."""

    customer_id: str
    language: Language


@dataclass(frozen=True, slots=True)
class OpenCaseRef:
    """An open case (``assigned | in_progress``) of an assignee, for administration."""

    case_id: str
    language: Language


class CaseRepository(Protocol):
    async def get(self, case_id: str) -> Case | None: ...

    async def get_many(self, case_ids: Collection[str]) -> dict[str, Case]:
        """The known cases among ``case_ids``, by id, in one query (unknown ids left out)."""
        ...

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

    async def list_by_statuses(self, statuses: Collection[CaseStatus]) -> list[Case]:
        """Cases in any of ``statuses`` (any order): one query for the team overview."""
        ...

    async def refs(self, case_ids: Collection[str]) -> dict[str, CaseRef]:
        """Customer and language of each known case id (unknown ids are left out)."""
        ...

    async def list_closed_for_assignee(self, staff_id: str, closed_since: datetime) -> list[Case]:
        """``staff_id``'s closed cases with ``closed_at >= closed_since`` (any order)."""
        ...

    async def latest_for_customer(self, customer_id: str) -> Case | None:
        """The customer's most recently opened case, if any."""
        ...

    async def list_for_customer(self, customer_id: str) -> list[Case]:
        """Every case of the customer, newest ``opened_at`` first (then id, descending)."""
        ...

    async def exists_for_customer_and_assignee(self, customer_id: str, staff_id: str) -> bool:
        """Whether ``staff_id`` holds, or held, any case of the customer (history access).

        "Held" includes past assignments: an analyst whose case was reassigned away still
        reads it (and the customer's other cases), read-only."""
        ...

    async def assignee_loads(
        self, open_statuses: Collection[CaseStatus]
    ) -> dict[str, AssigneeLoad]:
        """Per assigned analyst: cases in ``open_statuses`` and the last assignment time."""
        ...

    async def open_refs_by_assignee(
        self, staff_ids: Collection[str] | None = None
    ) -> dict[str, list[OpenCaseRef]]:
        """Each assignee's open cases (``assigned | in_progress``), by case id, in one query;
        only ``staff_ids`` when given. People without open cases are left out."""
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


@dataclass(frozen=True, slots=True)
class CustomerCaseFact:
    """One case of a customer, as "Volvió a escribir" counts them (slice 6 §2.3)."""

    case_id: str
    opened_at: datetime
    close_reason: CloseReason | None


class AnalystHomeReader(Protocol):
    """Read port of the analyst home ("Inicio", slice 6): CQRS-lite queries over the
    append-only facts (``staff_sessions``, ``assignments``, ``cases``, ``event_log``), each
    one indexed query whatever the analyst's history. Nothing here writes."""

    async def previous_session_end(
        self, staff_id: str, *, current_session_id: str, now: datetime
    ) -> datetime | None:
        """When ``staff_id``'s previous session ended: the latest ``ended_at`` (logout,
        revocation) or ``expires_at`` (expired, ``<= now``) among her sessions other than
        ``current_session_id``. ``None`` when there is none (first sign-in)."""
        ...

    async def touched_case_ids(self, staff_id: str, since: datetime) -> set[str]:
        """Cases whose activity after ``since`` may concern her: the ones assigned to her
        now that are open or closed after ``since``, plus every case assigned to her or
        taken away from her (``previous_staff_id``) after ``since``."""
        ...

    async def case_events(
        self, case_ids: Collection[str], *, since: datetime, event_types: Collection[str]
    ) -> list[StoredEvent]:
        """Event-log rows of those cases and types with ``event_time > since``, in
        ingestion order (``sequence``)."""
        ...

    async def customer_cases(
        self, customer_ids: Collection[str]
    ) -> dict[str, list[CustomerCaseFact]]:
        """Every case of each customer (any order), in one query."""
        ...
