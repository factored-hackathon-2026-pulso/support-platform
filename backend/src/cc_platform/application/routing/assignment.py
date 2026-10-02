"""Human tier: who gets a case (Strategy ``AssignmentPolicy``).

``LanguageLeastLoadedPolicy`` (synthetic policy, rule 3 / ``H1``): among *available*
analysts, keep those who speak the case language (a Portuguese case goes only to a
Portuguese speaker), then pick the fewest open cases, then the one who waited longest
since her last assignment, then the staff id (deterministic). Nobody eligible → the case
is queued. No capacity cap yet (seam: ``max_open_cases``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.cases.values import OPEN_ASSIGNED_STATUSES, AssignmentReason, CaseOrigin
from cc_platform.domain.people.staff import Language, StaffRole

RULE_PORTUGUESE_SPEAKER = "H1"
RULE_REGULATOR_FOLLOWUP = "A2"
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


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
    origin: CaseOrigin = CaseOrigin.CUSTOMER


@dataclass(frozen=True, slots=True)
class AssignmentChoice:
    candidate: AnalystCandidate
    reason: AssignmentReason
    policy_rule_id: str | None
    strategy: str


class AssignmentPolicy(Protocol):
    def choose(
        self, request: AssignmentRequest, candidates: Sequence[AnalystCandidate]
    ) -> AssignmentChoice | None:
        """Pick an analyst among available ``candidates``; ``None`` → queue the case."""
        ...


def language_rule(language: Language) -> str | None:
    """Policy rule behind a language-driven routing decision (rule 3 → ``H1``)."""
    return RULE_PORTUGUESE_SPEAKER if language is Language.PORTUGUESE else None


@dataclass(frozen=True, slots=True)
class LanguageLeastLoadedPolicy:
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
            candidate=chosen,
            reason=AssignmentReason.LANGUAGE_LEAST_LOADED,
            policy_rule_id=language_rule(request.language),
            strategy=self.strategy,
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
