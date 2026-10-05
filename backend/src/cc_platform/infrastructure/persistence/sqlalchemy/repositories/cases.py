"""SQLAlchemy repositories of the cases and customers contexts."""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import Column, exists, func, insert, or_, select
from sqlalchemy import case as sql_case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.application.cases.ports import (
    AssigneeLoad,
    CaseRef,
    EvidenceCell,
    EvidenceSample,
    OpenCaseRef,
    RatingTotals,
)
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.call import (
    Call,
    CallDirection,
    CallEndReason,
    CallState,
    HoldInterval,
)
from cc_platform.domain.cases.case import Case, CaseClosure
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.escalation import Escalation, EscalationState
from cc_platform.domain.cases.rating import CaseRating
from cc_platform.domain.cases.turn import StaffLine, Turn
from cc_platform.domain.cases.values import (
    OPEN_ASSIGNED_STATUSES,
    OPEN_STATUSES,
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseStatus,
    CaseType,
    CloseReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.customers.customer import CountryCode, Customer, CustomerLocale
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import ConcurrentUpdateError, ConflictError
from cc_platform.domain.shared.json import iso_utc
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def _role(value: str | None) -> TurnAuthorRole | None:
    return TurnAuthorRole(value) if value else None


#: ``turns.sequence`` is a 32-bit integer; a cursor beyond it (valid up to 2**63 - 1) is clamped,
#: or Postgres refuses the comparison ("integer out of range").
_MAX_TURN_SEQUENCE = 2**31 - 1


# ----------------------------------------------------------------------------- cases


class SqlCaseRepository(VersionedRepository[Case]):
    table = tables.cases

    def _key(self, aggregate: Case) -> str:
        return aggregate.id

    async def sample_cell(self, cell: EvidenceCell, *, limit: int) -> EvidenceSample:
        c = self.table.c
        conditions = [
            column == value
            for column, value in (
                (c.case_type, cell.case_type),
                (c.channel, cell.channel),
                (c.language, cell.language),
                (c.priority, cell.priority),
                (c.close_reason, cell.close_reason),
            )
            if value is not None
        ]
        if cell.opened_from is not None:
            conditions.append(c.opened_at >= cell.opened_from)
        if cell.opened_before is not None:
            conditions.append(c.opened_at < cell.opened_before)
        matched = (
            await self._session.execute(
                select(func.count()).select_from(self.table).where(*conditions)
            )
        ).scalar_one()
        rows = await self._session.execute(
            select(c.id).where(*conditions).order_by(c.opened_at.desc(), c.id.desc()).limit(limit)
        )
        return EvidenceSample(matched=int(matched), case_ids=tuple(r[0] for r in rows))

    def _to_row(self, aggregate: Case) -> dict[str, Any]:
        closure = aggregate.closure
        rating = aggregate.rating
        return {
            "id": aggregate.id,
            "customer_id": aggregate.customer_id,
            "channel": aggregate.channel.value,
            "language": aggregate.language.value,
            "priority": aggregate.priority.value,
            "case_type": aggregate.case_type.value,
            "status": aggregate.status.value,
            "opened_at": aggregate.opened_at,
            "sla_due_at": aggregate.sla_due_at,
            "first_response_at": aggregate.first_response_at,
            "search_text": aggregate.search_text,
            "previous_case_id": aggregate.previous_case_id,
            "assigned_analyst_id": aggregate.assigned_analyst_id,
            "assigned_at": aggregate.assigned_at,
            "queued_at": aggregate.queued_at,
            "queue_label": aggregate.queue_label,
            "last_sequence": aggregate.last_sequence,
            "last_public_sequence": aggregate.last_public_sequence,
            "last_message_at": aggregate.last_message_at,
            "last_message_author_role": (
                aggregate.last_message_author_role.value
                if aggregate.last_message_author_role
                else None
            ),
            "last_message_preview": aggregate.last_message_preview,
            "last_turn_author_role": (
                aggregate.last_turn_author_role.value if aggregate.last_turn_author_role else None
            ),
            "last_turn_preview": aggregate.last_turn_preview,
            "assignee_read_sequence": aggregate.assignee_read_sequence,
            "unread_sequences": list(aggregate.unread_sequences),
            "closed_at": closure.closed_at if closure else None,
            "closed_by_id": closure.closed_by_id if closure else None,
            "closed_by_role": closure.closed_by_role.value if closure else None,
            "close_reason": closure.reason.value if closure else None,
            "close_note": closure.note if closure else None,
            "rating_score": rating.score if rating else None,
            "rating_comment": rating.comment if rating else None,
            "rated_at": rating.rated_at if rating else None,
            "rating_key": rating.key if rating else None,
            "open_escalation_id": aggregate.open_escalation_id,
            "active_call_id": aggregate.active_call_id,
        }

    def _from_row(self, row: Row) -> Case:
        closure = None
        if row["closed_at"] is not None:
            closure = CaseClosure(
                closed_at=row["closed_at"],
                closed_by_id=row["closed_by_id"],
                closed_by_role=ActorRole(row["closed_by_role"]),
                reason=CloseReason(row["close_reason"]),
                note=row["close_note"],
            )
        rating = None
        if row["rating_score"] is not None:
            rating = CaseRating(
                score=row["rating_score"],
                rated_at=row["rated_at"],
                comment=row["rating_comment"],
                key=row["rating_key"],
            )
        return Case(
            id=row["id"],
            customer_id=row["customer_id"],
            channel=CaseChannel(row["channel"]),
            language=Language(row["language"]),
            priority=CasePriority(row["priority"]),
            case_type=CaseType(row["case_type"]),
            status=CaseStatus(row["status"]),
            opened_at=row["opened_at"],
            sla_due_at=row["sla_due_at"],
            first_response_at=row["first_response_at"],
            search_text=row["search_text"],
            previous_case_id=row["previous_case_id"],
            assigned_analyst_id=row["assigned_analyst_id"],
            assigned_at=row["assigned_at"],
            queued_at=row["queued_at"],
            queue_label=row["queue_label"],
            last_sequence=row["last_sequence"],
            last_public_sequence=row["last_public_sequence"],
            last_message_at=row["last_message_at"],
            last_message_author_role=_role(row["last_message_author_role"]),
            last_message_preview=row["last_message_preview"],
            last_turn_author_role=_role(row["last_turn_author_role"]),
            last_turn_preview=row["last_turn_preview"],
            assignee_read_sequence=row["assignee_read_sequence"],
            unread_sequences=tuple(int(s) for s in row["unread_sequences"]),
            closure=closure,
            rating=rating,
            open_escalation_id=row["open_escalation_id"],
            active_call_id=row["active_call_id"],
        )

    async def _list(self, *criteria: Any, order: tuple[Any, ...] = ()) -> list[Case]:
        statement = select(self.table).where(*criteria).order_by(*order)
        result = await self._session.execute(statement)
        found: list[Case] = []
        for row in result.mappings():
            case = self._load(row)
            if case is not None:
                found.append(case)
        return found

    async def get_many(self, case_ids: Collection[str]) -> dict[str, Case]:
        if not case_ids:
            return {}
        found = await self._list(self.table.c.id.in_(sorted(set(case_ids))))
        return {case.id: case for case in found}

    async def list_for_assignee(
        self, staff_id: str, statuses: Collection[CaseStatus]
    ) -> list[Case]:
        c = self.table.c
        return await self._list(
            c.assigned_analyst_id == staff_id, c.status.in_([s.value for s in statuses])
        )

    async def list_closed_for_assignee(self, staff_id: str, closed_since: datetime) -> list[Case]:
        c = self.table.c
        return await self._list(
            c.assigned_analyst_id == staff_id,
            c.status == CaseStatus.CLOSED.value,
            c.closed_at >= closed_since,
        )

    async def list_by_status(self, status: CaseStatus) -> list[Case]:
        c = self.table.c
        return await self._list(c.status == status.value, order=(c.opened_at, c.id))

    async def list_by_statuses(self, statuses: Collection[CaseStatus]) -> list[Case]:
        c = self.table.c
        return await self._list(c.status.in_([s.value for s in statuses]))

    async def refs(self, case_ids: Collection[str]) -> dict[str, CaseRef]:
        if not case_ids:
            return {}
        c = self.table.c
        rows = await self._session.execute(
            select(c.id, c.customer_id, c.language).where(c.id.in_(list(case_ids)))
        )
        return {
            row.id: CaseRef(customer_id=row.customer_id, language=Language(row.language))
            for row in rows
        }

    async def list_for_customer(self, customer_id: str) -> list[Case]:
        c = self.table.c
        return await self._list(
            c.customer_id == customer_id, order=(c.opened_at.desc(), c.id.desc())
        )

    async def exists_for_customer_and_assignee(self, customer_id: str, staff_id: str) -> bool:
        c, a = self.table.c, tables.assignments.c
        held_before = (
            select(a.id)
            .join(self.table, self.table.c.id == a.case_id)
            .where(a.staff_id == staff_id, c.customer_id == customer_id)
        )
        statement = select(
            or_(
                exists().where(c.customer_id == customer_id, c.assigned_analyst_id == staff_id),
                held_before.exists(),
            )
        )
        return bool((await self._session.execute(statement)).scalar())

    async def latest_for_customer(self, customer_id: str) -> Case | None:
        c = self.table.c
        result = await self._session.execute(
            select(self.table)
            .where(c.customer_id == customer_id)
            .order_by(c.opened_at.desc(), c.id.desc())
            .limit(1)
        )
        return self._load(result.mappings().first())

    async def assignee_loads(
        self, open_statuses: Collection[CaseStatus]
    ) -> dict[str, AssigneeLoad]:
        c = self.table.c
        is_open = c.status.in_([s.value for s in open_statuses])
        statement = (
            select(
                c.assigned_analyst_id,
                func.sum(sql_case((is_open, 1), else_=0)).label("open_cases"),
                func.max(c.assigned_at).label("last_assigned_at"),
            )
            .where(c.assigned_analyst_id.is_not(None))
            .group_by(c.assigned_analyst_id)
        )
        rows = (await self._session.execute(statement)).mappings().all()
        return {
            row["assigned_analyst_id"]: AssigneeLoad(
                open_cases=int(row["open_cases"] or 0),
                last_assigned_at=row["last_assigned_at"],
            )
            for row in rows
        }

    async def open_refs_by_assignee(
        self, staff_ids: Collection[str] | None = None
    ) -> dict[str, list[OpenCaseRef]]:
        c = self.table.c
        statement = (
            select(c.id, c.assigned_analyst_id, c.language)
            .where(
                c.assigned_analyst_id.is_not(None),
                c.status.in_([s.value for s in OPEN_ASSIGNED_STATUSES]),
            )
            .order_by(c.id)
        )
        if staff_ids is not None:
            if not staff_ids:
                return {}
            statement = statement.where(c.assigned_analyst_id.in_(list(staff_ids)))
        refs: dict[str, list[OpenCaseRef]] = {}
        for row in await self._session.execute(statement):
            refs.setdefault(row.assigned_analyst_id, []).append(
                OpenCaseRef(case_id=row.id, language=Language(row.language))
            )
        return refs

    async def rating_totals_by_closer(self, closed_since: datetime) -> dict[str, RatingTotals]:
        c = self.table.c
        statement = (
            select(
                c.closed_by_id,
                func.count(c.rating_score).label("rated"),
                func.sum(c.rating_score).label("score_sum"),
            )
            .where(
                c.closed_by_id.is_not(None),
                c.closed_at >= closed_since,
                c.rating_score.is_not(None),
            )
            .group_by(c.closed_by_id)
        )
        rows = (await self._session.execute(statement)).mappings().all()
        return {
            row["closed_by_id"]: RatingTotals(
                count=int(row["rated"] or 0), score_sum=int(row["score_sum"] or 0)
            )
            for row in rows
        }

    async def list_open_by_language(self, language: Language) -> list[Case]:
        c = self.table.c
        open_statuses = [s.value for s in OPEN_STATUSES]
        return await self._list(c.language == language.value, c.status.in_(open_statuses))


# ----------------------------------------------------------------------------- escalations
class SqlEscalationRepository(VersionedRepository[Escalation]):
    table = tables.escalations
    #: A duplicate ``creation_key`` = the same request racing itself: retry and replay.
    insert_race_is_retryable = True

    def _key(self, aggregate: Escalation) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Escalation) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "case_id": aggregate.case_id,
            "state": aggregate.state.value,
            "motive": aggregate.motive,
            "escalated_by_id": aggregate.escalated_by_id,
            "escalated_at": aggregate.escalated_at,
            "resolved_at": aggregate.resolved_at,
            "resolved_by_id": aggregate.resolved_by_id,
            "note": aggregate.note,
            "reassigned_to_id": aggregate.reassigned_to_id,
            "acknowledged_at": aggregate.acknowledged_at,
            "creation_key": aggregate.creation_key,
        }

    def _from_row(self, row: Row) -> Escalation:
        return Escalation(
            id=row["id"],
            case_id=row["case_id"],
            motive=row["motive"],
            escalated_by_id=row["escalated_by_id"],
            escalated_at=row["escalated_at"],
            state=EscalationState(row["state"]),
            resolved_at=row["resolved_at"],
            resolved_by_id=row["resolved_by_id"],
            note=row["note"],
            reassigned_to_id=row["reassigned_to_id"],
            acknowledged_at=row["acknowledged_at"],
            creation_key=row["creation_key"],
        )

    async def _list(self, *criteria: Any, order: tuple[Any, ...] = ()) -> list[Escalation]:
        result = await self._session.execute(select(self.table).where(*criteria).order_by(*order))
        found: list[Escalation] = []
        for row in result.mappings():
            escalation = self._load(row)
            if escalation is not None:
                found.append(escalation)
        return found

    async def get_by_creation_key(self, key: str) -> Escalation | None:
        return await self._get_where(self.table.c.creation_key == key)

    async def latest_for_case(self, case_id: str) -> Escalation | None:
        c = self.table.c
        result = await self._session.execute(
            select(self.table)
            .where(c.case_id == case_id)
            .order_by(c.escalated_at.desc(), c.id.desc())
            .limit(1)
        )
        return self._load(result.mappings().first())

    async def list_open_or_resolved_since(self, resolved_since: datetime) -> list[Escalation]:
        c = self.table.c
        return await self._list(
            or_(c.state == EscalationState.OPEN.value, c.resolved_at >= resolved_since)
        )


