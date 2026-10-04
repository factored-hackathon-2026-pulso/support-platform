"""``SetCaseAssignee`` (slice 3 contract §3.3–§3.5, §3.9): the rules in order, the effects of
one Unit of Work, the server texts, and the races settled by the case's compare-and-set."""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from dataclasses import dataclass, replace

import pytest

from cc_platform.application.cases.assignment import (
    AssignCase,
    DrainQueue,
    LanguageLeastLoadedStrategy,
    RepositoryAnalystDirectory,
)
from cc_platform.application.cases.commands import CloseCase, PostAnalystTurn
from cc_platform.application.cases.customer_chat import PostCustomerTurn
from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.errors import (
    AnalystNotEligibleError,
    AnalystPausedError,
    AssignmentChangedError,
    CaseNotAssignedError,
)
from cc_platform.application.cases.manual_assignment import (
    AssignmentResultView,
    SetAssigneeCommand,
    SetCaseAssignee,
)
from cc_platform.application.cases.sla import FirstResponseSlaPolicy
from cc_platform.application.events import StoredEvent
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import (
    AssignmentReason,
    CaseClosedError,
    CaseStatus,
    CloseReason,
    LanguageMismatchError,
    Turn,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
)
from tests.support import (
    ANALYST,
    JULIAN,
    SUPERVISOR,
    TEAM_LEAD,
    PlainHasher,
    actor_for,
    customer_actor,
    make_available_quietly,
    memory_container,
)

DANIELA_ID, JULIAN_ID = seed_staff_id(1), seed_staff_id(2)
SEBASTIAN_ID, FELIPE_ID = seed_staff_id(4), seed_staff_id(11)
GABRIELA_PT, ROSA_ES, MAURICIO_ES = seed_case_id(109), seed_case_id(111), seed_case_id(112)
CAMILA, ESTEBAN, LARISSA_PT, REFUND = (
    seed_case_id(113),
    seed_case_id(114),
    seed_case_id(103),
    seed_case_id(104),
)
LUCIA = actor_for(SUPERVISOR)


async def seeded(clock: FixedClock | None = None) -> Container:
    """The seeded world with Daniela available (the usual target here); the queues stay as
    seeded (``make_available_quietly``)."""
    container = await memory_container(clock=clock)
    await make_available_quietly(container.uow, DANIELA_ID)
    return container


def to(analyst_id: str, expected: str | None, *, confirm: bool = False) -> SetAssigneeCommand:
    return SetAssigneeCommand(
        analyst_id=analyst_id, expected_analyst_id=expected, confirm_paused=confirm
    )


async def events_of(container: Container) -> list[StoredEvent]:
    async with container.uow() as uow:
        return list((await uow.event_log.page(limit=500)).items)


async def turns_of(container: Container, case_id: str) -> list[Turn]:
    async with container.uow() as uow:
        return await uow.turns.page(case_id, limit=100)


async def assign(
    container: Container, case_id: str, command: SetAssigneeCommand
) -> AssignmentResultView:
    return await container.use_cases.cases.set_assignee.execute(LUCIA, case_id, command)


# ----------------------------------------------------------------------------- rules in order
async def test_unknown_or_malformed_case_is_not_found() -> None:
    container = await seeded()
    for case_id in (seed_case_id(999), "CASE-1", "nada"):
        with pytest.raises(NotFoundError):
            await assign(container, case_id, to(DANIELA_ID, None))


async def test_a_closed_case_is_checked_before_the_target() -> None:
    container = await seeded()
    with pytest.raises(CaseClosedError) as raised:
        await assign(container, REFUND, to(seed_staff_id(7), DANIELA_ID))  # an admin
    assert raised.value.details["currentStatus"] == "closed"


@pytest.mark.parametrize(
    "analyst_id",
    [
        seed_staff_id(99),  # unknown
        "STF-1",  # malformed
        seed_staff_id(5),  # Lucía: supervisor only
        seed_staff_id(7),  # Valeria: admin only
    ],
)
async def test_the_target_must_be_an_active_analyst(analyst_id: str) -> None:
    container = await seeded()
    with pytest.raises(AnalystNotEligibleError) as raised:
        # Even on a Portuguese case: eligibility is checked before the language.
        await assign(container, GABRIELA_PT, to(analyst_id, None))
    assert dict(raised.value.details) == {"analystId": analyst_id}


async def test_an_inactive_analyst_is_not_eligible() -> None:
    container = await seeded()
    async with container.uow() as uow:
        paula = await uow.staff.get(seed_staff_id(3))
        assert paula is not None
        paula.active = False
        await uow.staff.save(paula)
        await uow.commit()
    with pytest.raises(AnalystNotEligibleError):
        await assign(container, ROSA_ES, to(seed_staff_id(3), None, confirm=True))


