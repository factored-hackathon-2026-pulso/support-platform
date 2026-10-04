"""``Case`` state machine (contract §2.3), first-response SLA, close, transcript sequencing and
the one-open-case slot."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.cases import (
    Assignment,
    AssignmentReason,
    Case,
    CaseChannel,
    CaseClosedError,
    CasePriority,
    CaseStatus,
    CloseReason,
    CustomerCaseSlot,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
    normalize_close_note,
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
OTHER_CASE = "CASE-" + "0" * 25 + "2"
CUSTOMER_ID = "CUS-" + "0" * 25 + "1"
ANALYST_ID = "STF-" + "0" * 25 + "1"
ANALYST = ActorRef(ActorRole.ANALYST, ANALYST_ID)
_turns = iter(range(1, 10_000))


def turn_id() -> str:
    return f"TRN-{next(_turns):026d}"


def open_case(*, previous: str | None = None) -> Case:
    return Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia Guzmán Rincón",
        channel=CaseChannel.CHAT_APP,
        language=Language.SPANISH,
        priority=CasePriority.MEDIUM,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(minutes=15),
        actor=ActorRef(ActorRole.CUSTOMER, CUSTOMER_ID),
        previous_case_id=previous,
    )


def say(
    case: Case, text: str = "No reconozco un cargo", *, role: TurnAuthorRole, at: datetime = NOW
) -> None:
    case.append_turn(
        turn_id=turn_id(),
        kind=TurnKind.MESSAGE,
        audience=TurnAudience.EVERYONE,
        author_role=role,
        author_id=CUSTOMER_ID if role is TurnAuthorRole.CUSTOMER else ANALYST_ID,
        text=text,
        created_at=at,
    )


def customer_says(case: Case, text: str = "No reconozco un cargo") -> None:
    say(case, text, role=TurnAuthorRole.CUSTOMER)


def assignment(case: Case, *, waited: int | None = None) -> Assignment:
    return Assignment(
        id="ASG-" + "0" * 25 + "1",
        case_id=case.id,
        staff_id=ANALYST_ID,
        reason=AssignmentReason.QUEUE_DRAINED if waited else AssignmentReason.LANGUAGE_LEAST_LOADED,
        policy_rule_id=None,
        open_cases_at_assignment=0,
        strategy="language_least_loaded@1",
        assigned_at=NOW,
        assigned_by=ActorRef.system(),
        waited_seconds=waited,
    )


def assigned_case() -> Case:
    case = open_case()
    customer_says(case)
    case.assign(assignment(case))
    return case


def in_progress_case() -> Case:
    case = assigned_case()
    case.mark_read(up_to=1, at=NOW)
    return case


def close(case: Case, reason: CloseReason = CloseReason.RESOLVED, note: str | None = None) -> None:
    case.close(actor=ANALYST, at=NOW, reason=reason, note=note)


# ----------------------------------------------------------------------------- open
def test_open_starts_queued_and_records_case_opened() -> None:
    case = open_case(previous=OTHER_CASE)
    assert case.status is CaseStatus.QUEUED
    assert case.queued_at == NOW
    assert not case.is_waiting_in_queue  # nobody announced the wait yet
    (event,) = case.pull_events()
    assert event.event_type == "case.opened"
    assert event.payload() == {
        "customer_id": CUSTOMER_ID,
        "channel": "chat_app",
        "language": "es",
        "priority": "medium",
        "sla_due_at": "2026-10-02T14:15:00Z",
        "previous_case_id": OTHER_CASE,
    }


def test_a_case_cannot_follow_itself() -> None:
    with pytest.raises(InvalidValueError):
        open_case(previous=CASE_ID)


# ----------------------------------------------------------------------------- the table
def test_queued_to_assigned_to_in_progress_to_closed() -> None:
    case = open_case()
    customer_says(case)
    assert case.mark_waiting_in_queue(
        label="Cola en español", reason_code="no_available_analyst", policy_rule_id=None, at=NOW
    )
    assert case.is_waiting_in_queue
    assert not case.mark_waiting_in_queue(  # announced once only
        label="Cola en español", reason_code="no_available_analyst", policy_rule_id=None, at=NOW
    )
    case.assign(assignment(case, waited=120))
    assert (case.status, case.assigned_analyst_id) == (CaseStatus.ASSIGNED, ANALYST_ID)
    case.mark_read(up_to=1, at=NOW)
    assert case.status is CaseStatus.IN_PROGRESS
    close(case)
    assert case.status is CaseStatus.CLOSED
    events = case.pull_events()
    assert [e.event_type for e in events] == [
        "case.opened",
        "turn.created",
        "case.queued",
        "case.assigned",
        "case.status_changed",
        "case.read",
        "case.closed",
        "case.status_changed",
    ]
    assert events[3].payload()["waited_seconds"] == 120
    assert events[-1].payload() == {
        "from_status": "in_progress",
        "to_status": "closed",
        "reason": "closed",
    }


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


@pytest.mark.parametrize("prepare", [assigned_case, in_progress_case], ids=["assigned", "progress"])
def test_close_from_assigned_or_in_progress(prepare: Callable[[], Case]) -> None:
    case = prepare()
    close(case, CloseReason.DUPLICATE, "  Ya lo atiende otro caso.  ")
    assert case.status is CaseStatus.CLOSED
    assert case.closure is not None
    assert (case.closure.reason, case.closure.note) == (
        CloseReason.DUPLICATE,
        "Ya lo atiende otro caso.",
    )
    closed = next(e for e in case.pull_events() if e.event_type == "case.closed")
    assert closed.payload() == {
        "closed_at": "2026-10-02T14:00:00Z",
        "closed_by_role": "analyst",
        "closed_by_id": ANALYST_ID,
        "reason": "duplicate",
        "note": "Ya lo atiende otro caso.",
    }


def test_a_closed_case_is_terminal() -> None:
    case = in_progress_case()
    close(case)
    with pytest.raises(CaseClosedError) as closed:
        close(case)
    assert closed.value.details == {"currentStatus": "closed"}
    with pytest.raises(CaseClosedError):
        customer_says(case)
    with pytest.raises(CaseClosedError):
        case.ensure_assignee_can_reply()
    with pytest.raises(CaseClosedError):
        case.assign(assignment(case))


def test_a_queued_case_cannot_be_closed_nor_answered() -> None:
    case = open_case()
    with pytest.raises(InvalidTransitionError) as refused:
        close(case)
    assert refused.value.details["currentStatus"] == "queued"
    with pytest.raises(InvalidTransitionError):
        case.ensure_assignee_can_reply()
    with pytest.raises(InvalidTransitionError):
        case.mark_read(up_to=1, at=NOW)  # nobody assigned yet


def test_invalid_transitions_raise_with_the_current_status() -> None:
    case = assigned_case()
    with pytest.raises(InvalidTransitionError) as again:
        case.assign(assignment(case))  # reassignment is slice 3
    assert again.value.details["currentStatus"] == "assigned"
    with pytest.raises(InvalidTransitionError):
        case.mark_waiting_in_queue(label="Cola", reason_code="x", policy_rule_id=None, at=NOW)


@pytest.mark.parametrize("reason", list(CloseReason))
def test_every_close_reason_is_accepted(reason: CloseReason) -> None:
    case = assigned_case()
    close(case, reason)
    assert case.closure is not None
    assert case.closure.reason is reason
    assert case.closure.note is None


def test_close_note_is_trimmed_blank_is_null_and_at_most_500() -> None:
    assert normalize_close_note(None) is None
    assert normalize_close_note("   ") is None
    assert normalize_close_note("  nota  ") == "nota"
    assert normalize_close_note("x" * 500) == "x" * 500
    with pytest.raises(InvalidValueError):
        normalize_close_note("x" * 501)
    case = assigned_case()
    with pytest.raises(InvalidValueError):
        close(case, note="x" * 501)
    assert case.status is CaseStatus.ASSIGNED  # nothing changed


# ----------------------------------------------------------------------------- first response
@pytest.mark.parametrize(("minutes", "met"), [(10, True), (15, True), (16, False)])
def test_first_analyst_message_stops_the_sla_once(minutes: int, met: bool) -> None:
    case = assigned_case()
    case.pull_events()
    at = NOW + timedelta(minutes=minutes)
    say(case, "Hola, soy Daniela.", role=TurnAuthorRole.ANALYST, at=at)
    assert case.first_response_at == at
    events = case.pull_events()
    assert [e.event_type for e in events] == ["turn.created", "case.first_responded"]
    assert events[1].actor == ANALYST
    assert events[1].payload() == {
        "first_response_at": at.isoformat().replace("+00:00", "Z"),
        "response_seconds": minutes * 60,
        "sla_due_at": "2026-10-02T14:15:00Z",
        "sla_met": met,
    }
    # Later analyst messages and customer messages never move it.
    say(case, "¿Sigue ahí?", role=TurnAuthorRole.ANALYST, at=at + timedelta(minutes=5))
    customer_says(case, "sí")
    assert case.first_response_at == at
    assert "case.first_responded" not in [e.event_type for e in case.pull_events()]


def test_notices_and_banners_do_not_count_as_a_first_response() -> None:
    case = assigned_case()
    case.append_turn(
        turn_id=turn_id(),
        kind=TurnKind.NOTICE,
        audience=TurnAudience.EVERYONE,
        author_role=TurnAuthorRole.SYSTEM,
        author_id=None,
        text="Recibimos tu mensaje.",
        created_at=NOW,
    )
    assert case.first_response_at is None


# ----------------------------------------------------------------------------- transcript
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


def test_slot_holds_one_open_case() -> None:
    slot = CustomerCaseSlot(customer_id=CUSTOMER_ID)
    slot.occupy(CASE_ID)
    slot.occupy(CASE_ID)  # idempotent for the same case
    with pytest.raises(ConflictError):
        slot.occupy(OTHER_CASE)
    slot.release(OTHER_CASE)  # not the holder: no-op
    assert slot.open_case_id == CASE_ID
    slot.release(CASE_ID)
    assert slot.open_case_id is None
