"""What the platform itself keeps about a proposal (slice 22, ADR 0007): the improvement engine's
dossier, with its evidence cases resolved, and the history of the decisions taken here.

Read-only and local: it never calls agent-core, so it answers the same while the registry is slow
or down. Two sources, both already written by other flows:

- the **dossier** is the one the engine announced (``POST /internal/builder/proposals/announce``),
  stored with the ``improvement_proposed`` notification of every Supervisión person (the first
  announcement wins). A proposal the engine did not announce has none;
- the **history** is the platform's own audit (``builder.*`` events in the event log): created or
  brought here, frozen, evaluated (verdict and counts), approved, rejected (agent-core's reason
  code), reopened, published, and the alias promotions of the releases it published (``staging``
  or ``prod``). agent-core's registry exposes no history read, so a step taken outside the platform
  is not in it.

Nothing here carries free text from a person: reasons are kept as their size and code only.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from cc_platform.application.ai.builder_step_up import BUILDER_ROLES
from cc_platform.application.events import StoredEvent
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.cases.values import CaseChannel, CaseStatus, CaseType
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

#: The language the engine writes the dossier in: the announce carries Spanish only (ADR 0007).
DOSSIER_LANGUAGE = "es"
#: How many events of one proposal (and of its agent's alias promotions) the history reads.
MAX_HISTORY_EVENTS = 500
_PAGE = 100

type HistoryKind = Literal[
    "created",
    "tracked",
    "frozen",
    "evaluated",
    "approved",
    "rejected",
    "reopened",
    "published",
    "promoted",
]

_KINDS: dict[str, HistoryKind] = {
    "builder.proposal_created": "created",
    "builder.proposal_tracked": "tracked",
    "builder.proposal_frozen": "frozen",
    "builder.proposal_evaluated": "evaluated",
    "builder.proposal_approved": "approved",
    "builder.proposal_rejected": "rejected",
    "builder.proposal_reopened": "reopened",
    "builder.proposal_published": "published",
}
_PROMOTED = "builder.alias_promoted"


@dataclass(frozen=True, slots=True)
class EvidenceCase:
    """One evidence link of the dossier, resolved against the platform's cases. ``available``
    is False when the id names no case here (the engine's id is stale or never existed): the
    other facts are then None."""

    case_id: str
    available: bool
    status: CaseStatus | None = None
    case_type: CaseType | None = None
    channel: CaseChannel | None = None
    language: Language | None = None
    opened_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ImprovementView:
    title: str
    problem: str
    evidence: str
    expected_effect: str
    language: str
    announced_at: datetime
    evidence_cases: tuple[EvidenceCase, ...]


@dataclass(frozen=True, slots=True)
class HistoryEntry:
    kind: HistoryKind
    at: datetime
    actor_id: str | None
    """A staff id, or None for the improvement engine and the system."""
    actor_name: str | None
    source: str | None = None
    """``created`` / ``tracked``: who brought it here (``platform``, ``chat``, ``tracked``,
    ``engine``)."""
    verdict: str | None = None
    items: int | None = None
    items_failed: int | None = None
    suite_id: str | None = None
    reason_code: str | None = None
    release_id: str | None = None
    alias: str | None = None


@dataclass(frozen=True, slots=True)
class ProposalRecord:
    improvement: ImprovementView | None
    history: tuple[HistoryEntry, ...]


def _str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


async def _events(uow: UnitOfWork, entity_id: str) -> list[StoredEvent]:
    found: list[StoredEvent] = []
    cursor: str | None = None
    while len(found) < MAX_HISTORY_EVENTS:
        page = await uow.event_log.page(after=cursor, limit=_PAGE, entity_id=entity_id)
        found.extend(e for e in page.items if e.event_type.startswith("builder."))
        if page.next_cursor is None:
            break
        cursor = page.next_cursor
    return found[:MAX_HISTORY_EVENTS]


def _entry(event: StoredEvent, kind: HistoryKind, names: dict[str, str]) -> HistoryEntry:
    payload = event.payload
    staff = event.actor_id if is_valid_id(event.actor_id, IdPrefix.STAFF) else None
    return HistoryEntry(
        kind=kind,
        at=event.event_time,
        actor_id=staff,
        actor_name=names.get(staff) if staff else None,
        source=_str(payload.get("source")) if kind == "tracked" else None,
        verdict=_str(payload.get("verdict")),
        items=_int(payload.get("items")),
        items_failed=_int(payload.get("items_failed")),
        suite_id=_str(payload.get("suite_id")),
        reason_code=_str(payload.get("reason_code")),
        release_id=_str(payload.get("release_id")),
        alias=_str(payload.get("alias")),
    )


@dataclass(frozen=True, slots=True)
class GetProposalRecord:
    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, proposal_id: str) -> ProposalRecord:
        ensure_any_role(actor, BUILDER_ROLES)
        async with self.uow() as uow:
            improvement = await self._improvement(uow, proposal_id)
            history = await self._history(uow, proposal_id)
        return ProposalRecord(improvement=improvement, history=history)

    @staticmethod
    async def _improvement(uow: UnitOfWork, proposal_id: str) -> ImprovementView | None:
        notice = await uow.notifications.improvement_for(proposal_id)
        if notice is None or notice.improvement is None:
            return None
        dossier = notice.improvement
        cases = await uow.cases.get_many(dossier.evidence_links)
        evidence = tuple(
            EvidenceCase(
                case_id=link,
                available=True,
                status=case.status,
                case_type=case.case_type,
                channel=case.channel,
                language=case.language,
                opened_at=case.opened_at,
            )
            if (case := cases.get(link)) is not None
            else EvidenceCase(case_id=link, available=False)
            for link in dossier.evidence_links
        )
        return ImprovementView(
            title=dossier.title,
            problem=dossier.problem,
            evidence=dossier.evidence,
            expected_effect=dossier.expected_effect,
            language=DOSSIER_LANGUAGE,
            announced_at=notice.created_at,
            evidence_cases=evidence,
        )

    @staticmethod
    async def _history(uow: UnitOfWork, proposal_id: str) -> tuple[HistoryEntry, ...]:
        own = [e for e in await _events(uow, proposal_id) if e.event_type in _KINDS]
        releases = {
            release
            for e in own
            if e.event_type == "builder.proposal_published"
            and (release := _str(e.payload.get("release_id")))
        }
        agents = {agent for e in own if (agent := _str(e.payload.get("agent_id")))}
        promoted: list[StoredEvent] = []
        if releases:
            for agent in sorted(agents):
                promoted.extend(
                    e
                    for e in await _events(uow, agent)
                    if e.event_type == _PROMOTED and e.payload.get("release_id") in releases
                )
        events: Sequence[StoredEvent] = sorted(
            [*own, *promoted], key=lambda e: (e.event_time, e.sequence)
        )
        names: dict[str, str] = {}
        for staff_id in {e.actor_id for e in events if is_valid_id(e.actor_id, IdPrefix.STAFF)}:
            person = await uow.staff.get(staff_id)
            if person is not None:
                names[staff_id] = person.name
        return tuple(
            _entry(e, "promoted" if e.event_type == _PROMOTED else _KINDS[e.event_type], names)
            for e in events
        )
