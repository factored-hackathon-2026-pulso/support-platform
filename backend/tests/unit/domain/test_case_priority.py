"""Case priority (slice 8 contract §2): five levels, ``none`` on open, set on an open case only,
the same level is a no-op, and the SLA never moves."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.cases import (
    CASE_EVENTS,
    Assignment,
    AssignmentReason,
    Case,
    CaseChannel,
    CaseClosedError,
    CasePriority,
    CasePriorityChanged,
    CaseStatus,
    CloseReason,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
CASE_ID = "CASE-" + "0" * 25 + "1"
CUSTOMER_ID = "CUS-" + "0" * 25 + "1"
ANALYST_ID = "STF-" + "0" * 25 + "1"
SUPERVISOR_ID = "STF-" + "0" * 25 + "5"
ANALYST = ActorRef(ActorRole.ANALYST, ANALYST_ID)


def test_the_levels_follow_the_dataset_plus_none() -> None:
    assert [p.value for p in CasePriority] == ["none", "low", "medium", "high", "critical"]
    assert CasePriorityChanged in CASE_EVENTS


def open_case() -> Case:
    case = Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia Guzmán Rincón",
        channel=CaseChannel.APP_CHAT,
        language=Language.SPANISH,
        priority=CasePriority.NONE,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(minutes=15),
        actor=ActorRef(ActorRole.CUSTOMER, CUSTOMER_ID),
    )
    case.pull_events()
    return case


def assigned_case() -> Case:
    case = open_case()
    case.assign(
        Assignment(
            id="ASG-" + "0" * 25 + "1",
            case_id=CASE_ID,
            staff_id=ANALYST_ID,
            reason=AssignmentReason.LANGUAGE_LEAST_LOADED,
            policy_rule_id=None,
            open_cases_at_assignment=0,
            strategy="language_least_loaded",
            assigned_at=NOW,
            assigned_by=ActorRef.system(),
        )
    )
    case.pull_events()
    return case


def test_a_change_records_from_and_to_and_keeps_status_and_sla() -> None:
    case = assigned_case()
    at = NOW + timedelta(minutes=2)
    assert case.change_priority(actor=ANALYST, priority=CasePriority.HIGH, at=at) is True
    assert case.priority is CasePriority.HIGH
    assert case.status is CaseStatus.ASSIGNED
    assert case.sla_due_at == NOW + timedelta(minutes=15)
    (event,) = case.pull_events()
    assert isinstance(event, CasePriorityChanged)
    assert event.event_type == "case.priority_changed"
    assert (event.entity, event.entity_id, event.case_id) == ("case", CASE_ID, CASE_ID)
    assert (event.actor, event.occurred_at) == (ANALYST, at)
    assert event.payload() == {"from": "none", "to": "high"}


def test_the_same_level_is_a_no_op() -> None:
    case = assigned_case()
    assert case.change_priority(actor=ANALYST, priority=CasePriority.NONE, at=NOW) is False
    assert case.pull_events() == []
    case.change_priority(actor=ANALYST, priority=CasePriority.CRITICAL, at=NOW)
    case.pull_events()
    assert case.change_priority(actor=ANALYST, priority=CasePriority.CRITICAL, at=NOW) is False
    assert case.pull_events() == []


def test_a_queued_case_takes_a_priority_from_supervision() -> None:
    case = open_case()
    supervisor = ActorRef(ActorRole.SUPERVISOR, SUPERVISOR_ID)
    assert case.change_priority(actor=supervisor, priority=CasePriority.LOW, at=NOW)
    assert case.status is CaseStatus.QUEUED
    (event,) = case.pull_events()
    assert event.actor == supervisor
    assert event.payload() == {"from": "none", "to": "low"}


def test_a_closed_case_keeps_its_priority() -> None:
    case = assigned_case()
    case.change_priority(actor=ANALYST, priority=CasePriority.MEDIUM, at=NOW)
    case.close(actor=ANALYST, at=NOW + timedelta(minutes=5), reason=CloseReason.RESOLVED)
    case.pull_events()
    with pytest.raises(CaseClosedError) as raised:
        case.change_priority(actor=ANALYST, priority=CasePriority.HIGH, at=NOW)
    assert raised.value.code == "case_closed"
    assert case.priority is CasePriority.MEDIUM
    assert case.pull_events() == []
