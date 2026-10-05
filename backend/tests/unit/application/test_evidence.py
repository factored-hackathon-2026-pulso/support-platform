"""``SampleEvidenceCases`` (ADR 0007): which real cases sit in a cell, k-safe and ids only, over
both persistence adapters (the seeded demo cases)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import pytest

from cc_platform.application.cases.evidence import MAX_SAMPLE, SampleEvidenceCases
from cc_platform.application.cases.ports import EvidenceCell
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import make_settings

#: Seed: Cargo no reconocido on 101, 102, 110, 115 and 116.
DISPUTES = {seed_case_id(n) for n in (101, 102, 110, 115, 116)}


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'evidence.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


def sampler(world: Container, min_cell: int) -> SampleEvidenceCases:
    return SampleEvidenceCases(uow=world.uow, min_cell=min_cell)


async def test_a_cell_gives_its_size_and_real_case_ids(world: Container) -> None:
    view = await sampler(world, 5).execute(EvidenceCell(case_type="unrecognized_charge"))

    assert view.suppressed is False
    assert view.matched == 5
    assert set(view.case_ids) == DISPUTES


async def test_the_sample_is_bounded_and_the_newest_first(world: Container) -> None:
    everything = await sampler(world, 2).execute(EvidenceCell(), limit=100)
    two = await sampler(world, 2).execute(EvidenceCell(), limit=2)

    assert len(everything.case_ids) == MAX_SAMPLE
    assert everything.matched is not None
    assert everything.matched > MAX_SAMPLE
    assert two.case_ids == everything.case_ids[:2]
    assert two.matched == everything.matched


async def test_a_small_cell_is_suppressed_without_ids_or_count(world: Container) -> None:
    view = await sampler(world, 10).execute(EvidenceCell(case_type="unrecognized_charge"))

    assert (view.suppressed, view.matched, view.case_ids) == (True, None, ())


async def test_the_dimensions_combine_and_an_empty_cell_is_suppressed(world: Container) -> None:
    both = await sampler(world, 1).execute(
        EvidenceCell(case_type="unrecognized_charge", priority="critical")
    )
    none = await sampler(world, 1).execute(EvidenceCell(case_type="virtual_card"))

    assert both.case_ids == (seed_case_id(101),)
    assert none.suppressed is True


async def test_the_period_filters_on_when_the_case_opened(world: Container) -> None:
    all_cases = await sampler(world, 1).execute(EvidenceCell())
    future = await sampler(world, 1).execute(
        EvidenceCell(opened_from=FixedClock().now() + timedelta(days=30))
    )

    assert all_cases.suppressed is False
    assert future.suppressed is True


async def test_a_closed_case_cell_by_its_reason(world: Container) -> None:
    resolved = await sampler(world, 1).execute(EvidenceCell(close_reason="resolved"))

    assert not resolved.suppressed
    assert all(case_id.startswith("CASE-") for case_id in resolved.case_ids)
