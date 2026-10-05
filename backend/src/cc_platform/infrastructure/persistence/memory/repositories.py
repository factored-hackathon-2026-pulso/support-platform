"""In-memory repositories with transactional staging (for tests and ``CC_PERSISTENCE=memory``).

Reads return deep copies and writes are staged until the Unit of Work commits, so the
semantics match the SQL adapter: mutations without ``save`` + ``commit`` are not persisted.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from datetime import datetime

from cc_platform.application.cases.ports import (
    AssigneeLoad,
    CaseRef,
    CustomerCaseFact,
    OpenCaseRef,
    RatingTotals,
)
from cc_platform.application.events import EventPage, EventRecord, StoredEvent
from cc_platform.application.notifications.ports import NotificationCursor
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.domain.ai.builder import BuilderProposal, BuilderThread
from cc_platform.domain.ai.copilot import CopilotThread
from cc_platform.domain.ai.maturity import CaseTypeMaturity
from cc_platform.domain.ai.session import AssistantSession
from cc_platform.domain.ai.suggestion import CopilotSuggestion, SuggestionStatus
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.call import Call
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.escalation import Escalation, EscalationState
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import (
    OPEN_ASSIGNED_STATUSES,
    OPEN_STATUSES,
    CaseStatus,
    TurnAudience,
    TurnKind,
)
from cc_platform.domain.customers.customer import Customer
from cc_platform.domain.notifications.notification import Notification
from cc_platform.domain.people.admin_roster import ROSTER_ID, AdminRoster
from cc_platform.domain.people.availability import AnalystAvailability
from cc_platform.domain.people.errors import EmailTakenError, TeamNameTakenError
from cc_platform.domain.people.invitation import Invitation
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.password_reset import PasswordReset
from cc_platform.domain.people.preferences import StaffPreferences
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.domain.people.team import Team
from cc_platform.domain.platform.settings import SETTINGS_ID, PlatformSettings
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import (
    ConcurrentUpdateError,
    ConflictError,
    DomainError,
    NotFoundError,
)
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

    def _unique_violation(self, aggregate: A, other: A) -> DomainError | None:
        """Hook for secondary unique keys: the error when ``other`` (another row) clashes
        with ``aggregate``, else ``None``. Checked on add/save and again at commit."""
        return None

    def _check_unique(self, aggregate: A, others: Iterable[A]) -> None:
        key = self._key(aggregate)
        for other in others:
            if self._key(other) == key:
                continue
            violation = self._unique_violation(aggregate, other)
            if violation is not None:
                raise violation

    async def add(self, aggregate: A) -> None:
        key = self._key(aggregate)
        if key in self._staged or key in self._committed:
            raise self._duplicate(key)
        self._check_unique(aggregate, self._all())
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
        self._check_unique(aggregate, self._all())
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
        for staged in self._staged.values():
            self._check_unique(staged, self._committed.values())

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

    async def get_by_creation_key(self, key: str) -> Staff | None:
        for staff in self._all():
            if staff.creation_key is not None and staff.creation_key == key:
                self._track(staff)
                return staff
        return None

    def _unique_violation(self, aggregate: Staff, other: Staff) -> DomainError | None:
        if aggregate.creation_key is not None and aggregate.creation_key == other.creation_key:
            return ConcurrentUpdateError(creationKey=aggregate.creation_key)
        if aggregate.email == other.email:
            return EmailTakenError()
        return None


class InMemoryTeamRepository(_StagedRepository[Team]):
    def __init__(self, committed: dict[str, Team], track: Tracker) -> None:
        super().__init__(committed, lambda team: team.id, track)

    async def get(self, team_id: str) -> Team | None:
        return await self._get(team_id)

    async def get_many(self, team_ids: Collection[str]) -> dict[str, Team]:
        wanted = set(team_ids)
        found = {team.id: team for team in self._all() if team.id in wanted}
        for team in found.values():
            self._track(team)
        return found

    async def get_by_creation_key(self, key: str) -> Team | None:
        for team in self._all():
            if team.creation_key is not None and team.creation_key == key:
                self._track(team)
                return team
        return None

    async def list(self) -> list[Team]:
        teams = sorted(self._all(), key=lambda team: (team.name_key, team.id))
        for team in teams:
            self._track(team)
        return teams

    def _unique_violation(self, aggregate: Team, other: Team) -> DomainError | None:
        if aggregate.creation_key is not None and aggregate.creation_key == other.creation_key:
            return ConcurrentUpdateError(creationKey=aggregate.creation_key)
        if aggregate.name_key == other.name_key:
            return TeamNameTakenError()
        return None


class InMemoryAdminRosterRepository(_StagedRepository[AdminRoster]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, AdminRoster], track: Tracker) -> None:
        super().__init__(committed, lambda roster: roster.id, track)

    async def get(self, key: str = ROSTER_ID) -> AdminRoster | None:
        return await self._get(key)


class InMemoryPlatformSettingsRepository(_StagedRepository[PlatformSettings]):
    """Slice 18: the platform-wide settings (a singleton created on the first change)."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, PlatformSettings], track: Tracker) -> None:
        super().__init__(committed, lambda settings: settings.id, track)

    async def get(self, key: str = SETTINGS_ID) -> PlatformSettings | None:
        return await self._get(key)


