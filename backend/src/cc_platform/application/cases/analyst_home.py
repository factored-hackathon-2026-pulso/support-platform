"""The analyst home, "Inicio" (slice 6 contract ``docs/platform/api/slice-6-analyst-home.md``).

``GetAnalystHome`` is a CQRS-lite read query: one Unit of Work, the ``AnalystHomeReader``
port (SQL and in-memory adapters) plus a few existing repositories, a fixed number of
queries whatever her history, and nothing written.

It answers three things:

- ``since``: when her previous session ended (the latest ended or expired session other
  than the current one). Without one (first sign-in) it falls back to ``now − 8 h`` and
  says so (``since_source = fallback``).
- "Mientras no estabas": **deterministic** activity rows built from event-log facts
  (``case.assigned``, ``case.opened``, ``turn.created``) after ``since``. Rows are typed and
  structured (kind, names, numbers); the frontend owns every Spanish word. No summary, no
  ranking, no AI: the same log always yields the same rows (``project_activity``).
- "Tu equipo ahora": how many analysts of her team are available (counts only, no names)
  and, per language she speaks, how many cases wait in that queue and since when.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.application.cases.ports import CustomerCaseFact
from cc_platform.application.cases.read_model import UNKNOWN_CUSTOMER, inbox_status
from cc_platform.application.cases.supervision import QUEUE_LANGUAGES, queue_counts
from cc_platform.application.events import StoredEvent
from cc_platform.application.platform.settings import AiSwitch
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.ai.events import AssistantEnded
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.events import CaseAssigned, CaseOpened, TurnCreated
from cc_platform.domain.cases.values import (
    CONVERSATION_KINDS,
    AssignmentReason,
    CaseStatus,
    CloseReason,
    InboxStatus,
    TurnAudience,
    TurnAuthorRole,
)
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.errors import NotFoundError

#: Without a previous session, "Mientras no estabas" covers this much (one shift, team-generated).
FALLBACK_LOOKBACK = timedelta(hours=8)
#: Rows returned at most (``total`` counts them all).
MAX_ACTIVITY_ITEMS = 10

#: The event-log types the feed reads.
FEED_EVENT_TYPES: frozenset[str] = frozenset(
    {CaseAssigned.event_type, CaseOpened.event_type, TurnCreated.event_type}
)


class SinceSource(StrEnum):
    """Where ``since`` comes from: her previous session's end, or the 8-hour fallback."""

    PREVIOUS_SESSION = "previous_session"
    FALLBACK = "fallback"


class HomeActivityKind(StrEnum):
    """One row kind of "Mientras no estabas" (each has one fixed template in the frontend).

    - ``assigned_on_arrival``: a new case went to her on arrival (rule 3, least loaded).
    - ``assigned_from_queue``: a queued case went to her when she became available.
    - ``assigned_by_supervisor``: a supervisor assigned it to her (from the queue or another
      analyst).
    - ``reassigned_away``: a supervisor gave one of her cases to someone else (read-only now).
    - ``customer_returned``: the case continues a closed one of the same customer (it
      replaces the arrival row of that case).
    - ``customer_messages``: the customer wrote in one of her cases (one row per case).
    - ``assigned_by_assistant``: the assistant (ADR 0003) handed the case over and it went to her
      (slice 21; before it, such an assignment had no row).
    """

    ASSIGNED_ON_ARRIVAL = "assigned_on_arrival"
    ASSIGNED_FROM_QUEUE = "assigned_from_queue"
    ASSIGNED_BY_SUPERVISOR = "assigned_by_supervisor"
    REASSIGNED_AWAY = "reassigned_away"
    CUSTOMER_RETURNED = "customer_returned"
    CUSTOMER_MESSAGES = "customer_messages"
    ASSIGNED_BY_ASSISTANT = "assigned_by_assistant"


_ASSIGNED_KIND: dict[AssignmentReason, HomeActivityKind] = {
    AssignmentReason.LANGUAGE_LEAST_LOADED: HomeActivityKind.ASSIGNED_ON_ARRIVAL,
    AssignmentReason.QUEUE_DRAINED: HomeActivityKind.ASSIGNED_FROM_QUEUE,
    AssignmentReason.MANUAL: HomeActivityKind.ASSIGNED_BY_SUPERVISOR,
    AssignmentReason.ASSISTANT_HANDOFF: HomeActivityKind.ASSIGNED_BY_ASSISTANT,
}

#: Arrival rows a ``customer_returned`` row of the same case replaces.
_ARRIVAL_KINDS = frozenset(
    {
        HomeActivityKind.ASSIGNED_ON_ARRIVAL,
        HomeActivityKind.ASSIGNED_FROM_QUEUE,
        HomeActivityKind.ASSIGNED_BY_ASSISTANT,
    }
)

