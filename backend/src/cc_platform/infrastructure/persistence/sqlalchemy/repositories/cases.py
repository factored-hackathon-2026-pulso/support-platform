"""SQLAlchemy repositories of the cases and customers contexts."""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import Column, exists, func, insert, select
from sqlalchemy import case as sql_case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.application.cases.ports import AssigneeLoad
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case, CaseClosure
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseStatus,
    CloseReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.customers.customer import CountryCode, Customer, CustomerLocale
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import ConcurrentUpdateError, ConflictError
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def _role(value: str | None) -> TurnAuthorRole | None:
    return TurnAuthorRole(value) if value else None


# ----------------------------------------------------------------------------- cases
class SqlCaseRepository(VersionedRepository[Case]):
    table = tables.cases

    def _key(self, aggregate: Case) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Case) -> dict[str, Any]:
        closure = aggregate.closure
        return {
            "id": aggregate.id,
            "customer_id": aggregate.customer_id,
            "channel": aggregate.channel.value,
            "language": aggregate.language.value,
            "priority": aggregate.priority.value,
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
        return Case(
            id=row["id"],
            customer_id=row["customer_id"],
            channel=CaseChannel(row["channel"]),
            language=Language(row["language"]),
            priority=CasePriority(row["priority"]),
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

    async def list_for_customer(self, customer_id: str) -> list[Case]:
        c = self.table.c
        return await self._list(
            c.customer_id == customer_id, order=(c.opened_at.desc(), c.id.desc())
        )

    async def exists_for_customer_and_assignee(self, customer_id: str, staff_id: str) -> bool:
        c = self.table.c
        statement = select(
            exists().where(c.customer_id == customer_id, c.assigned_analyst_id == staff_id)
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
        )

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
            statement = statement.where(c.sequence > after).order_by(c.sequence).limit(limit)
            rows = (await self._session.execute(statement)).mappings().all()
            return [self._from_row(row) for row in rows]
        if before is not None:
            statement = statement.where(c.sequence < before)
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
