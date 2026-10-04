"""``Call`` aggregate, the case's one-active-call pointer and the slice 12 turn kinds."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.cases import (
    MAX_CALL_REASON,
    Call,
    CallDirection,
    CallEndReason,
    CallInProgressError,
    CallNotActiveError,
    CallState,
    CaseChannel,
    CaseClosedError,
    CasePriority,
    CloseReason,
    EmailDirection,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import AssignmentReason
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError

T = datetime(2026, 10, 4, 15, tzinfo=UTC)
CASE = "CASE-" + "0" * 25 + "1"
CALL, CALL_2 = "CALL-" + "0" * 25 + "1", "CALL-" + "0" * 25 + "2"
CUSTOMER = "CUS-" + "0" * 25 + "1"
DANIELA = "STF-" + "0" * 25 + "1"
ANALYST = ActorRef(ActorRole.ANALYST, DANIELA)
CLIENT = ActorRef(ActorRole.CUSTOMER, CUSTOMER)


def at(seconds: int) -> datetime:
    return T + timedelta(seconds=seconds)


def inbound() -> Call:
    return Call.start_inbound(call_id=CALL, case_id=CASE, customer_id=CUSTOMER, at=T)


def outbound(reason: str = "  Seguimiento del cargo  ") -> Call:
    return Call.start_outbound(
        call_id=CALL,
        case_id=CASE,
        customer_id=CUSTOMER,
        analyst_id=DANIELA,
        reason=reason,
        at=T,
    )


def assigned_case() -> Case:
    case = Case.open(
        case_id=CASE,
        customer_id=CUSTOMER,
        customer_name="Natalia Rendón Úsuga",
        channel=CaseChannel.PHONE_INBOUND,
        language=Language.SPANISH,
        priority=CasePriority.NONE,
        opened_at=T,
        sla_due_at=T + timedelta(minutes=15),
        actor=CLIENT,
    )
    case.assign(
        Assignment(
            id="ASG-" + "0" * 25 + "1",
            case_id=CASE,
            staff_id=DANIELA,
            reason=AssignmentReason.LANGUAGE_LEAST_LOADED,
            policy_rule_id=None,
            open_cases_at_assignment=0,
            strategy="test",
            assigned_at=T,
            assigned_by=ActorRef.system(),
        )
    )
    case.pull_events()
    return case


# ----------------------------------------------------------------------------- state machine
def test_an_inbound_call_rings_until_the_bank_answers() -> None:
    call = inbound()
    assert (call.state, call.direction, call.analyst_id, call.reason) == (
        CallState.RINGING,
        CallDirection.INBOUND,
        None,
        None,
    )
    (started,) = call.pull_events()
    assert started.event_type == "call.started"
    assert started.actor == CLIENT
    assert started.payload() == {
        "direction": "inbound",
        "customer_id": CUSTOMER,
        "analyst_id": None,
        "reason": None,
    }
    call.answer(actor=ANALYST, at=at(12))
    assert (call.state, call.analyst_id, call.answered_at) == (CallState.IN_CALL, DANIELA, at(12))
    (answered,) = call.pull_events()
    assert answered.payload() == {
        "answered_by_role": "analyst",
        "analyst_id": DANIELA,
        "ring_seconds": 12,
    }


def test_hold_resume_mute_and_hang_up_keep_times_and_intervals() -> None:
    call = inbound()
    call.answer(actor=ANALYST, at=at(10))
    call.hold(actor=ANALYST, at=at(70))
    assert call.state is CallState.ON_HOLD
    assert call.set_muted(actor=ANALYST, muted=True, at=at(75))
    assert not call.set_muted(actor=ANALYST, muted=True, at=at(76))  # same value: no event
    call.resume(actor=ANALYST, at=at(100))
    call.hold(actor=ANALYST, at=at(130))
    call.hang_up(actor=ANALYST, at=at(160))  # hanging up while on hold closes the hold
    assert call.state is CallState.ENDED
    assert call.end_reason is CallEndReason.COMPLETED
    assert call.ended_by_role is ActorRole.ANALYST
    assert [(h.started_at, h.ended_at) for h in call.holds] == [
        (at(70), at(100)),
        (at(130), at(160)),
    ]
    assert (call.hold_seconds, call.duration_seconds, call.muted) == (60, 150, True)
    types = [e.event_type for e in call.pull_events()]
    assert types == [
        "call.started",
        "call.answered",
        "call.held",
        "call.mute_changed",
        "call.resumed",
        "call.held",
        "call.ended",
    ]


def test_the_ended_event_tells_how_it_went() -> None:
    call = inbound()
    call.answer(actor=ANALYST, at=at(5))
    call.hang_up(actor=CLIENT, at=at(65))
    ended = call.pull_events()[-1]
    assert ended.payload() == {
        "end_reason": "completed",
        "ended_by_role": "customer",
        "analyst_id": DANIELA,
        "answered": True,
        "duration_seconds": 60,
        "hold_seconds": 0,
    }


@pytest.mark.parametrize(
    ("direction", "who", "reason"),
    [
        ("inbound", CLIENT, CallEndReason.CANCELLED),  # the customer gave up before an answer
        ("outbound", ANALYST, CallEndReason.CANCELLED),  # the analyst stopped calling
        ("outbound", CLIENT, CallEndReason.REJECTED),  # the customer hung up on the ring
    ],
)
def test_hanging_up_while_it_rings(direction: str, who: ActorRef, reason: CallEndReason) -> None:
    call = inbound() if direction == "inbound" else outbound()
    call.hang_up(actor=who, at=at(8))
    assert (call.state, call.end_reason, call.duration_seconds) == (CallState.ENDED, reason, None)


def test_an_outbound_call_has_a_reason_and_the_customer_answers_or_rejects() -> None:
    call = outbound()
    assert (call.reason, call.analyst_id) == ("Seguimiento del cargo", DANIELA)
    with pytest.raises(InvalidValueError):
        call.answer(actor=ANALYST, at=at(3))  # the bank does not answer its own call
    call.answer(actor=CLIENT, at=at(4))
    assert call.state is CallState.IN_CALL
    rejected = outbound()
    rejected.reject(actor=CLIENT, at=at(2))
    assert rejected.end_reason is CallEndReason.REJECTED
    with pytest.raises(InvalidTransitionError):
        inbound().reject(actor=CLIENT, at=at(2))  # only a call from the bank is rejected


@pytest.mark.parametrize("reason", ["   ", "x" * (MAX_CALL_REASON + 1)])
def test_an_outbound_reason_is_required_and_bounded(reason: str) -> None:
    with pytest.raises(InvalidValueError):
        outbound(reason)


def test_invalid_transitions_name_the_current_state() -> None:
    call = inbound()
    with pytest.raises(InvalidTransitionError) as ringing:
        call.hold(actor=ANALYST, at=at(1))
    assert ringing.value.details == {"currentState": "ringing"}
    with pytest.raises(InvalidTransitionError):
        call.resume(actor=ANALYST, at=at(1))
    with pytest.raises(InvalidTransitionError):
        call.ensure_talking()
    call.answer(actor=ANALYST, at=at(2))
    with pytest.raises(InvalidTransitionError):
        call.answer(actor=ANALYST, at=at(3))
    with pytest.raises(InvalidValueError):
        call.hold(actor=CLIENT, at=at(3))  # only the bank's side holds
    call.hold(actor=ANALYST, at=at(4))
    with pytest.raises(InvalidTransitionError):
        call.ensure_talking()  # no transcript lines while on hold
    call.hang_up(actor=ANALYST, at=at(5))
    for action in (
        lambda: call.hang_up(actor=ANALYST, at=at(6)),
        lambda: call.answer(actor=ANALYST, at=at(6)),
        lambda: call.set_muted(actor=ANALYST, muted=True, at=at(6)),
        call.ensure_talking,
    ):
        with pytest.raises(CallNotActiveError) as ended:
            action()
        assert ended.value.details == {"currentState": "ended"}


def test_invariants_reject_inconsistent_rows() -> None:
    with pytest.raises(InvalidValueError):
        Call(
            id=CALL,
            case_id=CASE,
            customer_id=CUSTOMER,
            direction=CallDirection.INBOUND,
            started_at=T,
            state=CallState.IN_CALL,  # answered without answered_at
        )
    with pytest.raises(InvalidValueError):
        Call(
            id=CALL,
            case_id=CASE,
            customer_id=CUSTOMER,
            direction=CallDirection.OUTBOUND,
            started_at=T,
            analyst_id=DANIELA,  # an outbound call without its reason
        )


# ----------------------------------------------------------------------------- the case
def test_one_active_call_per_case_and_no_close_while_it_is_on() -> None:
    case = assigned_case()
    case.start_call(CALL)
    with pytest.raises(CallInProgressError) as second:
        case.start_call(CALL_2)
    assert second.value.details == {"callId": CALL}
    with pytest.raises(CallInProgressError):
        case.close(actor=ANALYST, at=at(5), reason=CloseReason.RESOLVED)
    case.end_call(CALL)
    case.close(actor=ANALYST, at=at(6), reason=CloseReason.RESOLVED)
    with pytest.raises(CaseClosedError):
        case.start_call(CALL_2)


def test_answering_a_call_is_the_first_response() -> None:
    case = assigned_case()
    assert case.respond_by_call(actor=ANALYST, at=at(30))
    assert case.first_response_at == at(30)
    assert not case.respond_by_call(actor=ANALYST, at=at(90))  # only the first one counts
    (event,) = case.pull_events()
    assert event.event_type == "case.first_responded"
    assert event.payload()["sla_met"] is True


def test_turn_kinds_of_slice_12() -> None:
    case = assigned_case()
    line = case.append_turn(
        turn_id="TRN-" + "0" * 25 + "1",
        kind=TurnKind.TRANSCRIPT,
        audience=TurnAudience.EVERYONE,
        author_role=TurnAuthorRole.CUSTOMER,
        author_id=CUSTOMER,
        text="Hola, llamo por un cargo.",
        created_at=at(1),
    )
    assert not line.is_customer_message  # a call line is not a chat message for the inbox
    assert (case.last_message_at, case.unread_sequences) == (None, ())
    email = case.append_turn(
        turn_id="TRN-" + "0" * 25 + "2",
        kind=TurnKind.EMAIL,
        audience=TurnAudience.EVERYONE,
        author_role=TurnAuthorRole.CUSTOMER,
        author_id=CUSTOMER,
        text="Les escribo por un cargo.",
        created_at=at(2),
        subject="Cargo no reconocido",
    )
    assert (email.is_customer_message, email.email_direction) == (True, EmailDirection.IN)
    assert case.unread_sequences == (2,)
    events = case.pull_events()
    assert "subject" not in events[0].payload()  # only emails carry a subject
    assert events[1].payload()["subject"] == "Cargo no reconocido"
    reply = case.append_turn(
        turn_id="TRN-" + "0" * 25 + "3",
        kind=TurnKind.EMAIL,
        audience=TurnAudience.EVERYONE,
        author_role=TurnAuthorRole.ANALYST,
        author_id=DANIELA,
        text="Hola, Natalia:\n\nYa lo revisamos.",
        created_at=at(3),
        subject="Re: Cargo no reconocido",
    )
    assert reply.email_direction is EmailDirection.OUT
    assert case.first_response_at == at(3)  # the first email reply stops the SLA


@pytest.mark.parametrize(
    ("kind", "audience", "role", "subject"),
    [
        (TurnKind.NOTE, TurnAudience.EVERYONE, TurnAuthorRole.ANALYST, None),
        (TurnKind.NOTE, TurnAudience.STAFF, TurnAuthorRole.CUSTOMER, None),
        (TurnKind.EMAIL, TurnAudience.EVERYONE, TurnAuthorRole.CUSTOMER, None),
        (TurnKind.MESSAGE, TurnAudience.EVERYONE, TurnAuthorRole.CUSTOMER, "Asunto"),
        (TurnKind.EMAIL, TurnAudience.STAFF, TurnAuthorRole.CUSTOMER, "Asunto"),
        (TurnKind.TRANSCRIPT, TurnAudience.STAFF, TurnAuthorRole.SYSTEM, None),
    ],
)
def test_turn_kind_invariants(
    kind: TurnKind, audience: TurnAudience, role: TurnAuthorRole, subject: str | None
) -> None:
    case = assigned_case()
    with pytest.raises(InvalidValueError):
        case.append_turn(
            turn_id="TRN-" + "0" * 25 + "1",
            kind=kind,
            audience=audience,
            author_role=role,
            author_id=DANIELA if role is TurnAuthorRole.ANALYST else CUSTOMER,
            text="Texto",
            created_at=at(1),
            subject=subject,
        )
