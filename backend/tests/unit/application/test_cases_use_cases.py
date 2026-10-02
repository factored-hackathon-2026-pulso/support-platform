"""Use cases of slice 1 over the in-memory Unit of Work (with the demo seed)."""

from __future__ import annotations

import uuid

import pytest

from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import (
    CaseClosedError,
    CaseStatus,
    ChannelNotSupportedError,
    ContactReason,
    CustomerConversationStatus,
    CustomerTurnAuthor,
    FollowUp,
    IdempotencyConflictError,
    InboxStatus,
    ResolutionCode,
    TurnAudience,
)
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import (
    ANALYST,
    JULIAN,
    SUPERVISOR,
    TEAM_LEAD,
    actor_for,
    customer_actor,
    memory_container,
)

DANIELA = actor_for(ANALYST)
WEB_DISPUTE, IMPATIENT, PORTUGUESE, EMAIL, CALL, CONDUSEF, WAITING = (
    seed_case_id(n) for n in range(101, 108)
)


@pytest.fixture
async def container() -> Container:
    return await memory_container()


def message(text: str, client_message_id: str | None = None) -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=client_message_id or str(uuid.uuid4()))


def close_command() -> CloseCaseCommand:
    return CloseCaseCommand(
        resolved=False,
        contact_reason=ContactReason.TRANSACCIONAL,
        resolution_code=ResolutionCode.ESCALATED_TO_AREA,
        follow_up=FollowUp.IN_TWO_DAYS,
        send_csat_survey=True,
    )


# ----------------------------------------------------------------------------- customer side
async def test_first_message_opens_a_case_and_the_next_one_appends(container: Container) -> None:
    natalia = customer_actor(2001)
    post = container.use_cases.cases.post_customer_turn
    first = await post.execute(natalia, message("  No reconozco un cargo  "))
    assert first.case_created
    assert first.turn.sequence == 1
    assert first.turn.text == "No reconozco un cargo"
    assert first.conversation.status is CustomerConversationStatus.WAITING_AGENT
    assert first.conversation.last_sequence == 2  # + "Recibimos tu mensaje"
    await container.background.drain()

    second = await post.execute(natalia, message("¿Hola?"))
    assert not second.case_created
    assert second.conversation.case_id == first.conversation.case_id
    assert second.turn.sequence == 4  # 3 is the staff-only routing banner
    assert second.conversation.status is CustomerConversationStatus.WITH_AGENT
    assert second.conversation.agent_name == "Daniela"
    async with container.uow() as uow:
        slot = await uow.case_slots.get(natalia.customer_id)
    assert slot is not None
    assert slot.open_case_id == first.conversation.case_id


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


async def test_customer_sees_only_public_turns_with_bank_side_names(container: Container) -> None:
    result = await container.use_cases.cases.customer_conversation.execute(customer_actor(1001))
    assert result.conversation is not None
    assert result.conversation.case_id == WEB_DISPUTE
    authors = [turn.author_role for turn in result.turns]
    assert authors == [
        CustomerTurnAuthor.CUSTOMER,
        CustomerTurnAuthor.BOT,
        CustomerTurnAuthor.CUSTOMER,
        CustomerTurnAuthor.BOT,
        CustomerTurnAuthor.CUSTOMER,
    ]  # the staff-only routing banner is not there
    assert {turn.author_name for turn in result.turns} == {None}
    later = await container.use_cases.cases.customer_conversation.execute(
        customer_actor(1001), after_sequence=4
    )
    assert [turn.sequence for turn in later.turns] == [5]

    joaquin = await container.use_cases.cases.customer_conversation.execute(customer_actor(1007))
    reply = joaquin.turns[-1]
    assert (reply.author_role, reply.author_name, reply.client_message_id) == (
        CustomerTurnAuthor.ANALYST,
        "Daniela",
        None,
    )
    fresh = await container.use_cases.cases.customer_conversation.execute(customer_actor(2002))
    assert fresh.conversation is None
    assert fresh.turns == ()


# ----------------------------------------------------------------------------- analyst side
async def test_reply_starts_a_new_case_and_moves_it_to_waiting(container: Container) -> None:
    result = await container.use_cases.cases.post_analyst_turn.execute(
        DANIELA, PORTUGUESE, message("Olá, Larissa! Sou a Daniela.")
    )
    assert result.case.status is CaseStatus.IN_PROGRESS
    assert result.case.inbox_status is InboxStatus.WAITING
    assert result.case.unread_count == 0
    assert result.turn.author_name == "Daniela Ríos"
    assert result.turn.language.value == "pt"  # always the case language
    assert result.turn.audience is TurnAudience.EVERYONE


