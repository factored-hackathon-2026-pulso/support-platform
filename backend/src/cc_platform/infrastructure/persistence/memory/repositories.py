"""In-memory repositories with transactional staging (for tests and ``CC_PERSISTENCE=memory``).

Reads return deep copies and writes are staged until the Unit of Work commits, so the
semantics match the SQL adapter: mutations without ``save`` + ``commit`` are not persisted.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Sequence

from cc_platform.application.events import EventPage, EventRecord, StoredEvent
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Staff, StaffRole
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
    """

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
            raise ConflictError("Ya existe un registro con ese identificador.", id=key)
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
                raise ConflictError("Ya existe un registro con ese identificador.", id=key)
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