class InMemoryLoginAccountRepository(_StagedRepository[LoginAccount]):
    def __init__(self, committed: dict[str, LoginAccount], track: Tracker) -> None:
        super().__init__(committed, lambda account: account.staff_id, track)

    async def get(self, staff_id: str) -> LoginAccount | None:
        return await self._get(staff_id)

    async def list(self) -> list[LoginAccount]:
        return sorted(self._all(), key=lambda account: account.staff_id)


class InMemoryInvitationRepository(_StagedRepository[Invitation]):
    """Part 4. Same answers as ``SqlInvitationRepository`` (unique person and token)."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, Invitation], track: Tracker) -> None:
        super().__init__(committed, lambda invitation: invitation.id, track)

    def _unique_violation(self, aggregate: Invitation, other: Invitation) -> DomainError | None:
        if aggregate.staff_id == other.staff_id or aggregate.token_hash == other.token_hash:
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    def _first(self, found: list[Invitation]) -> Invitation | None:
        if not found:
            return None
        self._track(found[0])
        return found[0]

    async def get(self, invitation_id: str) -> Invitation | None:
        return await self._get(invitation_id)

    async def get_for_staff(self, staff_id: str) -> Invitation | None:
        return self._first([i for i in self._all() if i.staff_id == staff_id])

    async def get_by_token_hash(self, token_hash: str) -> Invitation | None:
        return self._first([i for i in self._all() if i.token_hash == token_hash])

    async def list(self) -> list[Invitation]:
        return sorted(self._all(), key=lambda invitation: invitation.staff_id)


class InMemoryPasswordResetRepository(_StagedRepository[PasswordReset]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, PasswordReset], track: Tracker) -> None:
        super().__init__(committed, lambda reset: reset.id, track)

    def _unique_violation(
        self, aggregate: PasswordReset, other: PasswordReset
    ) -> DomainError | None:
        if aggregate.staff_id == other.staff_id or aggregate.token_hash == other.token_hash:
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    def _first(self, found: list[PasswordReset]) -> PasswordReset | None:
        if not found:
            return None
        self._track(found[0])
        return found[0]

    async def get_for_staff(self, staff_id: str) -> PasswordReset | None:
        return self._first([r for r in self._all() if r.staff_id == staff_id])

    async def get_by_token_hash(self, token_hash: str) -> PasswordReset | None:
        return self._first([r for r in self._all() if r.token_hash == token_hash])


class InMemoryMfaChallengeRepository(_StagedRepository[MfaChallenge]):
    def __init__(self, committed: dict[str, MfaChallenge], track: Tracker) -> None:
        super().__init__(committed, lambda challenge: challenge.id, track)

    async def get(self, challenge_id: str) -> MfaChallenge | None:
        return await self._get(challenge_id)

    async def list_pending_for(self, staff_id: str, now: datetime) -> list[MfaChallenge]:
        mine = [c for c in self._all() if c.staff_id == staff_id and c.is_open(now)]
        mine.sort(key=lambda challenge: (challenge.issued_at, challenge.id))
        for challenge in mine:
            self._track(challenge)
        return mine


class InMemoryStaffSessionRepository(_StagedRepository[StaffSession]):
    def __init__(self, committed: dict[str, StaffSession], track: Tracker) -> None:
        super().__init__(committed, lambda session: session.id, track)

    async def get(self, session_id: str) -> StaffSession | None:
        return await self._get(session_id)

    async def active_staff_ids(self, now: datetime) -> set[str]:
        return {session.staff_id for session in self._all() if session.is_active(now)}

    async def list_active_for(self, staff_id: str, now: datetime) -> list[StaffSession]:
        mine = [s for s in self._all() if s.staff_id == staff_id and s.is_active(now)]
        mine.sort(key=lambda session: (session.issued_at, session.id))
        for session in mine:
            self._track(session)
        return mine


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

    async def search(
        self, filters: AuditFilters, *, before: int | None, limit: int
    ) -> list[StoredEvent]:
        matching = [
            event
            for event in reversed(self._committed)
            if (before is None or event.sequence < before) and _matches(event, filters)
        ]
        return matching[:limit]

    async def get(self, event_id: str) -> StoredEvent | None:
        return next((e for e in self._committed if e.event_id == event_id), None)

    async def latest(self, event_type: str, actor_id: str, case_id: str) -> StoredEvent | None:
        return next(
            (
                e
                for e in reversed(self._committed)
                if e.event_type == event_type and e.actor_id == actor_id and e.case_id == case_id
            ),
            None,
        )

    def verify(self) -> None:
        """Appends never conflict on version (event ids are checked in ``append``)."""

    def apply(self) -> None:
        self._committed.extend(self._staged)
        self._staged.clear()

    def discard(self) -> None:
        self._staged.clear()


def _matches(event: StoredEvent, filters: AuditFilters) -> bool:
    """Same semantics as the SQL adapter (``AuditFilters``)."""
    ids = (event.event_id, event.entity_id, event.case_id or "", event.actor_id)
    return (
        (filters.actor_roles is None or event.actor_role in filters.actor_roles)
        and (filters.actor_id is None or event.actor_id == filters.actor_id)
        and (filters.case_id is None or event.case_id == filters.case_id)
        and (filters.event_types is None or event.event_type in filters.event_types)
        and event.event_type not in filters.exclude_event_types
        and (filters.occurred_from is None or event.event_time >= filters.occurred_from)
        and (filters.occurred_to is None or event.event_time < filters.occurred_to)
        and (not filters.text or any(filters.text.lower() in i.lower() for i in ids))
    )


# ----------------------------------------------------------------------------- people: availability
class InMemoryAnalystAvailabilityRepository(_StagedRepository[AnalystAvailability]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, AnalystAvailability], track: Tracker) -> None:
        super().__init__(committed, lambda availability: availability.staff_id, track)

    async def get(self, staff_id: str) -> AnalystAvailability | None:
        return await self._get(staff_id)

    async def list(self) -> list[AnalystAvailability]:
        return sorted(self._all(), key=lambda availability: availability.staff_id)


# ----------------------------------------------------------------------------- people: preferences
class InMemoryStaffPreferencesRepository(_StagedRepository[StaffPreferences]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, StaffPreferences], track: Tracker) -> None:
        super().__init__(committed, lambda preferences: preferences.staff_id, track)

    async def get(self, staff_id: str) -> StaffPreferences | None:
        return await self._get(staff_id)


# ----------------------------------------------------------------------------- cases
class InMemoryCaseRepository(_StagedRepository[Case]):
    def __init__(
        self,
        committed: dict[str, Case],
        track: Tracker,
        assignments: dict[str, Assignment] | None = None,
    ) -> None:
        super().__init__(committed, lambda case: case.id, track)
        self._assignments = assignments if assignments is not None else {}

    async def get(self, case_id: str) -> Case | None:
        return await self._get(case_id)

    async def get_many(self, case_ids: Collection[str]) -> dict[str, Case]:
        wanted = set(case_ids)
        return {case.id: case for case in self._tracked(c for c in self._all() if c.id in wanted)}

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

    async def list_closed_for_assignee(self, staff_id: str, closed_since: datetime) -> list[Case]:
        return self._tracked(
            case
            for case in self._all()
            if case.assigned_analyst_id == staff_id
            and case.status is CaseStatus.CLOSED
            and case.closed_at is not None
            and case.closed_at >= closed_since
        )

    async def list_by_status(self, status: CaseStatus) -> list[Case]:
        matching = [case for case in self._all() if case.status is status]
        return self._tracked(sorted(matching, key=lambda case: (case.opened_at, case.id)))

    async def list_by_statuses(self, statuses: Collection[CaseStatus]) -> list[Case]:
        return self._tracked(case for case in self._all() if case.status in statuses)

    async def refs(self, case_ids: Collection[str]) -> dict[str, CaseRef]:
        wanted = set(case_ids)
        return {
            case.id: CaseRef(customer_id=case.customer_id, language=case.language)
            for case in self._all()
            if case.id in wanted
        }

    async def list_for_customer(self, customer_id: str) -> list[Case]:
        mine = [case for case in self._all() if case.customer_id == customer_id]
        return self._tracked(sorted(mine, key=lambda case: (case.opened_at, case.id), reverse=True))

    async def exists_for_customer_and_assignee(self, customer_id: str, staff_id: str) -> bool:
        cases = self._all()
        if any(c.customer_id == customer_id and c.assigned_analyst_id == staff_id for c in cases):
            return True
        theirs = {c.id for c in cases if c.customer_id == customer_id}
        return any(
            a.staff_id == staff_id and a.case_id in theirs for a in self._assignments.values()
        )

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

    async def open_refs_by_assignee(
        self, staff_ids: Collection[str] | None = None
    ) -> dict[str, list[OpenCaseRef]]:
        wanted = set(staff_ids) if staff_ids is not None else None
        refs: dict[str, list[OpenCaseRef]] = {}
        for case in sorted(self._all(), key=lambda c: c.id):
            staff_id = case.assigned_analyst_id
            if staff_id is None or case.status not in OPEN_ASSIGNED_STATUSES:
                continue
            if wanted is not None and staff_id not in wanted:
                continue
            refs.setdefault(staff_id, []).append(
                OpenCaseRef(case_id=case.id, language=case.language)
            )
        return refs

    async def rating_totals_by_closer(self, closed_since: datetime) -> dict[str, RatingTotals]:
        totals: dict[str, RatingTotals] = {}
        for case in self._all():
            closure, rating = case.closure, case.rating
            if closure is None or rating is None or closure.closed_at < closed_since:
                continue
            current = totals.get(closure.closed_by_id, RatingTotals(count=0, score_sum=0))
            totals[closure.closed_by_id] = RatingTotals(
                count=current.count + 1, score_sum=current.score_sum + rating.score
            )
        return totals

    async def list_open_by_language(self, language: Language) -> list[Case]:
        return self._tracked(
            case
            for case in self._all()
            if case.language is language and case.status in OPEN_STATUSES
        )


class InMemoryEscalationRepository(_StagedRepository[Escalation]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, Escalation], track: Tracker) -> None:
        super().__init__(committed, lambda escalation: escalation.id, track)

    def _unique_violation(self, aggregate: Escalation, other: Escalation) -> DomainError | None:
        key = aggregate.creation_key
        if key is not None and other.creation_key == key:
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    def _tracked(self, escalations: Iterable[Escalation]) -> list[Escalation]:
        found = list(escalations)
        for escalation in found:
            self._track(escalation)
        return found

    async def get(self, escalation_id: str) -> Escalation | None:
        return await self._get(escalation_id)

    async def get_by_creation_key(self, key: str) -> Escalation | None:
        found = [e for e in self._all() if e.creation_key == key]
        return self._tracked(found)[0] if found else None

    async def latest_for_case(self, case_id: str) -> Escalation | None:
        mine = [e for e in self._all() if e.case_id == case_id]
        if not mine:
            return None
        latest = max(mine, key=lambda e: (e.escalated_at, e.id))
        self._track(latest)
        return latest

    async def list_open_or_resolved_since(self, resolved_since: datetime) -> list[Escalation]:
        return self._tracked(
            e
            for e in self._all()
            if e.state is EscalationState.OPEN
            or (e.resolved_at is not None and e.resolved_at >= resolved_since)
        )


class InMemoryCallRepository(_StagedRepository[Call]):
    """Slice 12. Same answers as ``SqlCallRepository``."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, Call], track: Tracker) -> None:
        super().__init__(committed, lambda call: call.id, track)

    def _unique_violation(self, aggregate: Call, other: Call) -> DomainError | None:
        key = aggregate.creation_key
        if key is not None and other.creation_key == key:
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    async def get(self, call_id: str) -> Call | None:
        return await self._get(call_id)

    async def get_by_creation_key(self, key: str) -> Call | None:
        found = [call for call in self._all() if call.creation_key == key]
        if not found:
            return None
        self._track(found[0])
        return found[0]

    async def list_for_case(self, case_id: str) -> list[Call]:
        mine = sorted(
            (call for call in self._all() if call.case_id == case_id),
            key=lambda call: (call.started_at, call.id),
            reverse=True,
        )
        for call in mine:
            self._track(call)
        return mine

    async def latest_for_case(self, case_id: str) -> Call | None:
        found = await self.list_for_case(case_id)
        return found[0] if found else None


