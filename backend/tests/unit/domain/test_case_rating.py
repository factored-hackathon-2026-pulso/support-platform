"""Customer rating of a closed case (slice 7 contract §2): closed only, once, by its own
customer, score 1–4, optional comment trimmed to at most 500 characters."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.cases import (
    MAX_RATING_COMMENT,
    AlreadyRatedError,
    Assignment,
    AssignmentReason,
    Case,
    CaseChannel,
    CaseNotClosedError,
    CasePriority,
    CaseRated,
    CaseRating,
    CloseReason,
    normalize_rating_comment,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError

NOW = datetime(2026, 10, 2, 14, tzinfo=UTC)
CASE_ID = "CASE-" + "0" * 25 + "1"
CUSTOMER_ID = "CUS-" + "0" * 25 + "1"
OTHER_CUSTOMER = "CUS-" + "0" * 25 + "2"
ANALYST_ID = "STF-" + "0" * 25 + "1"
CUSTOMER = ActorRef(ActorRole.CUSTOMER, CUSTOMER_ID)


def assigned_case() -> Case:
    case = Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia Guzmán Rincón",
        channel=CaseChannel.APP_CHAT,
        language=Language.SPANISH,
        priority=CasePriority.MEDIUM,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(minutes=15),
        actor=CUSTOMER,
    )
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


def closed_case() -> Case:
    case = assigned_case()
    case.close(
        actor=ActorRef(ActorRole.ANALYST, ANALYST_ID),
        at=NOW + timedelta(minutes=5),
        reason=CloseReason.RESOLVED,
    )
    case.pull_events()
    return case


def test_the_customer_rates_a_closed_case_once_and_it_counts_for_who_closed_it() -> None:
    case = closed_case()
    at = NOW + timedelta(minutes=6)
    rating = case.rate(actor=CUSTOMER, score=4, comment="  Muy amable.  ", at=at, key="key-0001")
    assert rating == CaseRating(score=4, rated_at=at, comment="Muy amable.", key="key-0001")
    assert case.rating == rating
    assert case.is_closed  # no transition: a closed case stays closed
    (event,) = case.pull_events()
    assert isinstance(event, CaseRated)
    assert event.event_type == "case.rated"
    assert event.case_id == CASE_ID
    assert event.actor == CUSTOMER
    assert event.payload() == {"score": 4, "comment": "Muy amable.", "analyst_id": ANALYST_ID}


def test_a_second_rating_is_already_rated() -> None:
    case = closed_case()
    case.rate(actor=CUSTOMER, score=3, comment=None, at=NOW)
    with pytest.raises(AlreadyRatedError) as raised:
        case.rate(actor=CUSTOMER, score=3, comment=None, at=NOW)
    assert raised.value.code == "already_rated"
    assert case.rating is not None
    assert case.rating.score == 3


@pytest.mark.parametrize("status", ["assigned", "queued"])
def test_an_open_case_cannot_be_rated(status: str) -> None:
    case = assigned_case()
    if status == "queued":
        case = Case.open(
            case_id=CASE_ID,
            customer_id=CUSTOMER_ID,
            customer_name="Natalia",
            channel=CaseChannel.WEB_CHAT,
            language=Language.SPANISH,
            priority=CasePriority.MEDIUM,
            opened_at=NOW,
            sla_due_at=NOW + timedelta(minutes=15),
            actor=CUSTOMER,
        )
    with pytest.raises(CaseNotClosedError) as raised:
        case.rate(actor=CUSTOMER, score=4, comment=None, at=NOW)
    assert raised.value.code == "case_not_closed"
    assert raised.value.details == {"currentStatus": status}
    assert case.rating is None


@pytest.mark.parametrize(
    "actor",
    [
        ActorRef(ActorRole.CUSTOMER, OTHER_CUSTOMER),
        ActorRef(ActorRole.ANALYST, ANALYST_ID),
        ActorRef.system(),
    ],
)
def test_only_its_own_customer_rates_it(actor: ActorRef) -> None:
    case = closed_case()
    with pytest.raises(NotFoundError):
        case.rate(actor=actor, score=4, comment=None, at=NOW)
    assert case.rating is None
    assert case.pull_events() == []


@pytest.mark.parametrize("score", [0, 5, -1, True])
def test_the_score_is_on_the_one_to_four_scale(score: int) -> None:
    case = closed_case()
    with pytest.raises(InvalidValueError) as raised:
        case.rate(actor=CUSTOMER, score=score, comment=None, at=NOW)
    assert raised.value.details == {"field": "score"}
    assert case.rating is None


def test_the_comment_is_optional_trimmed_and_at_most_500_characters() -> None:
    assert normalize_rating_comment(None) is None
    assert normalize_rating_comment("   ") is None
    assert normalize_rating_comment("  Bien  ") == "Bien"
    longest = "a" * MAX_RATING_COMMENT
    assert normalize_rating_comment(f"  {longest}  ") == longest
    with pytest.raises(InvalidValueError) as raised:
        normalize_rating_comment("a" * (MAX_RATING_COMMENT + 1))
    assert raised.value.details == {"field": "comment"}
    case = closed_case()
    case.rate(actor=CUSTOMER, score=2, comment="   ", at=NOW)
    assert case.rating is not None
    assert case.rating.comment is None


def test_a_rating_needs_a_closure() -> None:
    case = assigned_case()
    with pytest.raises(InvalidValueError):
        Case(
            id=case.id,
            customer_id=case.customer_id,
            channel=case.channel,
            language=case.language,
            priority=case.priority,
            status=case.status,
            opened_at=case.opened_at,
            sla_due_at=case.sla_due_at,
            search_text=case.search_text,
            rating=CaseRating(score=3, rated_at=NOW),
        )


def test_a_rating_value_checks_its_invariants() -> None:
    with pytest.raises(InvalidValueError):
        CaseRating(score=5, rated_at=NOW)
    with pytest.raises(InvalidValueError):
        CaseRating(score=3, rated_at=NOW, comment="  not trimmed ")
    rating = CaseRating(score=3, rated_at=NOW, comment="Bien")
    assert rating.answers(3, "Bien")
    assert not rating.answers(3, None)
    assert not rating.answers(4, "Bien")
