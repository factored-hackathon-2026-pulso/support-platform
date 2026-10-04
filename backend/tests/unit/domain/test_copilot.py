"""``CopilotThread``: questions stored before the call, idempotent retries, run bookkeeping."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from cc_platform.domain.ai.copilot import (
    MAX_ANSWER,
    MAX_MESSAGES,
    MAX_QUESTION,
    CopilotThread,
)
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.shared.errors import InvalidValueError

NOW = datetime(2026, 10, 4, 14, tzinfo=UTC)
THREAD = "CPT-" + "0" * 25 + "1"
CASE = "CASE-" + "0" * 25 + "1"
ANALYST = "STF-" + "0" * 25 + "1"
_ids = iter(range(1, 10_000))


def mid() -> str:
    return f"CPM-{next(_ids):026d}"


def thread() -> CopilotThread:
    return CopilotThread.start(
        thread_id=THREAD, case_id=CASE, analyst_id=ANALYST, agent="copiloto-asesor@prod", at=NOW
    )


def test_a_question_is_stored_once_per_client_message_id() -> None:
    t = thread()

    first, new = t.ask(message_id=mid(), text="  ¿Saldo?  ", client_message_id="k1", at=NOW)
    again, again_new = t.ask(message_id=mid(), text="¿Saldo?", client_message_id="k1", at=NOW)

    assert (new, again_new) == (True, False)
    assert again is first
    assert first.text == "¿Saldo?"
    assert len(t.messages) == 1
    with pytest.raises(IdempotencyConflictError):
        t.ask(message_id=mid(), text="otra", client_message_id="k1", at=NOW)


@pytest.mark.parametrize("text", ["", "   ", "x" * (MAX_QUESTION + 1)])
def test_a_question_has_one_to_two_thousand_characters(text: str) -> None:
    with pytest.raises(InvalidValueError):
        thread().ask(message_id=mid(), text=text, client_message_id="k", at=NOW)


def test_the_answer_links_to_its_question_skips_empty_and_cuts_long_messages() -> None:
    t = thread()
    question, _ = t.ask(message_id=mid(), text="hola", client_message_id="k1", at=NOW)

    written = t.record_answer(
        question_id=question.id,
        texts=["uno", "   ", "y" * (MAX_ANSWER + 10)],
        message_ids=[mid(), mid(), mid()],
        trace_id="trace-1",
        status="open",
        at=NOW,
    )

    assert [len(m.text) for m in written] == [3, MAX_ANSWER]
    assert t.answers_to(question.id) == written
    assert t.last_trace_id == "trace-1"


def test_the_events_carry_sizes_and_ids_never_the_text() -> None:
    t = thread()
    question, _ = t.ask(message_id=mid(), text="pregunta secreta", client_message_id="k1", at=NOW)
    t.record_answer(
        question_id=question.id,
        texts=["respuesta secreta"],
        message_ids=[mid()],
        trace_id="trace-1",
        status="open",
        at=NOW,
    )

    events = t.pull_events()

    assert [e.event_type for e in events] == ["copilot.query_asked", "copilot.answered"]
    assert "secreta" not in repr([e.payload() for e in events])
    assert events[0].payload()["question_length"] == len("pregunta secreta")


def test_a_new_run_changes_the_idempotency_key_and_drops_the_session() -> None:
    t = thread()
    t.link_run(agent_session_id="ses-1", run_id="run-1", at=NOW)
    assert t.run_key == f"{THREAD}.0"

    t.new_run(at=NOW)

    assert (t.run_key, t.agent_session_id, t.run_id) == (f"{THREAD}.1", None, None)


def test_the_thread_keeps_the_newest_messages_only() -> None:
    t = thread()
    for n in range(MAX_MESSAGES + 5):
        t.ask(message_id=mid(), text=f"q{n}", client_message_id=f"k{n}", at=NOW)

    assert len(t.messages) == MAX_MESSAGES
    assert t.messages[-1].text == f"q{MAX_MESSAGES + 4}"