class InMemoryNotificationRepository(_StagedRepository[Notification]):
    """Slice 10. Same answers as ``SqlNotificationRepository``; deletions (retention) are
    staged like writes and applied at commit."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, Notification], track: Tracker) -> None:
        super().__init__(committed, lambda notification: notification.id, track)
        self._deleted: set[str] = set()

    def _unique_violation(self, aggregate: Notification, other: Notification) -> DomainError | None:
        same = (aggregate.recipient_id, aggregate.source_key)
        if same == (other.recipient_id, other.source_key):
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    def _all(self) -> list[Notification]:
        return [item for item in super()._all() if item.id not in self._deleted]

    def _mine(self, recipient_id: str) -> list[Notification]:
        mine = [item for item in self._all() if item.recipient_id == recipient_id]
        return sorted(mine, key=lambda item: (item.created_at, item.id), reverse=True)

    async def get(self, notification_id: str) -> Notification | None:
        if notification_id in self._deleted:
            return None
        return await self._get(notification_id)

    async def recipients_with_key(
        self, source_key: str, recipient_ids: Collection[str]
    ) -> set[str]:
        wanted = set(recipient_ids)
        return {
            item.recipient_id
            for item in self._all()
            if item.source_key == source_key and item.recipient_id in wanted
        }

    async def page(
        self, recipient_id: str, *, before: NotificationCursor | None, limit: int
    ) -> list[Notification]:
        mine = self._mine(recipient_id)
        if before is not None:
            mark = (before.created_at, before.notification_id)
            mine = [item for item in mine if (item.created_at, item.id) < mark]
        found = mine[:limit]
        for item in found:
            self._track(item)
        return found

    async def unread_count(self, recipient_id: str) -> int:
        mine = (item for item in self._all() if item.recipient_id == recipient_id)
        return sum(1 for item in mine if item.is_unread)

    async def mark_all_read(self, recipient_id: str, *, at: datetime) -> int:
        updated = 0
        for item in self._all():
            if item.recipient_id != recipient_id or not item.is_unread:
                continue
            item.mark_read(at=at)
            await self.save(item)
            updated += 1
        return updated

    async def prune(self, recipient_id: str, *, keep: int) -> set[str]:
        stale = {item.id for item in self._mine(recipient_id)[keep:]}
        for key in stale:
            self._staged.pop(key, None)
            if key in self._committed:
                self._deleted.add(key)
            else:
                self._base_versions.pop(key, None)
        return stale

    def apply(self) -> None:
        for key in self._deleted:
            self._committed.pop(key, None)
        super().apply()

    def discard(self) -> None:
        self._deleted.clear()
        super().discard()


class InMemoryCustomerCaseSlotRepository(_StagedRepository[CustomerCaseSlot]):
    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, CustomerCaseSlot], track: Tracker) -> None:
        super().__init__(committed, lambda slot: slot.customer_id, track)

    async def get(self, customer_id: str) -> CustomerCaseSlot | None:
        return await self._get(customer_id)


class InMemoryAssistantSessionRepository(_StagedRepository[AssistantSession]):
    """ADR 0003. Same answers as ``SqlAssistantSessionRepository`` (one session per case)."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, AssistantSession], track: Tracker) -> None:
        super().__init__(committed, lambda session: session.id, track)

    def _unique_violation(
        self, aggregate: AssistantSession, other: AssistantSession
    ) -> DomainError | None:
        if aggregate.case_id == other.case_id:
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    async def get(self, session_id: str) -> AssistantSession | None:
        return await self._get(session_id)

    async def get_by_case(self, case_id: str) -> AssistantSession | None:
        found = [session for session in self._all() if session.case_id == case_id]
        if not found:
            return None
        return await self._get(found[0].id)

    async def list_active(self) -> list[AssistantSession]:
        mine = sorted((s for s in self._all() if s.is_active), key=lambda s: (s.created_at, s.id))
        for session in mine:
            self._track(session)
        return mine