async def test_rule_3_comes_before_the_holder_and_the_pause() -> None:
    container = await seeded()
    # Julián speaks only Spanish, is paused, and the expected holder is wrong: rule 3 wins.
    with pytest.raises(LanguageMismatchError) as raised:
        await assign(container, GABRIELA_PT, to(JULIAN_ID, DANIELA_ID))
    assert dict(raised.value.details) == {
        "policyRuleId": "H1",
        "caseLanguage": "pt",
        "analystId": JULIAN_ID,
    }


async def test_the_current_assignee_is_a_no_op_without_events() -> None:
    container = await seeded()
    before = await events_of(container)
    async with container.uow() as uow:
        version = (await uow.cases.get(CAMILA)).version  # type: ignore[union-attr]
    # Same analyst: no-op even if the caller saw someone else (a retry, a second supervisor).
    result = await assign(container, CAMILA, to(JULIAN_ID, DANIELA_ID))
    assert result.changed is False
    assert result.case.assigned_analyst_id == JULIAN_ID
    assert result.assignment.analyst_id == JULIAN_ID
    assert await events_of(container) == before
    async with container.uow() as uow:
        assert (await uow.cases.get(CAMILA)).version == version  # type: ignore[union-attr]


@pytest.mark.parametrize("expected", [None, seed_staff_id(3)])
async def test_the_holder_must_be_who_the_supervisor_saw(expected: str | None) -> None:
    container = await seeded()
    with pytest.raises(AssignmentChangedError) as raised:
        await assign(container, CAMILA, to(DANIELA_ID, expected))
    assert dict(raised.value.details) == {"currentAnalystId": JULIAN_ID}
    with pytest.raises(AssignmentChangedError) as from_queue:
        await assign(container, ROSA_ES, to(DANIELA_ID, JULIAN_ID))
    assert dict(from_queue.value.details) == {"currentAnalystId": None}


async def test_a_paused_target_needs_the_confirmation() -> None:
    container = await seeded()
    with pytest.raises(AnalystPausedError) as raised:
        await assign(container, GABRIELA_PT, to(SEBASTIAN_ID, None))
    assert dict(raised.value.details) == {"analystId": SEBASTIAN_ID}
    result = await assign(container, GABRIELA_PT, to(SEBASTIAN_ID, None, confirm=True))
    assert result.changed is True
    assert result.assignment.analyst_id == SEBASTIAN_ID


# ----------------------------------------------------------------------------- effects
async def test_from_the_queue_to_an_available_analyst() -> None:
    container = await seeded()
    before = len(await events_of(container))
    turns_before = len(await turns_of(container, ROSA_ES))
    result = await assign(container, ROSA_ES, to(DANIELA_ID, None, confirm=True))  # ignored

    assert result.changed is True
    assert (result.case.status, result.case.assigned_analyst_id) == (
        CaseStatus.ASSIGNED,
        DANIELA_ID,
    )
    view = result.assignment
    assert (view.reason, view.assigned_by_role, view.assigned_by_name) == (
        AssignmentReason.MANUAL,
        ActorRole.SUPERVISOR,
        "Lucía Herrera",
    )
    assert (view.previous_analyst_id, view.previous_analyst_name) == (None, None)
    assert (view.queue_label, view.waited_seconds, view.policy_rule_id) == (
        "Cola en español",
        11 * 60,
        None,
    )
    async with container.uow() as uow:
        row = await uow.assignments.latest_for_case(ROSA_ES)
        case = await uow.cases.get(ROSA_ES)
    assert row is not None
    assert case is not None
    assert (row.strategy, row.open_cases_at_assignment, row.paused_override) == ("manual", 5, False)
    assert row.assigned_by.actor_id == LUCIA.staff_id
    added = (await events_of(container))[before:]
    assert [e.event_type for e in added] == ["case.assigned", "turn.created"]
    assert added[0].payload["reason"] == "manual"
    new_turns = (await turns_of(container, ROSA_ES))[turns_before:]
    assert [(t.kind, t.audience, t.text) for t in new_turns] == [
        (
            TurnKind.ROUTING,
            TurnAudience.STAFF,
            "Lucía Herrera asignó el caso a Daniela Ríos después de 11 min en la cola en español.",
        )
    ]  # no customer turn from the queue: the header says "Te atiende Daniela"
    conversation = await container.use_cases.cases.customer_conversation.execute(
        customer_actor(1009)
    )
    assert conversation.conversation is not None
    assert (conversation.conversation.status.value, conversation.conversation.agent_name) == (
        "with_agent",
        "Daniela",
    )
    assert case.sla_due_at == result.case.sla_due_at


