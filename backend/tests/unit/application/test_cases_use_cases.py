"""Use cases of the case lifecycle over the in-memory Unit of Work (with the demo seed)."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import (
    CaseClosedError,
    CaseStatus,
    CloseReason,
    CustomerConversationStatus,
    CustomerTurnAuthor,
    IdempotencyConflictError,
    InboxStatus,
    TurnAudience,
    TurnKind,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import (
    ANALYST,
    JULIAN,
    PAULA,
    SUPERVISOR,
    TEAM_LEAD,
    actor_for,
    customer_actor,
    memory_container,
)

DANIELA = actor_for(ANALYST)
MARCELA, BEATRIZ, LARISSA, JOAQUIN = (seed_case_id(n) for n in (101, 102, 103, 107))
PATRICIA_REFUND, CLAUDIA, HECTOR, PATRICIA_AGAIN, GABRIELA, PATRICIA_OLD = (
    seed_case_id(n) for n in (104, 105, 106, 108, 109, 110)
)


@pytest.fixture
async def container() -> Container:
    return await memory_container()


def message(text: str, client_message_id: str | None = None) -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=client_message_id or str(uuid.uuid4()))


def close_with(
    reason: CloseReason = CloseReason.RESOLVED, note: str | None = None
) -> CloseCaseCommand:
    return CloseCaseCommand(reason=reason, note=note)


# ----------------------------------------------------------------------------- customer side
async def test_first_message_opens_an_assigned_case_and_the_next_one_appends(
    container: Container,
) -> None:
    natalia = customer_actor(2001)
    post = container.use_cases.cases.post_customer_turn
    first = await post.execute(natalia, message("  No reconozco un cargo  "))
    assert first.case_created
    assert first.turn.sequence == 1
    assert first.turn.text == "No reconozco un cargo"
    assert first.conversation.status is CustomerConversationStatus.WITH_AGENT
    assert first.conversation.agent_name == "Daniela"
    assert first.conversation.last_sequence == 2  # + "Recibimos tu mensaje"
    assert first.conversation.previous_case_id is None

    second = await post.execute(natalia, message("¿Hola?"))
    assert not second.case_created
    assert second.conversation.case_id == first.conversation.case_id
    assert second.turn.sequence == 4  # 3 is the staff-only assignment banner
    async with container.uow() as uow:
        slot = await uow.case_slots.get(natalia.customer_id)
        case = await uow.cases.get(first.conversation.case_id)
    assert slot is not None
    assert slot.open_case_id == first.conversation.case_id
    assert case is not None
    assert case.sla_due_at == case.opened_at + timedelta(minutes=15)  # medium priority


async def test_customer_message_dedupe(container: Container) -> None:
    natalia = customer_actor(2001)
    post = container.use_cases.cases.post_customer_turn
    command = message("Me cobraron dos veces")
    original = await post.execute(natalia, command)
    replay = await post.execute(natalia, command)
    assert replay.replayed
    assert replay.case_created  # the replayed message is the one that opened the case
    assert replay.turn.id == original.turn.id
    with pytest.raises(IdempotencyConflictError):
        await post.execute(natalia, message("Otro texto", command.client_message_id))


async def test_customer_sees_only_public_turns(container: Container) -> None:
    result = await container.use_cases.cases.customer_conversation.execute(customer_actor(1001))
    assert result.conversation is not None
    assert result.conversation.case_id == MARCELA
    assert [turn.author_role for turn in result.turns] == [
        CustomerTurnAuthor.CUSTOMER,
        CustomerTurnAuthor.SYSTEM,
        CustomerTurnAuthor.ANALYST,
        CustomerTurnAuthor.CUSTOMER,
    ]  # the staff-only banner (sequence 3) is not there
    assert [turn.sequence for turn in result.turns] == [1, 2, 4, 5]
    assert result.turns[2].author_name == "Daniela"
    later = await container.use_cases.cases.customer_conversation.execute(
        customer_actor(1001), after_sequence=4
    )
    assert [turn.sequence for turn in later.turns] == [5]
    fresh = await container.use_cases.cases.customer_conversation.execute(customer_actor(2002))
    assert (fresh.conversation, fresh.turns, fresh.past_conversation_count) == (None, (), 0)


async def test_past_conversations_exclude_the_current_one(container: Container) -> None:
    patricia = customer_actor(1004)
    current = await container.use_cases.cases.customer_conversation.execute(patricia)
    assert current.conversation is not None
    assert current.conversation.case_id == PATRICIA_AGAIN
    assert current.conversation.previous_case_id == PATRICIA_REFUND
    assert current.past_conversation_count == 2
    past = await container.use_cases.cases.past_conversations.execute(patricia)
    assert [p.case_id for p in past] == [PATRICIA_REFUND, PATRICIA_OLD]  # newest first
    assert [p.agent_name for p in past] == ["Daniela", "Julián"]  # who attended it
    assert past[0].preview == "Perfecto, muchas gracias."
    assert {p.status for p in past} == {CustomerConversationStatus.CLOSED}

    old = await container.use_cases.cases.past_conversation.execute(patricia, PATRICIA_OLD)
    assert old.conversation.agent_name == "Julián"
    assert old.turns[-1].text.startswith("La conversación terminó")
    assert all(t.kind is not TurnKind.ROUTING for t in old.turns)
    for foreign in (MARCELA, seed_case_id(999), "nope"):
        with pytest.raises(NotFoundError):
            await container.use_cases.cases.past_conversation.execute(patricia, foreign)


# ----------------------------------------------------------------------------- analyst side
async def test_reply_starts_a_new_case_moves_it_to_waiting_and_stops_the_sla(
    container: Container,
) -> None:
    result = await container.use_cases.cases.post_analyst_turn.execute(
        DANIELA, LARISSA, message("Olá, Larissa! Sou a Daniela.")
    )
    assert result.case.status is CaseStatus.IN_PROGRESS
    assert result.case.inbox_status is InboxStatus.WAITING
    assert result.case.unread_count == 0
    assert result.case.first_response_at == container.clock.now()
    assert result.turn.author_name == "Daniela Ríos"
    assert result.turn.language.value == "pt"  # always the case language
    assert result.turn.audience is TurnAudience.EVERYONE
    async with container.uow() as uow:
        events = (await uow.event_log.page(case_id=LARISSA)).items
    first = [e for e in events if e.event_type == "case.first_responded"]
    assert len(first) == 1
    assert first[0].payload["sla_met"] is True


async def test_reply_rules(container: Container) -> None:
    post = container.use_cases.cases.post_analyst_turn
    with pytest.raises(CaseNotAssignedError):
        await post.execute(actor_for(JULIAN), BEATRIZ, message("Hola"))
    with pytest.raises(CaseNotAssignedError):  # supervisors read, never write
        await post.execute(actor_for(SUPERVISOR), BEATRIZ, message("Hola"))
    with pytest.raises(CaseNotAssignedError):  # analyst + supervisor, but not the assignee
        await post.execute(actor_for(TEAM_LEAD), BEATRIZ, message("Hola"))
    with pytest.raises(CaseNotAssignedError):  # nobody holds a queued case
        await post.execute(DANIELA, GABRIELA, message("Olá"))
    with pytest.raises(NotFoundError):
        await post.execute(DANIELA, seed_case_id(999), message("Hola"))
    with pytest.raises(NotFoundError):
        await post.execute(DANIELA, "CASE-1", message("Hola"))
    with pytest.raises(CaseClosedError):
        await post.execute(DANIELA, CLAUDIA, message("¿Sigue ahí?"))

    command = message("Hola, Beatriz. Ya la atiendo.")
    first = await post.execute(DANIELA, BEATRIZ, command)
    again = await post.execute(DANIELA, BEATRIZ, command)
    assert again.replayed
    assert again.turn.id == first.turn.id
    with pytest.raises(IdempotencyConflictError):
        await post.execute(DANIELA, BEATRIZ, message("Otro", command.client_message_id))
    with pytest.raises(IdempotencyConflictError):  # same id reused on another case
        await post.execute(DANIELA, MARCELA, command)


async def test_mark_read_opens_a_new_case(container: Container) -> None:
    summary = await container.use_cases.cases.mark_read.execute(DANIELA, LARISSA, 99)
    assert summary.status is CaseStatus.IN_PROGRESS
    assert summary.inbox_status is InboxStatus.TO_REPLY
    assert summary.unread_count == 0
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.mark_read.execute(actor_for(JULIAN), LARISSA, 1)


# ----------------------------------------------------------------------------- close
@pytest.mark.parametrize("reason", list(CloseReason))
async def test_close_with_every_reason(container: Container, reason: CloseReason) -> None:
    detail = await container.use_cases.cases.close.execute(DANIELA, MARCELA, close_with(reason))
    assert detail.case.status is CaseStatus.CLOSED
    assert detail.case.inbox_status is InboxStatus.CLOSED
    assert detail.case.close_reason is reason
    assert detail.closure is not None
    assert (detail.closure.reason, detail.closure.closed_by_name) == (reason, "Daniela Ríos")
    assert (detail.capabilities.can_reply, detail.capabilities.can_close) == (False, False)


async def test_close_note_is_trimmed_and_blank_is_null(container: Container) -> None:
    close = container.use_cases.cases.close
    noted = await close.execute(DANIELA, MARCELA, close_with(note="  Se explicó el cargo.  "))
    assert noted.closure is not None
    assert noted.closure.note == "Se explicó el cargo."
    blank = await close.execute(DANIELA, JOAQUIN, close_with(note="   "))
    assert blank.closure is not None
    assert blank.closure.note is None
    with pytest.raises(InvalidValueError):
        await close.execute(DANIELA, BEATRIZ, close_with(note="x" * 501))
    still_open = await container.use_cases.cases.detail.execute(DANIELA, BEATRIZ)
    assert still_open.case.status is CaseStatus.IN_PROGRESS


@pytest.mark.parametrize(
    ("case_id", "customer", "notice"),
    [
        (MARCELA, 1001, "La conversación terminó. Si necesitas algo más, escríbenos y te "
         "atendemos en una nueva conversación."),
        (LARISSA, 1003, "A conversa foi encerrada. Se precisar de algo mais, escreva para nós e "
         "abrimos uma nova conversa."),
    ],
)  # fmt: skip
async def test_close_tells_the_customer_in_their_language_never_the_reason(
    container: Container, case_id: str, customer: int, notice: str
) -> None:
    await container.use_cases.cases.close.execute(
        DANIELA, case_id, close_with(CloseReason.OUT_OF_SCOPE, "Nota interna secreta")
    )
    ended = await container.use_cases.cases.customer_conversation.execute(customer_actor(customer))
    assert ended.conversation is not None
    assert ended.conversation.status is CustomerConversationStatus.CLOSED
    assert ended.conversation.agent_name == "Daniela"  # who attended it
    assert ended.turns[-1].text == notice
    shown = " ".join(turn.text for turn in ended.turns)
    assert "Nota interna" not in shown
    assert "alcance" not in shown
    async with container.uow() as uow:
        slot = await uow.case_slots.get(customer_actor(customer).customer_id)
    assert slot is not None
    assert slot.open_case_id is None  # released: the next message opens a new case


async def test_close_twice_and_strangers(container: Container) -> None:
    close = container.use_cases.cases.close
    await close.execute(DANIELA, MARCELA, close_with())
    with pytest.raises(CaseClosedError):
        await close.execute(DANIELA, MARCELA, close_with())
    with pytest.raises(CaseClosedError):
        await close.execute(DANIELA, HECTOR, close_with())  # seeded closed case
    with pytest.raises(CaseNotAssignedError):
        await close.execute(actor_for(JULIAN), BEATRIZ, close_with())
    with pytest.raises(CaseNotAssignedError):  # nobody holds a queued case
        await close.execute(DANIELA, GABRIELA, close_with())


# ----------------------------------------------------------------------------- linked cases
async def test_writing_after_a_close_opens_a_new_linked_case(container: Container) -> None:
    await container.use_cases.cases.close.execute(DANIELA, MARCELA, close_with())
    reopened = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(1001), message("Hola de nuevo")
    )
    assert reopened.case_created
    new_id = reopened.conversation.case_id
    assert new_id != MARCELA
    assert reopened.conversation.previous_case_id == MARCELA
    assert reopened.conversation.status is CustomerConversationStatus.WITH_AGENT  # normal

    detail = await container.use_cases.cases.detail.execute(DANIELA, new_id)
    assert detail.case.previous_case_id == MARCELA
    assert detail.case.inbox_status is InboxStatus.NEW
    assert detail.previous_case_count == 1
    turns = (await container.use_cases.cases.turns.execute(DANIELA, new_id)).items
    banners = [t.text for t in turns if t.kind is TurnKind.ROUTING]
    assert banners[0].startswith("Marcela volvió a escribir. Su caso anterior se cerró el ")
    assert banners[0].endswith("(resuelto).")
    assert banners[1].startswith("Asignado a Daniela Ríos porque está disponible")
    old = await container.use_cases.cases.detail.execute(DANIELA, MARCELA)
    assert old.case.status is CaseStatus.CLOSED  # untouched
    current = await container.use_cases.cases.customer_conversation.execute(customer_actor(1001))
    assert current.past_conversation_count == 1


async def test_reopen_links_the_most_recently_closed_case(container: Container) -> None:
    patricia = customer_actor(1004)
    await container.use_cases.cases.close.execute(DANIELA, PATRICIA_AGAIN, close_with())
    again = await container.use_cases.cases.post_customer_turn.execute(patricia, message("Hola"))
    assert again.conversation.previous_case_id == PATRICIA_AGAIN


# ----------------------------------------------------------------------------- history
async def test_history_access_is_read_only(container: Container) -> None:
    history = await container.use_cases.cases.history.execute(DANIELA, PATRICIA_AGAIN)
    assert [item.id for item in history.items] == [PATRICIA_REFUND, PATRICIA_OLD]
    assert history.total == 2
    old = history.items[1]
    assert (old.analyst_name, old.close_reason, old.status) == (
        "Julián Ortega",
        CloseReason.RESOLVED,
        CaseStatus.CLOSED,
    )
    assert old.preview == "Ah, es cierto. Gracias."
    # Daniela holds another case of Patricia → she may read Julián's old case.
    julians = await container.use_cases.cases.detail.execute(DANIELA, PATRICIA_OLD)
    assert julians.capabilities.reply_blocked_reason is not None
    assert julians.capabilities.reply_blocked_reason.value == "not_assignee"
    assert julians.assignment is not None
    assert julians.assignment.analyst_name == "Julián Ortega"
    page = await container.use_cases.cases.turns.execute(DANIELA, PATRICIA_OLD)
    assert page.items[3].author_name == "Julián Ortega"
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.post_analyst_turn.execute(
            DANIELA, PATRICIA_OLD, message("Hola")
        )
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.mark_read.execute(DANIELA, PATRICIA_OLD, 1)
    # Julián held 110 → he may read Patricia's other cases too, never write.
    assert (await container.use_cases.cases.detail.execute(actor_for(JULIAN), PATRICIA_AGAIN)).case
    # Paula never held a case of Patricia.
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.detail.execute(actor_for(PAULA), PATRICIA_OLD)
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.history.execute(actor_for(PAULA), PATRICIA_AGAIN)
    # The case: socket topic stays assignee-or-supervisor.
    authorize = container.use_cases.cases.authorize_subscription
    assert not await authorize.execute(DANIELA, PATRICIA_OLD)
    assert await authorize.execute(actor_for(SUPERVISOR), PATRICIA_OLD)


async def test_history_caps_at_20_newest_first() -> None:
    clock = FixedClock()
    container = await memory_container(clock=clock)
    natalia = customer_actor(2001)
    opened: list[str] = []
    for i in range(23):
        result = await container.use_cases.cases.post_customer_turn.execute(
            natalia, message(f"Hola {i}")
        )
        opened.append(result.conversation.case_id)
        await container.use_cases.cases.close.execute(DANIELA, opened[-1], close_with())
        clock.advance(timedelta(minutes=1))
    history = await container.use_cases.cases.history.execute(DANIELA, opened[-1])
    assert history.total == 22
    assert [item.id for item in history.items] == list(reversed(opened[:-1]))[:20]
    past = await container.use_cases.cases.past_conversations.execute(natalia)
    assert len(past) == 20  # the current (latest closed) conversation is not in the list


# ----------------------------------------------------------------------------- inbox
async def test_inbox_lists_counts_and_search(container: Container) -> None:
    inbox = container.use_cases.cases.inbox
    everything = await inbox.execute(DANIELA)
    assert [i.id for i in everything.items] == [PATRICIA_AGAIN, MARCELA, LARISSA, BEATRIZ, JOAQUIN]
    to_reply = await inbox.execute(DANIELA, status=InboxStatus.TO_REPLY)
    assert [i.id for i in to_reply.items] == [MARCELA, BEATRIZ]
    closed = await inbox.execute(DANIELA, status=InboxStatus.CLOSED)
    assert [i.id for i in closed.items] == [HECTOR, CLAUDIA, PATRICIA_REFUND]  # newest close first
    assert to_reply.counts == everything.counts == closed.counts
    counts = everything.counts
    assert (counts.all, counts.to_reply, counts.new, counts.waiting, counts.closed) == (
        5,
        2,
        2,
        1,
        3,
    )
    found = await inbox.execute(DANIELA, query="  joaquin ")
    assert [i.id for i in found.items] == [JOAQUIN]
    assert found.counts == counts  # q never changes the counters
    patricia_closed = await inbox.execute(DANIELA, status=InboxStatus.CLOSED, query="patricia")
    assert [i.id for i in patricia_closed.items] == [PATRICIA_REFUND]
    assert [i.id for i in (await inbox.execute(DANIELA, query="0103")).items] == [LARISSA]
    julian = await inbox.execute(actor_for(JULIAN))
    assert (julian.counts.all, julian.counts.closed) == (0, 0)  # 110 is 20 days old


async def test_closed_window_is_seven_days() -> None:
    clock = FixedClock()
    container = await memory_container(clock=clock)
    await container.use_cases.cases.close.execute(DANIELA, MARCELA, close_with())
    inbox = container.use_cases.cases.inbox
    clock.advance(timedelta(days=6))
    six = await inbox.execute(DANIELA, status=InboxStatus.CLOSED)
    assert MARCELA in [i.id for i in six.items]
    clock.advance(timedelta(days=2))
    eight = await inbox.execute(DANIELA, status=InboxStatus.CLOSED)
    assert MARCELA not in [i.id for i in eight.items]
    assert eight.counts.closed == len(eight.items) == 0  # every seeded close is older too


async def test_detail_and_turn_pages(container: Container) -> None:
    detail = await container.use_cases.cases.detail.execute(DANIELA, PATRICIA_AGAIN)
    assert (detail.customer.display_name, detail.customer.city, detail.customer.locale.value) == (
        "Patricia Lozano Vega",
        "Guadalajara",
        "es-MX",
    )
    assert detail.previous_case_count == 2
    assert detail.assignment is not None
    assert (detail.assignment.analyst_name, detail.assignment.queue_label) == (
        "Daniela Ríos",
        None,
    )
    closed = await container.use_cases.cases.detail.execute(DANIELA, PATRICIA_REFUND)
    assert closed.closure is not None
    assert closed.closure.note == "Se explicó el plazo del reverso (5 días hábiles)."
    supervisor_view = await container.use_cases.cases.detail.execute(actor_for(SUPERVISOR), BEATRIZ)
    assert supervisor_view.capabilities.reply_blocked_reason is not None

    turns = container.use_cases.cases.turns
    latest = await turns.execute(DANIELA, BEATRIZ, limit=2)
    assert [t.sequence for t in latest.items] == [5, 6]
    assert latest.older_cursor == "5"
    assert latest.last_sequence == 6
    before = await turns.execute(DANIELA, BEATRIZ, cursor=latest.older_cursor, limit=10)
    assert [t.sequence for t in before.items] == [1, 2, 3, 4]
    assert before.older_cursor is None
    after = await turns.execute(DANIELA, BEATRIZ, after_sequence=4)
    assert [t.sequence for t in after.items] == [5, 6]
    with pytest.raises(InvalidValueError):
        await turns.execute(DANIELA, BEATRIZ, cursor="x")
    with pytest.raises(InvalidValueError):
        await turns.execute(DANIELA, BEATRIZ, cursor="5", after_sequence=1)


async def test_availability_round_trip(container: Container) -> None:
    julian = actor_for(JULIAN)
    availability = container.use_cases.people
    assert (await availability.get_availability.execute(julian)).status is AvailabilityStatus.PAUSED
    changed = await availability.set_availability.execute(julian, AvailabilityStatus.AVAILABLE)
    assert changed.status is AvailabilityStatus.AVAILABLE
    same = await availability.set_availability.execute(julian, AvailabilityStatus.AVAILABLE)
    assert same.since == changed.since
    async with container.uow() as uow:
        events = (await uow.event_log.page(entity_id=julian.staff_id)).items
    assert [e.event_type for e in events] == ["staff.availability_changed"]
    assert events[0].payload == {"from_status": "paused", "to_status": "available"}