class InMemoryCopilotThreadRepository(_StagedRepository[CopilotThread]):
    """ADR 0003. Same answers as ``SqlCopilotThreadRepository`` (a thread per case and analyst)."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, CopilotThread], track: Tracker) -> None:
        super().__init__(committed, lambda thread: thread.id, track)

    def _unique_violation(
        self, aggregate: CopilotThread, other: CopilotThread
    ) -> DomainError | None:
        if (aggregate.case_id, aggregate.analyst_id) == (other.case_id, other.analyst_id):
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    async def get_for(self, case_id: str, analyst_id: str) -> CopilotThread | None:
        found = [t for t in self._all() if (t.case_id, t.analyst_id) == (case_id, analyst_id)]
        return await self._get(found[0].id) if found else None


class InMemoryCaseTypeMaturityRepository(_StagedRepository[CaseTypeMaturity]):
    """Slice 21. Same answers as ``SqlCaseTypeMaturityRepository`` (one per case type)."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, CaseTypeMaturity], track: Tracker) -> None:
        super().__init__(committed, lambda maturity: maturity.case_type.value, track)

    async def get(self, case_type: str) -> CaseTypeMaturity | None:
        return await self._get(str(case_type))

    async def list(self) -> list[CaseTypeMaturity]:
        found = sorted(self._all(), key=lambda maturity: maturity.case_type.value)
        return [m for m in [await self._get(m.case_type.value) for m in found] if m is not None]