#: Tie-break of rows with the same time (stable, documented order).
_KIND_ORDER: dict[HomeActivityKind, int] = {kind: i for i, kind in enumerate(HomeActivityKind)}


# ----------------------------------------------------------------------------- views
@dataclass(frozen=True, slots=True)
class HomeActivityItemView:
    kind: HomeActivityKind
    case_id: str
    customer_name: str
    occurred_at: datetime
    language: Language
    read_only: bool
    case_status: CaseStatus
    inbox_status: InboxStatus | None
    sla_due_at: datetime
    first_response_at: datetime | None
    actor_name: str | None = None
    target_name: str | None = None
    reason: AssignmentReason | None = None
    waited_seconds: int | None = None
    previous_cases_count: int | None = None
    last_close_reason: CloseReason | None = None
    message_count: int | None = None


@dataclass(frozen=True, slots=True)
class HomeActivityView:
    items: tuple[HomeActivityItemView, ...]
    total: int


@dataclass(frozen=True, slots=True)
class HomeQueueView:
    language: Language
    waiting: int
    oldest_queued_at: datetime | None


@dataclass(frozen=True, slots=True)
class HomeTeamView:
    team_id: str
    team_name: str
    available_count: int
    analyst_count: int
    queues: tuple[HomeQueueView, ...]


@dataclass(frozen=True, slots=True)
class HomeAssistantView:
    """The assistant in her languages (slice 21, IaHomeTurno), from the event log and the cases."""

    resolved: int
    """Conversations of her languages the assistant resolved since ``since``."""
    handed_to_you: int
    """Cases the assistant handed over that went to her since ``since``."""
    with_assistant_now: int
    """Open conversations of her languages the assistant holds now."""


@dataclass(frozen=True, slots=True)
class AnalystHomeView:
    since: datetime
    since_source: SinceSource
    activity: HomeActivityView
    team_now: HomeTeamView
    server_time: datetime
    assistant: HomeAssistantView | None = None
    """Slice 21: ``None`` while the AI switch is off."""


# ----------------------------------------------------------------------------- pure rules
def since_of(previous_end: datetime | None, now: datetime) -> tuple[datetime, SinceSource]:
    """Her previous session's end (never later than now), else ``now − 8 h``."""
    if previous_end is None:
        return now - FALLBACK_LOOKBACK, SinceSource.FALLBACK
    return min(previous_end, now), SinceSource.PREVIOUS_SESSION


def _text(payload: Mapping[str, object], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) and value else None


def _int(payload: Mapping[str, object], key: str) -> int | None:
    value = payload.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _reason(value: str | None) -> AssignmentReason | None:
    try:
        return AssignmentReason(value) if value else None
    except ValueError:
        return None


def _is_customer_message(payload: Mapping[str, object]) -> bool:
    return (
        payload.get("author_role") == TurnAuthorRole.CUSTOMER.value
        and payload.get("kind") in {kind.value for kind in CONVERSATION_KINDS}  # chat or email
        and payload.get("audience") == TurnAudience.EVERYONE.value
    )


def _earlier_cases(case: Case, facts: Sequence[CustomerCaseFact]) -> tuple[int, CloseReason | None]:
    """How many of the customer's cases opened before this one, and how the one it
    continues (``previous_case_id``) was closed."""
    earlier = [f for f in facts if f.case_id != case.id and f.opened_at < case.opened_at]
    previous = next((f for f in facts if f.case_id == case.previous_case_id), None)
    return len(earlier), previous.close_reason if previous else None


