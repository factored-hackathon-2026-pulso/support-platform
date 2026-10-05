"""Case type (slice 18 contract §3): the dataset's complaint subcategories plus ``none`` (and the
team-generated "Tarjeta virtual"), ``none`` on open, set on an open case only, the same type is
a no-op, and neither the status nor the SLA moves."""

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
    CaseStatus,
    CaseType,
    CaseTypeChanged,
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


def test_the_types_are_the_dataset_subcategories_plus_none_and_virtual_card() -> None:
    assert [t.value for t in CaseType] == [
        "none",
        "unrecognized_charge",
        "undue_charge",
        "app_issue",
        "branch_service",
        "service_quality",
        "virtual_card",
    ]
    assert CaseTypeChanged in CASE_EVENTS


def open_case() -> Case:
    case = Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia Guzmán Rincón",
        channel=CaseChannel.CHAT_APP,
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


def test_every_case_opens_without_a_type() -> None:
    assert open_case().case_type is CaseType.NONE


def test_a_change_records_from_and_to_and_keeps_status_priority_and_sla() -> None:
    case = assigned_case()
    at = NOW + timedelta(minutes=2)
    assert case.change_type(actor=ANALYST, case_type=CaseType.UNDUE_CHARGE, at=at) is True
    assert case.case_type is CaseType.UNDUE_CHARGE
    assert case.status is CaseStatus.ASSIGNED
    assert case.priority is CasePriority.NONE
    assert case.sla_due_at == NOW + timedelta(minutes=15)
    (event,) = case.pull_events()
    assert isinstance(event, CaseTypeChanged)
    assert event.event_type == "case.type_changed"
    assert (event.entity, event.entity_id, event.case_id) == ("case", CASE_ID, CASE_ID)
    assert (event.actor, event.occurred_at) == (ANALYST, at)
    assert event.payload() == {"from": "none", "to": "undue_charge"}


def test_the_same_type_is_a_no_op() -> None:
    case = assigned_case()
    assert case.change_type(actor=ANALYST, case_type=CaseType.NONE, at=NOW) is False
    assert case.pull_events() == []
    case.change_type(actor=ANALYST, case_type=CaseType.APP_ISSUE, at=NOW)
    case.pull_events()
    assert case.change_type(actor=ANALYST, case_type=CaseType.APP_ISSUE, at=NOW) is False
    assert case.pull_events() == []


def test_a_queued_case_takes_a_type_from_supervision() -> None:
    case = open_case()
    supervisor = ActorRef(ActorRole.SUPERVISOR, SUPERVISOR_ID)
    assert case.change_type(actor=supervisor, case_type=CaseType.VIRTUAL_CARD, at=NOW)
    assert case.status is CaseStatus.QUEUED
    (event,) = case.pull_events()
    assert event.actor == supervisor
    assert event.payload() == {"from": "none", "to": "virtual_card"}


def test_back_to_none_is_a_change() -> None:
    case = assigned_case()
    case.change_type(actor=ANALYST, case_type=CaseType.SERVICE_QUALITY, at=NOW)
    case.pull_events()
    assert case.change_type(actor=ANALYST, case_type=CaseType.NONE, at=NOW) is True
    (event,) = case.pull_events()
    assert event.payload() == {"from": "service_quality", "to": "none"}


def test_a_closed_case_keeps_its_type() -> None:
    case = assigned_case()
    case.change_type(actor=ANALYST, case_type=CaseType.BRANCH_SERVICE, at=NOW)
    case.close(actor=ANALYST, at=NOW + timedelta(minutes=5), reason=CloseReason.RESOLVED)
    case.pull_events()
    with pytest.raises(CaseClosedError) as raised:
        case.change_type(actor=ANALYST, case_type=CaseType.APP_ISSUE, at=NOW)
    assert raised.value.code == "case_closed"
    assert case.case_type is CaseType.BRANCH_SERVICE
    assert case.pull_events() == []