# ----------------------------------------------------------------------------- calls
def holds_to_json(holds: tuple[HoldInterval, ...]) -> list[dict[str, str | None]]:
    return [
        {
            "started_at": iso_utc(hold.started_at),
            "ended_at": iso_utc(hold.ended_at) if hold.ended_at else None,
        }
        for hold in holds
    ]


def holds_from_json(raw: list[dict[str, str | None]]) -> tuple[HoldInterval, ...]:
    holds: list[HoldInterval] = []
    for item in raw:
        started, ended = item["started_at"], item.get("ended_at")
        if started is None:  # pragma: no cover - written by ``holds_to_json``
            continue
        holds.append(
            HoldInterval(
                started_at=datetime.fromisoformat(started),
                ended_at=datetime.fromisoformat(ended) if ended else None,
            )
        )
    return tuple(holds)


class SqlCallRepository(VersionedRepository[Call]):
    table = tables.calls
    #: A duplicate ``creation_key`` = the same request racing itself: retry and replay.
    insert_race_is_retryable = True

    def _key(self, aggregate: Call) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Call) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "case_id": aggregate.case_id,
            "customer_id": aggregate.customer_id,
            "direction": aggregate.direction.value,
            "state": aggregate.state.value,
            "reason": aggregate.reason,
            "analyst_id": aggregate.analyst_id,
            "started_at": aggregate.started_at,
            "answered_at": aggregate.answered_at,
            "ended_at": aggregate.ended_at,
            "end_reason": aggregate.end_reason.value if aggregate.end_reason else None,
            "ended_by_role": aggregate.ended_by_role.value if aggregate.ended_by_role else None,
            "muted": aggregate.muted,
            "holds": holds_to_json(aggregate.holds),
            "creation_key": aggregate.creation_key,
        }

    def _from_row(self, row: Row) -> Call:
        return Call(
            id=row["id"],
            case_id=row["case_id"],
            customer_id=row["customer_id"],
            direction=CallDirection(row["direction"]),
            started_at=row["started_at"],
            state=CallState(row["state"]),
            reason=row["reason"],
            analyst_id=row["analyst_id"],
            answered_at=row["answered_at"],
            ended_at=row["ended_at"],
            end_reason=CallEndReason(row["end_reason"]) if row["end_reason"] else None,
            ended_by_role=ActorRole(row["ended_by_role"]) if row["ended_by_role"] else None,
            muted=bool(row["muted"]),
            holds=holds_from_json(row["holds"]),
            creation_key=row["creation_key"],
        )

    async def get_by_creation_key(self, key: str) -> Call | None:
        return await self._get_where(self.table.c.creation_key == key)

    async def list_for_case(self, case_id: str) -> list[Call]:
        c = self.table.c
        result = await self._session.execute(
            select(self.table)
            .where(c.case_id == case_id)
            .order_by(c.started_at.desc(), c.id.desc())
        )
        found: list[Call] = []
        for row in result.mappings():
            call = self._load(row)
            if call is not None:
                found.append(call)
        return found

    async def latest_for_case(self, case_id: str) -> Call | None:
        found = await self.list_for_case(case_id)
        return found[0] if found else None


