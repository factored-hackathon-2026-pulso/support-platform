"""The notification center (slice 10) over the real composition and both persistence adapters:
the projector's mapping for every kind, its recipients (only active people, never the actor),
idempotency, the queue dedup per language, the SLA sweep, retention, the list (keyset
pagination, unread count) and reading (only her own).

Seed (``infrastructure/seed/``): Daniela's 101 and Julián's 113 are open escalations, 107 was
answered by Lucía, Paula's 114 ended as ``reassigned`` to Julián; 111 and 112 wait in the
Spanish queue and 109 in the Portuguese one; Mariana is locked; nobody is available.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import ClassVar

import pytest

from cc_platform.application.cases.dto import (
    CloseCaseCommand,
    PostTurnCommand,
    RateConversationCommand,
)
from cc_platform.application.cases.escalations import EscalateCommand
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.errors import InvalidCredentialsError
from cc_platform.application.events import EventRecord
from cc_platform.application.notifications.writer import NotificationDraft, NotificationWriter
from cc_platform.application.people.dto import LoginCommand
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.cases.values import CaseStatus, CloseReason
from cc_platform.domain.notifications.notification import Notification, NotificationKind
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.errors import AccountLockedError
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_escalation_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import (
    ADMIN,
    ADMIN_ONLY,
    ANALYST,
    JULIAN,
    MARIANA,
    PAULA,
    SEBASTIAN,
    SECOND_SUPERVISOR,
    SUPERVISOR,
    TEAM_LEAD,
    actor_for,
    customer_actor,
    make_settings,
)

K = NotificationKind
DANIELA_ID, JULIAN_ID, PAULA_ID, SEBASTIAN_ID = (s.id for s in (ANALYST, JULIAN, PAULA, SEBASTIAN))
LUCIA_ID, RENATA_ID, FELIPE_ID, MARIANA_ID = (
    s.id for s in (SUPERVISOR, SECOND_SUPERVISOR, TEAM_LEAD, MARIANA)
)
MARTIN_ID = seed_staff_id(6)
VALERIA_ID, CAROLINA_ID = ADMIN_ONLY.id, ADMIN.id
SUPERVISORS = {LUCIA_ID, MARTIN_ID, RENATA_ID, FELIPE_ID, MARIANA_ID}
ADMINS = {VALERIA_ID, CAROLINA_ID}
DANIELA, JULIAN_A, LUCIA, FELIPE, SEBASTIAN_A = (
    actor_for(s) for s in (ANALYST, JULIAN, SUPERVISOR, TEAM_LEAD, SEBASTIAN)
)
MARCELA, PATRICIA_NEW, JOAQUIN, CLAUDIA, CAMILA, ESTEBAN, PATRICIA_OLD = (
    seed_case_id(n) for n in (101, 108, 107, 105, 113, 114, 104)
)
ROSA, MAURICIO, GABRIELA = (seed_case_id(n) for n in (111, 112, 109))


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'notifications.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


async def mine(world: Container, staff_id: str) -> list[Notification]:
    async with world.uow() as uow:
        return await uow.notifications.page(staff_id, before=None, limit=500)


async def kinds_of(world: Container, staff_id: str) -> list[tuple[NotificationKind, str | None]]:
    return [(n.kind, n.case_id) for n in await mine(world, staff_id)]


async def newest(world: Container, staff_id: str) -> Notification:
    return (await mine(world, staff_id))[0]


async def who_has(world: Container, kind: NotificationKind, case_id: str | None) -> set[str]:
    async with world.uow() as uow:
        people = await uow.staff.list()
    found: set[str] = set()
    for person in people:
        if (kind, case_id) in await kinds_of(world, person.id):
            found.add(person.id)
    return found


def message(text: str = "Hola, necesito ayuda") -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=str(uuid.uuid4()))


async def write_as(world: Container, customer: int, text: str = "Hola") -> str:
    result = await world.use_cases.cases.post_customer_turn.execute(
        customer_actor(customer), message(text)
    )
    await world.background.drain()
    return result.conversation.case_id


async def available(world: Container, *people: object) -> None:
    for seed in people:
        await world.use_cases.people.set_availability.execute(
            actor_for(seed),  # type: ignore[arg-type]
            AvailabilityStatus.AVAILABLE,
        )
    await world.background.drain()


# ----------------------------------------------------------------------------- the seed story
async def test_the_seed_story_notified_its_people(world: Container) -> None:
    """The seed commits through the domain, so the projector saw its events."""
    daniela = await mine(world, DANIELA_ID)
    answered = next(n for n in daniela if n.kind is K.ESCALATION_ANSWERED)
    assert (answered.case_id, answered.actor_id) == (JOAQUIN, LUCIA_ID)
    assert answered.escalation_id == seed_escalation_id(107)
    rated = next(n for n in daniela if n.kind is K.CASE_RATED and n.case_id == PATRICIA_OLD)
    assert rated.score == 4
    assert (K.CUSTOMER_RETURNED, PATRICIA_NEW) in await kinds_of(world, DANIELA_ID)
    # 114: Paula hears it through the escalation, never twice; Julián got it from supervision.
    paula = await kinds_of(world, PAULA_ID)
    assert (K.ESCALATION_REASSIGNED, ESTEBAN) in paula
    assert (K.REASSIGNED_AWAY, ESTEBAN) not in paula
    julian = await mine(world, JULIAN_ID)
    by_lucia = next(n for n in julian if n.kind is K.ASSIGNED_BY_SUPERVISOR)
    assert (by_lucia.case_id, by_lucia.actor_id) == (ESTEBAN, LUCIA_ID)
    # Supervision: every escalation, one queue notice per language; never to an admin.
    assert await who_has(world, K.CASE_ESCALATED, MARCELA) == SUPERVISORS
    queued = {
        (n.case_id, n.language) for n in await mine(world, LUCIA_ID) if n.kind is K.CASE_QUEUED
    }
    assert queued == {(ROSA, Language.SPANISH), (GABRIELA, Language.PORTUGUESE)}
    # Administration: Mariana's lock, for the active admins only.
    assert await who_has(world, K.ACCOUNT_LOCKED, None) == ADMINS
    locked = await newest(world, VALERIA_ID)
    assert (locked.target_id, locked.failed_attempts) == (MARIANA_ID, 5)
    # The story's older facts start read; the newest ones are "Nuevas".
    assert answered.read_at is not None
    assert any(n.read_at is None for n in daniela)


# ----------------------------------------------------------------------------- analyst kinds
async def test_assigned_on_arrival_and_from_the_queue(world: Container) -> None:
    await available(world, SEBASTIAN)  # speaks es and pt: drains every queued case
    drained = {
        n.case_id for n in await mine(world, SEBASTIAN_ID) if n.kind is K.ASSIGNED_FROM_QUEUE
    }
    assert drained == {ROSA, MAURICIO, GABRIELA}
    case_id = await write_as(world, 2001)
    first = await newest(world, SEBASTIAN_ID)
    assert (first.kind, first.case_id, first.actor_id) == (K.ASSIGNED_ON_ARRIVAL, case_id, None)
    assert first.customer_id == seed_customer_id(2001)
    assert first.language is Language.SPANISH


async def test_a_customer_who_returns_is_customer_returned(world: Container) -> None:
    await available(world, ANALYST)  # Daniela drains the queues first
    case_id = await write_as(world, 1005)  # Claudia's 105 is closed
    assert (await newest(world, DANIELA_ID)).kind is K.CUSTOMER_RETURNED
    assert (await newest(world, DANIELA_ID)).case_id == case_id


async def test_a_reassignment_notifies_both_analysts(world: Container) -> None:
    await world.use_cases.cases.set_assignee.execute(
        LUCIA, PATRICIA_NEW, SetAssigneeCommand(JULIAN_ID, DANIELA_ID, confirm_paused=True)
    )
    to_julian, away = await newest(world, JULIAN_ID), await newest(world, DANIELA_ID)
    assert (to_julian.kind, to_julian.case_id, to_julian.actor_id) == (
        K.ASSIGNED_BY_SUPERVISOR,
        PATRICIA_NEW,
        LUCIA_ID,
    )
    assert (away.kind, away.actor_id, away.target_id) == (K.REASSIGNED_AWAY, LUCIA_ID, JULIAN_ID)
    # From the queue by hand: assigned_by_supervisor, nobody loses it.
    await world.use_cases.cases.set_assignee.execute(
        LUCIA, ROSA, SetAssigneeCommand(JULIAN_ID, None, confirm_paused=True)
    )
    assert (await newest(world, JULIAN_ID)).kind is K.ASSIGNED_BY_SUPERVISOR


async def test_escalation_outcomes_reach_who_escalated(world: Container) -> None:
    cases = world.use_cases.cases
    await cases.respond_escalation.execute(LUCIA, seed_escalation_id(113), "Sigue tú.")
    answered = await newest(world, JULIAN_ID)
    assert (answered.kind, answered.case_id, answered.actor_id) == (
        K.ESCALATION_ANSWERED,
        CAMILA,
        LUCIA_ID,
    )
    # Felipe takes Daniela's escalated 101: one notification for her, none for him.
    before_felipe = len(await mine(world, FELIPE_ID))
    await cases.take_escalated_case.execute(FELIPE, seed_escalation_id(101))
    taken = await newest(world, DANIELA_ID)
    assert (taken.kind, taken.actor_id, taken.target_id) == (
        K.ESCALATION_TAKEN,
        FELIPE_ID,
        FELIPE_ID,
    )
    assert (K.REASSIGNED_AWAY, MARCELA) not in await kinds_of(world, DANIELA_ID)
    assert len(await mine(world, FELIPE_ID)) == before_felipe
    # Reassigning an escalated case: the escalation kind, never reassigned_away too.
    escalated = await cases.escalate.execute(
        DANIELA, PATRICIA_NEW, EscalateCommand(motive="Pide supervisión.", idempotency_key="k-1")
    )
    await cases.set_assignee.execute(
        LUCIA, PATRICIA_NEW, SetAssigneeCommand(SEBASTIAN_ID, DANIELA_ID, confirm_paused=True)
    )
    moved = await newest(world, DANIELA_ID)
    assert (moved.kind, moved.target_id, moved.escalation_id) == (
        K.ESCALATION_REASSIGNED,
        SEBASTIAN_ID,
        escalated.escalation.id,
    )
    assert (K.REASSIGNED_AWAY, PATRICIA_NEW) not in await kinds_of(world, DANIELA_ID)
    assert (await newest(world, SEBASTIAN_ID)).kind is K.ASSIGNED_BY_SUPERVISOR


async def test_a_rating_reaches_who_closed_the_case(world: Container) -> None:
    await world.use_cases.cases.rate_conversation.execute(
        customer_actor(1005),
        CLAUDIA,
        RateConversationCommand(score=2, comment=None, idempotency_key="rate-k-0001"),
    )
    rated = await newest(world, DANIELA_ID)
    assert (rated.kind, rated.case_id, rated.score, rated.actor_id) == (
        K.CASE_RATED,
        CLAUDIA,
        2,
        None,
    )


# ----------------------------------------------------------------------------- supervision kinds
async def test_an_escalation_reaches_every_active_supervisor_but_the_actor(
    world: Container,
) -> None:
    async with world.uow() as uow:  # Martín leaves: inactive people get nothing
        martin = await uow.staff.get(MARTIN_ID)
        assert martin is not None
        martin.active = False
        await uow.staff.save(martin)
        await uow.commit()
    await world.use_cases.cases.escalate.execute(
        DANIELA, PATRICIA_NEW, EscalateCommand(motive="Pide supervisión.", idempotency_key="k-2")
    )
    assert await who_has(world, K.CASE_ESCALATED, PATRICIA_NEW) == SUPERVISORS - {MARTIN_ID}
    note = await newest(world, LUCIA_ID)
    assert (note.actor_id, note.escalation_id is not None) == (DANIELA_ID, True)
    # Felipe (Analista + Supervisión) escalating his own case does not notify himself.
    await available(world, TEAM_LEAD)  # drains the Spanish queue to him
    async with world.uow() as uow:
        his = (await uow.cases.get(ROSA)) or (await uow.cases.get(MAURICIO))
        assert his is not None
        assert his.assigned_analyst_id == FELIPE_ID
    await world.use_cases.cases.escalate.execute(
        FELIPE, his.id, EscalateCommand(motive="Necesito ayuda.", idempotency_key="k-3")
    )
    assert await who_has(world, K.CASE_ESCALATED, his.id) == SUPERVISORS - {MARTIN_ID, FELIPE_ID}


async def test_case_queued_once_per_language_while_it_waits(world: Container) -> None:
    supervision = world.use_cases.cases
    # Empty the Spanish queue by hand (nobody is available).
    for case_id in (ROSA, MAURICIO):
        await supervision.set_assignee.execute(
            LUCIA, case_id, SetAssigneeCommand(JULIAN_ID, None, confirm_paused=True)
        )
    first = await write_as(world, 2001)
    assert await who_has(world, K.CASE_QUEUED, first) == SUPERVISORS
    second = await write_as(world, 2002)  # the queue still holds ``first``
    assert await who_has(world, K.CASE_QUEUED, second) == set()
    # Portuguese has its own queue (Gabriela still waits there): no new notice either.
    portuguese = await write_as(world, 2004)
    assert await who_has(world, K.CASE_QUEUED, portuguese) == set()
    # Once the Spanish queue empties, the next case notifies again.
    for case_id in (first, second):
        await supervision.set_assignee.execute(
            LUCIA, case_id, SetAssigneeCommand(JULIAN_ID, None, confirm_paused=True)
        )
    third = await write_as(world, 2003)
    assert await who_has(world, K.CASE_QUEUED, third) == SUPERVISORS


async def test_the_sla_sweep_notifies_once_per_case(world: Container) -> None:
    clock = world.clock
    assert isinstance(clock, FixedClock)
    sweep = world.use_cases.notifications.sweep_sla_risk
    written = await sweep.execute()
    async with world.uow() as uow:
        open_cases = await uow.cases.list_by_statuses(
            {CaseStatus.QUEUED, CaseStatus.ASSIGNED, CaseStatus.IN_PROGRESS}
        )
        at_risk = {
            c.id
            for c in open_cases
            if c.first_response_at is None and c.sla_due_at - clock.now() <= timedelta(minutes=5)
        }
    assert written == len(at_risk) * len(SUPERVISORS)
    assert ROSA in at_risk  # due in 4 min (seed)
    rosa = next(
        n for n in await mine(world, LUCIA_ID) if n.kind is K.SLA_AT_RISK and n.case_id == ROSA
    )
    async with world.uow() as uow:
        case = await uow.cases.get(ROSA)
        assert case is not None
    assert rosa.created_at == case.sla_due_at - timedelta(minutes=5)
    assert rosa.source_key == f"sla:{ROSA}"
    assert await sweep.execute() == 0  # once per case
    # Mauricio's 112 (due in 7 min) enters the window later; nothing for answered cases.
    assert MAURICIO not in at_risk
    clock.advance(timedelta(minutes=3))
    assert await sweep.execute() >= len(SUPERVISORS)
    assert await who_has(world, K.SLA_AT_RISK, MAURICIO) == SUPERVISORS
    assert not await who_has(world, K.SLA_AT_RISK, JOAQUIN)  # 107 was answered


# ----------------------------------------------------------------------------- administration
async def test_a_lock_reaches_the_admins(world: Container) -> None:
    people = world.use_cases.people
    for _ in range(4):
        with pytest.raises(InvalidCredentialsError):
            await people.login.execute(LoginCommand(email=JULIAN.email, password="nope-nope"))
    with pytest.raises(AccountLockedError):
        await people.login.execute(LoginCommand(email=JULIAN.email, password="nope-nope"))
    assert await who_has(world, K.ACCOUNT_LOCKED, None) == ADMINS
    lock = await newest(world, CAROLINA_ID)
    assert (lock.target_id, lock.failed_attempts, lock.case_id) == (JULIAN_ID, 5, None)


@dataclass(frozen=True, kw_only=True, slots=True)
class _InvitationAccepted(DomainEvent):
    """Stand-in for the event part 4 records (``staff.invitation_accepted``)."""

    event_type: ClassVar[str] = "staff.invitation_accepted"
    entity: ClassVar[str] = "staff"


async def test_an_accepted_invitation_reaches_the_admins(world: Container) -> None:
    async with world.uow() as uow:
        uow.record(
            _InvitationAccepted(
                occurred_at=world.clock.now(),
                actor=ActorRef(ActorRole.ANALYST, JULIAN_ID),
                entity_id=JULIAN_ID,
            )
        )
        await uow.commit()
    accepted = await newest(world, VALERIA_ID)
    assert (accepted.kind, accepted.target_id, accepted.actor_id) == (
        K.INVITATION_ACCEPTED,
        JULIAN_ID,
        JULIAN_ID,
    )
    assert await who_has(world, K.INVITATION_ACCEPTED, None) == ADMINS


# ----------------------------------------------------------------------------- idempotency
async def test_the_same_fact_never_notifies_twice(world: Container) -> None:
    await world.use_cases.cases.rate_conversation.execute(
        customer_actor(1005),
        CLAUDIA,
        RateConversationCommand(score=3, comment=None, idempotency_key="rate-k-0002"),
    )
    before = await mine(world, DANIELA_ID)
    async with world.uow() as uow:
        page = await uow.event_log.page(case_id=CLAUDIA, limit=500)
    rated = next(e for e in page.items if e.event_type == "case.rated")
    record = EventRecord(
        event_id=rated.event_id,
        event=_rated_event(rated.payload, rated.event_time),
        ingested_at=rated.ingested_at,
    )
    await world.event_bus.publish([record, record])
    assert [n.id for n in await mine(world, DANIELA_ID)] == [n.id for n in before]


def _rated_event(payload: object, at: object) -> DomainEvent:
    from cc_platform.domain.cases.events import CaseRated

    assert isinstance(payload, dict)
    return CaseRated(
        occurred_at=at,  # type: ignore[arg-type]
        actor=ActorRef(ActorRole.CUSTOMER, seed_customer_id(1005)),
        entity_id=CLAUDIA,
        case_id=CLAUDIA,
        score=int(payload["score"]),
        comment=None,
        analyst_id=str(payload["analyst_id"]),
    )


# ----------------------------------------------------------------------------- retention
async def test_only_the_newest_are_kept(world: Container) -> None:
    clock = world.clock
    writer = NotificationWriter(
        uow=world.uow,
        ids=world.ids,
        signals=world.use_cases.notifications.mark_read.signals,
        retention=3,
    )
    for n in range(5):
        await writer.write(
            [
                NotificationDraft(
                    kind=K.CASE_RATED,
                    recipients=(SEBASTIAN_ID,),
                    created_at=clock.now() + timedelta(seconds=n),
                    source_key=f"test:{n}",
                    case_id=CLAUDIA,
                    score=4,
                )
            ]
        )
    kept = await mine(world, SEBASTIAN_ID)
    assert [n.source_key for n in kept] == ["test:4", "test:3", "test:2"]
    # An old fact for a full list is not kept (and nothing breaks).
    late = NotificationDraft(
        kind=K.CASE_RATED,
        recipients=(SEBASTIAN_ID,),
        created_at=clock.now() - timedelta(days=1),
        source_key="test:old",
        case_id=CLAUDIA,
        score=1,
    )
    assert await writer.write([late]) == []
    assert len(await mine(world, SEBASTIAN_ID)) == 3


# ----------------------------------------------------------------------------- list and read
async def test_the_list_pages_newest_first_with_the_unread_count(world: Container) -> None:
    notifications = world.use_cases.notifications
    every = await mine(world, DANIELA_ID)
    unread = sum(1 for n in every if n.read_at is None)
    seen: list[str] = []
    cursor: str | None = None
    while True:
        page = await notifications.list_mine.execute(DANIELA, cursor=cursor, limit=3)
        assert page.unread_count == unread
        assert len(page.items) <= 3
        seen.extend(item.id for item in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break
    assert seen == [n.id for n in every]
    times = [n.created_at for n in every]
    assert times == sorted(times, reverse=True)
    first = (await notifications.list_mine.execute(DANIELA, limit=1)).items[0]
    assert first.customer_name is not None
    assert first.role.value == "analyst"
    for bad in ("x", "12.NTF-1", "-1.NTF-00000000000000000000000001", "1.CASE-1"):
        with pytest.raises(InvalidValueError):
            await notifications.list_mine.execute(DANIELA, cursor=bad)


async def test_views_name_people_and_the_case_now(world: Container) -> None:
    page = await world.use_cases.notifications.list_mine.execute(DANIELA, limit=100)
    answered = next(i for i in page.items if i.kind is K.ESCALATION_ANSWERED)
    assert (answered.actor_name, answered.customer_name) == (
        "Lucía Herrera",
        "Joaquín Ferreyra Paz",
    )
    assert answered.sla_due_at is not None
    lucia = await world.use_cases.notifications.list_mine.execute(LUCIA, limit=100)
    escalated = next(i for i in lucia.items if i.kind is K.CASE_ESCALATED)
    assert escalated.actor_name is not None
    valeria = await world.use_cases.notifications.list_mine.execute(actor_for(ADMIN_ONLY))
    lock, accepted = valeria.items  # newest first: Mariana's lock (T−2m), Tatiana (T−1h)
    assert (lock.target_name, lock.customer_name, lock.case_id) == ("Mariana Duque", None, None)
    assert (accepted.kind, accepted.target_name, accepted.actor_name) == (
        K.INVITATION_ACCEPTED,
        "Tatiana Rojas",
        "Tatiana Rojas",
    )


async def test_reading_one_and_all_of_her_own(world: Container) -> None:
    notifications = world.use_cases.notifications
    unread = [n for n in await mine(world, DANIELA_ID) if n.read_at is None]
    assert len(unread) >= 2
    result = await notifications.mark_read.execute(DANIELA, unread[0].id)
    assert (result.changed, result.notification.read_at is not None) == (True, True)
    assert result.unread_count == len(unread) - 1
    again = await notifications.mark_read.execute(DANIELA, unread[0].id)
    assert (again.changed, again.unread_count) == (False, len(unread) - 1)
    # Only her own: someone else's, an unknown or a malformed id is "not found".
    lucias = (await mine(world, LUCIA_ID))[0].id
    for other in (lucias, "NTF-00000000000000000000000999", "nope"):
        with pytest.raises(NotFoundError):
            await notifications.mark_read.execute(DANIELA, other)
    everything = await notifications.mark_all_read.execute(DANIELA)
    assert (everything.updated, everything.unread_count) == (len(unread) - 1, 0)
    assert all(n.read_at is not None for n in await mine(world, DANIELA_ID))
    assert (await notifications.mark_all_read.execute(DANIELA)).updated == 0
    # Lucía's are untouched.
    assert any(n.read_at is None for n in await mine(world, LUCIA_ID))


async def test_closing_a_case_notifies_nobody(world: Container) -> None:
    before = {p: len(await mine(world, p)) for p in (DANIELA_ID, LUCIA_ID, VALERIA_ID)}
    await world.use_cases.cases.close.execute(
        DANIELA, PATRICIA_NEW, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )
    after = {p: len(await mine(world, p)) for p in (DANIELA_ID, LUCIA_ID, VALERIA_ID)}
    assert after == before


async def test_startup_sweeps_once_then_ticks(tmp_path: Path) -> None:
    """With the sweep on (the default outside tests), startup writes the cases already at risk
    and starts the loop; shutdown stops it."""
    container = build_container(
        make_settings(
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'sweep.db'}",
            notification_sweep_seconds=30,
        ),
        clock=FixedClock(),
        ids=SequentialIdGenerator(),
    )
    await container.startup()
    try:
        assert container.sla_sweep is not None
        assert container.sla_sweep.running
        assert (K.SLA_AT_RISK, ROSA) in await kinds_of(container, LUCIA_ID)
    finally:
        await container.shutdown()
    assert not container.sla_sweep.running
