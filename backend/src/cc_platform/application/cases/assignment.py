"""Assignment: who gets a case (slice 2 contract §3; brief §4.6, the only "routing" there is).

- ``AssignmentStrategy`` (Strategy port) picks an analyst among the available candidates.
  ``LanguageLeastLoadedStrategy`` implements rule 3 (``H1``): keep the available analysts
  who speak the case language (a Portuguese case goes only to a Portuguese speaker), then
  the fewest open cases, then the longest since her last assignment, then the staff id.
- ``AssignCase`` places one case **inside the caller's Unit of Work** (it never commits):
  it assigns it with a staff-only banner, or announces once that it waits in the language
  queue. Two callers: ``PostCustomerTurn`` (same Unit of Work as the open, so the POST
  answer already says ``with_agent`` or ``waiting_agent``) and ``DrainQueue``.
- ``DrainQueue`` assigns queued cases, oldest first, one Unit of Work each.
- ``QueueDrainer`` (process manager) runs ``DrainQueue`` in the background whenever an
  analyst becomes available.

Known limits (accepted, documented in the contract): two cases opened at the same instant
may both pick the same least-loaded analyst; an analyst who pauses at that instant may
still get one case; a new case may be assigned while an older one of **another** language
waits (each language queue is first in, first out: a new arrival never jumps older cases of
its own language). No capacity cap yet (seam: ``max_open_cases``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from functools import partial
from typing import Protocol

from cc_platform.application.cases import copy
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import (
    LANGUAGE_RULE_ID,
    OPEN_ASSIGNED_STATUSES,
    AssignmentReason,
    CaseStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.events import StaffAvailabilityChanged, StaffLanguagesChanged
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.ids import IdPrefix

RULE_PORTUGUESE_SPEAKER = LANGUAGE_RULE_ID
REASON_NO_ANALYST = "no_available_analyst"
#: Reasons that place a case like a new arrival: it never jumps its language queue (ADR 0003:
#: a case the assistant hands over arrives like any other).
_ARRIVAL_REASONS = frozenset(
    {AssignmentReason.LANGUAGE_LEAST_LOADED, AssignmentReason.ASSISTANT_HANDOFF}
)
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


# ----------------------------------------------------------------------------- strategy
@dataclass(frozen=True, slots=True)
class AnalystCandidate:
    staff_id: str
    name: str
    languages: frozenset[Language]
    open_case_count: int
    last_assigned_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class AssignmentRequest:
    case_id: str
    language: Language


@dataclass(frozen=True, slots=True)
class AssignmentChoice:
    candidate: AnalystCandidate
    policy_rule_id: str | None
    strategy: str


class AssignmentStrategy(Protocol):
    def choose(
        self, request: AssignmentRequest, candidates: Sequence[AnalystCandidate]
    ) -> AssignmentChoice | None:
        """Pick an analyst among available ``candidates``; ``None`` → the case waits."""
        ...


def language_rule(language: Language) -> str | None:
    """Policy rule behind a language-driven decision (rule 3 → ``H1`` for Portuguese)."""
    return RULE_PORTUGUESE_SPEAKER if language is Language.PORTUGUESE else None


@dataclass(frozen=True, slots=True)
class LanguageLeastLoadedStrategy:
    strategy: str = "language_least_loaded@1"

    def choose(
        self, request: AssignmentRequest, candidates: Sequence[AnalystCandidate]
    ) -> AssignmentChoice | None:
        eligible = [c for c in candidates if request.language in c.languages]
        if not eligible:
            return None
        chosen = min(
            eligible,
            key=lambda c: (c.open_case_count, c.last_assigned_at or _EPOCH, c.staff_id),
        )
        return AssignmentChoice(
            candidate=chosen, policy_rule_id=language_rule(request.language), strategy=self.strategy
        )


class AnalystDirectory(Protocol):
    async def candidates(self, uow: UnitOfWork) -> list[AnalystCandidate]:
        """Active analysts who are ``available`` right now, with their current load."""
        ...


@dataclass(frozen=True, slots=True)
class RepositoryAnalystDirectory:
    """``AnalystDirectory`` over the staff, availability and case repositories (read in the
    same Unit of Work as the assignment, so a retry sees fresh loads)."""

    async def candidates(self, uow: UnitOfWork) -> list[AnalystCandidate]:
        analysts = await uow.staff.list(role=StaffRole.ANALYST)
        available = {a.staff_id for a in await uow.availability.list() if a.is_available}
        loads = await uow.cases.assignee_loads(OPEN_ASSIGNED_STATUSES)
        candidates: list[AnalystCandidate] = []
        for analyst in analysts:
            if not analyst.active or analyst.id not in available:
                continue
            load = loads.get(analyst.id)
            candidates.append(
                AnalystCandidate(
                    staff_id=analyst.id,
                    name=analyst.name,
                    languages=analyst.languages,
                    open_case_count=load.open_cases if load else 0,
                    last_assigned_at=load.last_assigned_at if load else None,
                )
            )
        return candidates


# ----------------------------------------------------------------------------- use cases
@dataclass(frozen=True, slots=True)
class AssignCase:
    """Place one ``queued`` case: assign it, or announce once that it waits in the queue."""

    clock: Clock
    ids: IdGenerator
    strategy: AssignmentStrategy
    directory: AnalystDirectory

    async def place(self, uow: UnitOfWork, case: Case, *, reason: AssignmentReason) -> bool:
        """Runs in the caller's Unit of Work and never commits. ``case`` must already be
        stored in it (added or loaded); ``place`` saves it. True when assigned.

        A new arrival (``language_least_loaded``) never jumps its language queue: older
        cases of that language waiting there are assigned first (``queue_drained``, same
        Unit of Work), so the queue stays first in, first out (brief §4.3)."""
        candidates = await self.directory.candidates(uow)
        if reason in _ARRIVAL_REASONS:
            candidates = await self._serve_queue_first(uow, case, candidates)
        return await self._place(uow, case, reason, candidates) is not None

    async def _serve_queue_first(
        self, uow: UnitOfWork, case: Case, candidates: list[AnalystCandidate]
    ) -> list[AnalystCandidate]:
        """Assign the cases already waiting in ``case``'s language queue, oldest first.

        Normally empty: the queue drains as soon as an eligible analyst becomes available
        (``QueueDrainer``). It matters when a new case races that background drain. Loads
        are updated locally after each pick, so the least-loaded choice stays fair within
        this Unit of Work; a drain committing first makes this commit retry on fresh state.
        """
        if not any(case.language in c.languages for c in candidates):
            return candidates  # nobody eligible: the new case queues behind them anyway
        waiting = [
            older
            for older in await uow.cases.list_by_status(CaseStatus.QUEUED)
            if older.id != case.id and older.language is case.language and older.is_waiting_in_queue
        ]
        for older in waiting:
            if await self._place(uow, older, AssignmentReason.QUEUE_DRAINED, candidates) is None:
                break
        return candidates

    async def _place(
        self,
        uow: UnitOfWork,
        case: Case,
        reason: AssignmentReason,
        candidates: list[AnalystCandidate],
    ) -> AnalystCandidate | None:
        """Assign ``case`` (and update the chosen candidate's load in ``candidates``) or
        queue it; returns the chosen candidate, ``None`` when it waits."""
        now = self.clock.now()
        choice = self.strategy.choose(AssignmentRequest(case.id, case.language), candidates)
        if choice is None:
            if case.is_waiting_in_queue:
                return None  # a drain that still finds nobody changes nothing
            label = copy.QUEUE_LABEL[case.language]
            case.mark_waiting_in_queue(
                label=label,
                reason_code=REASON_NO_ANALYST,
                policy_rule_id=language_rule(case.language),
                at=now,
            )
            await self._banner(uow, case, copy.queued(case.language, label), now)
            return None

        waited: int | None = None
        if reason is AssignmentReason.QUEUE_DRAINED and case.queued_at is not None:
            waited = max(0, int((now - case.queued_at).total_seconds()))
        chosen = choice.candidate
        assignment = Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=case.id,
            staff_id=chosen.staff_id,
            reason=reason,
            policy_rule_id=choice.policy_rule_id,
            open_cases_at_assignment=chosen.open_case_count,
            strategy=choice.strategy,
            assigned_at=now,
            assigned_by=ActorRef.system(),
            waited_seconds=waited,
        )
        case.assign(assignment)
        await uow.assignments.add(assignment)
        if waited is not None:
            label = case.queue_label or copy.QUEUE_LABEL[case.language]
            text = copy.assigned_from_queue(chosen.name, copy.queue_wait_minutes(waited), label)
        elif reason is AssignmentReason.ASSISTANT_HANDOFF:
            text = copy.assigned_from_assistant(chosen.name, case.language)
        else:
            text = copy.assigned_on_arrival(chosen.name, case.language)
        await self._banner(uow, case, text, now)
        candidates[candidates.index(chosen)] = replace(
            chosen, open_case_count=chosen.open_case_count + 1, last_assigned_at=now
        )
        return chosen

    async def _banner(self, uow: UnitOfWork, case: Case, text: str, now: datetime) -> None:
        turn = case.append_turn(
            turn_id=self.ids.new_id(IdPrefix.TURN),
            kind=TurnKind.ROUTING,
            audience=TurnAudience.STAFF,
            author_role=TurnAuthorRole.SYSTEM,
            author_id=None,
            text=text,
            created_at=now,
        )
        await uow.cases.save(case)
        await uow.turns.add(turn)


@dataclass(frozen=True, slots=True)
class DrainQueue:
    uow: UnitOfWorkFactory
    assign_case: AssignCase

    async def execute(self) -> int:
        """Assign what can be assigned now, oldest first; returns how many left the queue."""
        async with self.uow() as uow:
            queued = [case.id for case in await uow.cases.list_by_status(CaseStatus.QUEUED)]
        assigned = 0
        for case_id in queued:
            if await retry_on_conflict(partial(self._drain_one, case_id)):
                assigned += 1
        return assigned

    async def _drain_one(self, case_id: str) -> bool:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            if case is None or case.status is not CaseStatus.QUEUED:
                return False
            placed = await self.assign_case.place(uow, case, reason=AssignmentReason.QUEUE_DRAINED)
            if placed:
                await uow.commit()
            return placed


#: Events ``QueueDrainer`` subscribes to.
QUEUE_DRAINER_EVENTS: tuple[type[DomainEvent], ...] = (
    StaffAvailabilityChanged,
    StaffLanguagesChanged,
)


class QueueDrainer:
    """Process manager: an analyst became ``available``, or administration gave someone new
    languages (slice 4 §3.2) → drain the queue in the background.

    The job is idempotent (each case is re-read and skipped if it already left the queue),
    so a duplicate event or two analysts becoming available at once is harmless. After a
    languages change it only assigns when that person is an active, available analyst
    (``RepositoryAnalystDirectory``), so a paused one changes nothing.
    """

    def __init__(self, tasks: BackgroundTasks, drain_queue: DrainQueue) -> None:
        self._tasks = tasks
        self._drain_queue = drain_queue

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        became_available = (
            isinstance(event, StaffAvailabilityChanged)
            and event.to_status == AvailabilityStatus.AVAILABLE.value
        )
        speaks_more = isinstance(event, StaffLanguagesChanged) and bool(event.added)
        if became_available or speaks_more:
            self._tasks.spawn("drain_queue", self._drain_queue.execute)