class SqlCustomerCaseSlotRepository(VersionedRepository[CustomerCaseSlot]):
    table = tables.customer_case_slots
    insert_race_is_retryable = True

    @property
    def _key_column(self) -> Column[Any]:
        return tables.customer_case_slots.c.customer_id

    def _key(self, aggregate: CustomerCaseSlot) -> str:
        return aggregate.customer_id

    def _to_row(self, aggregate: CustomerCaseSlot) -> dict[str, Any]:
        return {"customer_id": aggregate.customer_id, "open_case_id": aggregate.open_case_id}

    def _from_row(self, row: Row) -> CustomerCaseSlot:
        return CustomerCaseSlot(customer_id=row["customer_id"], open_case_id=row["open_case_id"])


# ----------------------------------------------------------------------------- append-only rows
class _AppendOnly:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _insert(self, table: Any, row: dict[str, Any], *, race: bool = False) -> None:
        try:
            await self._session.execute(insert(table).values(**row))
        except IntegrityError as exc:
            if race:
                raise ConcurrentUpdateError(entity=table.name) from exc
            raise ConflictError("Ya existe un registro con esos datos.") from exc


class SqlTurnRepository(_AppendOnly):
    async def add(self, turn: Turn) -> None:
        # A unique violation means a concurrent writer won the sequence or the message id:
        # retry on fresh state (the replay check then finds the original turn).
        await self._insert(
            tables.turns,
            {
                "id": turn.id,
                "case_id": turn.case_id,
                "sequence": turn.sequence,
                "kind": turn.kind.value,
                "audience": turn.audience.value,
                "author_role": turn.author_role.value,
                "author_id": turn.author_id,
                "text": turn.text,
                "language": turn.language.value,
                "created_at": turn.created_at,
                "client_message_id": turn.client_message_id,
                "subject": turn.subject,
                "staff_line": turn.staff_line.to_json() if turn.staff_line else None,
            },
            race=True,
        )

    @staticmethod
    def _from_row(row: Row) -> Turn:
        return Turn(
            id=row["id"],
            case_id=row["case_id"],
            sequence=row["sequence"],
            kind=TurnKind(row["kind"]),
            audience=TurnAudience(row["audience"]),
            author_role=TurnAuthorRole(row["author_role"]),
            author_id=row["author_id"],
            text=row["text"],
            language=Language(row["language"]),
            created_at=row["created_at"],
            client_message_id=row["client_message_id"],
            subject=row["subject"],
            staff_line=StaffLine.from_json(row["staff_line"]),
        )

    async def list_of_kind(self, case_id: str, kind: TurnKind, *, limit: int) -> list[Turn]:
        c = tables.turns.c
        statement = (
            select(tables.turns)
            .where(c.case_id == case_id, c.kind == kind.value)
            .order_by(c.sequence)
            .limit(limit)
        )
        rows = (await self._session.execute(statement)).mappings().all()
        return [self._from_row(row) for row in rows]

    async def page(
        self,
        case_id: str,
        *,
        limit: int,
        before: int | None = None,
        after: int | None = None,
        audience: TurnAudience | None = None,
    ) -> list[Turn]:
        c = tables.turns.c
        statement = select(tables.turns).where(c.case_id == case_id)
        if audience is not None:
            statement = statement.where(c.audience == audience.value)
        if after is not None:
            after = min(after, _MAX_TURN_SEQUENCE)
            statement = statement.where(c.sequence > after).order_by(c.sequence).limit(limit)
            rows = (await self._session.execute(statement)).mappings().all()
            return [self._from_row(row) for row in rows]
        if before is not None:
            statement = statement.where(c.sequence < min(before, _MAX_TURN_SEQUENCE))
        statement = statement.order_by(c.sequence.desc()).limit(limit)
        rows = (await self._session.execute(statement)).mappings().all()
        return [self._from_row(row) for row in reversed(rows)]

    async def find_by_client_message_id(
        self, author_id: str, client_message_id: str
    ) -> Turn | None:
        c = tables.turns.c
        result = await self._session.execute(
            select(tables.turns).where(
                c.author_id == author_id, c.client_message_id == client_message_id
            )
        )
        row = result.mappings().first()
        return self._from_row(row) if row is not None else None


