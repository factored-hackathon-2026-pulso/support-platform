"""``Escalation`` aggregate and the case's one-open-escalation pointer (slice 9)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.cases import (
    MAX_ESCALATION_TEXT,
    CaseChannel,
    CaseClosedError,
    CasePriority,
    CloseReason,
    Escalation,
    EscalationNotOpenError,
    EscalationOpenError,
    EscalationState,
)
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import AssignmentReason
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError

T = datetime(2026, 10, 4, 15, tzinfo=UTC)
CASE = "CASE-" + "0" * 25 + "1"
ESC, ESC_2 = "ESC-" + "0" * 25 + "1", "ESC-" + "0" * 25 + "2"
DANIELA, LUCIA, JULIAN = ("STF-" + "0" * 25 + n for n in ("1", "5", "2"))
ANALYST = ActorRef(ActorRole.ANALYST, DANIELA)
SUPERVISOR = ActorRef(ActorRole.SUPERVISOR, LUCIA)


def opened(motive: str = "  La clienta pide hablar con supervisión.  ") -> Escalation:
    return Escalation.open(escalation_id=ESC, case_id=CASE, motive=motive, actor=ANALYST, at=T)


def assigned_case() -> Case:
    case = Case.open(
        case_id=CASE,
        customer_id="CUS-" + "0" * 25 + "1",
        customer_name="Marcela",
        channel=CaseChannel.CHAT_WEB,
        language=Language.SPANISH,
        priority=CasePriority.NONE,
        opened_at=T,
        sla_due_at=T + timedelta(minutes=15),
        actor=ActorRef(ActorRole.CUSTOMER, "CUS-" + "0" * 25 + "1"),
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


# ----------------------------------------------------------------------------- opening
def test_an_escalation_opens_with_a_trimmed_motive_and_one_event() -> None:
    escalation = opened()
    assert escalation.state is EscalationState.OPEN
    assert escalation.motive == "La clienta pide hablar con supervisión."
    assert (escalation.escalated_by_id, escalation.escalated_at) == (DANIELA, T)
    (event,) = escalation.pull_events()
    assert event.event_type == "escalation.opened"
    assert (event.entity_id, event.case_id) == (ESC, CASE)
    assert event.payload() == {
        "motive": "La clienta pide hablar con supervisión.",
        "analyst_id": DANIELA,
    }


@pytest.mark.parametrize("motive", ["", "   ", "x" * (MAX_ESCALATION_TEXT + 1)])
def test_the_motive_is_required_and_at_most_500(motive: str) -> None:
    with pytest.raises(InvalidValueError) as raised:
        opened(motive)
    assert raised.value.details["field"] == "motive"


def test_a_500_character_motive_is_fine() -> None:
    assert len(opened("x" * MAX_ESCALATION_TEXT).motive) == MAX_ESCALATION_TEXT


# ----------------------------------------------------------------------------- endings
def test_withdraw_ends_it_once() -> None:
    escalation = opened()
    escalation.pull_events()
    escalation.withdraw(actor=ANALYST, at=T + timedelta(minutes=1))
    assert escalation.state is EscalationState.WITHDRAWN
    assert (escalation.resolved_at, escalation.resolved_by_id) == (
        T + timedelta(minutes=1),
        DANIELA,
    )
    assert [e.event_type for e in escalation.pull_events()] == ["escalation.withdrawn"]
    with pytest.raises(EscalationNotOpenError) as raised:
        escalation.withdraw(actor=ANALYST, at=T)
    assert raised.value.details == {"currentState": "withdrawn"}


def test_an_answer_needs_a_note_and_keeps_it() -> None:
    escalation = opened()
    escalation.pull_events()
    with pytest.raises(InvalidValueError):
        escalation.answer(actor=SUPERVISOR, note="  ", at=T)
    assert escalation.is_open  # a rejected answer changes nothing
    escalation.answer(actor=SUPERVISOR, note=" Sigue tú con el caso. ", at=T)
    assert (escalation.state, escalation.note) == (
        EscalationState.ANSWERED,
        "Sigue tú con el caso.",
    )
    (event,) = escalation.pull_events()
    assert event.payload() == {"note": "Sigue tú con el caso.", "analyst_id": DANIELA}
    with pytest.raises(EscalationNotOpenError):
        escalation.answer(actor=SUPERVISOR, note="Otra", at=T)


def test_taking_and_reassigning_record_who_holds_the_case_now() -> None:
    taken = opened()
    taken.take(actor=ActorRef(ActorRole.SUPERVISOR, JULIAN), at=T)
    assert (taken.state, taken.reassigned_to_id) == (EscalationState.TAKEN, JULIAN)
    assert taken.pull_events()[-1].payload() == {
        "previous_analyst_id": DANIELA,
        "analyst_id": JULIAN,
    }
    moved = opened()
    moved.mark_reassigned(actor=SUPERVISOR, to_staff_id=JULIAN, at=T)
    assert (moved.state, moved.reassigned_to_id, moved.resolved_by_id) == (
        EscalationState.REASSIGNED,
        JULIAN,
        LUCIA,
    )
    assert moved.pull_events()[-1].event_type == "escalation.reassigned"


def test_it_ends_with_the_case() -> None:
    escalation = opened()
    escalation.end_with_case(actor=ANALYST, at=T)
    assert escalation.state is EscalationState.CLOSED
    assert escalation.pull_events()[-1].event_type == "escalation.closed"


# ----------------------------------------------------------------------------- "Entendido"
def test_only_who_escalated_acknowledges_an_attended_one_once() -> None:
    escalation = opened()
    with pytest.raises(InvalidTransitionError):  # supervision did nothing yet
        escalation.acknowledge(actor=ANALYST, at=T)
    escalation.answer(actor=SUPERVISOR, note="Listo.", at=T)
    escalation.pull_events()
    with pytest.raises(InvalidValueError):
        escalation.acknowledge(actor=SUPERVISOR, at=T)
    assert escalation.acknowledge(actor=ANALYST, at=T + timedelta(minutes=2)) is True
    assert escalation.acknowledged_at == T + timedelta(minutes=2)
    assert escalation.acknowledge(actor=ANALYST, at=T + timedelta(minutes=3)) is False
    assert [e.event_type for e in escalation.pull_events()] == ["escalation.acknowledged"]


def test_a_withdrawn_one_has_nothing_to_acknowledge() -> None:
    escalation = opened()
    escalation.withdraw(actor=ANALYST, at=T)
    with pytest.raises(InvalidTransitionError):
        escalation.acknowledge(actor=ANALYST, at=T)


def test_an_open_escalation_has_no_resolution() -> None:
    with pytest.raises(InvalidValueError):
        Escalation(
            id=ESC,
            case_id=CASE,
            motive="m",
            escalated_by_id=DANIELA,
            escalated_at=T,
            resolved_at=T,
        )


# ----------------------------------------------------------------------------- the case pointer
def test_a_case_holds_one_open_escalation_at_a_time() -> None:
    case = assigned_case()
    case.escalate(ESC)
    assert (case.is_escalated, case.open_escalation_id) == (True, ESC)
    with pytest.raises(EscalationOpenError) as raised:
        case.escalate(ESC_2)
    assert raised.value.details == {"escalationId": ESC}
    with pytest.raises(InvalidValueError):
        case.clear_escalation(ESC_2)
    case.clear_escalation(ESC)
    assert case.is_escalated is False
    case.escalate(ESC_2)  # escalated again once the first one ended
    assert case.open_escalation_id == ESC_2
    assert case.pull_events() == []  # the escalation records the events, not the case


def test_a_queued_or_closed_case_cannot_be_escalated() -> None:
    queued = Case.open(
        case_id=CASE,
        customer_id="CUS-" + "0" * 25 + "1",
        customer_name="Marcela",
        channel=CaseChannel.CHAT_WEB,
        language=Language.SPANISH,
        priority=CasePriority.NONE,
        opened_at=T,
        sla_due_at=T + timedelta(minutes=15),
        actor=ActorRef(ActorRole.CUSTOMER, "CUS-" + "0" * 25 + "1"),
    )
    with pytest.raises(InvalidTransitionError):
        queued.escalate(ESC)
    closed = assigned_case()
    closed.close(actor=ANALYST, at=T, reason=CloseReason.RESOLVED)
    with pytest.raises(CaseClosedError):
        closed.escalate(ESC)
