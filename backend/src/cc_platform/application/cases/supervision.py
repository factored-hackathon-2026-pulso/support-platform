"""Supervision read models (slice 3 contract §2): "Equipo y colas".

- ``GetTeamOverview``: the analysts (active staff holding ``analyst``), grouped by team,
  with what each one is doing **now** (``AnalystActivity``, derived, never stored), her load
  by inbox status, the longest customer wait and her open cases as ``CaseSummary`` rows.
- ``GetQueueOverview``: one queue per language (always both), its cases oldest first (the
  drain order), the oldest wait and how many analysts could take them.

Everything is read through one Unit of Work and ``CaseReader`` (so every case row is the
slice 2 ``CaseSummary``), with a fixed number of queries whatever the team size: staff,
availability, active sessions, the open (or queued) cases and their customers' names.

"At SLA risk" depends on the time, so it is never stored: the backend computes it at
``serverTime`` for API consumers (``TeamSummary.atRiskCases``, ``LanguageQueue.atRisk``)
and the UI recomputes it from the rows with its own ticking clock.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.application.cases import copy
from cc_platform.application.cases.dto import CaseSummaryView
from cc_platform.application.cases.read_model import CaseReader, inbox_order
from cc_platform.application.people.dto import TeamRefView
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases.case import search_key
from cc_platform.domain.cases.values import OPEN_ASSIGNED_STATUSES, CaseStatus, InboxStatus
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.names import fold
from cc_platform.domain.people.staff import Language, Staff, StaffRole, canonical_roles
from cc_platform.domain.people.team import Team

#: Team-generated: a pending first response is "at risk" 5 minutes before ``slaDueAt``
#: (overdue included). The frontend keeps the same value (``SLA_AT_RISK_MS``).
SLA_AT_RISK = timedelta(minutes=5)

#: Queues are global, one per language, always listed in this order.
QUEUE_LANGUAGES: tuple[Language, ...] = (Language.SPANISH, Language.PORTUGUESE)


class AnalystActivity(StrEnum):
    """What an analyst is doing now ("Ahora"), derived from availability, sessions and load.

    ``busy`` "Atendiendo" · ``available`` "Disponible" · ``paused`` "En pausa" ·
    ``offline`` "Desconectada" (paused and not signed in).
    """

    BUSY = "busy"
    AVAILABLE = "available"
    PAUSED = "paused"
    OFFLINE = "offline"


_ACTIVITY_ORDER: dict[AnalystActivity, int] = {a: i for i, a in enumerate(AnalystActivity)}


def activity_of(
    availability: AvailabilityStatus, *, signed_in: bool, open_cases: int
) -> AnalystActivity:
    """Contract §2.2. An available analyst without a session is **not** offline: cases keep
    landing on her (no presence yet), so she is busy or available."""
    if availability is AvailabilityStatus.AVAILABLE:
        return AnalystActivity.BUSY if open_cases > 0 else AnalystActivity.AVAILABLE
    return AnalystActivity.PAUSED if signed_in else AnalystActivity.OFFLINE


def at_sla_risk(summary: CaseSummaryView, now: datetime) -> bool:
    """First response pending, case not closed, and due in 5 minutes or less (or overdue)."""
    return (
        summary.first_response_at is None
        and summary.status is not CaseStatus.CLOSED
        and summary.sla_due_at - now <= SLA_AT_RISK
    )


# ----------------------------------------------------------------------------- views
@dataclass(frozen=True, slots=True)
class ActivityCountsView:
    busy: int
    available: int
    paused: int
    offline: int


@dataclass(frozen=True, slots=True)
class TeamSummaryView:
    id: str
    name: str
    analyst_count: int
    activity: ActivityCountsView
    open_cases: int
    at_risk_cases: int


@dataclass(frozen=True, slots=True)
class AnalystCaseCountsView:
    open: int
    new: int
    to_reply: int
    waiting: int


@dataclass(frozen=True, slots=True)
class TeamAnalystView:
    id: str
    name: str
    team: TeamRefView
    languages: tuple[Language, ...]
    roles: tuple[StaffRole, ...]
    availability: AvailabilityStatus
    availability_since: datetime | None
    signed_in: bool
    activity: AnalystActivity
    counts: AnalystCaseCountsView
    oldest_waiting_since: datetime | None
    open_cases: tuple[CaseSummaryView, ...]


@dataclass(frozen=True, slots=True)
class TeamOverviewView:
    teams: tuple[TeamSummaryView, ...]
    analysts: tuple[TeamAnalystView, ...]
    server_time: datetime


@dataclass(frozen=True, slots=True)
class QueueCountView:
    language: Language
    waiting: int
    oldest_queued_at: datetime | None


@dataclass(frozen=True, slots=True)
class QueueCountsView:
    total: int
    by_language: tuple[QueueCountView, ...]
    computed_at: datetime


@dataclass(frozen=True, slots=True)
class LanguageQueueView:
    language: Language
    label: str
    waiting: int
    oldest_queued_at: datetime | None
    at_risk: int
    available_speakers: int
    speakers: int
    cases: tuple[CaseSummaryView, ...]


@dataclass(frozen=True, slots=True)
class QueueOverviewView:
    queues: tuple[LanguageQueueView, ...]
    counts: QueueCountsView
    server_time: datetime


# ----------------------------------------------------------------------------- helpers
def _ordered_roles(staff: Staff) -> tuple[StaffRole, ...]:
    return canonical_roles(staff.roles)


def _case_counts(cases: Sequence[CaseSummaryView]) -> AnalystCaseCountsView:
    statuses = [case.inbox_status for case in cases]
    return AnalystCaseCountsView(
        open=len(cases),
        new=statuses.count(InboxStatus.NEW),
        to_reply=statuses.count(InboxStatus.TO_REPLY),
        waiting=statuses.count(InboxStatus.WAITING),
    )


def _oldest_waiting(cases: Iterable[CaseSummaryView]) -> datetime | None:
    """The customer waits for her when the case is Nuevo or Por responder."""
    waits = [
        case.last_interaction_at
        for case in cases
        if case.inbox_status in (InboxStatus.NEW, InboxStatus.TO_REPLY)
    ]
    return min(waits, default=None)


def _queued_since(summary: CaseSummaryView) -> datetime:
    # ``queued_at`` = ``opened_at`` for every case (slice 2 §2.2).
    return summary.opened_at


async def active_analysts(uow: UnitOfWork) -> list[Staff]:
    return [s for s in await uow.staff.list(role=StaffRole.ANALYST) if s.active]


async def queued_summaries(uow: UnitOfWork, reader: CaseReader) -> list[CaseSummaryView]:
    """Every queued case, oldest ``openedAt`` first (the drain order)."""
    return await reader.summaries(await uow.cases.list_by_status(CaseStatus.QUEUED))


def count_queues(queued: Sequence[CaseSummaryView], computed_at: datetime) -> QueueCountsView:
    by_language = []
    for language in QUEUE_LANGUAGES:
        mine = [case for case in queued if case.language is language]
        by_language.append(
            QueueCountView(
                language=language,
                waiting=len(mine),
                oldest_queued_at=min((_queued_since(c) for c in mine), default=None),
            )
        )
    return QueueCountsView(
        total=len(queued), by_language=tuple(by_language), computed_at=computed_at
    )


async def queue_counts(uow: UnitOfWork, now: datetime) -> QueueCountsView:
    """``QueueCounts`` now (the ``queue.updated`` payload and the rail badge)."""
    return count_queues(await queued_summaries(uow, CaseReader(uow)), now)


# ----------------------------------------------------------------------------- queries
@dataclass(frozen=True, slots=True)
class GetTeamOverview:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self) -> TeamOverviewView:
        now = self.clock.now()
        async with self.uow() as uow:
            analysts = await active_analysts(uow)
            teams = await uow.teams.get_many({analyst.team_id for analyst in analysts})
            availability = {a.staff_id: a for a in await uow.availability.list()}
            signed_in = await uow.sessions.active_staff_ids(now)
            reader = CaseReader(uow)
            open_cases = await reader.summaries(
                await uow.cases.list_by_statuses(OPEN_ASSIGNED_STATUSES)
            )
        by_analyst: dict[str, list[CaseSummaryView]] = defaultdict(list)
        for summary in open_cases:
            if summary.assigned_analyst_id is not None:
                by_analyst[summary.assigned_analyst_id].append(summary)

        rows = [
            self._row(
                analyst,
                _team_ref(teams, analyst.team_id),
                availability.get(analyst.id),
                signed_in=analyst.id in signed_in,
                cases=sorted(by_analyst.get(analyst.id, []), key=inbox_order),
            )
            for analyst in analysts
        ]
        rows.sort(key=lambda r: (_ACTIVITY_ORDER[r.activity], search_key(r.name), r.id))
        active_team_ids = {team.id for team in teams.values() if team.active}
        return TeamOverviewView(
            teams=_teams(rows, now, active_team_ids), analysts=tuple(rows), server_time=now
        )

    @staticmethod
    def _row(
        analyst: Staff,
        team: TeamRefView,
        availability: AnalystAvailability | None,
        *,
        signed_in: bool,
        cases: list[CaseSummaryView],
    ) -> TeamAnalystView:
        # A missing availability row means paused (slice 1 rule).
        status = availability.status if availability else AvailabilityStatus.PAUSED
        return TeamAnalystView(
            id=analyst.id,
            name=analyst.name,
            team=team,
            languages=tuple(sorted(analyst.languages)),
            roles=_ordered_roles(analyst),
            availability=status,
            availability_since=availability.since if availability else None,
            signed_in=signed_in,
            activity=activity_of(status, signed_in=signed_in, open_cases=len(cases)),
            counts=_case_counts(cases),
            oldest_waiting_since=_oldest_waiting(cases),
            open_cases=tuple(cases),
        )


def _team_ref(teams: dict[str, Team], team_id: str) -> TeamRefView:
    team = teams.get(team_id)
    # Every staff row references a team (foreign key); the fallback only guards a gap.
    return TeamRefView.of(team) if team is not None else TeamRefView(id=team_id, name=team_id)


def _teams(
    rows: Sequence[TeamAnalystView], now: datetime, active_team_ids: set[str]
) -> tuple[TeamSummaryView, ...]:
    """The active teams with at least one active analyst, by name (slice 4 §6)."""
    members: dict[str, list[TeamAnalystView]] = defaultdict(list)
    refs: dict[str, TeamRefView] = {}
    for row in rows:
        if row.team.id in active_team_ids:
            members[row.team.id].append(row)
            refs[row.team.id] = row.team
    teams = []
    for team_id in sorted(members, key=lambda i: (fold(refs[i].name), refs[i].name, i)):
        team = members[team_id]
        activities = [row.activity for row in team]
        cases = [case for row in team for case in row.open_cases]
        teams.append(
            TeamSummaryView(
                id=team_id,
                name=refs[team_id].name,
                analyst_count=len(team),
                activity=ActivityCountsView(
                    busy=activities.count(AnalystActivity.BUSY),
                    available=activities.count(AnalystActivity.AVAILABLE),
                    paused=activities.count(AnalystActivity.PAUSED),
                    offline=activities.count(AnalystActivity.OFFLINE),
                ),
                open_cases=len(cases),
                at_risk_cases=sum(at_sla_risk(case, now) for case in cases),
            )
        )
    return tuple(teams)


@dataclass(frozen=True, slots=True)
class GetQueueOverview:
    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self) -> QueueOverviewView:
        now = self.clock.now()
        async with self.uow() as uow:
            queued = await queued_summaries(uow, CaseReader(uow))
            analysts = await active_analysts(uow)
            available = {a.staff_id for a in await uow.availability.list() if a.is_available}
        queues = []
        for language in QUEUE_LANGUAGES:
            mine = tuple(case for case in queued if case.language is language)
            speakers = [a for a in analysts if a.speaks(language)]
            queues.append(
                LanguageQueueView(
                    language=language,
                    label=copy.QUEUE_LABEL[language],
                    waiting=len(mine),
                    oldest_queued_at=min((_queued_since(c) for c in mine), default=None),
                    at_risk=sum(at_sla_risk(case, now) for case in mine),
                    available_speakers=sum(a.id in available for a in speakers),
                    speakers=len(speakers),
                    cases=mine,
                )
            )
        return QueueOverviewView(
            queues=tuple(queues), counts=count_queues(queued, now), server_time=now
        )