class SqlAssignmentRepository(_AppendOnly):
    async def add(self, assignment: Assignment) -> None:
        await self._insert(
            tables.assignments,
            {
                "id": assignment.id,
                "case_id": assignment.case_id,
                "staff_id": assignment.staff_id,
                "reason": assignment.reason.value,
                "policy_rule_id": assignment.policy_rule_id,
                "open_cases_at_assignment": assignment.open_cases_at_assignment,
                "strategy": assignment.strategy,
                "assigned_at": assignment.assigned_at,
                "assigned_by_role": assignment.assigned_by.role.value,
                "assigned_by_id": assignment.assigned_by.actor_id,
                "waited_seconds": assignment.waited_seconds,
                "previous_staff_id": assignment.previous_staff_id,
                "paused_override": assignment.paused_override,
            },
        )

    async def latest_for_case(self, case_id: str) -> Assignment | None:
        c = tables.assignments.c
        result = await self._session.execute(
            select(tables.assignments)
            .where(c.case_id == case_id)
            .order_by(c.assigned_at.desc(), c.id.desc())
            .limit(1)
        )
        row = result.mappings().first()
        if row is None:
            return None
        return Assignment(
            id=row["id"],
            case_id=row["case_id"],
            staff_id=row["staff_id"],
            reason=AssignmentReason(row["reason"]),
            policy_rule_id=row["policy_rule_id"],
            open_cases_at_assignment=row["open_cases_at_assignment"],
            strategy=row["strategy"],
            assigned_at=row["assigned_at"],
            assigned_by=ActorRef(ActorRole(row["assigned_by_role"]), row["assigned_by_id"]),
            waited_seconds=row["waited_seconds"],
            previous_staff_id=row["previous_staff_id"],
            paused_override=bool(row["paused_override"]),
        )


