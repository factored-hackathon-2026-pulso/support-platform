"""The builder's records (ADR 0003, slice 16): the proposals index and the chat thread."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.ai.builder import BuilderProposal, BuilderThread
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, make_id

T = datetime(2026, 10, 4, 14, tzinfo=UTC)
STAFF = make_id(IdPrefix.STAFF, "0" * 25 + "1")
THREAD = make_id(IdPrefix.BUILDER_THREAD, "0" * 25 + "1")
ACTOR = ActorRef(ActorRole.SUPERVISOR, STAFF)


def proposal(**changes: object) -> BuilderProposal:
    values: dict[str, object] = {
        "id": "00000000-0000-7000-8000-000000000001",
        "agent_id": "disputas",
        "title": "Resumen más corto",
        "origin": "manual",
        "created_by": STAFF,
        "registered_by": STAFF,
        "source": "platform",
        "state": "draft",
        "rev": 0,
        "base_release_id": None,
        "candidate_hash": None,
        "created_at": T,
        "updated_at": T,
        "refreshed_at": T,
    }
    return BuilderProposal(**{**values, **changes})  # type: ignore[arg-type]


def thread() -> BuilderThread:
    return BuilderThread.start(
        thread_id=THREAD, staff_id=STAFF, agent="constructor-chat@prod", at=T
    )


# ----------------------------------------------------------------------------- the index
def test_a_proposal_needs_an_id_and_a_staff_member_who_brought_it() -> None:
    with pytest.raises(InvalidValueError):
        proposal(id="  ")
    with pytest.raises(InvalidValueError):
        proposal(registered_by="not-a-staff-id")


def test_observing_the_registry_reports_whether_anything_changed() -> None:
    entry = proposal()
    later = T + timedelta(minutes=5)

    unchanged = entry.observe(
        title=entry.title,
        state="draft",
        rev=0,
        base_release_id=None,
        candidate_hash=None,
        updated_at=T,
        at=later,
    )
    assert unchanged is False
    assert entry.refreshed_at == later  # it was read again, even if nothing moved

    changed = entry.observe(
        title=entry.title,
        state="candidate",
        rev=1,
        base_release_id=None,
        candidate_hash="abc",
        updated_at=later,
        at=later,
    )
    assert changed is True
    assert (entry.state, entry.rev, entry.candidate_hash) == ("candidate", 1, "abc")


# ----------------------------------------------------------------------------- the thread
def test_a_message_is_stored_once_per_client_message_id() -> None:
    chat = thread()

    first, is_new = chat.say(
        message_id="BLM-1", text="  acorta el resumen  ", client_message_id="c-1", at=T, actor=ACTOR
    )
    again, replayed = chat.say(
        message_id="BLM-2", text="acorta el resumen", client_message_id="c-1", at=T, actor=ACTOR
    )

    assert is_new is True
    assert replayed is False
    assert again is first
    assert first.text == "acorta el resumen"
    assert len(chat.messages) == 1
    with pytest.raises(IdempotencyConflictError):
        chat.say(message_id="BLM-3", text="otra cosa", client_message_id="c-1", at=T, actor=ACTOR)
    with pytest.raises(InvalidValueError):
        chat.say(message_id="BLM-4", text="   ", client_message_id="c-2", at=T, actor=ACTOR)
    with pytest.raises(InvalidValueError):
        chat.say(message_id="BLM-5", text="x" * 2001, client_message_id="c-3", at=T, actor=ACTOR)


def test_answers_link_to_their_message_and_the_events_keep_sizes_only() -> None:
    chat = thread()
    message, _ = chat.say(
        message_id="BLM-1", text="un texto privado", client_message_id="c-1", at=T, actor=ACTOR
    )
    answers = chat.record_answer(
        question_id=message.id,
        texts=["Creé la propuesta", "  ", "Y la validé"],
        message_ids=["BLM-2", "BLM-3", "BLM-4"],
        trace_id="trace-1",
        status="open",
        at=T,
    )

    assert [a.text for a in answers] == ["Creé la propuesta", "Y la validé"]  # blanks are skipped
    assert [a.role for a in answers] == ["agent", "agent"]
    assert chat.answers_to(message.id) == answers
    asked, answered = chat.pull_events()
    assert asked.event_type == "builder.question_asked"
    assert asked.actor == ACTOR
    assert asked.payload()["question_length"] == len("un texto privado")
    assert answered.event_type == "builder.answered"
    assert answered.payload()["messages"] == 2
    for event in (asked, answered):
        assert "privado" not in str(event.payload())
        assert "Creé" not in str(event.payload())
    with pytest.raises(InvalidValueError):
        chat.record_answer(
            question_id=message.id,
            texts=["a"],
            message_ids=[],
            trace_id="t",
            status="open",
            at=T,
        )


def test_a_closed_run_is_replaced_keeping_the_thread() -> None:
    chat = thread()
    chat.link_run(agent_session_id="ses-1", run_id="run-1", at=T)
    assert chat.run_key == f"{THREAD}.0"

    chat.new_run(at=T)

    assert (chat.agent_session_id, chat.run_id, chat.runs) == (None, None, 1)
    assert chat.run_key == f"{THREAD}.1"


def test_the_thread_keeps_the_newest_200_messages() -> None:
    chat = thread()
    for number in range(205):
        chat.say(
            message_id=f"BLM-{number}",
            text=f"mensaje {number}",
            client_message_id=f"c-{number}",
            at=T,
            actor=ACTOR,
        )

    assert len(chat.messages) == 200
    assert chat.messages[0].text == "mensaje 5"