class InMemoryCopilotSuggestionRepository(_StagedRepository[CopilotSuggestion]):
    """ADR 0005. Same answers as ``SqlCopilotSuggestionRepository``."""

    def __init__(self, committed: dict[str, CopilotSuggestion], track: Tracker) -> None:
        super().__init__(committed, lambda suggestion: suggestion.id, track)

    def _unique_violation(
        self, aggregate: CopilotSuggestion, other: CopilotSuggestion
    ) -> DomainError | None:
        if aggregate.request_key is not None and (
            aggregate.case_id,
            aggregate.analyst_id,
            aggregate.request_key,
        ) == (other.case_id, other.analyst_id, other.request_key):
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    async def get(self, suggestion_id: str) -> CopilotSuggestion | None:
        return await self._get(suggestion_id)

    async def get_by_request_key(
        self, case_id: str, analyst_id: str, request_key: str
    ) -> CopilotSuggestion | None:
        found = [
            s
            for s in self._all()
            if (s.case_id, s.analyst_id, s.request_key) == (case_id, analyst_id, request_key)
        ]
        return await self._get(found[0].id) if found else None

    async def latest_for(self, case_id: str, analyst_id: str) -> CopilotSuggestion | None:
        mine = [s for s in self._all() if (s.case_id, s.analyst_id) == (case_id, analyst_id)]
        if not mine:
            return None
        newest = max(mine, key=lambda s: (s.created_at, s.id))
        return await self._get(newest.id)

    async def list_expired(
        self, *, created_before: datetime, limit: int
    ) -> list[CopilotSuggestion]:
        due = sorted(
            (
                s
                for s in self._all()
                if s.status is SuggestionStatus.READY
                and s.purged_at is None
                and s.created_at <= created_before
            ),
            key=lambda s: (s.created_at, s.id),
        )[:limit]
        for suggestion in due:
            self._track(suggestion)
        return due


