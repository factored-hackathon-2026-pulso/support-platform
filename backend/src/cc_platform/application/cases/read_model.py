"""Read side of the cases context (CQRS-lite): pure projections plus one reader.

``inbox_status`` is the single place that derives the bucket of a case in "Casos" (Nuevos,
Por responder, Esperando al cliente, Cerrados); the frontend never re-derives it.
``CaseReader`` loads what the projections need inside a Unit of Work; the REST queries and
the realtime projection both use it, so a socket payload always equals the REST shape.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import datetime

from cc_platform.application.cases import copy
from cc_platform.application.cases.dto import (
    AssignmentView,
    AssistantConfirmationView,
    AssistantStateView,
    AssistantStepUpView,
    CallView,
    CaseCapabilitiesView,
    CaseClosureView,
    CaseCustomerView,
    CaseHistoryItemView,
    CaseRatingView,
    CaseSummaryView,
    CustomerCallView,
    CustomerConversationSummaryView,
    CustomerConversationView,
    CustomerEmailView,
    CustomerRefView,
    CustomerTurnView,
    EmailMessageView,
    EscalationView,
    HoldIntervalView,
    InboxCountsView,
    ReplyBlockedReason,
    TurnView,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.application.security import Actor
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.call import Call, CallState
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.escalation import Escalation
from cc_platform.domain.cases.rating import CaseRating
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
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.actor import ActorRole

UNKNOWN_CUSTOMER = "Cliente"
MAX_INBOX_ITEMS = 200


# ----------------------------------------------------------------------------- pure projections
def inbox_status(case: Case) -> InboxStatus | None:
    """Bucket of a case (contract §4.1); ``None`` while it is queued or with the assistant
    (in no inbox).

    ``in_progress`` splits on who wrote the last message: the customer → Por responder;
    the analyst (or nobody yet) → Esperando al cliente.
    """
    match case.status:
        case CaseStatus.ASSIGNED:
            return InboxStatus.NEW
        case CaseStatus.IN_PROGRESS:
            if case.last_message_author_role is TurnAuthorRole.CUSTOMER:
                return InboxStatus.TO_REPLY
            return InboxStatus.WAITING
        case CaseStatus.CLOSED:
            return InboxStatus.CLOSED
        case CaseStatus.QUEUED | CaseStatus.WITH_ASSISTANT:
            return None  # nobody holds it yet (a queue, or the assistant): in no inbox


def rating_view(rating: CaseRating | None) -> CaseRatingView | None:
    """The rating as both sides see it (the idempotency key stays inside)."""
    if rating is None:
        return None
    return CaseRatingView(score=rating.score, comment=rating.comment, rated_at=rating.rated_at)


def summarize(case: Case, customer_name: str) -> CaseSummaryView:
    has_message = case.last_message_preview is not None
    return CaseSummaryView(
        id=case.id,
        version=case.version,
        customer=CustomerRefView(id=case.customer_id, display_name=customer_name),
        channel=case.channel,
        language=case.language,
        priority=case.priority,
        case_type=case.case_type,
        status=case.status,
        inbox_status=inbox_status(case),
        opened_at=case.opened_at,
        sla_due_at=case.sla_due_at,
        first_response_at=case.first_response_at,
        last_interaction_at=case.last_interaction_at,
        preview=case.last_message_preview if has_message else case.last_turn_preview,
        preview_author_role=(
            case.last_message_author_role if has_message else case.last_turn_author_role
        ),
        assigned_analyst_id=case.assigned_analyst_id,
        unread_count=case.unread_count,
        last_sequence=case.last_sequence,
        previous_case_id=case.previous_case_id,
        closed_at=case.closed_at,
        close_reason=case.closure.reason if case.closure else None,
        rating=rating_view(case.rating),
        escalated=case.is_escalated,
        active_call_id=case.active_call_id,
    )


def count_inbox(items: Iterable[CaseSummaryView], computed_at: datetime) -> InboxCountsView:
    """Counters of the whole inbox: ``all`` = open cases; ``closed`` = closed in the window
    (the caller passes the open items plus the closed items of the window)."""
    buckets = [item.inbox_status for item in items if item.inbox_status is not None]
    new = buckets.count(InboxStatus.NEW)
    to_reply = buckets.count(InboxStatus.TO_REPLY)
    waiting = buckets.count(InboxStatus.WAITING)
    return InboxCountsView(
        all=new + to_reply + waiting,
        new=new,
        to_reply=to_reply,
        waiting=waiting,
        closed=buckets.count(InboxStatus.CLOSED),
        computed_at=computed_at,
    )


def inbox_order(item: CaseSummaryView) -> tuple[int, datetime, datetime, str]:
    """Open lists: Nuevos and Por responder first, then Esperando al cliente; within each
    group whoever has waited longest (oldest last interaction), then the oldest case."""
    group = 1 if item.inbox_status is InboxStatus.WAITING else 0
    return (group, item.last_interaction_at, item.opened_at, item.id)


def closed_order(item: CaseSummaryView) -> tuple[datetime, str]:
    """Cerrados: the most recently closed first (sort with ``reverse=True``)."""
    return (item.closed_at or item.opened_at, item.id)


def capabilities_for(case: Case, actor: Actor) -> CaseCapabilitiesView:
    """What the caller may do: reply and close as the assignee (never a supervisor as such),
    assign or reassign as a supervisor while the case is open, change the priority (slice 8)
    and the case type (slice 18) as either."""
    is_assignee = case.is_assignee(actor.staff_id)
    reason: ReplyBlockedReason | None = None
    if not is_assignee:
        reason = ReplyBlockedReason.NOT_ASSIGNEE
    elif case.is_closed:
        reason = ReplyBlockedReason.CLOSED
    return CaseCapabilitiesView(
        can_reply=reason is None and case.status in REPLYABLE_STATUSES,
        reply_blocked_reason=reason,
        can_close=is_assignee and case.status in CLOSABLE_STATUSES,
        can_assign=actor.has_any_role({StaffRole.SUPERVISOR}) and not case.is_closed,
        can_change_priority=can_change_priority(case, actor),
        can_change_type=can_change_type(case, actor),
        can_escalate=can_escalate(case, actor),
        can_call=works_on(case, actor) and case.active_call_id is None,
        can_email=works_on(case, actor),
        can_add_note=works_on(case, actor),
    )


def works_on(case: Case, actor: Actor) -> bool:
    """Slice 12: the assignee (as Analista) of an open assigned case (calls, emails, notes)."""
    return (
        case.is_assignee(actor.staff_id)
        and actor.has_any_role({StaffRole.ANALYST})
        and case.status in OPEN_ASSIGNED_STATUSES
    )


def can_escalate(case: Case, actor: Actor) -> bool:
    """Slice 9: its assignee (as Analista) asks supervision for help, one at a time."""
    return (
        case.is_assignee(actor.staff_id)
        and actor.has_any_role({StaffRole.ANALYST})
        and case.status in OPEN_ASSIGNED_STATUSES
        and not case.is_escalated
    )


def can_change_priority(case: Case, actor: Actor) -> bool:
    """Slice 8: the assignee (as Analista) or Supervisión (any case), while it is open."""
    if case.is_closed:
        return False
    is_assignee = case.is_assignee(actor.staff_id) and actor.has_any_role({StaffRole.ANALYST})
    return is_assignee or actor.has_any_role({StaffRole.SUPERVISOR})


def can_change_type(case: Case, actor: Actor) -> bool:
    """Slice 18: who may set the case type is who may set the priority."""
    return can_change_priority(case, actor)


def customer_of(customer: Customer) -> CaseCustomerView:
    return CaseCustomerView(
        id=customer.id,
        display_name=customer.display_name,
        locale=customer.locale,
        language=customer.language,
        country=customer.country,
        city=customer.city,
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

    async def open_inbox(self, staff_id: str) -> list[CaseSummaryView]:
        """``staff_id``'s open cases (Nuevos, Por responder, Esperando), sorted."""
        cases = await self._uow.cases.list_for_assignee(staff_id, OPEN_ASSIGNED_STATUSES)
        return sorted(await self.summaries(cases), key=inbox_order)

    async def closed_inbox(self, staff_id: str, closed_since: datetime) -> list[CaseSummaryView]:
        """``staff_id``'s cases closed since ``closed_since``, the most recent first."""
        cases = await self._uow.cases.list_closed_for_assignee(staff_id, closed_since)
        return sorted(await self.summaries(cases), key=closed_order, reverse=True)

    async def inbox_counts(
        self, staff_id: str, *, closed_since: datetime, computed_at: datetime
    ) -> InboxCountsView:
        items = [
            *await self.open_inbox(staff_id),
            *await self.closed_inbox(staff_id, closed_since),
        ]
        return count_inbox(items, computed_at)

    async def assignment(self, case: Case) -> AssignmentView | None:
        """The case's latest assignment ("Cómo llegó a ti"), if any."""
        assignment = await self._uow.assignments.latest_for_case(case.id)
        return None if assignment is None else await self.assignment_view(case, assignment)

    async def assignment_view(self, case: Case, assignment: Assignment) -> AssignmentView:
        waited = assignment.waited_seconds
        by = assignment.assigned_by
        previous = assignment.previous_staff_id
        return AssignmentView(
            id=assignment.id,
            analyst_id=assignment.staff_id,
            analyst_name=await self.staff_name(assignment.staff_id) or assignment.staff_id,
            reason=assignment.reason,
            policy_rule_id=assignment.policy_rule_id,
            assigned_at=assignment.assigned_at,
            queue_label=case.queue_label if waited is not None else None,
            waited_seconds=waited,
            assigned_by_role=by.role,
            assigned_by_name=(
                None if by.role is ActorRole.SYSTEM else await self.staff_name(by.actor_id)
            ),
            previous_analyst_id=previous,
            previous_analyst_name=await self.staff_name(previous) if previous else None,
        )

    async def escalation_view(self, escalation: Escalation, case: Case) -> EscalationView:
        names = await self.customer_names([case.customer_id])
        resolver = escalation.resolved_by_id
        target = escalation.reassigned_to_id
        return EscalationView(
            id=escalation.id,
            case_id=escalation.case_id,
            customer_name=names[case.customer_id],
            state=escalation.state,
            motive=escalation.motive,
            escalated_at=escalation.escalated_at,
            escalated_by_id=escalation.escalated_by_id,
            escalated_by_name=await self.staff_name(escalation.escalated_by_id),
            resolved_at=escalation.resolved_at,
            resolved_by_id=resolver,
            resolved_by_name=await self.staff_name(resolver) if resolver else None,
            note=escalation.note,
            reassigned_to_id=target,
            reassigned_to_name=await self.staff_name(target) if target else None,
            acknowledged_at=escalation.acknowledged_at,
        )

    async def latest_escalation(self, case: Case) -> EscalationView | None:
        """The case's latest escalation (slice 9), any state."""
        escalation = await self._uow.escalations.latest_for_case(case.id)
        return None if escalation is None else await self.escalation_view(escalation, case)

    async def closure(self, case: Case) -> CaseClosureView | None:
        closure = case.closure
        if closure is None:
            return None
        return CaseClosureView(
            closed_at=closure.closed_at,
            closed_by_id=closure.closed_by_id,
            closed_by_name=(
                copy.ASSISTANT_NAME[Language.SPANISH]
                if closure.closed_by_role is ActorRole.ASSISTANT
                else await self.staff_name(closure.closed_by_id)
            ),
            reason=closure.reason,
            note=closure.note,
        )

    async def history_items(self, cases: Sequence[Case]) -> list[CaseHistoryItemView]:
        items: list[CaseHistoryItemView] = []
        for case in cases:
            analyst = case.assigned_analyst_id
            items.append(
                CaseHistoryItemView(
                    id=case.id,
                    status=case.status,
                    channel=case.channel,
                    opened_at=case.opened_at,
                    closed_at=case.closed_at,
                    close_reason=case.closure.reason if case.closure else None,
                    analyst_id=analyst,
                    analyst_name=await self.staff_name(analyst) if analyst else None,
                    preview=case.last_message_preview,
                    rating=rating_view(case.rating),
                )
            )
        return items

    async def _author_names(self, turns: Sequence[Turn]) -> dict[str, str | None]:
        names: dict[str, str | None] = {}
        for turn in turns:
            author = turn.author_id
            if author is None or author in names:
                continue
            if turn.author_role is TurnAuthorRole.CUSTOMER:
                names[author] = (await self.customer_names([author]))[author]
            elif turn.author_role is TurnAuthorRole.ANALYST:
                names[author] = await self.staff_name(author)
            elif turn.author_role is TurnAuthorRole.ASSISTANT:
                names[author] = copy.ASSISTANT_NAME[Language.SPANISH]  # staff read Spanish
        return names

    async def turn_views(self, turns: Sequence[Turn]) -> list[TurnView]:
        names = await self._author_names(turns)
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
                subject=turn.subject,
                staff_line=turn.staff_line,
            )
            for turn in turns
        ]

    async def customer_turn_views(
        self, turns: Sequence[Turn], customer_id: str
    ) -> list[CustomerTurnView]:
        """What the customer may see: ``everyone`` turns, analysts by first name, client
        message ids only on the customer's own messages."""
        views: list[CustomerTurnView] = []
        for turn in turns:
            if not turn.is_public:
                continue
            author = CustomerTurnAuthor.of(turn.author_role)
            name: str | None = None
            if author is CustomerTurnAuthor.ANALYST and turn.author_id is not None:
                staff_name = await self.staff_name(turn.author_id)
                name = first_name(staff_name) if staff_name else None
            elif author is CustomerTurnAuthor.ASSISTANT:
                name = copy.ASSISTANT_NAME[turn.language]  # never the agent's internal id
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
                    subject=turn.subject,
                )
            )
        return views

    # ------------------------------------------------------------------ calls (slice 12)
    async def active_call(self, case: Case) -> CallView | None:
        if case.active_call_id is None:
            return None
        call = await self._uow.calls.get(case.active_call_id)
        return None if call is None else await self.call_view(call)

    async def call_view(self, call: Call) -> CallView:
        analyst = call.analyst_id
        return CallView(
            id=call.id,
            case_id=call.case_id,
            direction=call.direction,
            state=call.state,
            reason=call.reason,
            analyst_id=analyst,
            analyst_name=await self.staff_name(analyst) if analyst else None,
            started_at=call.started_at,
            answered_at=call.answered_at,
            ended_at=call.ended_at,
            end_reason=call.end_reason,
            ended_by_role=call.ended_by_role,
            muted=call.muted,
            holds=tuple(HoldIntervalView(h.started_at, h.ended_at) for h in call.holds),
            hold_seconds=call.hold_seconds,
            duration_seconds=call.duration_seconds,
            version=call.version,
        )

    async def customer_call_view(self, call: Call) -> CustomerCallView:
        """The analyst by first name, never the reason nor staff ids."""
        name = await self.staff_name(call.analyst_id) if call.analyst_id else None
        return CustomerCallView(
            id=call.id,
            case_id=call.case_id,
            direction=call.direction,
            state=call.state,
            agent_name=first_name(name) if name else None,
            started_at=call.started_at,
            answered_at=call.answered_at,
            ended_at=call.ended_at,
            end_reason=call.end_reason,
            on_hold=call.state is CallState.ON_HOLD,
            duration_seconds=call.duration_seconds,
        )

    # ------------------------------------------------------------------ email (slice 12)
    async def email_views(self, turns: Sequence[Turn]) -> list[EmailMessageView]:
        names = await self._author_names(turns)
        views: list[EmailMessageView] = []
        for turn in turns:
            direction = turn.email_direction
            if direction is None or turn.subject is None:
                continue
            views.append(
                EmailMessageView(
                    id=turn.id,
                    case_id=turn.case_id,
                    sequence=turn.sequence,
                    direction=direction,
                    subject=turn.subject,
                    body=turn.text,
                    author_role=turn.author_role,
                    author_id=turn.author_id,
                    author_name=names.get(turn.author_id) if turn.author_id else None,
                    created_at=turn.created_at,
                    client_message_id=turn.client_message_id,
                )
            )
        return views

    async def customer_email_views(
        self, turns: Sequence[Turn], customer_id: str
    ) -> list[CustomerEmailView]:
        views: list[CustomerEmailView] = []
        for view in await self.customer_turn_views(turns, customer_id):
            source = next(t for t in turns if t.id == view.id)
            direction = source.email_direction
            if direction is None or view.subject is None:
                continue
            views.append(
                CustomerEmailView(
                    id=view.id,
                    sequence=view.sequence,
                    direction=direction,
                    subject=view.subject,
                    body=view.text,
                    author_name=view.author_name,
                    created_at=view.created_at,
                    client_message_id=view.client_message_id,
                )
            )
        return views

    async def _assistant_state(self, case: Case) -> AssistantStateView | None:
        """What the assistant waits for and whether it is answering (``with_assistant`` only)."""
        if not case.is_with_assistant:
            return None
        session = await self._uow.assistant_sessions.get_by_case(case.id)
        if session is None:
            return AssistantStateView(working=False, confirmation=None, step_up=None)
        confirmation, step_up = session.confirmation, session.step_up
        pending_customer_message = case.last_message_author_role is TurnAuthorRole.CUSTOMER
        return AssistantStateView(
            working=session.is_active
            and (
                session.claim is not None
                or session.queued is not None
                or session.resend_blocked
                or (pending_customer_message and confirmation is None and step_up is None)
            ),
            confirmation=None
            if confirmation is None
            else AssistantConfirmationView(
                summary=confirmation.summary,
                token=confirmation.token,
                expires_at=confirmation.expires_at,
            ),
            step_up=None
            if step_up is None
            else AssistantStepUpView(reason=step_up.reason, simulated=step_up.simulated),
        )

    async def _agent_name(self, case: Case, status: CustomerConversationStatus) -> str | None:
        """The assignee's first name while with an agent; on a closed case, who attended (the
        assistant, by its name, when it resolved the conversation itself)."""
        resolved_by_assistant = (
            case.closure is not None and case.closure.closed_by_role is ActorRole.ASSISTANT
        )
        if status is CustomerConversationStatus.WITH_ASSISTANT or resolved_by_assistant:
            return copy.ASSISTANT_NAME[case.language]
        if status is CustomerConversationStatus.WAITING_AGENT or not case.assigned_analyst_id:
            return None
        name = await self.staff_name(case.assigned_analyst_id)
        return first_name(name) if name else None

    async def conversation(self, case: Case) -> CustomerConversationView:
        status = CustomerConversationStatus.of(case.status)
        return CustomerConversationView(
            case_id=case.id,
            status=status,
            channel=case.channel,
            language=case.language,
            opened_at=case.opened_at,
            closed_at=case.closed_at,
            agent_name=await self._agent_name(case, status),
            last_sequence=case.last_public_sequence,
            previous_case_id=case.previous_case_id,
            rating=rating_view(case.rating),
            assistant=await self._assistant_state(case),
        )

    async def conversation_summary(self, case: Case) -> CustomerConversationSummaryView:
        status = CustomerConversationStatus.of(case.status)
        return CustomerConversationSummaryView(
            case_id=case.id,
            status=status,
            channel=case.channel,
            opened_at=case.opened_at,
            closed_at=case.closed_at,
            agent_name=await self._agent_name(case, status),
            preview=case.last_message_preview,  # messages are always public
        )
