"""Read model: the derived canvas status, counters, inbox order, capabilities and route."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.application.cases.dto import ReplyBlockedReason
from cc_platform.application.cases.read_model import (
    CaseReader,
    capabilities_for,
    count_inbox,
    inbox_status,
    summarize,
)
from cc_platform.domain.cases import (
    Case,
    CaseChannel,
    CaseOrigin,
    CasePriority,
    CaseStatus,
    ChannelSessionKind,
    InboxStatus,
    TurnAuthorRole,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.routing.values import RouteStopKind, RoutingOutcome, Tier
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import memory_container

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
DANIELA = seed_staff_id(1)


def case_in(
    status: CaseStatus,
    last_author: TurnAuthorRole | None = None,
    channel: CaseChannel = CaseChannel.APP_CHAT,
) -> Case:
    return Case(
        id="CASE-" + "0" * 25 + "1",
        customer_id="CUS-" + "0" * 25 + "1",
        channel=channel,
        channel_session=ChannelSessionKind.APP_SESSION,
        language=Language.SPANISH,
        origin=CaseOrigin.CUSTOMER,
        priority=CasePriority.MEDIUM,
        status=status,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(hours=1),
        search_text="x",
        assigned_analyst_id=DANIELA if status is not CaseStatus.ROUTING else None,
        last_message_author_role=last_author,
    )


@pytest.mark.parametrize(
    ("status", "last_author", "expected"),
    [
        (CaseStatus.ASSIGNED, TurnAuthorRole.CUSTOMER, InboxStatus.NEW),
        (CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER, InboxStatus.TO_REPLY),
        (CaseStatus.IN_PROGRESS, TurnAuthorRole.ANALYST, InboxStatus.WAITING),
        (CaseStatus.IN_PROGRESS, TurnAuthorRole.TREE, InboxStatus.WAITING),
        (CaseStatus.IN_PROGRESS, None, InboxStatus.WAITING),
        (CaseStatus.IN_CALL, TurnAuthorRole.CUSTOMER, InboxStatus.LIVE),
        (CaseStatus.TO_CALL, None, InboxStatus.TO_CALL),
        (CaseStatus.AWAITING_APPROVAL, TurnAuthorRole.CUSTOMER, InboxStatus.WAITING),
        (CaseStatus.ROUTING, TurnAuthorRole.CUSTOMER, None),
        (CaseStatus.QUEUED, TurnAuthorRole.CUSTOMER, None),
        (CaseStatus.CLOSED, TurnAuthorRole.CUSTOMER, None),
    ],
)
def test_inbox_status_table(
    status: CaseStatus, last_author: TurnAuthorRole | None, expected: InboxStatus | None
) -> None:
    assert inbox_status(case_in(status, last_author)) is expected


def test_counts_cover_every_bucket() -> None:
    items = [
        summarize(case_in(CaseStatus.ASSIGNED), "A"),
        summarize(case_in(CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER), "B"),
        summarize(case_in(CaseStatus.IN_PROGRESS, TurnAuthorRole.ANALYST), "C"),
        summarize(case_in(CaseStatus.CLOSED), "D"),
    ]
    counts = count_inbox(items, NOW)
    assert (counts.all, counts.new, counts.to_reply, counts.waiting, counts.live) == (3, 1, 1, 1, 0)


def test_capabilities_for_assignee_supervisor_closed_and_phone() -> None:
    open_chat = case_in(CaseStatus.IN_PROGRESS, TurnAuthorRole.CUSTOMER)
    mine = capabilities_for(open_chat, DANIELA)
    assert (mine.can_reply, mine.reply_blocked_reason, mine.can_close) == (True, None, True)
    other = capabilities_for(open_chat, seed_staff_id(5))
    assert (other.can_reply, other.reply_blocked_reason, other.can_close) == (
        False,
        ReplyBlockedReason.NOT_ASSIGNEE,
        False,
    )
    closed = capabilities_for(case_in(CaseStatus.CLOSED), DANIELA)
    assert closed.reply_blocked_reason is ReplyBlockedReason.CLOSED
    assert not closed.can_close
    phone = capabilities_for(case_in(CaseStatus.IN_CALL, channel=CaseChannel.PHONE), DANIELA)
    assert phone.reply_blocked_reason is ReplyBlockedReason.CHANNEL_NOT_SUPPORTED
    assert phone.can_close


async def test_seeded_inbox_order_and_counts() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        items = await CaseReader(uow).inbox(DANIELA)
    names = [item.customer.display_name.split()[0] for item in items]
    # Live call first, then by closest SLA.
    assert names == ["Claudia", "Beatriz", "Larissa", "Joaquín", "Marcela", "Patricia", "Héctor"]
    counts = count_inbox(items, NOW)
    assert (
        counts.all,
        counts.to_reply,
        counts.live,
        counts.new,
        counts.to_call,
        counts.waiting,
    ) == (
        7,
        3,
        1,
        1,
        1,
        1,
    )
    beatriz = items[1]
    assert beatriz.unread_count == 3
    assert beatriz.preview == "contesten!! qué mal servicio"
    hector = items[-1]
    assert hector.preview is not None  # no messages: the routing banner is the preview
    assert hector.preview_author_role is TurnAuthorRole.SYSTEM
    assert hector.last_interaction_at == hector.opened_at


async def test_route_summary_of_seeded_stories() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        reader = CaseReader(uow)
        web = await uow.cases.get(seed_case_id(101))
        call = await uow.cases.get(seed_case_id(105))
        assert web is not None
        assert call is not None
        web_route = await reader.routing(web)
        call_route = await reader.routing(call)
    assert [(s.kind, s.tier) for s in web_route.stops] == [
        (RouteStopKind.TIER, Tier.JUDGE),
        (RouteStopKind.TIER, Tier.TREE),
        (RouteStopKind.TIER, Tier.AI_AGENT),
        (RouteStopKind.ASSIGNEE, None),
    ]
    agent = web_route.stops[2]
    assert (agent.label, agent.outcome, agent.reason_code, agent.policy_rule_id) == (
        "Agente de disputas",
        RoutingOutcome.HANDED_OFF,
        "R4_amount_over_limit",
        "R4",
    )
    assert web_route.inputs_used == ("customers", "transactions", "interactions")
    assert [s.kind for s in call_route.stops] == [
        RouteStopKind.ENTRY,
        RouteStopKind.QUEUE,
        RouteStopKind.ASSIGNEE,
    ]
    assert call_route.stops[0].label == "IVR"
    assert call_route.stops[1].waited_seconds == 133
    assert call_route.stops[2].label == "Daniela Ríos"
    assert call_route.inputs_used == ()


def test_live_since_only_while_in_call() -> None:
    live = replace(case_in(CaseStatus.IN_CALL), live_since=NOW)
    assert summarize(live, "A").live_since == NOW
    assert summarize(replace(live, status=CaseStatus.TO_CALL), "A").live_since is None
