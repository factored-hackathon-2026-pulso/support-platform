"""Seeded "Datos de ejemplo": Daniela's inbox covers every canvas status; invented people."""

from __future__ import annotations

from collections import Counter

from cc_platform.application.cases.read_model import CaseReader
from cc_platform.domain.cases import InboxStatus
from cc_platform.infrastructure.seed.cases import DEMO_STORIES, seed_demo_cases
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import memory_container


async def test_inbox_counts_per_status_match_the_canvas() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        items = await CaseReader(uow).inbox(seed_staff_id(1))
    assert Counter(item.inbox_status for item in items) == {
        InboxStatus.TO_REPLY: 3,
        InboxStatus.LIVE: 1,
        InboxStatus.NEW: 1,
        InboxStatus.TO_CALL: 1,
        InboxStatus.WAITING: 1,
    }


async def test_seeding_is_idempotent_and_only_daniela_starts_available() -> None:
    container = await memory_container()
    assert await seed_demo_cases(container.uow, container.ids, container.clock) == 0
    async with container.uow() as uow:
        availability = await uow.availability.list()
    assert [a.staff_id for a in availability if a.is_available] == [seed_staff_id(1)]
    assert len(availability) == 5  # every analyst (incl. the team lead) has a row


def test_seed_people_are_invented_and_ids_unique() -> None:
    assert len({seed.number for seed in DEMO_CUSTOMERS}) == len(DEMO_CUSTOMERS)
    assert len({number for number, _ in DEMO_STORIES}) == 7
    simulator = [seed for seed in DEMO_CUSTOMERS if seed.simulator]
    assert {seed.locale.value for seed in simulator} == {"es-CO", "es-MX", "es-AR", "pt-BR"}
    assert all(seed.suggestions for seed in simulator)