class _ActivityProjection:
    """Accumulates the rows of one analyst while the events are replayed in log order."""

    def __init__(
        self,
        staff_id: str,
        cases: Mapping[str, Case],
        *,
        customer_names: Mapping[str, str],
        staff_names: Mapping[str, str],
        customer_cases: Mapping[str, Sequence[CustomerCaseFact]],
    ) -> None:
        self._me = staff_id
        self._cases = cases
        self._customer_names = customer_names
        self._staff_names = staff_names
        self._customer_cases = customer_cases
        self._rows: dict[tuple[str, HomeActivityKind], HomeActivityItemView] = {}
        self._went_to_her: set[str] = set()
        self._returned: list[tuple[Case, datetime]] = []
        self._tallies: dict[str, tuple[int, datetime]] = {}

    def _row(self, case: Case, kind: HomeActivityKind, at: datetime) -> HomeActivityItemView:
        return HomeActivityItemView(
            kind=kind,
            case_id=case.id,
            customer_name=self._customer_names.get(case.customer_id, UNKNOWN_CUSTOMER),
            occurred_at=at,
            language=case.language,
            read_only=case.assigned_analyst_id != self._me,
            case_status=case.status,
            inbox_status=inbox_status(case),
            sla_due_at=case.sla_due_at,
            first_response_at=case.first_response_at,
        )

    def _put(self, item: HomeActivityItemView) -> None:
        # Events arrive in log order: a later fact of the same (case, kind) replaces it.
        self._rows[(item.case_id, item.kind)] = item

    def apply(self, event: StoredEvent) -> None:
        if event.actor_id == self._me:
            return
        case = self._cases.get(event.case_id) if event.case_id else None
        if case is None:
            return
        if event.event_type == CaseAssigned.event_type:
            self._assigned(case, event)
        elif event.event_type == CaseOpened.event_type:
            # The customer came back (an analyst's follow-up call case is not a return).
            by_customer = event.actor_role == ActorRole.CUSTOMER.value
            if by_customer and _text(event.payload, "previous_case_id"):
                self._returned.append((case, event.event_time))
        elif event.event_type == TurnCreated.event_type:
            self._message(case, event)

    def _assigned(self, case: Case, event: StoredEvent) -> None:
        payload = event.payload
        to = _text(payload, "assigned_analyst_id")
        reason = _reason(_text(payload, "reason"))
        if reason is AssignmentReason.OUTBOUND_CALL:
            return  # slice 12: she opened it herself to call the customer
        if to == self._me and reason is not None:
            self._went_to_her.add(case.id)
            kind = _ASSIGNED_KIND[reason]
        elif to != self._me and _text(payload, "previous_analyst_id") == self._me:
            kind = HomeActivityKind.REASSIGNED_AWAY
        else:
            return
        by_person = event.actor_role != ActorRole.SYSTEM.value
        away = kind is HomeActivityKind.REASSIGNED_AWAY
        from_queue = kind is HomeActivityKind.ASSIGNED_FROM_QUEUE
        self._put(
            replace(
                self._row(case, kind, event.event_time),
                actor_name=self._staff_names.get(event.actor_id) if by_person else None,
                target_name=self._staff_names.get(to) if away and to else None,
                reason=reason,
                waited_seconds=_int(payload, "waited_seconds") if from_queue else None,
            )
        )

    def _message(self, case: Case, event: StoredEvent) -> None:
        """Customer messages in a case she holds now, written after she got it."""
        mine_since = case.assigned_at
        if (
            case.assigned_analyst_id != self._me
            or mine_since is None
            or event.event_time <= mine_since
            or not _is_customer_message(event.payload)
        ):
            return
        count, _last = self._tallies.get(case.id, (0, event.event_time))
        self._tallies[case.id] = (count + 1, event.event_time)

    def result(self, limit: int) -> HomeActivityView:
        for case, at in self._returned:
            if case.assigned_analyst_id != self._me and case.id not in self._went_to_her:
                continue
            for kind in _ARRIVAL_KINDS:
                self._rows.pop((case.id, kind), None)
            count, last_reason = _earlier_cases(
                case, self._customer_cases.get(case.customer_id, ())
            )
            self._put(
                replace(
                    self._row(case, HomeActivityKind.CUSTOMER_RETURNED, at),
                    previous_cases_count=count,
                    last_close_reason=last_reason,
                )
            )
        for case_id, (count, last_at) in self._tallies.items():
            self._put(
                replace(
                    self._row(self._cases[case_id], HomeActivityKind.CUSTOMER_MESSAGES, last_at),
                    message_count=count,
                )
            )
        ordered = sorted(
            self._rows.values(),
            key=lambda item: (-item.occurred_at.timestamp(), _KIND_ORDER[item.kind], item.case_id),
        )
        return HomeActivityView(items=tuple(ordered[:limit]), total=len(ordered))


def project_activity(
    staff_id: str,
    events: Sequence[StoredEvent],
    cases: Mapping[str, Case],
    *,
    customer_names: Mapping[str, str],
    staff_names: Mapping[str, str],
    customer_cases: Mapping[str, Sequence[CustomerCaseFact]],
    limit: int = MAX_ACTIVITY_ITEMS,
) -> HomeActivityView:
    """ "Mientras no estabas" from event-log rows already limited to ``event_time > since``
    and to the cases that may concern her (``AnalystHomeReader.touched_case_ids``).

    Rules (contract §2.2): never an event whose actor is herself; an assignment row only
    when the case went to her or was taken away from her; ``customer_returned`` only for a
    case she holds or that went to her, and it replaces that case's arrival row; customer
    messages only in cases she holds now, after she got them, one row per case (count and
    the last time); one row per ``(case, kind)``, the newest; newest first; ``limit`` rows
    and the full ``total``. ``read_only`` = the case is not hers now.
    """
    projection = _ActivityProjection(
        staff_id,
        cases,
        customer_names=customer_names,
        staff_names=staff_names,
        customer_cases=customer_cases,
    )
    for event in events:
        projection.apply(event)
    return projection.result(limit)


