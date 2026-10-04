"""Seeded "Datos de ejemplo" (contract §8.3): chat only, invented people, every inbox status."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta

from cc_platform.application.cases.queries import CLOSED_INBOX_WINDOW
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.events import StoredEvent
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import CaseChannel, CaseStatus, InboxStatus, TurnAuthorRole
from cc_platform.infrastructure.seed.cases import DEMO_STORIES, seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS
from cc_platform.infrastructure.seed.people import seed_session_id, seed_staff_id
from tests.support import memory_container

DANIELA, JULIAN, PAULA = seed_staff_id(1), seed_staff_id(2), seed_staff_id(3)


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
    assert [c.id for c in queued] == [seed_case_id(n) for n in (111, 112, 109)]
    assert [c.queue_label for c in queued] == ["Cola en español"] * 2 + ["Cola en portugués"]
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
    assert beatriz.first_response_at is None  # SLA at risk ("SLA 2 min")
    assert (beatriz.sla_due_at - container.clock.now()).total_seconds() == 2 * 60
    assert marcela is not None
    assert marcela.first_response_at is not None
    assert marcela.unread_count == 1
    assert hector is not None
    assert hector.closure is not None
    assert hector.closure.note == "Pregunta por un crédito hipotecario."
    assert (hector.sla_due_at - hector.opened_at).total_seconds() == 15 * 60  # one fixed target


async def test_seeding_is_idempotent_and_nobody_starts_available() -> None:
    container = await memory_container()
    assert await seed_demo_cases(container.uow, container.ids, container.clock) == 0
    async with container.uow() as uow:
        availability = await uow.availability.list()
        slots = {seed.number: await uow.case_slots.get(seed.id) for seed in DEMO_CUSTOMERS}
    # Queued cases wait because nobody who speaks their language is available (rule 3).
    assert [a.staff_id for a in availability if a.is_available] == []
    assert len(availability) == 6  # every analyst (incl. Tomás and the team lead) has a row
    patricia, claudia = slots[1004], slots[1005]
    assert patricia is not None
    assert patricia.open_case_id == seed_case_id(108)
    assert claudia is not None
    assert claudia.open_case_id is None  # closed: the next message opens a new case


def test_seed_people_are_invented_and_ids_unique() -> None:
    assert len({seed.number for seed in DEMO_CUSTOMERS}) == len(DEMO_CUSTOMERS)
    assert len({number for number, _ in DEMO_STORIES}) == 14
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


async def test_slice_3_seed_people_state_and_assignment_chain() -> None:
    container = await memory_container()
    t = container.clock.now()
    # Seeding again changes nothing (session, pause, cases and the supervisor view).
    before = await all_events(container)
    await container.seed_demo_data()
    assert await all_events(container) == before
    async with container.uow() as uow:
        session = await uow.sessions.get(seed_session_id(2))
        julian = await uow.availability.get(JULIAN)
        esteban = await uow.cases.get(seed_case_id(114))
        chain = await uow.assignments.latest_for_case(seed_case_id(114))
        active = await uow.sessions.active_staff_ids(t)
    assert session is not None
    assert (session.staff_id, session.issued_at) == (JULIAN, t - timedelta(minutes=45))
    assert active == {JULIAN}
    assert julian is not None
    assert (julian.status.value, julian.since) == ("paused", t - timedelta(minutes=20))
    assert esteban is not None
    assert (esteban.assigned_analyst_id, esteban.status) == (JULIAN, CaseStatus.IN_PROGRESS)
    assert chain is not None
    assert (chain.reason.value, chain.previous_staff_id, chain.assigned_by.actor_id) == (
        "manual",
        seed_staff_id(3),
        seed_staff_id(5),
    )
    types = [e.event_type for e in before]
    assert types.count("case.viewed") == 1
    assert types.count("auth.session_started") == 1
    paused = [e for e in before if e.event_type == "staff.availability_changed"]
    assert [(e.actor_id, e.payload["to_status"], e.event_time) for e in paused] == [
        (PAULA, "paused", t - timedelta(minutes=33)),  # before Lucía moved 114 to Julián
        (JULIAN, "paused", t - timedelta(minutes=20)),
        (DANIELA, "paused", t - timedelta(minutes=12)),  # before 111, 112 and 109 arrived
    ]


async def test_the_seeded_log_is_in_story_time_order() -> None:
    """The audit reads the log by sequence: the seed writes it as things happened, across
    every case and the people's sessions and pauses (one "Hoy" run, then older days)."""
    container = await memory_container()
    events = await all_events(container)
    times = [e.event_time for e in events]
    assert times == sorted(times)
    assert [e.sequence for e in events] == sorted(e.sequence for e in events)
    # "Persona: Julián": his 20-day-old case first, then today's sign-in, … , his pause last.
    julian = [e.event_type for e in events if e.actor_id == JULIAN]
    assert julian.index("auth.session_started") > julian.index("case.closed")
    assert julian[-1] == "staff.availability_changed"


async def test_seeded_arrivals_respect_rule_3_and_the_queue_order() -> None:
    """Replaying the seeded log: a case assigned on arrival never jumps a waiting case of
    its language, and its analyst was not paused at that time."""
    container = await memory_container()
    events = await all_events(container)
    async with container.uow() as uow:
        language = {n: (await uow.cases.get(seed_case_id(n))) for n, _ in DEMO_STORIES}
    case_language = {seed_case_id(n): case.language for n, case in language.items() if case}
    waiting: dict[str, str] = {}  # case id → language
    paused: set[str] = set()
    for event in events:
        if event.event_type == "staff.availability_changed":
            if event.payload["to_status"] == "paused":
                paused.add(event.entity_id)
            else:
                paused.discard(event.entity_id)
        elif event.event_type == "case.queued":
            assert event.case_id is not None
            waiting[event.case_id] = case_language[event.case_id]
        elif event.event_type == "case.assigned":
            assert event.case_id is not None
            waiting.pop(event.case_id, None)
            if event.payload["reason"] == "language_least_loaded":
                assert case_language[event.case_id] not in waiting.values(), event.case_id
                assert event.payload["assigned_analyst_id"] not in paused, event.case_id
    assert sorted(waiting) == [seed_case_id(n) for n in (109, 111, 112)]


async def all_events(container: Container) -> list[StoredEvent]:
    async with container.uow() as uow:
        return list((await uow.event_log.page(limit=500)).items)