class InMemoryBuilderThreadRepository(_StagedRepository[BuilderThread]):
    """ADR 0003 (slice 16). Same answers as ``SqlBuilderThreadRepository`` (a thread per person)."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, BuilderThread], track: Tracker) -> None:
        super().__init__(committed, lambda thread: thread.id, track)

    def _unique_violation(
        self, aggregate: BuilderThread, other: BuilderThread
    ) -> DomainError | None:
        if aggregate.staff_id == other.staff_id:
            return ConcurrentUpdateError(id=aggregate.id)
        return None

    async def get_for(self, staff_id: str) -> BuilderThread | None:
        found = [t for t in self._all() if t.staff_id == staff_id]
        return await self._get(found[0].id) if found else None


class InMemoryBuilderProposalRepository(_StagedRepository[BuilderProposal]):
    """ADR 0003 (slice 16): the index of agent-core's proposals."""

    insert_race_is_retryable = True

    def __init__(self, committed: dict[str, BuilderProposal], track: Tracker) -> None:
        super().__init__(committed, lambda proposal: proposal.id, track)

    async def get(self, proposal_id: str) -> BuilderProposal | None:
        return await self._get(proposal_id)

    async def search(
        self, *, agent_id: str | None = None, state: str | None = None, limit: int = 50
    ) -> list[BuilderProposal]:
        found = [
            p
            for p in self._all()
            if (agent_id is None or p.agent_id == agent_id) and (state is None or p.state == state)
        ]
        found.sort(key=lambda p: (p.updated_at, p.id), reverse=True)
        result = []
        for proposal in found[:limit]:
            loaded = await self._get(proposal.id)
            if loaded is not None:
                result.append(loaded)
        return result