# ----------------------------------------------------------------------------- customers
class SqlCustomerRepository(_AppendOnly):
    @staticmethod
    def _from_row(row: Row) -> Customer:
        return Customer(
            id=row["id"],
            display_name=row["display_name"],
            country=CountryCode(row["country"]),
            city=row["city"],
            locale=CustomerLocale(row["locale"]),
            simulator=bool(row["simulator"]),
            suggestions=tuple(row["suggestions"]),
        )

    async def add(self, customer: Customer) -> None:
        await self._insert(
            tables.customers,
            {
                "id": customer.id,
                "display_name": customer.display_name,
                "country": customer.country.value,
                "city": customer.city,
                "locale": customer.locale.value,
                "simulator": customer.simulator,
                "suggestions": list(customer.suggestions),
            },
        )

    async def get(self, customer_id: str) -> Customer | None:
        result = await self._session.execute(
            select(tables.customers).where(tables.customers.c.id == customer_id)
        )
        row = result.mappings().first()
        return self._from_row(row) if row is not None else None

    async def get_many(self, customer_ids: Collection[str]) -> dict[str, Customer]:
        if not customer_ids:
            return {}
        result = await self._session.execute(
            select(tables.customers).where(tables.customers.c.id.in_(list(customer_ids)))
        )
        return {row["id"]: self._from_row(row) for row in result.mappings()}

    async def list(self) -> list[Customer]:
        result = await self._session.execute(
            select(tables.customers).order_by(tables.customers.c.id)
        )
        return [self._from_row(row) for row in result.mappings()]