def _team_queues(
    languages: Collection[Language], counts: Sequence[HomeQueueView]
) -> tuple[HomeQueueView, ...]:
    return tuple(q for q in counts if q.language in languages)


# ----------------------------------------------------------------------------- query
@dataclass(frozen=True, slots=True)
class GetAnalystHome:
    """``GET /me/home`` (analysts only; the router enforces the role)."""

    uow: UnitOfWorkFactory
    clock: Clock
    switch: AiSwitch | None = None
    """Slice 21: with it on, the assistant's summary (``AnalystHomeView.assistant``)."""

    async def execute(self, actor: Actor) -> AnalystHomeView:
        now = self.clock.now()
        async with self.uow() as uow:
            reader = uow.analyst_home
            previous_end = await reader.previous_session_end(
                actor.staff_id, current_session_id=actor.session_id, now=now
            )
            since, source = since_of(previous_end, now)

            people = await uow.staff.list()
            me = next((person for person in people if person.id == actor.staff_id), None)
            if me is None:
                raise NotFoundError("La persona no existe.", staffId=actor.staff_id)
            team = await uow.teams.get(me.team_id)

            case_ids = await reader.touched_case_ids(actor.staff_id, since)
            events = await reader.case_events(case_ids, since=since, event_types=FEED_EVENT_TYPES)
            cases = await uow.cases.get_many({e.case_id for e in events if e.case_id})
            customers = await uow.customers.get_many({c.customer_id for c in cases.values()})
            returning = {c.customer_id for c in cases.values() if c.previous_case_id}
            history = await reader.customer_cases(returning) if returning else {}

            available = {a.staff_id for a in await uow.availability.list() if a.is_available}
            queues = await queue_counts(uow, now)
            assistant = (
                await _assistant_summary(uow, me.languages, actor.staff_id, since, events)
                if self.switch is not None and await self.switch.is_on_in(uow)
                else None
            )

        activity = project_activity(
            actor.staff_id,
            events,
            cases,
            customer_names={cid: c.display_name for cid, c in customers.items()},
            staff_names={person.id: person.name for person in people},
            customer_cases=history,
        )
        teammates = [
            p
            for p in people
            if p.active and p.has_role(StaffRole.ANALYST) and p.team_id == me.team_id
        ]
        queue_views = [
            HomeQueueView(
                language=q.language, waiting=q.waiting, oldest_queued_at=q.oldest_queued_at
            )
            for q in queues.by_language
            if q.language in QUEUE_LANGUAGES
        ]
        return AnalystHomeView(
            since=since,
            since_source=source,
            activity=activity,
            team_now=HomeTeamView(
                team_id=me.team_id,
                team_name=team.name if team is not None else me.team_id,
                available_count=sum(p.id in available for p in teammates),
                analyst_count=len(teammates),
                queues=_team_queues(me.languages, queue_views),
            ),
            server_time=now,
            assistant=assistant,
        )


#: The assistant's ``assistant.ended`` results that mean "it resolved the conversation".
_ASSISTANT_RESOLVED = "resolved"
#: The most ``assistant.ended`` events one summary reads (a shift is far below it).
_ASSISTANT_EVENTS_LIMIT = 1000


async def _assistant_summary(
    uow: UnitOfWork,
    languages: Collection[Language],
    staff_id: str,
    since: datetime,
    events: Sequence[StoredEvent],
) -> HomeAssistantView:
    """What the assistant did in her languages since ``since`` and holds now (IaHomeTurno)."""
    ended = await uow.event_log.search(
        AuditFilters(event_types=frozenset({AssistantEnded.event_type}), occurred_from=since),
        before=None,
        limit=_ASSISTANT_EVENTS_LIMIT,
    )
    resolved_ids = {
        e.case_id for e in ended if e.case_id and e.payload.get("result") == _ASSISTANT_RESOLVED
    }
    resolved_cases = await uow.cases.get_many(resolved_ids) if resolved_ids else {}
    handed = {
        e.case_id
        for e in events
        if e.event_type == CaseAssigned.event_type
        and e.event_time > since
        and e.payload.get("assigned_analyst_id") == staff_id
        and e.payload.get("reason") == AssignmentReason.ASSISTANT_HANDOFF.value
    }
    holding = await uow.cases.list_by_status(CaseStatus.WITH_ASSISTANT)
    return HomeAssistantView(
        resolved=sum(c.language in languages for c in resolved_cases.values()),
        handed_to_you=len(handed),
        with_assistant_now=sum(c.language in languages for c in holding),
    )