class InMemoryBankCustomerLinks:
    """ADR 0003: platform customer → dataset customer. Staged like a write, applied at commit."""

    def __init__(self, committed: dict[str, str]) -> None:
        self._committed = committed
        self._staged: dict[str, str] = {}

    async def get(self, customer_id: str) -> str | None:
        return self._staged.get(customer_id) or self._committed.get(customer_id)

    async def set_many(self, links: Mapping[str, str]) -> int:
        changed = 0
        for customer_id, bank_customer_id in links.items():
            if await self.get(customer_id) != bank_customer_id:
                self._staged[customer_id] = bank_customer_id
                changed += 1
        return changed

    def verify(self) -> None:
        return None

    def apply(self) -> None:
        self._committed.update(self._staged)
        self.discard()

    def discard(self) -> None:
        self._staged.clear()


class _AppendOnlyRepository[E]:
    """Immutable rows (turns, assignments): add only, checked at commit."""

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

    async def list_of_kind(self, case_id: str, kind: TurnKind, *, limit: int) -> list[Turn]:
        turns = sorted(
            (t for t in self._all() if t.case_id == case_id and t.kind is kind),
            key=lambda turn: turn.sequence,
        )
        return turns[:limit]

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


# ----------------------------------------------------------------------------- analyst home
class InMemoryAnalystHomeReader:
    """Same answers as ``SqlAnalystHomeReader``, over the committed store (read-only)."""

    def __init__(
        self,
        sessions: dict[str, StaffSession],
        cases: dict[str, Case],
        assignments: dict[str, Assignment],
        events: list[StoredEvent],
    ) -> None:
        self._sessions = sessions
        self._cases = cases
        self._assignments = assignments
        self._events = events

    async def previous_session_end(
        self, staff_id: str, *, current_session_id: str, now: datetime
    ) -> datetime | None:
        ends = [
            session.ended_at or session.expires_at
            for session in self._sessions.values()
            if session.staff_id == staff_id
            and session.id != current_session_id
            and (session.ended_at is not None or session.expires_at <= now)
        ]
        return max(ends, default=None)

    async def touched_case_ids(self, staff_id: str, since: datetime) -> set[str]:
        held = {
            case.id
            for case in self._cases.values()
            if case.assigned_analyst_id == staff_id
            and (
                case.status in OPEN_ASSIGNED_STATUSES
                or (case.closed_at is not None and case.closed_at > since)
            )
        }
        moved = {
            a.case_id
            for a in self._assignments.values()
            if a.assigned_at > since and staff_id in (a.staff_id, a.previous_staff_id)
        }
        return held | moved

    async def case_events(
        self, case_ids: Collection[str], *, since: datetime, event_types: Collection[str]
    ) -> list[StoredEvent]:
        wanted, types = set(case_ids), set(event_types)
        return [
            event
            for event in self._events
            if event.case_id in wanted and event.event_time > since and event.event_type in types
        ]

    async def customer_cases(
        self, customer_ids: Collection[str]
    ) -> dict[str, list[CustomerCaseFact]]:
        wanted = set(customer_ids)
        facts: dict[str, list[CustomerCaseFact]] = {}
        for case in self._cases.values():
            if case.customer_id in wanted:
                facts.setdefault(case.customer_id, []).append(
                    CustomerCaseFact(
                        case_id=case.id,
                        opened_at=case.opened_at,
                        close_reason=case.closure.reason if case.closure else None,
                    )
                )
        return facts
