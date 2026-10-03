"""Supervision read models (slice 3 contract §2, §9.4): "Ahora", load, waits, SLA risk,
teams and the language queues, over the seeded data and a pinned clock."""

from __future__ import annotations

from datetime import timedelta

import pytest

from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.cases.supervision import (
    SLA_AT_RISK,
    AnalystActivity,
    QueueOverviewView,
    TeamAnalystView,
    TeamOverviewView,
    activity_of,
)
from cc_platform.application.people.dto import LoginCommand, VerifyMfaCommand
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import (
    DEMO_STAFF,
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
    seed_team_id,
)
from tests.support import (
    SUPERVISOR,
    PlainHasher,
    actor_for,
    make_available_quietly,
    memory_container,
)

A, P = AvailabilityStatus.AVAILABLE, AvailabilityStatus.PAUSED


@pytest.mark.parametrize(
    ("availability", "signed_in", "open_cases", "expected"),
    [
        (A, True, 2, AnalystActivity.BUSY),
        (A, False, 2, AnalystActivity.BUSY),  # no session: cases keep landing on her
        (A, True, 0, AnalystActivity.AVAILABLE),
        (A, False, 0, AnalystActivity.AVAILABLE),
        (P, True, 3, AnalystActivity.PAUSED),
        (P, True, 0, AnalystActivity.PAUSED),
        (P, False, 3, AnalystActivity.OFFLINE),
        (P, False, 0, AnalystActivity.OFFLINE),
    ],
)
def test_activity_table(
    availability: AvailabilityStatus, signed_in: bool, open_cases: int, expected: AnalystActivity
) -> None:
    assert activity_of(availability, signed_in=signed_in, open_cases=open_cases) is expected


def test_sla_risk_window_is_five_minutes() -> None:
    assert timedelta(minutes=5) == SLA_AT_RISK


def row(team: TeamOverviewView, staff_number: int) -> TeamAnalystView:
    return next(a for a in team.analysts if a.id == seed_staff_id(staff_number))


async def test_seeded_team_matches_the_contract() -> None:
    container = await memory_container()
    team = await container.use_cases.cases.team_overview.execute()
    now = container.clock.now()

    assert [a.name for a in team.analysts] == [
        "Julián Ortega",  # paused (seeded session)
        "Daniela Ríos",  # offline (paused, no session), by name
        "Felipe Echeverri",
        "Paula Medina",
        "Sebastián Cárdenas",
        "Tomás Arango",
    ]
    daniela = row(team, 1)
    # Nobody starts available: Daniela paused at T−12m, before the queued cases arrived.
    assert (daniela.activity, daniela.signed_in, daniela.availability) == (
        AnalystActivity.OFFLINE,
        False,
        AvailabilityStatus.PAUSED,
    )
    assert daniela.availability_since == now - timedelta(minutes=12)
    assert (daniela.counts.open, daniela.counts.new, daniela.counts.to_reply) == (5, 2, 2)
    assert daniela.counts.waiting == 1
    assert daniela.oldest_waiting_since == now - timedelta(minutes=14)  # 108
    assert [c.id for c in daniela.open_cases] == [
        seed_case_id(n) for n in (108, 103, 101, 102, 107)
    ]  # inbox order: new/to_reply by oldest interaction, then waiting
    assert [lang.value for lang in daniela.languages] == ["es", "pt"]
    assert [r.value for r in daniela.roles] == ["analyst"]

    julian = row(team, 2)
    assert (julian.activity, julian.signed_in, julian.availability) == (
        AnalystActivity.PAUSED,
        True,
        AvailabilityStatus.PAUSED,
    )
    assert julian.availability_since == now - timedelta(minutes=20)
    assert (julian.counts.open, julian.counts.to_reply, julian.counts.waiting) == (2, 1, 1)
    assert [c.id for c in julian.open_cases] == [seed_case_id(113), seed_case_id(114)]

    felipe = row(team, 11)
    assert (felipe.activity, felipe.counts.open, felipe.oldest_waiting_since) == (
        AnalystActivity.OFFLINE,
        0,
        None,
    )
    assert [r.value for r in felipe.roles] == ["analyst", "supervisor"]
    assert seed_staff_id(5) not in {a.id for a in team.analysts}  # Lucía: supervisor only
    assert seed_staff_id(13) not in {a.id for a in team.analysts}  # Andrés: inactive
    assert daniela.team.id == seed_team_id(1)

    andes, pacifico = team.teams
    assert (andes.id, andes.name, andes.analyst_count) == (
        seed_team_id(1),
        "Disputas · Equipo Andes",
        3,
    )
    assert (andes.activity.busy, andes.activity.paused, andes.activity.offline) == (0, 1, 2)
    # 108, 102 and 103 (first response due within 5 min) and 113 (overdue).
    assert (andes.open_cases, andes.at_risk_cases) == (7, 4)
    assert (pacifico.id, pacifico.analyst_count, pacifico.activity.offline) == (
        seed_team_id(2),
        3,
        3,
    )
    assert (pacifico.open_cases, pacifico.at_risk_cases) == (0, 0)
    assert team.server_time == now