async def test_from_the_queue_to_a_paused_analyst_says_so() -> None:
    container = await seeded()
    result = await assign(container, GABRIELA_PT, to(SEBASTIAN_ID, None, confirm=True))
    assert result.assignment.policy_rule_id == "H1"
    banner = (await turns_of(container, GABRIELA_PT))[-1]
    assert banner.text == (
        "Lucía Herrera asignó el caso a Sebastián Cárdenas después de 6 min en la cola en "
        "portugués (Sebastián estaba en pausa)."
    )
    async with container.uow() as uow:
        row = await uow.assignments.latest_for_case(GABRIELA_PT)
    assert row is not None
    assert row.paused_override is True
    event = (await events_of(container))[-2]
    assert (event.event_type, event.payload["paused_override"]) == ("case.assigned", True)


async def test_reassignment_tells_the_customer_and_keeps_history_access() -> None:
    container = await seeded()
    sla_before = (await container.use_cases.cases.detail.execute(LUCIA, CAMILA)).case
    before = len(await events_of(container))
    turns_before = len(await turns_of(container, CAMILA))
    result = await assign(container, CAMILA, to(DANIELA_ID, JULIAN_ID))

    assert (result.case.status, result.case.inbox_status.value) == (  # type: ignore[union-attr]
        CaseStatus.ASSIGNED,
        "new",
    )
    assert (result.case.sla_due_at, result.case.first_response_at) == (
        sla_before.sla_due_at,
        None,
    )
    assert result.case.unread_count == sla_before.unread_count  # unread stays unread
    view = result.assignment
    assert (view.previous_analyst_id, view.previous_analyst_name) == (JULIAN_ID, "Julián Ortega")
    assert (view.waited_seconds, view.queue_label) == (None, None)
    added = (await events_of(container))[before:]
    assert [e.event_type for e in added] == [
        "case.status_changed",
        "case.assigned",
        "escalation.reassigned",  # Julián had escalated it (seed, slice 9)
        "turn.created",
        "turn.created",
    ]
    assert added[0].payload["reason"] == "reassigned"
    assert added[1].payload["previous_analyst_id"] == JULIAN_ID
    new_turns = (await turns_of(container, CAMILA))[turns_before:]
    assert [(t.kind, t.audience, t.author_role, t.text) for t in new_turns] == [
        (
            TurnKind.ROUTING,
            TurnAudience.STAFF,
            TurnAuthorRole.SYSTEM,
            "Lucía Herrera pasó el caso de Julián Ortega a Daniela Ríos.",
        ),
        (
            TurnKind.NOTICE,
            TurnAudience.EVERYONE,
            TurnAuthorRole.SYSTEM,
            "Ahora te atiende Daniela, de nuestro equipo.",
        ),
    ]

    inbox = container.use_cases.cases.inbox
    daniela_inbox = await inbox.execute(actor_for(ANALYST))
    assert CAMILA in {item.id for item in daniela_inbox.items}
    assert daniela_inbox.counts.new == 3
    julian = actor_for(JULIAN)
    assert CAMILA not in {item.id for item in (await inbox.execute(julian)).items}
    # He held it: he still reads it (history access), read-only.
    detail = await container.use_cases.cases.detail.execute(julian, CAMILA)
    assert (detail.capabilities.can_reply, detail.capabilities.can_close) == (False, False)
    turns = await container.use_cases.cases.turns.execute(julian, CAMILA)
    assert turns.items[-1].text == "Ahora te atiende Daniela, de nuestro equipo."
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.post_analyst_turn.execute(
            julian, CAMILA, PostTurnCommand(text="Hola", client_message_id=str(uuid.uuid4()))
        )
    # The customer sees the new name, never who reassigned or the banner.
    conversation = await container.use_cases.cases.customer_conversation.execute(
        customer_actor(1011)
    )
    assert conversation.conversation is not None
    assert conversation.conversation.agent_name == "Daniela"
    texts = [t.text for t in conversation.turns]
    assert texts[-1] == "Ahora te atiende Daniela, de nuestro equipo."
    assert not any("Lucía" in text or "Julián" in text for text in texts)


async def test_portuguese_reassignment_to_a_paused_analyst() -> None:
    container = await seeded()
    await assign(container, LARISSA_PT, to(SEBASTIAN_ID, DANIELA_ID, confirm=True))
    banner, notice = (await turns_of(container, LARISSA_PT))[-2:]
    assert banner.text == (
        "Lucía Herrera pasó el caso de Daniela Ríos a Sebastián Cárdenas "
        "(Sebastián estaba en pausa)."
    )
    assert notice.text == "Agora quem te atende é Sebastián, da nossa equipe."


