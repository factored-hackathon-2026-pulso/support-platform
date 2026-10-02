"""Human tier strategy (``LanguageLeastLoadedPolicy``) and the analyst directory."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from cc_platform.application.routing.assignment import (
    AnalystCandidate,
    AssignmentRequest,
    LanguageLeastLoadedPolicy,
    RepositoryAnalystDirectory,
)
from cc_platform.domain.cases.values import AssignmentReason
from cc_platform.domain.people.staff import Language
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import memory_container

ES, PT = Language.SPANISH, Language.PORTUGUESE
T = datetime(2026, 10, 2, 14, tzinfo=UTC)
CASE = "CASE-" + "0" * 25 + "1"


def candidate(
    number: int, *languages: Language, load: int = 0, last: datetime | None = None
) -> AnalystCandidate:
    return AnalystCandidate(
        staff_id=seed_staff_id(number),
        name=f"Analista {number}",
        languages=frozenset(languages),
        open_case_count=load,
        last_assigned_at=last,
    )


def choose(language: Language, *candidates: AnalystCandidate) -> str | None:
    choice = LanguageLeastLoadedPolicy().choose(AssignmentRequest(CASE, language), candidates)
    return choice.candidate.staff_id if choice else None


def test_portuguese_goes_only_to_a_portuguese_speaker_rule_3() -> None:
    policy = LanguageLeastLoadedPolicy()
    spanish_idle = candidate(2, ES, load=0)
    bilingual_busy = candidate(1, ES, PT, load=7)
    choice = policy.choose(AssignmentRequest(CASE, PT), [spanish_idle, bilingual_busy])
    assert choice is not None
    assert choice.candidate.staff_id == seed_staff_id(1)
    assert choice.policy_rule_id == "H1"
    assert choice.reason is AssignmentReason.LANGUAGE_LEAST_LOADED
    assert choice.strategy == "language_least_loaded@1"
    # A Spanish case carries no rule id.
    spanish = policy.choose(AssignmentRequest(CASE, ES), [spanish_idle])
    assert spanish is not None
    assert spanish.policy_rule_id is None


def test_nobody_who_speaks_the_language_means_queue() -> None:
    assert choose(PT, candidate(2, ES), candidate(3, ES)) is None
    assert choose(ES) is None


def test_least_loaded_then_longest_idle_then_staff_id() -> None:
    assert choose(ES, candidate(1, ES, load=3), candidate(2, ES, load=1)) == seed_staff_id(2)
    recent = candidate(1, ES, load=1, last=T)
    earlier = candidate(2, ES, load=1, last=T - timedelta(hours=1))
    assert choose(ES, recent, earlier) == seed_staff_id(2)
    never = candidate(3, ES, load=1, last=None)
    assert choose(ES, recent, earlier, never) == seed_staff_id(3)
    assert choose(ES, candidate(4, ES), candidate(3, ES)) == seed_staff_id(3)


async def test_directory_lists_only_available_analysts_with_their_load() -> None:
    container = await memory_container()  # Daniela available (7 cases), others paused
    async with container.uow() as uow:
        candidates = await RepositoryAnalystDirectory().candidates(uow)
    assert [(c.name, c.open_case_count) for c in candidates] == [("Daniela Ríos", 7)]
    assert candidates[0].languages == frozenset({ES, PT})
    assert candidates[0].last_assigned_at is not None