async def test_reply_rules(container: Container) -> None:
    post = container.use_cases.cases.post_analyst_turn
    with pytest.raises(ChannelNotSupportedError):
        await post.execute(DANIELA, EMAIL, message("Hola, Patricia"))
    with pytest.raises(ChannelNotSupportedError):
        await post.execute(DANIELA, CALL, message("Hola"))
    with pytest.raises(CaseNotAssignedError):
        await post.execute(actor_for(JULIAN), IMPATIENT, message("Hola"))
    with pytest.raises(CaseNotAssignedError):  # supervisors read, never write
        await post.execute(actor_for(SUPERVISOR), IMPATIENT, message("Hola"))
    with pytest.raises(CaseNotAssignedError):  # analyst + supervisor, but not the assignee
        await post.execute(actor_for(TEAM_LEAD), IMPATIENT, message("Hola"))
    with pytest.raises(NotFoundError):
        await post.execute(DANIELA, seed_case_id(999), message("Hola"))
    with pytest.raises(NotFoundError):
        await post.execute(DANIELA, "CASE-1", message("Hola"))

    command = message("Hola, Beatriz. Ya la atiendo.")
    first = await post.execute(DANIELA, IMPATIENT, command)
    again = await post.execute(DANIELA, IMPATIENT, command)
    assert again.replayed
    assert again.turn.id == first.turn.id
    with pytest.raises(IdempotencyConflictError):
        await post.execute(DANIELA, IMPATIENT, message("Otro", command.client_message_id))
    with pytest.raises(IdempotencyConflictError):  # same id reused on another case
        await post.execute(DANIELA, WEB_DISPUTE, command)


async def test_mark_read_opens_a_new_case(container: Container) -> None:
    summary = await container.use_cases.cases.mark_read.execute(DANIELA, PORTUGUESE, 99)
    assert summary.status is CaseStatus.IN_PROGRESS
    assert summary.inbox_status is InboxStatus.TO_REPLY
    assert summary.unread_count == 0
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.mark_read.execute(actor_for(JULIAN), PORTUGUESE, 1)


async def test_close_frees_the_customer_and_tells_them(container: Container) -> None:
    close = container.use_cases.cases.close
    detail = await close.execute(DANIELA, WEB_DISPUTE, close_command())
    assert detail.case.status is CaseStatus.CLOSED
    assert detail.case.inbox_status is None
    assert detail.closure is not None
    assert detail.closure.followup_at is not None
    assert (detail.closure.followup_at - detail.closure.closed_at).total_seconds() == 48 * 3600
    assert detail.capabilities.reply_blocked_reason is not None
    with pytest.raises(CaseClosedError):
        await close.execute(DANIELA, WEB_DISPUTE, close_command())
    with pytest.raises(CaseClosedError):
        await container.use_cases.cases.post_analyst_turn.execute(
            DANIELA, WEB_DISPUTE, message("¿Algo más?")
        )

    marcela = customer_actor(1001)
    ended = await container.use_cases.cases.customer_conversation.execute(marcela)
    assert ended.conversation is not None
    assert ended.conversation.status is CustomerConversationStatus.CLOSED
    assert ended.turns[-1].text.startswith("La conversación terminó")
    reopened = await container.use_cases.cases.post_customer_turn.execute(
        marcela, message("Hola de nuevo")
    )
    assert reopened.case_created
    assert reopened.conversation.case_id != WEB_DISPUTE


async def test_close_an_outbound_follow_up_and_refuse_strangers(container: Container) -> None:
    detail = await container.use_cases.cases.close.execute(DANIELA, CONDUSEF, close_command())
    assert detail.case.status is CaseStatus.CLOSED
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.close.execute(actor_for(JULIAN), CALL, close_command())


async def test_inbox_filters_keep_whole_inbox_counts(container: Container) -> None:
    inbox = container.use_cases.cases.inbox
    everything = await inbox.execute(DANIELA)
    to_reply = await inbox.execute(DANIELA, status=InboxStatus.TO_REPLY)
    assert len(everything.items) == 7
    assert {i.inbox_status for i in to_reply.items} == {InboxStatus.TO_REPLY}
    assert to_reply.counts == everything.counts
    found = await inbox.execute(DANIELA, query="  joaquin ")
    assert [i.id for i in found.items] == [WAITING]
    assert [i.id for i in (await inbox.execute(DANIELA, query="0103")).items] == [PORTUGUESE]
    assert (await inbox.execute(actor_for(JULIAN))).counts.all == 0


async def test_detail_and_turn_pages(container: Container) -> None:
    detail = await container.use_cases.cases.detail.execute(DANIELA, EMAIL)
    assert detail.channel_identity.kind.value == "email_address"
    assert not detail.channel_identity.verified
    assert detail.customer.document_type == "INE"
    assert detail.assignment is not None
    assert detail.assignment.analyst_name == "Daniela Ríos"
    supervisor_view = await container.use_cases.cases.detail.execute(actor_for(SUPERVISOR), EMAIL)
    assert supervisor_view.capabilities.reply_blocked_reason is not None
    with pytest.raises(CaseNotAssignedError):
        await container.use_cases.cases.detail.execute(actor_for(JULIAN), EMAIL)

    turns = container.use_cases.cases.turns
    latest = await turns.execute(DANIELA, EMAIL, limit=2)
    assert [t.sequence for t in latest.items] == [5, 6]
    assert latest.older_cursor == "5"
    assert latest.last_sequence == 6
    before = await turns.execute(DANIELA, EMAIL, cursor=latest.older_cursor, limit=10)
    assert [t.sequence for t in before.items] == [1, 2, 3, 4]
    assert before.older_cursor is None
    after = await turns.execute(DANIELA, EMAIL, after_sequence=4)
    assert [t.sequence for t in after.items] == [5, 6]
    with pytest.raises(InvalidValueError):
        await turns.execute(DANIELA, EMAIL, cursor="x")
    with pytest.raises(InvalidValueError):
        await turns.execute(DANIELA, EMAIL, cursor="5", after_sequence=1)
    bot_turns = await turns.execute(DANIELA, WEB_DISPUTE)
    assert bot_turns.items[1].author_name == "Árbol de disputas"


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
