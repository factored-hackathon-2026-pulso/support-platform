"""Read-side use cases of the analyst Workspace: inbox, case detail, transcript pages, the
customer's other cases ("Casos anteriores"), and the case-topic check of the socket.

Who may see a case (contract §4.3, ``load_case_for``): its assignee reads and writes; a
supervisor reads; an analyst who holds (or held) another case of the same customer reads
it (history access). Everyone else gets ``case_not_assigned``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from cc_platform.application.cases.dto import (
    CaseDetailView,
    CaseHistoryView,
    InboxView,
    TurnPageView,
)
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.cases.read_model import (
    MAX_INBOX_ITEMS,
    CaseReader,
    capabilities_for,
    count_inbox,
    customer_of,
)
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.case import Case, search_key
from cc_platform.domain.cases.values import InboxStatus
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

DEFAULT_TURN_PAGE = 50
MAX_TURN_PAGE = 200
#: "Cerrados" shows the analyst's cases closed in the last 7 days (team-generated window).
CLOSED_INBOX_WINDOW = timedelta(days=7)
#: "Casos anteriores" lists at most this many of the customer's other cases.
MAX_HISTORY_ITEMS = 20


async def load_case_for(
    uow: UnitOfWork, actor: Actor, case_id: str, *, write: bool, history_access: bool = True
) -> Case:
    """The case if ``actor`` may see it (``write``: only its assignee analyst).

    ``history_access=False`` leaves out analysts who only reach the case through another
    case of the same customer (the ``case:`` socket topic is assignee-or-supervisor).
    Unknown or malformed ids → ``not_found``; anyone else → ``case_not_assigned``.
    """
    case = await uow.cases.get(case_id) if is_valid_id(case_id, IdPrefix.CASE) else None
    if case is None:
        raise NotFoundError("No encontramos ese caso.", caseId=case_id)
    if case.is_assignee(actor.staff_id) and actor.has_any_role({StaffRole.ANALYST}):
        return case
    if write:
        raise CaseNotAssignedError()
    if actor.has_any_role({StaffRole.SUPERVISOR}):
        return case
    if (
        history_access
        and actor.has_any_role({StaffRole.ANALYST})
        and await uow.cases.exists_for_customer_and_assignee(case.customer_id, actor.staff_id)
    ):
        return case
    raise CaseNotAssignedError()


def decode_turn_cursor(cursor: str) -> int:
    if not cursor.isdigit() or int(cursor) < 1:
        raise InvalidValueError("El cursor no es válido.", field="cursor")
    return int(cursor)


@dataclass(frozen=True, slots=True)
class GetInbox:
    """ "Casos": Todos (no ``status``) = the caller's open cases; ``status=closed`` = her cases
    closed in the last 7 days. ``counts`` always cover the whole inbox (the counters are the
    filters), whatever ``status`` and ``query`` select."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, *, status: InboxStatus | None = None, query: str | None = None
    ) -> InboxView:
        now = self.clock.now()
        async with self.uow() as uow:
            reader = CaseReader(uow)
            open_items = await reader.open_inbox(actor.staff_id)
            closed_items = await reader.closed_inbox(actor.staff_id, now - CLOSED_INBOX_WINDOW)
        listed = closed_items if status is InboxStatus.CLOSED else open_items
        needle = search_key(query.strip()) if query and query.strip() else None
        selected = [
            item
            for item in listed
            if (status is None or item.inbox_status is status)
            and (needle is None or needle in search_key(item.customer.display_name, item.id))
        ]
        return InboxView(
            items=tuple(selected[:MAX_INBOX_ITEMS]),
            counts=count_inbox([*open_items, *closed_items], now),
            server_time=now,
        )


@dataclass(frozen=True, slots=True)
class GetCaseDetail:
    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, case_id: str) -> CaseDetailView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=False)
            return await case_detail(uow, case, actor.staff_id)


async def case_detail(uow: UnitOfWork, case: Case, viewer_id: str) -> CaseDetailView:
    reader = CaseReader(uow)
    customer = await uow.customers.get(case.customer_id)
    if customer is None:
        raise NotFoundError("El cliente del caso no existe.", customerId=case.customer_id)
    others = [c for c in await uow.cases.list_for_customer(case.customer_id) if c.id != case.id]
    return CaseDetailView(
        case=await reader.summary(case),
        customer=customer_of(customer),
        assignment=await reader.assignment(case),
        closure=await reader.closure(case),
        capabilities=capabilities_for(case, viewer_id),
        previous_case_count=len(others),
    )


@dataclass(frozen=True, slots=True)
class GetCaseHistory:
    """ "Casos anteriores de este cliente": the customer's other cases (any status), newest
    first, at most 20 (``total`` is the full count). Conversation history, not bank data."""

    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, case_id: str) -> CaseHistoryView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=False)
            others = [
                c for c in await uow.cases.list_for_customer(case.customer_id) if c.id != case.id
            ]
            items = await CaseReader(uow).history_items(others[:MAX_HISTORY_ITEMS])
        return CaseHistoryView(items=tuple(items), total=len(others))


@dataclass(frozen=True, slots=True)
class ListCaseTurns:
    """Transcript pages: latest page, the page before ``cursor``, or everything after
    ``after_sequence`` (gap fill after a reconnect)."""

    uow: UnitOfWorkFactory

    async def execute(
        self,
        actor: Actor,
        case_id: str,
        *,
        cursor: str | None = None,
        after_sequence: int | None = None,
        limit: int = DEFAULT_TURN_PAGE,
    ) -> TurnPageView:
        if cursor is not None and after_sequence is not None:
            raise InvalidValueError("Usa cursor o afterSequence, no ambos.", field="cursor")
        size = max(1, min(limit, MAX_TURN_PAGE))
        before = decode_turn_cursor(cursor) if cursor is not None else None
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=False)
            if after_sequence is not None:
                turns = await uow.turns.page(case.id, limit=size, after=max(after_sequence, 0))
            else:
                turns = await uow.turns.page(case.id, limit=size, before=before)
            items = await CaseReader(uow).turn_views(turns)
        # Sequences are gap-free and every turn is visible to staff: older ones exist
        # exactly when the first item is not sequence 1.
        older = str(items[0].sequence) if items and items[0].sequence > 1 else None
        return TurnPageView(
            items=tuple(items), older_cursor=older, last_sequence=case.last_sequence
        )


@dataclass(frozen=True, slots=True)
class AuthorizeCaseSubscription:
    """WebSocket ``case:<id>``: only the assignee analyst or a supervisor may listen."""

    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, case_id: str) -> bool:
        async with self.uow() as uow:
            try:
                await load_case_for(uow, actor, case_id, write=False, history_access=False)
            except (NotFoundError, CaseNotAssignedError):
                return False
        return True
