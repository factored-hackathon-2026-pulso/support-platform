"""Manual assignment in the domain (slice 3 contract §3.1): ``Case.assign`` with ``manual``,
``Case.reassign`` and rule 3 (``H1``)."""

from __future__ import annotations

from datetime import timedelta

import pytest

from cc_platform.domain.cases import (
    LANGUAGE_RULE_ID,
    Assignment,
    AssignmentReason,
    Case,
    CaseAssigned,
    CaseClosedError,
    CaseStatus,
    CaseStatusChanged,
    CloseReason,
    LanguageMismatchError,
    TurnAuthorRole,
    ensure_speaks_case_language,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError
from tests.unit.domain.test_case import (
    ANALYST,
    ANALYST_ID,
    NOW,
    assigned_case,
    customer_says,
    in_progress_case,
    open_case,
    say,
)

OTHER_ANALYST = "STF-" + "0" * 25 + "2"
SUPERVISOR = ActorRef(ActorRole.SUPERVISOR, "STF-" + "0" * 25 + "5")
LATER = NOW + timedelta(minutes=10)


def manual(
    case: Case,
    *,
    to: str = OTHER_ANALYST,
    previous: str | None = ANALYST_ID,
    paused: bool = False,
    waited: int | None = None,
) -> Assignment:
    return Assignment(
        id="ASG-" + "0" * 25 + "9",
        case_id=case.id,
        staff_id=to,
        reason=AssignmentReason.MANUAL,
        policy_rule_id=None,
        open_cases_at_assignment=2,
        strategy="manual",
        assigned_at=LATER,
        assigned_by=SUPERVISOR,
        waited_seconds=waited,
        previous_staff_id=previous,
        paused_override=paused,
    )


def assigned_events(case: Case) -> list[CaseAssigned]:
    return [e for e in case.pull_events() if isinstance(e, CaseAssigned)]


def test_manual_assignment_from_the_queue() -> None:
    case = open_case()
    case.pull_events()
    case.assign(manual(case, to=ANALYST_ID, previous=None, paused=True, waited=600))
    (event,) = case.pull_events()
    assert isinstance(event, CaseAssigned)
    assert (case.status, case.assigned_analyst_id) == (CaseStatus.ASSIGNED, ANALYST_ID)
    assert (event.reason, event.previous_analyst_id, event.paused_override) == (
        "manual",
        None,
        True,
    )
    assert event.actor == SUPERVISOR
    assert event.payload()["paused_override"] is True


def test_every_automatic_assignment_records_no_paused_override() -> None:
    case = assigned_case()
    events = [e for e in case.pull_events() if isinstance(e, CaseAssigned)]
    assert [e.paused_override for e in events] == [False]


def test_a_queued_assignment_cannot_name_a_previous_analyst() -> None:
    case = open_case()
    with pytest.raises(InvalidValueError):
        case.assign(manual(case, previous=ANALYST_ID))


def test_reassign_an_assigned_case() -> None:
    case = assigned_case()
    case.pull_events()
    case.reassign(manual(case))
    events = case.pull_events()
    assert [type(e) for e in events] == [CaseAssigned]  # no status change from assigned
    assert (case.status, case.assigned_analyst_id, case.assigned_at) == (
        CaseStatus.ASSIGNED,
        OTHER_ANALYST,
        LATER,
    )
    event = events[0]
    assert isinstance(event, CaseAssigned)
    assert (event.previous_analyst_id, event.assigned_analyst_id) == (ANALYST_ID, OTHER_ANALYST)


def test_reassign_an_in_progress_case_sends_it_back_to_new() -> None:
    case = in_progress_case()
    say(case, "Hola, ya lo reviso", role=TurnAuthorRole.ANALYST)
    customer_says(case, "¿Y entonces?")
    customer_says(case, "¿Hola?")
    unread_before = case.unread_sequences
    first_response = case.first_response_at
    sla_due = case.sla_due_at
    case.pull_events()

    case.reassign(manual(case))
    events = case.pull_events()
    assert [type(e) for e in events] == [CaseStatusChanged, CaseAssigned]
    changed = events[0]
    assert isinstance(changed, CaseStatusChanged)
    assert (changed.from_status, changed.to_status, changed.reason, changed.actor) == (
        "in_progress",
        "assigned",
        "reassigned",
        SUPERVISOR,
    )
    assert case.status is CaseStatus.ASSIGNED  # Nuevo for her until she opens it
    assert case.assignee_read_sequence == 0  # her read cursor restarts…
    assert case.unread_sequences == unread_before  # …the unread messages stay unread
    assert (case.first_response_at, case.sla_due_at) == (first_response, sla_due)  # SLA kept
    # The new assignee opens it like any new case.
    case.mark_read(up_to=case.last_sequence, at=LATER)
    assert case.status is CaseStatus.IN_PROGRESS
    assert case.unread_count == 0


def test_reassign_guards() -> None:
    closed = in_progress_case()
    closed.close(actor=ANALYST, at=LATER, reason=CloseReason.RESOLVED)
    with pytest.raises(CaseClosedError):
        closed.reassign(manual(closed))

    queued = open_case()
    with pytest.raises(InvalidTransitionError) as raised:
        queued.reassign(manual(queued))
    assert raised.value.details["currentStatus"] == "queued"

    same = assigned_case()
    with pytest.raises(InvalidValueError):
        same.reassign(manual(same, to=ANALYST_ID, previous=None))
    with pytest.raises(InvalidValueError):  # previous must be the current assignee
        same.reassign(manual(same, previous=None))
    assert same.assigned_analyst_id == ANALYST_ID


def test_an_assignment_cannot_reassign_to_the_same_person() -> None:
    case = assigned_case()
    with pytest.raises(InvalidValueError):
        manual(case, to=ANALYST_ID, previous=ANALYST_ID)


def test_rule_3_language() -> None:
    ensure_speaks_case_language(
        Language.PORTUGUESE, ANALYST_ID, {Language.SPANISH, Language.PORTUGUESE}
    )
    with pytest.raises(LanguageMismatchError) as raised:
        ensure_speaks_case_language(Language.PORTUGUESE, ANALYST_ID, {Language.SPANISH})
    assert raised.value.code == "language_mismatch"
    assert dict(raised.value.details) == {
        "policyRuleId": "H1",
        "caseLanguage": "pt",
        "analystId": ANALYST_ID,
    }
    assert LANGUAGE_RULE_ID == "H1"
