"""The synthetic volume's plan (seed profile ``volume``): size, cells, shares, synthetic ids."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from itertools import pairwise

from cc_platform.domain.ai.maturity import CaseTypeMaturity, MaturityStage, StageRule
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.people.staff import Language
from cc_platform.infrastructure.seed import volume_catalog as cat
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS
from cc_platform.infrastructure.seed.people import DEMO_STAFF
from cc_platform.infrastructure.seed.volume import (
    ClosedFact,
    DraftFact,
    Kind,
    build_plan,
    claimed_cells,
    recompute_signals,
)

PLAN = build_plan()


def test_the_plan_is_deterministic() -> None:
    assert build_plan() == PLAN


def test_it_holds_at_least_a_thousand_closed_cases_and_open_ones() -> None:
    kinds = Counter(spec.kind for spec in PLAN.specs)
    assert kinds[Kind.CLOSED] >= 1000
    assert kinds[Kind.QUEUED] == sum(cat.QUEUED_OPEN.values())
    assert kinds[Kind.ASSIGNED] == cat.ASSIGNED_OPEN
    assert kinds[Kind.WITH_ASSISTANT] == cat.WITH_ASSISTANT_OPEN
    assert kinds[Kind.ASSISTANT_RESOLVED] > 0


def test_every_claimed_cell_has_the_floor_of_closed_cases() -> None:
    cells = PLAN.cells()
    claimed = claimed_cells()
    assert len(claimed) == 50  # 5 dataset types x 5 channels x 2 languages
    assert all(cells[cell] >= cat.CELL_FLOOR for cell in claimed), {
        cell: cells[cell] for cell in claimed if cells[cell] < cat.CELL_FLOOR
    }


def test_the_five_dataset_types_have_about_equal_shares() -> None:
    closed = [s for s in PLAN.closed() if s.case_type in cat.DATASET_TYPES]
    shares = Counter(s.case_type for s in closed)
    assert set(shares) == set(cat.DATASET_TYPES)
    assert all(0.19 <= n / len(closed) <= 0.21 for n in shares.values())
    spanish = sum(1 for s in closed if s.language is Language.SPANISH) / len(closed)
    assert 0.6 <= spanish <= 0.75


def test_it_spans_the_history_window() -> None:
    oldest = max(spec.opened_ago for spec in PLAN.specs)
    assert timedelta(days=cat.HISTORY_DAYS - 2) <= oldest <= timedelta(days=cat.HISTORY_DAYS)
    assert all(spec.closed_ago > timedelta(0) for spec in PLAN.closed())


def test_everything_lives_in_the_synthetic_id_ranges() -> None:
    assert all(spec.number > cat.VOLUME_BASE for spec in PLAN.specs)
    assert all(customer.number > cat.VOLUME_BASE for customer in PLAN.customers)
    assert all(staff.number >= cat.VOLUME_STAFF_BASE for staff in cat.VOLUME_STAFF)
    demo_names = {c.name for c in DEMO_CUSTOMERS} | {s.name for s in DEMO_STAFF}
    assert not demo_names & {c.name for c in PLAN.customers}
    assert not {s.username for s in DEMO_STAFF} & {s.username for s in cat.VOLUME_STAFF}


def test_a_customer_has_one_open_case_at_a_time() -> None:
    by_customer: dict[int, list[tuple[timedelta, timedelta]]] = defaultdict(list)
    for spec in PLAN.specs:
        open_until = (
            spec.closed_ago if spec.kind in (Kind.CLOSED, Kind.ASSISTANT_RESOLVED) else None
        )
        by_customer[spec.customer].append((spec.opened_ago, open_until or timedelta(0)))
    for cases in by_customer.values():
        ordered = sorted(cases, reverse=True)  # oldest first
        for (_opened, closed), (next_opened, _next_closed) in pairwise(ordered):
            assert closed > next_opened  # the earlier one closed before the next one opened
    returning = [spec for spec in PLAN.specs if spec.previous is not None]
    assert returning
    numbers = {spec.number: spec for spec in PLAN.specs}
    assert all(
        numbers[spec.previous].customer == spec.customer for spec in returning if spec.previous
    )


def test_portuguese_cases_go_to_portuguese_speakers() -> None:
    speakers = {s.number for s in cat.VOLUME_STAFF if Language.PORTUGUESE in s.languages}
    assert all(
        spec.analyst in speakers
        for spec in PLAN.specs
        if spec.language is Language.PORTUGUESE and spec.analyst is not None
    )


def test_signals_count_what_happened_since_the_current_stage() -> None:
    t = datetime(2026, 10, 1, tzinfo=UTC)
    maturity = CaseTypeMaturity(
        case_type=CaseType.UNDUE_CHARGE,
        stage=MaturityStage.SHADOWS,
        stage_since={
            1: t - timedelta(days=30),
            2: t - timedelta(days=20),
            3: t - timedelta(days=10),
        },
    )
    closed = [
        ClosedFact(t - timedelta(days=11), CaseType.UNDUE_CHARGE, True, True, True, True),
        ClosedFact(t - timedelta(days=5), CaseType.UNDUE_CHARGE, True, True, True, False),
        ClosedFact(t - timedelta(days=4), CaseType.UNDUE_CHARGE, False, False, False, False),
        ClosedFact(t - timedelta(days=4), CaseType.APP_ISSUE, True, True, True, True),
    ]
    drafts = [
        DraftFact(t - timedelta(days=12), CaseType.UNDUE_CHARGE, "used", 0),
        DraftFact(t - timedelta(days=3), CaseType.UNDUE_CHARGE, "used", 0),
        DraftFact(t - timedelta(days=3), CaseType.UNDUE_CHARGE, "edited", 90),
        DraftFact(t - timedelta(days=2), CaseType.UNDUE_CHARGE, "edited", 600),
        DraftFact(t - timedelta(days=2), CaseType.UNDUE_CHARGE, "discarded", None),
        DraftFact(t - timedelta(days=1), CaseType.UNDUE_CHARGE, "ignored", None),
    ]

    signals = recompute_signals(maturity, closed, drafts, StageRule())

    assert (signals.closed_cases, signals.resolved_cases, signals.asked_cases) == (2, 1, 1)
    assert (signals.tool_cases, signals.tool_used_cases) == (1, 0)
    assert signals.recent_drafts == "aaed"
