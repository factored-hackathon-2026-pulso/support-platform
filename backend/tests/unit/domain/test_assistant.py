"""The assistant in the domain (ADR 0003): a ``Case`` that opens ``with_assistant`` and leaves it,
and the ``AssistantSession`` that guards every call to agent-core."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.ai import (
    MAX_STEP_UP_ATTEMPTS,
    AgentInput,
    AssistantSession,
    AssistantState,
    PendingConfirmation,
    PendingStepUp,
)
from cc_platform.domain.ai.errors import (
    AssistantBusyError,
    AssistantNotActiveError,
    ConfirmationExpiredError,
    ConfirmationNotPendingError,
    StepUpNotPendingError,
)
from cc_platform.domain.cases import (
    Case,
    CaseChannel,
    CaseClosedError,
    CasePriority,
    CaseStatus,
    CloseReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError

NOW = datetime(2026, 10, 4, 14, tzinfo=UTC)
TIMEOUT = timedelta(minutes=2)
CASE_ID = "CASE-" + "0" * 25 + "1"
CUSTOMER_ID = "CUS-" + "0" * 25 + "1"
SESSION_ID = "AST-" + "0" * 25 + "1"
CUSTOMER = ActorRef(ActorRole.CUSTOMER, CUSTOMER_ID)
ASSISTANT = ActorRef(ActorRole.ASSISTANT, "disputas@1.0.0")
_ids = iter(range(1, 10_000))


def turn_id() -> str:
    return f"TRN-{next(_ids):026d}"


def assistant_case() -> Case:
    return Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia Guzmán",
        channel=CaseChannel.CHAT_APP,
        language=Language.SPANISH,
        priority=CasePriority.NONE,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(minutes=15),
        actor=CUSTOMER,
        assistant=(SESSION_ID, "recepcion@prod"),
    )


def write(case: Case, role: TurnAuthorRole, text: str = "Hola") -> None:
    case.append_turn(
        turn_id=turn_id(),
        kind=TurnKind.MESSAGE,
        audience=TurnAudience.EVERYONE,
        author_role=role,
        author_id=CUSTOMER_ID if role is TurnAuthorRole.CUSTOMER else "disputas@1.0.0",
        text=text,
        created_at=NOW,
    )


def event_types(case: Case) -> list[str]:
    return [event.event_type for event in case.pull_events()]


# ----------------------------------------------------------------------------- the case
def test_a_case_can_open_in_the_assistants_hands() -> None:
    case = assistant_case()

    assert case.status is CaseStatus.WITH_ASSISTANT
    assert case.is_with_assistant
    assert case.queued_at is None
    assert case.assigned_analyst_id is None
    assert event_types(case) == ["case.opened", "case.assistant_started"]


def test_the_assistants_reply_is_not_a_first_response_and_not_unread_for_anyone() -> None:
    case = assistant_case()
    case.pull_events()

    write(case, TurnAuthorRole.CUSTOMER)
    write(case, TurnAuthorRole.ASSISTANT, "Hola, te ayudo")

    assert case.first_response_at is None
    assert "case.first_responded" not in event_types(case)
    assert case.unread_count == 1  # only the customer's message


def test_releasing_to_people_queues_the_case_and_starts_the_sla_now() -> None:
    case = assistant_case()
    case.pull_events()
    later = NOW + timedelta(minutes=9)

    case.release_from_assistant(
        actor=ASSISTANT,
        at=later,
        sla_due_at=later + timedelta(minutes=15),
        reason="escalated",
        handoff_ref="hnd-1",
    )

    assert case.status is CaseStatus.QUEUED
    assert (case.queued_at, case.sla_due_at, case.queue_label) == (
        later,
        later + timedelta(minutes=15),
        None,
    )
    assert event_types(case) == ["case.assistant_released", "case.status_changed"]


def test_only_a_case_in_the_assistants_hands_can_be_released_or_closed_by_it() -> None:
    queued = Case.open(
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        customer_name="Natalia",
        channel=CaseChannel.CHAT_APP,
        language=Language.SPANISH,
        priority=CasePriority.NONE,
        opened_at=NOW,
        sla_due_at=NOW + timedelta(minutes=15),
        actor=CUSTOMER,
    )
    with pytest.raises(InvalidTransitionError):
        queued.release_from_assistant(
            actor=ASSISTANT, at=NOW, sla_due_at=NOW + timedelta(minutes=15), reason="failed"
        )
    with pytest.raises(InvalidTransitionError):
        queued.close_by_assistant(actor=ASSISTANT, at=NOW)


def test_the_sla_cannot_be_due_before_it_starts() -> None:
    with pytest.raises(InvalidValueError):
        assistant_case().release_from_assistant(
            actor=ASSISTANT, at=NOW, sla_due_at=NOW - timedelta(seconds=1), reason="failed"
        )


def test_the_assistant_resolves_a_case_and_it_is_terminal() -> None:
    case = assistant_case()
    case.pull_events()

    case.close_by_assistant(actor=ASSISTANT, at=NOW + timedelta(minutes=3))

    assert case.is_closed
    assert case.closure is not None
    assert (case.closure.closed_by_role, case.closure.reason) == (
        ActorRole.ASSISTANT,
        CloseReason.RESOLVED,
    )
    assert event_types(case) == ["case.closed", "case.status_changed"]
    with pytest.raises(CaseClosedError):
        case.release_from_assistant(
            actor=ASSISTANT, at=NOW, sla_due_at=NOW + timedelta(minutes=15), reason="failed"
        )


def test_nobody_can_hold_a_case_the_assistant_handles() -> None:
    with pytest.raises(InvalidValueError):
        Case(
            id=CASE_ID,
            customer_id=CUSTOMER_ID,
            channel=CaseChannel.CHAT_APP,
            language=Language.SPANISH,
            priority=CasePriority.NONE,
            status=CaseStatus.WITH_ASSISTANT,
            opened_at=NOW,
            sla_due_at=NOW + timedelta(minutes=15),
            search_text="",
            assigned_analyst_id="STF-" + "0" * 25 + "1",
        )


# ----------------------------------------------------------------------------- the session
def new_session() -> AssistantSession:
    session = AssistantSession.start(
        session_id=SESSION_ID,
        case_id=CASE_ID,
        customer_id=CUSTOMER_ID,
        entry_agent="recepcion@prod",
        at=NOW,
    )
    session.pull_events()
    return session


def answer(session: AssistantSession, turn: str, **over: object) -> None:
    args: dict[str, object] = {
        "turn_id": turn,
        "at": NOW,
        "awaiting": "input",
        "status": "open",
        "trace_id": "trace-1",
        "messages": 1,
        "run_id": "run-1",
        "agent": "recepcion@1.0.0",
        "outcome": None,
        "confirmation": None,
        "step_up": None,
    }
    args.update(over)
    session.apply_answer(**args)  # type: ignore[arg-type]


def test_the_next_input_is_the_oldest_unanswered_message() -> None:
    session = new_session()

    chosen = session.select_input([(3, "TRN-3"), (5, "TRN-5")], now=NOW, claim_timeout=TIMEOUT)

    assert chosen == AgentInput(kind="text", turn_id="TRN-3", sequence=3)
    assert session.select_input([], now=NOW, claim_timeout=TIMEOUT) is None


def test_one_input_is_in_flight_at_a_time_and_a_dead_claim_is_taken_over() -> None:
    session = new_session()
    first = AgentInput(kind="text", turn_id="TRN-3", sequence=3)
    session.claim_input(first, now=NOW)
    pending = [(3, "TRN-3"), (5, "TRN-5")]

    assert (
        session.select_input(pending, now=NOW + timedelta(seconds=30), claim_timeout=TIMEOUT)
        is None
    )
    assert session.select_input(pending, now=NOW + TIMEOUT, claim_timeout=TIMEOUT) == first


def test_a_confirmation_goes_before_new_messages() -> None:
    session = new_session()
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)
    answer(
        session,
        "TRN-1",
        awaiting="confirmation",
        confirmation=PendingConfirmation("tok", "Radicar", NOW + timedelta(minutes=5)),
    )

    session.answer_confirmation(token="tok", answer="yes", turn_id="TRN-9", actor=CUSTOMER, at=NOW)
    chosen = session.select_input([(4, "TRN-4")], now=NOW, claim_timeout=TIMEOUT)

    assert chosen == AgentInput(kind="confirm", turn_id="TRN-9", token="tok", answer="yes")
    session.claim_input(chosen, now=NOW)
    assert session.queued is None  # claimed: it is in flight now


def test_answering_a_confirmation_checks_token_expiry_and_the_claim() -> None:
    session = new_session()
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)
    answer(
        session,
        "TRN-1",
        awaiting="confirmation",
        confirmation=PendingConfirmation("tok", "Radicar", NOW + timedelta(minutes=5)),
    )

    with pytest.raises(ConfirmationNotPendingError):
        session.answer_confirmation(
            token="x", answer="yes", turn_id="TRN-2", actor=CUSTOMER, at=NOW
        )
    with pytest.raises(ConfirmationExpiredError):
        session.answer_confirmation(
            token="tok",
            answer="yes",
            turn_id="TRN-2",
            actor=CUSTOMER,
            at=NOW + timedelta(minutes=5),
        )
    session.claim_input(AgentInput(kind="text", turn_id="TRN-4", sequence=4), now=NOW)
    with pytest.raises(AssistantBusyError):
        session.answer_confirmation(
            token="tok", answer="no", turn_id="TRN-5", actor=CUSTOMER, at=NOW
        )


def test_an_answer_for_another_input_is_refused() -> None:
    session = new_session()
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)

    with pytest.raises(AssistantBusyError):
        answer(session, "TRN-OTHER")
    answer(session, "TRN-1")
    assert (session.claim, session.processed_sequence) == (None, 1)
    with pytest.raises(AssistantBusyError):  # applied once
        answer(session, "TRN-1")


def test_a_step_up_blocks_the_input_and_verifying_resends_it_with_a_new_id() -> None:
    session = new_session()
    blocked = AgentInput(kind="text", turn_id="TRN-1", sequence=1)
    session.claim_input(blocked, now=NOW)
    answer(session, "TRN-1", awaiting="step_up", step_up=PendingStepUp("monto", True))

    with pytest.raises(StepUpNotPendingError):
        new_session().verify_step_up(actor=CUSTOMER, at=NOW)
    session.verify_step_up(actor=CUSTOMER, at=NOW)
    resent = session.select_input([], now=NOW, claim_timeout=TIMEOUT)

    assert resent is not None
    assert resent.client_turn_id == "TRN-1.1"
    session.claim_input(resent, now=NOW)
    assert session.step_up_valid(NOW + timedelta(minutes=14)) is True
    assert session.step_up_valid(NOW + timedelta(minutes=15)) is False
    assert session.select_input([], now=NOW, claim_timeout=TIMEOUT) is None  # in flight again


def test_wrong_codes_count_and_the_last_one_reports_exhaustion() -> None:
    session = new_session()
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)
    answer(session, "TRN-1", awaiting="step_up", step_up=PendingStepUp("monto", True))

    results = [session.reject_step_up(actor=CUSTOMER, at=NOW) for _ in range(MAX_STEP_UP_ATTEMPTS)]

    assert results == [False, False, True]


def test_an_ended_session_refuses_everything() -> None:
    session = new_session()
    session.resolve(at=NOW)

    assert session.state is AssistantState.RESOLVED
    with pytest.raises(AssistantNotActiveError):
        session.fail(at=NOW, code="x")
    with pytest.raises(AssistantNotActiveError):
        session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)
    assert session.select_input([(1, "TRN-1")], now=NOW, claim_timeout=TIMEOUT) is None


def test_an_escalation_carries_its_handoff_and_the_label_is_sent_once() -> None:
    with pytest.raises(InvalidValueError):
        new_session().escalate(handoff_ref="", at=NOW)
    session = new_session()
    session.escalate(handoff_ref="hnd-1", at=NOW)

    assert (session.state, session.handoff_ref) == (AssistantState.ESCALATED, "hnd-1")
    assert session.mark_handoff_resolved(at=NOW) is True
    assert session.mark_handoff_resolved(at=NOW) is False
    assert new_session().mark_handoff_resolved(at=NOW) is False  # nothing to label


def test_session_events_carry_ids_and_enums_never_text() -> None:
    session = new_session()
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)
    answer(session, "TRN-1", messages=2)
    session.escalate(handoff_ref="hnd-1", at=NOW)

    events = session.pull_events()

    assert [e.event_type for e in events] == ["assistant.turn_answered", "assistant.ended"]
    payloads = [e.payload() for e in events]
    assert payloads[0]["messages"] == 2
    assert payloads[1]["result"] == "escalated"
    assert "text" not in payloads[0]


def test_the_answer_event_says_which_release_the_run_started_on() -> None:
    session = new_session()
    session.link_run(
        agent_session_id="ses-1", run_id="run-1", agent="recepcion@prod", release="rel-3", at=NOW
    )
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)

    answer(session, "TRN-1")

    event = session.pull_events()[-1]
    assert event.event_type == "assistant.turn_answered"
    assert event.payload()["release"] == "rel-3"


def test_a_session_without_a_known_release_says_none() -> None:
    session = new_session()
    session.claim_input(AgentInput(kind="text", turn_id="TRN-1", sequence=1), now=NOW)

    answer(session, "TRN-1")

    assert session.pull_events()[-1].payload()["release"] is None