async def test_at_risk_follows_the_clock() -> None:
    clock = FixedClock()
    container = await memory_container(clock=clock)
    queues = await container.use_cases.cases.queue_overview.execute()
    assert queues.queues[1].at_risk == 0  # 109 is due T+9
    team = await container.use_cases.cases.team_overview.execute()
    assert team.teams[0].at_risk_cases == 4
    clock.advance(timedelta(minutes=8))  # 109 enters the window
    queues = await container.use_cases.cases.queue_overview.execute()
    assert queues.queues[1].at_risk == 1
    team = await container.use_cases.cases.team_overview.execute()
    assert team.teams[0].at_risk_cases == 4  # overdue cases stay at risk


async def test_a_missing_availability_row_is_paused() -> None:
    container = await memory_container(seed=False)
    await seed_demo_staff(container.uow, PlainHasher())
    without_tomas = tuple(s for s in DEMO_STAFF if s.number != 8)
    await seed_demo_availability(container.uow, container.clock, seeds=without_tomas)
    team = await container.use_cases.cases.team_overview.execute()
    tomas = row(team, 8)
    assert (tomas.availability, tomas.availability_since, tomas.activity) == (
        AvailabilityStatus.PAUSED,
        None,
        AnalystActivity.OFFLINE,
    )
    assert row(team, 1).availability_since == container.clock.now() - timedelta(minutes=12)


async def test_signing_in_moves_an_analyst_from_offline_to_paused() -> None:
    container = await memory_container()
    people = container.use_cases.people
    login = await people.login.execute(
        LoginCommand(email="felipe.echeverri@latambank.example", password="demo1234")
    )
    grant = await people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code="000000")
    )
    team = await container.use_cases.cases.team_overview.execute()
    assert (row(team, 11).signed_in, row(team, 11).activity) == (True, AnalystActivity.PAUSED)
    actor = await people.authenticate.execute(grant.token)
    await people.logout.execute(actor)
    team = await container.use_cases.cases.team_overview.execute()
    assert row(team, 11).activity is AnalystActivity.OFFLINE


def queue(overview: QueueOverviewView, language: str) -> tuple[int, int, int, int, list[str]]:
    q = next(q for q in overview.queues if q.language.value == language)
    return (q.waiting, q.at_risk, q.available_speakers, q.speakers, [c.id for c in q.cases])


async def test_seeded_queues_match_the_contract() -> None:
    container = await memory_container()
    overview = await container.use_cases.cases.queue_overview.execute()
    now = container.clock.now()
    assert [(q.language.value, q.label) for q in overview.queues] == [
        ("es", "Cola en español"),
        ("pt", "Cola en portugués"),
    ]
    # Spanish: 111 (SLA in 4 min) and 112 (overdue) at risk. Nobody available speaks
    # either language: that is why they wait (rule 3).
    assert queue(overview, "es") == (2, 2, 0, 6, [seed_case_id(111), seed_case_id(112)])
    assert queue(overview, "pt") == (1, 0, 0, 3, [seed_case_id(109)])
    spanish, portuguese = overview.queues
    assert spanish.oldest_queued_at == now - timedelta(minutes=11)
    assert portuguese.oldest_queued_at == now - timedelta(minutes=6)
    counts = overview.counts
    assert counts.total == 3
    assert [(c.language.value, c.waiting) for c in counts.by_language] == [("es", 2), ("pt", 1)]
    assert counts.computed_at == overview.server_time == now


async def test_both_queues_are_listed_even_when_empty() -> None:
    container = await memory_container()
    await make_available_quietly(container.uow, seed_staff_id(1))
    lucia = actor_for(SUPERVISOR)
    set_assignee = container.use_cases.cases.set_assignee
    for number in (111, 112, 109):
        await set_assignee.execute(
            lucia,
            seed_case_id(number),
            SetAssigneeCommand(analyst_id=seed_staff_id(1), expected_analyst_id=None),
        )
    overview = await container.use_cases.cases.queue_overview.execute()
    assert [
        (q.language.value, q.waiting, q.oldest_queued_at, q.cases) for q in overview.queues
    ] == [
        ("es", 0, None, ()),
        ("pt", 0, None, ()),
    ]
    assert overview.counts.total == 0
    team = await container.use_cases.cases.team_overview.execute()
    assert row(team, 1).counts.open == 8
