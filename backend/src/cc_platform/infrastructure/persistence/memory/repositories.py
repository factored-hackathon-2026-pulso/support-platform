"""In-memory repositories with transactional staging (for tests and ``CC_PERSISTENCE=memory``).

Reads return deep copies and writes are staged until the Unit of Work commits, so the
semantics match the SQL adapter: mutations without ``save`` + ``commit`` are not persisted.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Collection, Iterable, Sequence

from cc_platform.application.cases.ports import AssigneeLoad
from cc_platform.application.events import EventPage, EventRecord, StoredEvent
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import CaseStatus, TurnAudience
from cc_platform.domain.customers.customer import Customer
from cc_platform.domain.people.availability import AnalystAvailability
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Staff, StaffRole
from cc_platform.domain.routing.routing_step import RoutingStep
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import ConcurrentUpdateError, ConflictError, NotFoundError
from cc_platform.infrastructure.persistence.cursors import clamp_limit, decode_cursor, encode_cursor

type Tracker = Callable[[AggregateRoot], None]


def _clone[A: AggregateRoot](aggregate: A) -> A:
    clone = copy.deepcopy(aggregate)
    clone.pull_events()
    return clone


class _StagedRepository[A: AggregateRoot]:
    """Staged writes with the same optimistic locking as the SQL adapter.

    ``save`` compares the aggregate's loaded ``version`` with the stored one and bumps it;
    ``verify`` repeats the check for every staged key right before ``apply``, so a commit
    that lost a race raises ``ConcurrentUpdateError`` and applies nothing.

    ``insert_race_is_retryable``: for aggregates created on demand by a retryable command
    (one-open-case slot, availability), a duplicate insert means "someone created it
    first", so it raises ``ConcurrentUpdateError`` (retry on fresh state) instead of a
    plain ``ConflictError``.
    """

    insert_race_is_retryable = False

    def _duplicate(self, key: str) -> ConflictError:
        if self.insert_race_is_retryable:
            return ConcurrentUpdateError(id=key)
        return ConflictError("Ya existe un registro con ese identificador.", id=key)

    def __init__(self, committed: dict[str, A], key: Callable[[A], str], track: Tracker) -> None:
        self._committed = committed
        self._staged: dict[str, A] = {}
        self._base_versions: dict[str, int] = {}  # key → committed version the unit started from
        self._key = key
        self._track = track

    async def _get(self, key: str) -> A | None:
        found = self._staged.get(key) or self._committed.get(key)
        if found is None:
            return None
        aggregate = _clone(found)
        self._track(aggregate)
        return aggregate

    async def add(self, aggregate: A) -> None:
        key = self._key(aggregate)
        if key in self._staged or key in self._committed:
            raise self._duplicate(key)
        aggregate.mark_persisted(1)
        self._base_versions[key] = 0
        self._staged[key] = _clone(aggregate)
        self._track(aggregate)

    async def save(self, aggregate: A) -> None:
        key = self._key(aggregate)
        expected = aggregate.version
        stored = self._staged.get(key) or self._committed.get(key)
        if stored is None or expected < 1:
            raise NotFoundError(id=key)
        if stored.version != expected:
            raise ConcurrentUpdateError(id=key)
        self._base_versions.setdefault(key, expected)
        aggregate.mark_persisted(expected + 1)
        self._staged[key] = _clone(aggregate)
        self._track(aggregate)

    def _all(self) -> list[A]:
        merged = {**self._committed, **self._staged}
        return [_clone(item) for item in merged.values()]

    def verify(self) -> None:
        for key, base in self._base_versions.items():
            committed = self._committed.get(key)
            if base == 0 and committed is not None:
                raise self._duplicate(key)
            if base > 0 and (committed is None or committed.version != base):
                raise ConcurrentUpdateError(id=key)

    def apply(self) -> None:
        self._committed.update(self._staged)
        self.discard()

    def discard(self) -> None:
        self._staged.clear()
        self._base_versions.clear()


class InMemoryStaffRepository(_StagedRepository[Staff]):
    def __init__(self, committed: dict[str, Staff], track: Tracker) -> None:
        super().__init__(committed, lambda staff: staff.id, track)

    async def get(self, staff_id: str) -> Staff | None:
        return await self._get(staff_id)

    async def get_by_email(self, email: str) -> Staff | None:
        for staff in self._all():
            if staff.email == email:
                self._track(staff)
                return staff
        return None

    async def list(self, *, role: StaffRole | None = None) -> list[Staff]:
        people = [s for s in self._all() if role is None or s.has_role(role)]
        return sorted(people, key=lambda staff: (staff.name, staff.id))

    async def add(self, aggregate: Staff) -> None:
        if any(other.email == aggregate.email for other in self._all()):
            raise ConflictError("Ya existe una persona con ese correo.", email=aggregate.email)
        await super().add(aggregate)


class InMemoryLoginAccountRepository(_StagedRepository[LoginAccount]):
    def __init__(self, committed: dict[str, LoginAccount], track: Tracker) -> None:
        super().__init__(committed, lambda account: account.staff_id, track)

    async def get(self, staff_id: str) -> LoginAccount | None:
        return await self._get(staff_id)


class InMemoryMfaChallengeRepository(_StagedRepository[MfaChallenge]):
    def __init__(self, committed: dict[str, MfaChallenge], track: Tracker) -> None:
        super().__init__(committed, lambda challenge: challenge.id, track)

    async def get(self, challenge_id: str) -> MfaChallenge | None:
        return await self._get(challenge_id)


class InMemoryStaffSessionRepository(_StagedRepository[StaffSession]):
    def __init__(self, committed: dict[str, StaffSession], track: Tracker) -> None:
        super().__init__(committed, lambda session: session.id, track)

    async def get(self, session_id: str) -> StaffSession | None:
        return await self._get(session_id)


class InMemoryEventLogRepository:
    def __init__(self, committed: list[StoredEvent]) -> None:
        self._committed = committed
        self._staged: list[StoredEvent] = []

    async def append(self, records: Sequence[EventRecord]) -> None:
        known = {event.event_id for event in self._committed} | {e.event_id for e in self._staged}
        next_sequence = len(self._committed) + len(self._staged) + 1
        for record in records:
            if record.event_id in known:
                raise ConflictError("El evento ya fue registrado.", eventId=record.event_id)
            self._staged.append(
                StoredEvent(
                    sequence=next_sequence,
                    event_id=record.event_id,
                    event_type=record.event_type,
                    entity=record.entity,
                    entity_id=record.entity_id,
                    case_id=record.case_id,
                    actor_role=record.actor_role,
                    actor_id=record.actor_id,
                    event_time=record.event_time,
                    ingested_at=record.ingested_at,
                    payload=record.payload(),
                )
            )
            known.add(record.event_id)
            next_sequence += 1

    async def page(
        self,
        *,
        after: str | None = None,
        limit: int = 100,
        case_id: str | None = None,
        entity_id: str | None = None,
    ) -> EventPage:
        start = decode_cursor(after)
        size = clamp_limit(limit)
        matching = [
            event
            for event in self._committed
            if event.sequence > start
            and (case_id is None or event.case_id == case_id)
            and (entity_id is None or event.entity_id == entity_id)
        ]
        items = tuple(matching[:size])
        has_more = len(matching) > size
        return EventPage(
            items=items,
            next_cursor=encode_cursor(items[-1].sequence) if has_more and items else None,
        )

    def verify(self) -> None:
        """Appends never conflict on version (event ids are checked in ``append``)."""

    def apply(self) -> None:
        self._committed.extend(self._staged)
        self._staged.clear()

    def discard(self) -> None:
        self._staged.clear()


# ----------------------------------------------------------------------------- people: availability
class InMemoryAnalystAvailabilityRepository(_StagedRepository[AnalystAvailability]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, AnalystAvailability], track: Tracker) -> None:
        super().__init__(committed, lambda availability: availability.staff_id, track)

    async def get(self, staff_id: str) -> AnalystAvailability | None:
        return await self._get(staff_id)

    async def list(self) -> list[AnalystAvailability]:
        return sorted(self._all(), key=lambda availability: availability.staff_id)


# ----------------------------------------------------------------------------- cases
class InMemoryCaseRepository(_StagedRepository[Case]):
    def __init__(self, committed: dict[str, Case], track: Tracker) -> None:
        super().__init__(committed, lambda case: case.id, track)

    async def get(self, case_id: str) -> Case | None:
        return await self._get(case_id)

    def _tracked(self, cases: Iterable[Case]) -> list[Case]:
        found = list(cases)
        for case in found:
            self._track(case)
        return found

    async def list_for_assignee(
        self, staff_id: str, statuses: Collection[CaseStatus]
    ) -> list[Case]:
        return self._tracked(
            case
            for case in self._all()
            if case.assigned_analyst_id == staff_id and case.status in statuses
        )

    async def list_by_status(self, status: CaseStatus) -> list[Case]:
        matching = [case for case in self._all() if case.status is status]
        return self._tracked(sorted(matching, key=lambda case: (case.opened_at, case.id)))

    async def latest_for_customer(self, customer_id: str) -> Case | None:
        mine = [case for case in self._all() if case.customer_id == customer_id]
        if not mine:
            return None
        latest = max(mine, key=lambda case: (case.opened_at, case.id))
        self._track(latest)
        return latest

    async def assignee_loads(
        self, open_statuses: Collection[CaseStatus]
    ) -> dict[str, AssigneeLoad]:
        loads: dict[str, AssigneeLoad] = {}
        for case in self._all():
            staff_id = case.assigned_analyst_id
            if staff_id is None:
                continue
            current = loads.get(staff_id, AssigneeLoad(open_cases=0, last_assigned_at=None))
            last = current.last_assigned_at
            if case.assigned_at is not None and (last is None or case.assigned_at > last):
                last = case.assigned_at
            loads[staff_id] = AssigneeLoad(
                open_cases=current.open_cases + (1 if case.status in open_statuses else 0),
                last_assigned_at=last,
            )
        return loads


class InMemoryCustomerCaseSlotRepository(_StagedRepository[CustomerCaseSlot]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, CustomerCaseSlot], track: Tracker) -> None:
        super().__init__(committed, lambda slot: slot.customer_id, track)

    async def get(self, customer_id: str) -> CustomerCaseSlot | None:
        return await self._get(customer_id)


class _AppendOnlyRepository[E]:
    """Immutable rows (turns, assignments, routing steps): add only, checked at commit."""

    def __init__(self, committed: dict[str, E], key: Callable[[E], str]) -> None:
        self._committed = committed
        self._staged: dict[str, E] = {}
        self._key = key

    async def add(self, item: E) -> None:
        key = self._key(item)
        if key in self._committed or key in self._staged:
            raise ConflictError("Ya existe un registro con ese identificador.", id=key)
        self._check_unique(item, self._all())
        self._staged[key] = item

    def _check_unique(self, item: E, existing: Iterable[E]) -> None:
        """Hook for secondary unique keys (raise ``ConflictError``)."""

    def _all(self) -> list[E]:
        return [*self._committed.values(), *self._staged.values()]

    def verify(self) -> None:
        for key, item in self._staged.items():
            if key in self._committed:
                raise ConflictError("Ya existe un registro con ese identificador.", id=key)
            self._check_unique(item, self._committed.values())

    def apply(self) -> None:
        self._committed.update(self._staged)
        self.discard()

    def discard(self) -> None:
        self._staged.clear()


class InMemoryTurnRepository(_AppendOnlyRepository[Turn]):
    def __init__(self, committed: dict[str, Turn]) -> None:
        super().__init__(committed, lambda turn: turn.id)

    def _check_unique(self, item: Turn, existing: Iterable[Turn]) -> None:
        for other in existing:
            if other.case_id == item.case_id and other.sequence == item.sequence:
                raise ConcurrentUpdateError(id=item.case_id, sequence=item.sequence)
            if (
                item.client_message_id is not None
                and other.author_id == item.author_id
                and other.client_message_id == item.client_message_id
            ):
                raise ConcurrentUpdateError(clientMessageId=item.client_message_id)

    async def page(
        self,
        case_id: str,
        *,
        limit: int,
        before: int | None = None,
        after: int | None = None,
        audience: TurnAudience | None = None,
    ) -> list[Turn]:
        turns = sorted(
            (
                turn
                for turn in self._all()
                if turn.case_id == case_id and (audience is None or turn.audience is audience)
            ),
            key=lambda turn: turn.sequence,
        )
        if after is not None:
            return [turn for turn in turns if turn.sequence > after][:limit]
        if before is not None:
            turns = [turn for turn in turns if turn.sequence < before]
        return turns[-limit:] if limit > 0 else []

    async def find_by_client_message_id(
        self, author_id: str, client_message_id: str
    ) -> Turn | None:
        for turn in self._all():
            if turn.author_id == author_id and turn.client_message_id == client_message_id:
                return turn
        return None


class InMemoryAssignmentRepository(_AppendOnlyRepository[Assignment]):
    def __init__(self, committed: dict[str, Assignment]) -> None:
        super().__init__(committed, lambda assignment: assignment.id)

    async def latest_for_case(self, case_id: str) -> Assignment | None:
        mine = [a for a in self._all() if a.case_id == case_id]
        return max(mine, key=lambda a: (a.assigned_at, a.id)) if mine else None


class InMemoryRoutingStepRepository(_AppendOnlyRepository[RoutingStep]):
    def __init__(self, committed: dict[str, RoutingStep]) -> None:
        super().__init__(committed, lambda step: step.id)

    async def list_for_case(self, case_id: str) -> list[RoutingStep]:
        steps = [step for step in self._all() if step.case_id == case_id]
        return sorted(steps, key=lambda step: (step.occurred_at, step.id))


# ----------------------------------------------------------------------------- customers
class InMemoryCustomerRepository(_AppendOnlyRepository[Customer]):
    def __init__(self, committed: dict[str, Customer]) -> None:
        super().__init__(committed, lambda customer: customer.id)

    async def get(self, customer_id: str) -> Customer | None:
        return self._staged.get(customer_id) or self._committed.get(customer_id)

    async def get_many(self, customer_ids: Collection[str]) -> dict[str, Customer]:
        wanted = set(customer_ids)
        return {c.id: c for c in self._all() if c.id in wanted}

    async def list(self) -> list[Customer]:
        return sorted(self._all(), key=lambda customer: customer.id)