async def test_the_team_lead_may_take_a_case_himself() -> None:
    container = await seeded()
    felipe = actor_for(TEAM_LEAD)
    result = await container.use_cases.cases.set_assignee.execute(
        felipe, ROSA_ES, to(FELIPE_ID, None, confirm=True)
    )
    assert (result.case.assigned_analyst_id, result.assignment.assigned_by_name) == (
        FELIPE_ID,
        "Felipe Echeverri",
    )
    detail = await container.use_cases.cases.detail.execute(felipe, ROSA_ES)
    assert (detail.capabilities.can_reply, detail.capabilities.can_assign) == (True, True)


async def test_an_assignment_is_recorded_as_the_supervisor() -> None:
    container = await seeded()
    await assign(container, MAURICIO_ES, to(DANIELA_ID, None))
    assigned = next(
        e for e in reversed(await events_of(container)) if e.event_type == "case.assigned"
    )
    assert (assigned.actor_role, assigned.actor_id) == ("supervisor", LUCIA.staff_id)


# ----------------------------------------------------------------------------- concurrency
class YieldingUnitOfWork(InMemoryUnitOfWork):
    """Yields before committing, so concurrent commands interleave between read and write."""

    async def commit(self) -> None:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await super().commit()


@dataclass
class Kit:
    store: InMemoryStore
    uow: UnitOfWorkFactory
    set_assignee: SetCaseAssignee
    post_customer: PostCustomerTurn
    post_analyst: PostAnalystTurn
    close: CloseCase
    drain: DrainQueue


async def kit() -> Kit:
    clock, ids, bus, store = (
        FixedClock(),
        SequentialIdGenerator(),
        InProcessEventBus(),
        InMemoryStore(),
    )

    def uow() -> UnitOfWork:
        return YieldingUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(uow, PlainHasher())
    await seed_demo_customers(uow)
    await seed_demo_availability(uow, clock)
    await seed_demo_cases(uow, ids, clock)
    await make_available_quietly(uow, DANIELA_ID)
    assign_case = AssignCase(
        clock, ids, LanguageLeastLoadedStrategy(), RepositoryAnalystDirectory()
    )
    return Kit(
        store=store,
        uow=uow,
        set_assignee=SetCaseAssignee(uow, clock, ids),
        post_customer=PostCustomerTurn(uow, clock, ids, FirstResponseSlaPolicy(), assign_case),
        post_analyst=PostAnalystTurn(uow, clock, ids),
        close=CloseCase(uow, clock, ids),
        drain=DrainQueue(uow, assign_case),
    )


def message(text: str) -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=str(uuid.uuid4()))


def case_turns(k: Kit, case_id: str) -> list[Turn]:
    return sorted(
        (t for t in k.store.turns.values() if t.case_id == case_id), key=lambda t: t.sequence
    )


async def test_a_customer_message_racing_a_reassignment_both_commit() -> None:
    k = await kit()
    camila = customer_actor(1011)
    reassigned, posted = await asyncio.gather(
        k.set_assignee.execute(LUCIA, CAMILA, to(DANIELA_ID, JULIAN_ID)),
        k.post_customer.execute(camila, message("¿Siguen ahí?")),
    )
    assert reassigned.changed is True
    assert posted.conversation.case_id == CAMILA
    turns = case_turns(k, CAMILA)
    assert [t.sequence for t in turns] == list(range(1, len(turns) + 1))  # gap-free
    assert [t.text for t in turns].count("¿Siguen ahí?") == 1
    assert k.store.cases[CAMILA].assigned_analyst_id == DANIELA_ID


async def test_close_then_assign_is_case_closed() -> None:
    k = await kit()
    daniela = actor_for(ANALYST)
    await k.close.execute(daniela, LARISSA_PT, CloseCaseCommand(reason=CloseReason.RESOLVED))
    with pytest.raises(CaseClosedError):
        await k.set_assignee.execute(LUCIA, LARISSA_PT, to(SEBASTIAN_ID, DANIELA_ID, confirm=True))


async def test_assign_then_close_or_reply_is_case_not_assigned() -> None:
    k = await kit()
    julian = actor_for(JULIAN)
    await k.set_assignee.execute(LUCIA, CAMILA, to(DANIELA_ID, JULIAN_ID))
    with pytest.raises(CaseNotAssignedError):
        await k.close.execute(julian, CAMILA, CloseCaseCommand(reason=CloseReason.RESOLVED))
    with pytest.raises(CaseNotAssignedError):
        await k.post_analyst.execute(julian, CAMILA, message("Hola, Camila"))


