"""Seeded "Datos de ejemplo" (contract §8.3): chat only, invented people, every inbox status."""

from __future__ import annotations

from collections import Counter

from cc_platform.application.cases.queries import CLOSED_INBOX_WINDOW
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.domain.cases import CaseChannel, CaseStatus, InboxStatus, TurnAuthorRole
from cc_platform.infrastructure.seed.cases import DEMO_STORIES, seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import memory_container

DANIELA, JULIAN = seed_staff_id(1), seed_staff_id(2)


async def test_daniela_inbox_counts_match_the_contract() -> None:
    container = await memory_container()
    now = container.clock.now()
    async with container.uow() as uow:
        reader = CaseReader(uow)
        open_items = await reader.open_inbox(DANIELA)
        closed = await reader.closed_inbox(DANIELA, now - CLOSED_INBOX_WINDOW)
        julian_closed = await reader.closed_inbox(JULIAN, now - CLOSED_INBOX_WINDOW)
        queued = await uow.cases.list_by_status(CaseStatus.QUEUED)
        old = await uow.cases.get(seed_case_id(110))
        every = [await uow.cases.get(seed_case_id(n)) for n, _ in DEMO_STORIES]
    assert len(open_items) == 5
    assert Counter(item.inbox_status for item in open_items) == {
        InboxStatus.TO_REPLY: 2,
        InboxStatus.NEW: 2,
        InboxStatus.WAITING: 1,
    }
    assert [c.id for c in closed] == [seed_case_id(n) for n in (106, 105, 104)]
    assert [c.id for c in queued] == [seed_case_id(109)]
    assert queued[0].queue_label == "Cola en portugués"
    assert old is not None
    assert old.assigned_analyst_id == JULIAN
    assert old.closed_at is not None
    assert now - old.closed_at > CLOSED_INBOX_WINDOW
    assert julian_closed == []
    cases = [case for case in every if case is not None]
    assert {case.channel for case in cases} <= {CaseChannel.APP_CHAT, CaseChannel.WEB_CHAT}
    assert all(case.last_turn_author_role is not None for case in cases)


async def test_seed_links_first_responses_and_closures() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        cases = {n: await uow.cases.get(seed_case_id(n)) for n, _ in DEMO_STORIES}
    patricia_again, refund, beatriz, marcela, hector = (
        cases[108],
        cases[104],
        cases[102],
        cases[101],
        cases[106],
    )
    assert patricia_again is not None
    assert refund is not None
    assert (patricia_again.previous_case_id, refund.previous_case_id) == (
        seed_case_id(104),
        seed_case_id(110),
    )
    assert beatriz is not None
    assert beatriz.first_response_at is None  # SLA at risk ("SLA 3 min")
    assert (beatriz.sla_due_at - container.clock.now()).total_seconds() == 3 * 60
    assert marcela is not None
    assert marcela.first_response_at is not None
    assert marcela.unread_count == 1
    assert hector is not None
    assert hector.closure is not None
    assert hector.closure.note == "Pregunta por un crédito hipotecario."
    assert (hector.sla_due_at - hector.opened_at).total_seconds() == 60 * 60  # low priority


async def test_seeding_is_idempotent_and_only_daniela_starts_available() -> None:
    container = await memory_container()
    assert await seed_demo_cases(container.uow, container.ids, container.clock) == 0
    async with container.uow() as uow:
        availability = await uow.availability.list()
        slots = {seed.number: await uow.case_slots.get(seed.id) for seed in DEMO_CUSTOMERS}
    assert [a.staff_id for a in availability if a.is_available] == [DANIELA]
    assert len(availability) == 6  # every analyst (incl. Tomás and the team lead) has a row
    patricia, claudia = slots[1004], slots[1005]
    assert patricia is not None
    assert patricia.open_case_id == seed_case_id(108)
    assert claudia is not None
    assert claudia.open_case_id is None  # closed: the next message opens a new case


def test_seed_people_are_invented_and_ids_unique() -> None:
    assert len({seed.number for seed in DEMO_CUSTOMERS}) == len(DEMO_CUSTOMERS)
    assert len({number for number, _ in DEMO_STORIES}) == 10
    simulator = [seed for seed in DEMO_CUSTOMERS if seed.simulator]
    assert {seed.locale.value for seed in simulator} == {"es-CO", "es-MX", "es-AR", "pt-BR"}
    assert all(seed.suggestions for seed in DEMO_CUSTOMERS)


async def test_no_bot_turns_anywhere() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        roles = {
            turn.author_role
            for number, _ in DEMO_STORIES
            for turn in await uow.turns.page(seed_case_id(number), limit=50)
        }
    assert roles == set(TurnAuthorRole)
