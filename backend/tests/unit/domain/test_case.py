"""``Case`` state machine, transcript sequencing and the one-open-case slot."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.cases import (
    Assignment,
    AssignmentReason,
    Case,
    CaseChannel,
    CaseClosedError,
    CaseOrigin,
    CasePriority,
    CaseStatus,
    ChannelSessionKind,
    ContactReason,
    CustomerCaseSlot,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
    preview_of,
    search_key,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import (
    ConflictError,
    InvalidTransitionError,
    InvalidValueError,
)

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
CASE_ID = "CASE-" + "0" * 25 + "1"
CUSTOMER_ID = "CUS-" + "0" * 25 + "1"
ANALYST_ID = "STF-" + "0" * 25 + "1"
ANALYST = ActorRef(ActorRole.ANALYST, ANALYST_ID)
_turns = iter(range(1, 10_000))


def turn_id() -> str:
    return f"TRN-{next(_turns):026d}"


def open_case(
    *, origin: CaseOrigin = CaseOrigin.CUSTOMER, channel: CaseChannel = CaseChannel.APP_CHAT
) -> Case:
    return Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia Guzmán Rincón",
        channel=channel,
        channel_session=ChannelSessionKind.for_chat(channel),
        language=Language.SPANISH,
        origin=origin,
        priority=CasePriority.MEDIUM,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(hours=1),
        actor=ActorRef(ActorRole.CUSTOMER, CUSTOMER_ID),
    )


def customer_says(case: Case, text: str = "No reconozco un cargo") -> None:
    case.append_turn(
        turn_id=turn_id(),
        kind=TurnKind.MESSAGE,
        audience=TurnAudience.EVERYONE,
        author_role=TurnAuthorRole.CUSTOMER,
        author_id=CUSTOMER_ID,
        text=text,
        created_at=NOW,
    )


def assignment(case: Case) -> Assignment:
    return Assignment(
        id="ASG-" + "0" * 25 + "1",
        case_id=case.id,
        staff_id=ANALYST_ID,
        reason=AssignmentReason.LANGUAGE_LEAST_LOADED,
        policy_rule_id=None,
        open_cases_at_assignment=0,
        strategy="language_least_loaded@1",
        assigned_at=NOW,
        assigned_by=ActorRef.system(),
    )


def assigned_case(**kwargs: object) -> Case:
    case = open_case(**kwargs)  # type: ignore[arg-type]
    customer_says(case)
    case.assign(assignment(case))
    return case


def close(case: Case) -> None:
    case.close(
        actor=ANALYST,
        at=NOW,
        resolved=False,
        contact_reason=ContactReason.TRANSACCIONAL,
        resolution_code=None,
        followup_at=None,
        csat_requested=False,
    )


def test_open_starts_routing_and_records_case_opened() -> None:
    case = open_case()
    assert case.status is CaseStatus.ROUTING
    (event,) = case.pull_events()
    assert event.event_type == "case.opened"
    assert event.payload()["channel_session"] == "app_session"
    assert event.payload()["topic"] is None  # no judge yet


def test_turn_sequences_are_gap_free_and_include_staff_turns() -> None:
    case = open_case()
    customer_says(case)
    case.append_turn(
        turn_id=turn_id(),
        kind=TurnKind.ROUTING,
        audience=TurnAudience.STAFF,
        author_role=TurnAuthorRole.SYSTEM,
        author_id=None,
        text="Banner",
        created_at=NOW,
    )
    customer_says(case, "  hola?  ")
    assert case.last_sequence == 3
    assert case.last_public_sequence == 3
    assert case.unread_sequences == (1, 3)
    assert case.last_message_preview == "hola?"  # trimmed
    events = case.pull_events()
    assert [e.payload()["sequence"] for e in events[1:]] == [1, 2, 3]


def test_routing_turns_must_be_staff_only_and_text_not_empty() -> None:
    case = open_case()
    with pytest.raises(InvalidValueError):
        case.append_turn(
            turn_id=turn_id(),
            kind=TurnKind.ROUTING,
            audience=TurnAudience.EVERYONE,
            author_role=TurnAuthorRole.SYSTEM,
            author_id=None,
            text="x",
            created_at=NOW,
        )
    with pytest.raises(InvalidValueError):
        customer_says(case, "   ")


def test_preview_flattens_and_truncates() -> None:
    assert preview_of("a\n\nb") == "a b"
    long = preview_of("x" * 200)
    assert len(long) == 140
    assert long.endswith("…")
    assert search_key("Joaquín Ferreyra") == "joaquin ferreyra"


def test_routing_to_queue_to_assigned() -> None:
    case = open_case()
    case.queue(
        label="Cola de disputas", reason_code="no_available_analyst", policy_rule_id=None, at=NOW
    )
    assert case.status is CaseStatus.QUEUED
    case.assign(assignment(case))
    assert case.status is CaseStatus.ASSIGNED
    assert case.assigned_analyst_id == ANALYST_ID
    types = [e.event_type for e in case.pull_events()]
    assert types == ["case.opened", "case.queued", "case.assigned"]


def test_opening_an_assigned_case_starts_it_and_moves_the_read_cursor() -> None:
    case = assigned_case()
    case.pull_events()
    assert case.mark_read(up_to=99, at=NOW)  # clamped to last_sequence
    assert case.status is CaseStatus.IN_PROGRESS
    assert case.assignee_read_sequence == 1
    assert case.unread_count == 0
    events = case.pull_events()
    assert [e.event_type for e in events] == ["case.status_changed", "case.read"]
    assert events[0].payload() == {
        "from_status": "assigned",
        "to_status": "in_progress",
        "reason": "opened_by_assignee",
    }
    # Monotonic: reading an older position changes nothing.
    assert not case.mark_read(up_to=0, at=NOW)
    assert case.pull_events() == []


def test_close_from_every_open_status_and_never_twice() -> None:
    case = assigned_case()
    close(case)
    assert case.status is CaseStatus.CLOSED
    assert case.closure is not None
    types = [e.event_type for e in case.pull_events()]
    assert types[-2:] == ["case.closed", "case.status_changed"]
    with pytest.raises(CaseClosedError) as closed:
        close(case)
    assert closed.value.details == {"currentStatus": "closed"}
    with pytest.raises(CaseClosedError):
        customer_says(case)

    for prepare in (
        lambda c: c.mark_read(up_to=1, at=NOW),  # in_progress
        lambda c: c.start_call(at=NOW, actor=ANALYST),  # in_call
    ):
        other = assigned_case()
        prepare(other)
        close(other)
        assert other.status is CaseStatus.CLOSED


@pytest.mark.parametrize("status", [CaseStatus.ROUTING, CaseStatus.QUEUED])
def test_cases_nobody_holds_cannot_be_closed(status: CaseStatus) -> None:
    case = open_case()
    if status is CaseStatus.QUEUED:
        case.queue(label="Cola", reason_code="no_available_analyst", policy_rule_id=None, at=NOW)
    with pytest.raises(InvalidTransitionError) as refused:
        close(case)
    assert refused.value.details["currentStatus"] == status.value


def test_invalid_transitions_raise_with_the_current_status() -> None:
    case = assigned_case()
    with pytest.raises(InvalidTransitionError):
        case.queue(label="Cola", reason_code="x", policy_rule_id=None, at=NOW)
    with pytest.raises(InvalidTransitionError):
        case.assign(assignment(case))
    with pytest.raises(InvalidTransitionError):
        case.require_callback(at=NOW, actor=ANALYST)  # only outbound origins
    with pytest.raises(InvalidTransitionError):
        open_case().mark_read(up_to=1, at=NOW)  # nobody assigned yet


def test_replies_only_in_assigned_or_in_progress() -> None:
    case = assigned_case()
    case.ensure_assignee_can_reply()
    case.start_call(at=NOW, actor=ANALYST)
    with pytest.raises(InvalidTransitionError):
        case.ensure_assignee_can_reply()


def test_outbound_follow_up_goes_to_call_then_live() -> None:
    case = assigned_case(origin=CaseOrigin.REGULATOR, channel=CaseChannel.PHONE)
    case.require_callback(at=NOW, actor=ActorRef.system())
    assert case.status is CaseStatus.TO_CALL
    case.start_call(at=NOW + timedelta(minutes=1), actor=ANALYST)
    assert case.status is CaseStatus.IN_CALL
    assert case.live_since == NOW + timedelta(minutes=1)


def test_slot_holds_one_open_case() -> None:
    slot = CustomerCaseSlot(customer_id=CUSTOMER_ID)
    slot.occupy(CASE_ID)
    slot.occupy(CASE_ID)  # idempotent for the same case
    with pytest.raises(ConflictError):
        slot.occupy("CASE-" + "0" * 25 + "2")
    slot.release("CASE-" + "0" * 25 + "2")  # not the holder: no-op
    assert slot.open_case_id == CASE_ID
    slot.release(CASE_ID)
    assert slot.open_case_id is None
