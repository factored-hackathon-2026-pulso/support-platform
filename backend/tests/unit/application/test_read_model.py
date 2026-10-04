"""Read model: the derived inbox status (contract §4.1), counters, order and capabilities."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.application.cases.dto import CaseSummaryView, ReplyBlockedReason
from cc_platform.application.cases.queries import CLOSED_INBOX_WINDOW
from cc_platform.application.cases.read_model import (
    CaseReader,
    capabilities_for,
    count_inbox,
    inbox_order,
    inbox_status,
    summarize,
)
from cc_platform.domain.cases import (
    Case,
    CaseChannel,
    CaseClosure,
    CasePriority,
    CaseStatus,
    CloseReason,
    InboxStatus,
    TurnAuthorRole,
)
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import make_actor, memory_container

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
DANIELA = seed_staff_id(1)


def case_in(
    status: CaseStatus,
    last_author: TurnAuthorRole | None = None,
    *,
    number: int = 1,
    last_message_at: datetime | None = None,
    opened_at: datetime = NOW,
) -> Case:
    closure = (
        CaseClosure(NOW, DANIELA, ActorRole.ANALYST, CloseReason.RESOLVED)
        if status is CaseStatus.CLOSED
        else None
    )
    return Case(
        id="CASE-" + str(number).zfill(26),
        customer_id="CUS-" + "0" * 25 + "1",
        channel=CaseChannel.CHAT_APP,
        language=Language.SPANISH,
        priority=CasePriority.MEDIUM,
        status=status,
        opened_at=opened_at,
        sla_due_at=opened_at + timedelta(minutes=15),
        search_text="x",
        assigned_analyst_id=DANIELA if status is not CaseStatus.QUEUED else None,
        last_message_author_role=last_author,
        last_message_at=last_message_at,
        closure=closure,
    )


@pytest.mark.parametrize(
    ("status", "last_author", "expected"),
    [
        (CaseStatus.ASSIGNED, TurnAuthorRole.CUSTOMER, InboxStatus.NEW),
        (CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER, InboxStatus.TO_REPLY),
        (CaseStatus.IN_PROGRESS, TurnAuthorRole.ANALYST, InboxStatus.WAITING),
        (CaseStatus.IN_PROGRESS, None, InboxStatus.WAITING),
        (CaseStatus.CLOSED, TurnAuthorRole.CUSTOMER, InboxStatus.CLOSED),
        (CaseStatus.QUEUED, TurnAuthorRole.CUSTOMER, None),
    ],
)
def test_inbox_status_table(
    status: CaseStatus, last_author: TurnAuthorRole | None, expected: InboxStatus | None
) -> None:
    assert inbox_status(case_in(status, last_author)) is expected


def test_counts_cover_every_bucket_and_all_means_open() -> None:
    items = [
        summarize(case_in(CaseStatus.ASSIGNED), "A"),
        summarize(case_in(CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER), "B"),
        summarize(case_in(CaseStatus.IN_PROGRESS, TurnAuthorRole.ANALYST), "C"),
        summarize(case_in(CaseStatus.CLOSED), "D"),
        summarize(case_in(CaseStatus.CLOSED), "E"),
        summarize(case_in(CaseStatus.QUEUED), "F"),
    ]
    counts = count_inbox(items, NOW)
    assert (counts.all, counts.new, counts.to_reply, counts.waiting, counts.closed) == (
        3,
        1,
        1,
        1,
        2,
    )


def test_open_order_new_and_to_reply_first_then_waiting_oldest_interaction_first() -> None:
    def item(
        number: int, status: CaseStatus, author: TurnAuthorRole, minutes_ago: int
    ) -> CaseSummaryView:
        at = NOW - timedelta(minutes=minutes_ago)
        return summarize(case_in(status, author, number=number, last_message_at=at), "x")

    waiting_oldest = item(1, CaseStatus.IN_PROGRESS, TurnAuthorRole.ANALYST, 60)
    to_reply_recent = item(2, CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER, 1)
    new_older = item(3, CaseStatus.ASSIGNED, TurnAuthorRole.CUSTOMER, 5)
    items = [waiting_oldest, to_reply_recent, new_older]
    assert sorted(items, key=inbox_order) == [new_older, to_reply_recent, waiting_oldest]


def test_summary_carries_the_lifecycle_fields() -> None:
    linked = replace(
        case_in(CaseStatus.CLOSED),
        previous_case_id="CASE-" + "0" * 25 + "9",
        first_response_at=NOW + timedelta(minutes=3),
    )
    summary = summarize(linked, "A")
    assert summary.previous_case_id == "CASE-" + "0" * 25 + "9"
    assert summary.first_response_at == NOW + timedelta(minutes=3)
    assert (summary.closed_at, summary.close_reason) == (NOW, CloseReason.RESOLVED)
    assert summary.inbox_status is InboxStatus.CLOSED


def test_capabilities_for_assignee_others_and_closed() -> None:
    open_chat = case_in(CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER)
    daniela = make_actor(StaffRole.ANALYST, staff_id=DANIELA)
    mine = capabilities_for(open_chat, daniela)
    assert (mine.can_reply, mine.reply_blocked_reason, mine.can_close) == (True, None, True)
    assert mine.can_assign is False
    lucia = make_actor(StaffRole.SUPERVISOR, staff_id=seed_staff_id(5))
    other = capabilities_for(open_chat, lucia)
    assert (other.can_reply, other.reply_blocked_reason, other.can_close) == (
        False,
        ReplyBlockedReason.NOT_ASSIGNEE,
        False,
    )
    assert other.can_assign is True  # "Reasignar"
    assert capabilities_for(case_in(CaseStatus.QUEUED), lucia).can_assign is True  # "Asignar"
    closed = capabilities_for(case_in(CaseStatus.CLOSED), daniela)
    assert (closed.can_reply, closed.reply_blocked_reason, closed.can_close) == (
        False,
        ReplyBlockedReason.CLOSED,
        False,
    )
    assert capabilities_for(case_in(CaseStatus.CLOSED), lucia).can_assign is False
    # Felipe (Analista + Supervisión) on his own case: replies, closes and may reassign.
    felipe = make_actor(StaffRole.ANALYST, StaffRole.SUPERVISOR, staff_id=DANIELA)
    lead = capabilities_for(open_chat, felipe)
    assert (lead.can_reply, lead.can_close, lead.can_assign) == (True, True, True)
    assert [r.value for r in ReplyBlockedReason] == ["not_assignee", "closed"]


async def test_seeded_inbox_order_and_counts() -> None:
    container = await memory_container()
    now = container.clock.now()
    async with container.uow() as uow:
        reader = CaseReader(uow)
        items = await reader.open_inbox(DANIELA)
        closed = await reader.closed_inbox(DANIELA, now - CLOSED_INBOX_WINDOW)
        counts = await reader.inbox_counts(
            DANIELA, closed_since=now - CLOSED_INBOX_WINDOW, computed_at=now
        )
    names = [item.customer.display_name.split()[0] for item in items]
    # new/to_reply by the oldest last interaction (Ignacio's email 9 h, Patricia 14 min,
    # Larissa 12.5 min, Marcela 2 min, Beatriz 1 min), then the case waiting on the customer.
    assert names == ["Ignacio", "Patricia", "Larissa", "Marcela", "Beatriz", "Joaquín"]
    assert [c.customer.display_name.split()[0] for c in closed] == [
        "Héctor",
        "Claudia",  # 116, the follow-up call
        "Claudia",
        "Natalia",  # 115, the inbound call
        "Patricia",
    ]
    assert (counts.all, counts.to_reply, counts.new, counts.waiting, counts.closed) == (
        6,
        3,
        2,
        1,
        5,
    )
    beatriz = items[4]
    assert beatriz.unread_count == 3
    assert beatriz.preview == "contesten!! qué mal servicio"
    assert beatriz.first_response_at is None
