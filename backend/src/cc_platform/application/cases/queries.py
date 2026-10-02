"""Read-side use cases of the analyst Workspace: inbox, case detail, transcript pages, and
the case-topic check of the realtime socket."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases.dto import (
    CaseDetailView,
    ChannelIdentityView,
    InboxView,
    TurnPageView,
)
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.cases.read_model import (
    MAX_INBOX_ITEMS,
    CaseReader,
    capabilities_for,
    count_inbox,
    profile_of,
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


async def load_case_for(uow: UnitOfWork, actor: Actor, case_id: str, *, write: bool) -> Case:
    """The case if ``actor`` may see it (assignee analyst; supervisors read-only).

    Unknown or malformed ids → ``not_found``; someone else's case → ``case_not_assigned``.
    """
    case = await uow.cases.get(case_id) if is_valid_id(case_id, IdPrefix.CASE) else None
    if case is None:
        raise NotFoundError("No encontramos ese caso.", caseId=case_id)
    if case.is_assignee(actor.staff_id) and actor.has_any_role({StaffRole.ANALYST}):
        return case
    if not write and actor.has_any_role({StaffRole.SUPERVISOR}):
        return case
    raise CaseNotAssignedError()


def decode_turn_cursor(cursor: str) -> int:
    if not cursor.isdigit() or int(cursor) < 1:
        raise InvalidValueError("El cursor no es válido.", field="cursor")
    return int(cursor)


@dataclass(frozen=True, slots=True)
class GetInbox:
    """ "Casos": the caller's open cases. ``counts`` always cover the whole inbox (the
    status counters are the filters), whatever ``status`` and ``query`` select."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, actor: Actor, *, status: InboxStatus | None = None, query: str | None = None
    ) -> InboxView:
        async with self.uow() as uow:
            items = await CaseReader(uow).inbox(actor.staff_id)
        now = self.clock.now()
        needle = search_key(query.strip()) if query and query.strip() else None
        selected = [
            item
            for item in items
            if (status is None or item.inbox_status is status)
            and (needle is None or needle in search_key(item.customer.display_name, item.id))
        ]
        return InboxView(
            items=tuple(selected[:MAX_INBOX_ITEMS]),
            counts=count_inbox(items, now),
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
    return CaseDetailView(
        case=await reader.summary(case),
        customer=profile_of(customer),
        channel_identity=ChannelIdentityView(
            kind=case.channel_session, verified=case.channel_session.verified
        ),
        assignment=await reader.assignment(case),
        routing=await reader.routing(case),
        closure=case.closure,
        capabilities=capabilities_for(case, viewer_id),
    )


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
            items = await CaseReader(uow).turn_views(case, turns)
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
                await load_case_for(uow, actor, case_id, write=False)
            except (NotFoundError, CaseNotAssignedError):
                return False
        return True
