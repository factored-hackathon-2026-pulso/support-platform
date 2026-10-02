"""Read side of the cases context (CQRS-lite): pure projections plus one reader.

``inbox_status`` is the single place that derives the canvas bucket of a case (Nuevos,
Por responder, En curso, Por llamar, En espera); the frontend never re-derives it.
``CaseReader`` loads what the projections need inside a Unit of Work; the REST queries and
the realtime projection both use it, so a socket payload always equals the REST shape.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime

from cc_platform.application.cases.dto import (
    AssignmentView,
    CaseCapabilitiesView,
    CaseSummaryView,
    CustomerConversationView,
    CustomerProfileView,
    CustomerRefView,
    CustomerTurnView,
    InboxCountsView,
    ReplyBlockedReason,
    RouteStopView,
    RoutingSummaryView,
    TurnView,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import (
    CLOSABLE_STATUSES,
    OPEN_ASSIGNED_STATUSES,
    REPLYABLE_STATUSES,
    CaseStatus,
    CustomerConversationStatus,
    CustomerTurnAuthor,
    InboxStatus,
    TurnAuthorRole,
)
from cc_platform.domain.customers.customer import Customer
from cc_platform.domain.routing.routing_step import RoutingStep
from cc_platform.domain.routing.values import RouteStopKind

UNKNOWN_CUSTOMER = "Cliente"
MAX_INBOX_ITEMS = 200


# ----------------------------------------------------------------------------- pure projections
_INBOX_STATUS: dict[CaseStatus, InboxStatus] = {
    CaseStatus.ASSIGNED: InboxStatus.NEW,
    CaseStatus.IN_CALL: InboxStatus.LIVE,
    CaseStatus.TO_CALL: InboxStatus.TO_CALL,
    CaseStatus.AWAITING_APPROVAL: InboxStatus.WAITING,
}


def inbox_status(case: Case) -> InboxStatus | None:
    """Canvas bucket of a case; ``None`` while it is in no inbox (routing, queued, closed).

    ``in_progress`` splits on who wrote the last message: the customer → Por responder;
    anyone else (analyst, bot) or nobody → En espera ("Esperando al cliente").
    """
    if case.status is CaseStatus.IN_PROGRESS:
        if case.last_message_author_role is TurnAuthorRole.CUSTOMER:
            return InboxStatus.TO_REPLY
        return InboxStatus.WAITING
    return _INBOX_STATUS.get(case.status)


def summarize(case: Case, customer_name: str) -> CaseSummaryView:
    has_message = case.last_message_preview is not None
    return CaseSummaryView(
        id=case.id,
        version=case.version,
        customer=CustomerRefView(id=case.customer_id, display_name=customer_name),
        channel=case.channel,
        language=case.language,
        origin=case.origin,
        topic=case.topic,
        priority=case.priority,
        status=case.status,
        inbox_status=inbox_status(case),
        opened_at=case.opened_at,
        sla_due_at=case.sla_due_at,
        last_interaction_at=case.last_interaction_at,
        live_since=case.live_since if case.status is CaseStatus.IN_CALL else None,
        preview=case.last_message_preview if has_message else case.last_turn_preview,
        preview_author_role=(
            case.last_message_author_role if has_message else case.last_turn_author_role
        ),
        assigned_analyst_id=case.assigned_analyst_id,
        unread_count=case.unread_count,
        last_sequence=case.last_sequence,
        closed_at=case.closed_at,
    )


def count_inbox(items: Iterable[CaseSummaryView], computed_at: datetime) -> InboxCountsView:
    buckets = [item.inbox_status for item in items if item.inbox_status is not None]
    return InboxCountsView(
        all=len(buckets),
        new=buckets.count(InboxStatus.NEW),
        to_reply=buckets.count(InboxStatus.TO_REPLY),
        live=buckets.count(InboxStatus.LIVE),
        to_call=buckets.count(InboxStatus.TO_CALL),
        waiting=buckets.count(InboxStatus.WAITING),
        computed_at=computed_at,
    )


def inbox_order(item: CaseSummaryView) -> tuple[int, datetime, datetime, str]:
    """Live calls first (longest first), then the closest SLA, then the oldest case."""
    if item.inbox_status is InboxStatus.LIVE:
        return (0, item.live_since or item.opened_at, item.opened_at, item.id)
    return (1, item.sla_due_at, item.opened_at, item.id)


def capabilities_for(case: Case, staff_id: str) -> CaseCapabilitiesView:
    is_assignee = case.is_assignee(staff_id)
    reason: ReplyBlockedReason | None = None
    if not is_assignee:
        reason = ReplyBlockedReason.NOT_ASSIGNEE
    elif case.is_closed:
        reason = ReplyBlockedReason.CLOSED
    elif not case.channel.is_chat:
        reason = ReplyBlockedReason.CHANNEL_NOT_SUPPORTED
    return CaseCapabilitiesView(
        can_reply=reason is None and case.status in REPLYABLE_STATUSES,
        reply_blocked_reason=reason,
        can_close=is_assignee and case.status in CLOSABLE_STATUSES,
    )


def route_summary(
    case: Case,
    steps: Sequence[RoutingStep],
    assignment: Assignment | None,
    analyst_name: str | None,
) -> RoutingSummaryView:
    """ "Cómo llegó a ti": entry → tiers → queue (if it waited) → the analyst, in order."""
    stops: list[RouteStopView] = []
    if case.entry_label is not None:
        stops.append(
            RouteStopView(
                kind=RouteStopKind.ENTRY,
                occurred_at=case.opened_at,
                label=case.entry_label,
                summary=case.entry_summary,
            )
        )
    inputs: dict[str, None] = {}
    for step in steps:
        inputs.update(dict.fromkeys(step.inputs_used))
        stops.append(
            RouteStopView(
                kind=RouteStopKind.TIER,
                occurred_at=step.occurred_at,
                label=step.component_name,
                tier=step.tier,
                component_id=step.component.component_id if step.component else None,
                component_version=step.component.component_version if step.component else None,
                outcome=step.outcome,
                reason_code=step.reason_code,
                policy_rule_id=step.policy_rule_id,
                summary=step.handoff.summary if step.handoff else None,
            )
        )
    if case.queued_at is not None:
        waited = (
            int((case.assigned_at - case.queued_at).total_seconds())
            if case.assigned_at is not None
            else None
        )
        stops.append(
            RouteStopView(
                kind=RouteStopKind.QUEUE,
                occurred_at=case.queued_at,
                label=case.queue_label,
                summary=case.queue_summary,
                waited_seconds=waited,
            )
        )
    if assignment is not None:
        stops.append(
            RouteStopView(
                kind=RouteStopKind.ASSIGNEE,
                occurred_at=assignment.assigned_at,
                label=analyst_name,
                reason_code=assignment.reason.value,
                policy_rule_id=assignment.policy_rule_id,
                staff_id=assignment.staff_id,
            )
        )
    return RoutingSummaryView(stops=tuple(stops), inputs_used=tuple(inputs))


def profile_of(customer: Customer) -> CustomerProfileView:
    return CustomerProfileView(
        id=customer.id,
        display_name=customer.display_name,
        segment=customer.segment,
        country=customer.country,
        city=customer.city,
        locale=customer.locale,
        language=customer.language,
        customer_since=customer.customer_since,
        document_type=customer.document_type,
    )


def first_name(name: str) -> str:
    return name.split(maxsplit=1)[0] if name.strip() else name


# ----------------------------------------------------------------------------- reader
class CaseReader:
    """Loads the related data the projections need (one per Unit of Work; caches names)."""

    def __init__(self, uow: UnitOfWork) -> None:
        self._uow = uow
        self._customer_names: dict[str, str] = {}
        self._staff_names: dict[str, str | None] = {}

    async def customer_names(self, customer_ids: Iterable[str]) -> dict[str, str]:
        missing = {cid for cid in customer_ids if cid not in self._customer_names}
        if missing:
            found = await self._uow.customers.get_many(missing)
            for cid in missing:
                customer = found.get(cid)
                self._customer_names[cid] = customer.display_name if customer else UNKNOWN_CUSTOMER
        return self._customer_names

    async def staff_name(self, staff_id: str) -> str | None:
        if staff_id not in self._staff_names:
            staff = await self._uow.staff.get(staff_id)
            self._staff_names[staff_id] = staff.name if staff else None
        return self._staff_names[staff_id]

    async def summary(self, case: Case) -> CaseSummaryView:
        names = await self.customer_names([case.customer_id])
        return summarize(case, names[case.customer_id])

    async def summaries(self, cases: Sequence[Case]) -> list[CaseSummaryView]:
        names = await self.customer_names(case.customer_id for case in cases)
        return [summarize(case, names[case.customer_id]) for case in cases]

    async def inbox(self, staff_id: str) -> list[CaseSummaryView]:
        """Every case in ``staff_id``'s inbox, sorted (counts are computed over all of it)."""
        cases = await self._uow.cases.list_for_assignee(staff_id, OPEN_ASSIGNED_STATUSES)
        items = [item for item in await self.summaries(cases) if item.inbox_status is not None]
        return sorted(items, key=inbox_order)

    async def assignment(self, case: Case) -> AssignmentView | None:
        assignment = await self._uow.assignments.latest_for_case(case.id)
        if assignment is None:
            return None
        return AssignmentView(
            id=assignment.id,
            analyst_id=assignment.staff_id,
            analyst_name=await self.staff_name(assignment.staff_id) or assignment.staff_id,
            reason=assignment.reason,
            policy_rule_id=assignment.policy_rule_id,
            assigned_at=assignment.assigned_at,
        )

    async def routing(self, case: Case) -> RoutingSummaryView:
        steps = await self._uow.routing_steps.list_for_case(case.id)
        assignment = await self._uow.assignments.latest_for_case(case.id)
        name = await self.staff_name(assignment.staff_id) if assignment else None
        return route_summary(case, steps, assignment, name)

    async def _author_names(self, case: Case, turns: Sequence[Turn]) -> dict[str, str | None]:
        names: dict[str, str | None] = {}
        components: dict[str, str | None] | None = None
        for turn in turns:
            author = turn.author_id
            if author is None or author in names:
                continue
            if turn.author_role is TurnAuthorRole.CUSTOMER:
                names[author] = (await self.customer_names([author]))[author]
            elif turn.author_role is TurnAuthorRole.ANALYST:
                names[author] = await self.staff_name(author)
            elif turn.author_role.is_bot:
                if components is None:
                    steps = await self._uow.routing_steps.list_for_case(case.id)
                    components = {
                        str(step.component): step.component_name
                        for step in steps
                        if step.component is not None
                    }
                names[author] = components.get(author)
        return names

    async def turn_views(self, case: Case, turns: Sequence[Turn]) -> list[TurnView]:
        names = await self._author_names(case, turns)
        return [
            TurnView(
                id=turn.id,
                case_id=turn.case_id,
                sequence=turn.sequence,
                kind=turn.kind,
                audience=turn.audience,
                author_role=turn.author_role,
                author_id=turn.author_id,
                author_name=names.get(turn.author_id) if turn.author_id else None,
                text=turn.text,
                language=turn.language,
                created_at=turn.created_at,
                client_message_id=turn.client_message_id,
                evidence_ids=turn.evidence_ids,
                from_suggestion_id=turn.from_suggestion_id,
            )
            for turn in turns
        ]

    async def customer_turn_views(
        self, turns: Sequence[Turn], customer_id: str
    ) -> list[CustomerTurnView]:
        """What the customer may see: ``everyone`` turns, bots as one "bot", analysts by
        first name, client message ids only on the customer's own messages."""
        views: list[CustomerTurnView] = []
        for turn in turns:
            if not turn.is_public:
                continue
            author = CustomerTurnAuthor.of(turn.author_role)
            name: str | None = None
            if author is CustomerTurnAuthor.ANALYST and turn.author_id is not None:
                staff_name = await self.staff_name(turn.author_id)
                name = first_name(staff_name) if staff_name else None
            own = turn.author_role is TurnAuthorRole.CUSTOMER and turn.author_id == customer_id
            views.append(
                CustomerTurnView(
                    id=turn.id,
                    sequence=turn.sequence,
                    kind=turn.kind,
                    author_role=author,
                    author_name=name,
                    text=turn.text,
                    language=turn.language,
                    created_at=turn.created_at,
                    client_message_id=turn.client_message_id if own else None,
                )
            )
        return views

    async def conversation(self, case: Case) -> CustomerConversationView:
        status = CustomerConversationStatus.of(case.status)
        agent: str | None = None
        if status is CustomerConversationStatus.WITH_AGENT and case.assigned_analyst_id:
            name = await self.staff_name(case.assigned_analyst_id)
            agent = first_name(name) if name else None
        return CustomerConversationView(
            case_id=case.id,
            status=status,
            channel=case.channel,
            language=case.language,
            opened_at=case.opened_at,
            closed_at=case.closed_at,
            agent_name=agent,
            last_sequence=case.last_public_sequence,
        )