async def test_a_close_racing_a_reassignment_has_one_winner() -> None:
    k = await kit()
    outcomes = await asyncio.gather(
        k.close.execute(actor_for(JULIAN), CAMILA, CloseCaseCommand(reason=CloseReason.RESOLVED)),
        k.set_assignee.execute(LUCIA, CAMILA, to(DANIELA_ID, JULIAN_ID)),
        return_exceptions=True,
    )
    kinds = {type(o).__name__ for o in outcomes}
    case = k.store.cases[CAMILA]
    if case.is_closed:  # the close won: the reassignment re-ran and found it closed
        assert kinds == {"CaseDetailView", "CaseClosedError"}
        assert case.assigned_analyst_id == JULIAN_ID
    else:  # the reassignment won: the close re-ran and Julián no longer holds it
        assert kinds == {"CaseNotAssignedError", "AssignmentResultView"}
        assert case.assigned_analyst_id == DANIELA_ID


async def test_a_reply_racing_a_reassignment_is_never_written_after_it() -> None:
    k = await kit()
    outcomes = await asyncio.gather(
        k.post_analyst.execute(actor_for(JULIAN), CAMILA, message("Hola, Camila, ya reviso")),
        k.set_assignee.execute(LUCIA, CAMILA, to(DANIELA_ID, JULIAN_ID)),
        return_exceptions=True,
    )
    assert isinstance(outcomes[1], AssignmentResultView)
    turns = case_turns(k, CAMILA)
    banner = next(t for t in turns if t.kind is TurnKind.ROUTING and "pasó el caso" in t.text)
    replies = [t for t in turns if t.author_role is TurnAuthorRole.ANALYST]
    if isinstance(outcomes[0], CaseNotAssignedError):
        assert replies == []
    else:
        assert [r.sequence < banner.sequence for r in replies] == [True]


async def test_the_drain_racing_a_manual_assignment_assigns_once() -> None:
    k = await kit()
    # Felipe (paused, confirmed) by hand vs. the drain (Daniela is the only one available).
    drained, manual = await asyncio.gather(
        k.drain.execute(),
        k.set_assignee.execute(LUCIA, ROSA_ES, to(FELIPE_ID, None, confirm=True)),
        return_exceptions=True,
    )
    rows = Counter(a.case_id for a in k.store.assignments.values())
    assert rows[ROSA_ES] == 1
    case = k.store.cases[ROSA_ES]
    if isinstance(manual, AssignmentChangedError):  # the drain won
        assert dict(manual.details) == {"currentAnalystId": DANIELA_ID}
        assert case.assigned_analyst_id == DANIELA_ID
    else:  # the manual assignment won: the drain re-read it and skipped it
        assert isinstance(manual, AssignmentResultView)
        assert case.assigned_analyst_id == FELIPE_ID
    assert isinstance(drained, int)


async def test_the_drain_choosing_the_same_analyst_makes_the_manual_call_a_no_op() -> None:
    k = await kit()
    _drained, manual = await asyncio.gather(
        k.drain.execute(), k.set_assignee.execute(LUCIA, ROSA_ES, to(DANIELA_ID, None))
    )
    assert k.store.cases[ROSA_ES].assigned_analyst_id == DANIELA_ID
    assert Counter(a.case_id for a in k.store.assignments.values())[ROSA_ES] == 1
    assert manual.case.assigned_analyst_id == DANIELA_ID


async def test_two_supervisors_choosing_the_same_analyst() -> None:
    k = await kit()
    renata = replace(LUCIA, staff_id=seed_staff_id(10), name="Renata Villalba")
    results = await asyncio.gather(
        k.set_assignee.execute(LUCIA, MAURICIO_ES, to(DANIELA_ID, None)),
        k.set_assignee.execute(renata, MAURICIO_ES, to(DANIELA_ID, None)),
    )
    assert sorted(r.changed for r in results) == [False, True]
    assert Counter(a.case_id for a in k.store.assignments.values())[MAURICIO_ES] == 1


async def test_two_supervisors_choosing_different_analysts() -> None:
    k = await kit()
    outcomes = await asyncio.gather(
        k.set_assignee.execute(LUCIA, MAURICIO_ES, to(DANIELA_ID, None)),
        k.set_assignee.execute(LUCIA, MAURICIO_ES, to(FELIPE_ID, None, confirm=True)),
        return_exceptions=True,
    )
    assert Counter(type(o).__name__ for o in outcomes) == {
        "AssignmentResultView": 1,
        "AssignmentChangedError": 1,
    }
