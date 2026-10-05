"""``CopilotSuggestion``: a typed list that may be empty, decisions, purge, events without text."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.ai.suggestion import (
    DRAFT_TTL,
    MAX_EVIDENCE,
    MAX_REPLY,
    MAX_SUGGESTIONS,
    ActionSuggestion,
    CopilotSuggestion,
    EscalationSuggestion,
    ReplyDecision,
    ReplySuggestion,
    SuggestionStatus,
    SuggestionTrigger,
    ToolSuggestion,
    edit_distance_permille,
    normalize_suggestions,
    text_hash,
)
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.errors import InvalidValueError

NOW = datetime(2026, 10, 4, 14, tzinfo=UTC)
CASE = "CASE-" + "0" * 25 + "1"
ANALYST = "STF-" + "0" * 25 + "1"
DRAFT = "Lorena, revisé tu cuenta: los dos cobros de $18.900 no corresponden."


def suggestion(trigger: SuggestionTrigger = SuggestionTrigger.MANUAL) -> CopilotSuggestion:
    return CopilotSuggestion.request(
        suggestion_id="CPS-" + "0" * 25 + "1",
        case_id=CASE,
        analyst_id=ANALYST,
        agent="copiloto-sugerencias@prod",
        trigger=trigger,
        based_on_sequence=7,
        request_key="k1",
        at=NOW,
    )


def everything() -> list:
    return [
        ReplySuggestion(text=DRAFT, citations=("fact-1",), language="es"),
        ToolSuggestion(tool="leer_movimientos@1", label="Movimientos", why="Ver los dos cobros"),
        ActionSuggestion(tool="radicar_pqr@1", summary="Radicar una disputa por 120 USD"),
        EscalationSuggestion(
            reason_code="policy:escalamiento-disputa-monto",
            evidence=("Pidió hablar con supervisión",),
            motive_draft="La clienta pide hablar con supervisión.",
        ),
    ]


def ready(raw: list | None = None) -> CopilotSuggestion:
    s = suggestion()
    items = everything() if raw is None else raw
    s.record_answer(raw=items, run_id="run-1", trace_id="t-1", at=NOW)
    return s


def test_a_new_suggestion_is_preparing_and_says_who_asked() -> None:
    manual, automatic = suggestion(), suggestion(SuggestionTrigger.CUSTOMER_MESSAGE)

    assert manual.status is SuggestionStatus.PREPARING
    (event,) = manual.pull_events()
    assert event.event_type == "copilot.suggestion_requested"
    assert event.actor.role is ActorRole.ANALYST
    assert event.payload() == {
        "analyst_id": ANALYST,
        "trigger": "manual",
        "based_on_sequence": 7,
    }
    assert automatic.pull_events()[0].actor.role is ActorRole.SYSTEM


def test_a_ready_suggestion_keeps_the_kinds_the_tools_and_the_drafts_hash() -> None:
    s = ready()

    assert s.status is SuggestionStatus.READY
    assert s.kinds == ("reply", "tool", "action", "escalate")
    assert s.tool_ids == ("leer_movimientos@1", "radicar_pqr@1")
    assert s.reply_hash == text_hash(DRAFT)
    assert (s.run_id, s.trace_id) == ("run-1", "t-1")
    assert s.reply_pending
    assert s.recommends_escalation


def test_nothing_to_propose_is_a_normal_answer() -> None:
    s = suggestion()
    s.record_answer(raw=[], run_id="run-1", trace_id="t-1", at=NOW)

    assert s.status is SuggestionStatus.NONE
    assert s.items == ()
    assert s.kinds == ()
    assert [e.event_type for e in s.pull_events()][-1] == "copilot.suggestion_none"


def test_a_list_of_empty_things_is_also_nothing() -> None:
    s = ready([ReplySuggestion(text="   "), ToolSuggestion(tool=" "), ActionSuggestion("", "x")])

    assert s.status is SuggestionStatus.NONE


def test_the_list_is_cleaned_one_reply_one_escalation_and_a_cap() -> None:
    raw = [
        ReplySuggestion(text="uno"),
        ReplySuggestion(text="dos"),
        EscalationSuggestion(reason_code="rule:a"),
        EscalationSuggestion(reason_code="rule:b"),
        *[ToolSuggestion(tool=f"t{i}@1") for i in range(20)],
    ]

    cleaned = normalize_suggestions(raw)

    assert len(cleaned) == MAX_SUGGESTIONS
    assert [i.kind for i in cleaned].count("reply") == 1
    assert [i.kind for i in cleaned].count("escalate") == 1
    assert cleaned[0].text == "uno"  # type: ignore[union-attr]


def test_long_texts_are_cut() -> None:
    cleaned = normalize_suggestions(
        [
            ReplySuggestion(text="x" * (MAX_REPLY + 50)),
            EscalationSuggestion(reason_code="rule:a", evidence=tuple("e" for _ in range(20))),
        ]
    )

    assert len(cleaned[0].text) == MAX_REPLY  # type: ignore[union-attr]
    assert len(cleaned[1].evidence) == MAX_EVIDENCE  # type: ignore[union-attr]


def test_an_action_is_information_only() -> None:
    action = ActionSuggestion(tool="radicar_pqr@1", summary="Radicar")

    assert not hasattr(action, "executable")


def test_a_failure_can_be_asked_again_with_the_same_key() -> None:
    s = suggestion()
    s.record_failure(code="agent_core_unavailable", at=NOW)
    assert s.status is SuggestionStatus.FAILED
    assert s.failure_code == "agent_core_unavailable"

    s.restart(based_on_sequence=9, at=NOW)

    assert s.status is SuggestionStatus.PREPARING
    assert s.failure_code is None
    assert s.based_on_sequence == 9
    with pytest.raises(InvalidValueError):
        s.restart(based_on_sequence=9, at=NOW)


def test_an_answer_needs_a_suggestion_in_preparation() -> None:
    s = ready()

    with pytest.raises(InvalidValueError):
        s.record_answer(raw=[], run_id=None, trace_id="t", at=NOW)
    with pytest.raises(InvalidValueError):
        s.record_failure(code="x", at=NOW)


def test_sending_the_draft_as_it_is_counts_as_used_and_drops_its_text() -> None:
    s = ready()

    assert s.reply_sent(sent_text=f"  {DRAFT}  ", at=NOW) is True

    assert s.reply_decision is ReplyDecision.USED
    assert s.edit_distance_permille == 0
    assert not any(isinstance(i, ReplySuggestion) for i in s.items)
    assert s.reply_hash == text_hash(DRAFT)  # the hash stays
    assert s.reply_sent(sent_text=DRAFT, at=NOW) is False  # decided once


def test_sending_a_changed_draft_counts_as_edited_with_its_distance() -> None:
    s = ready()

    s.reply_sent(sent_text="Lorena, ya revisé tu cuenta y te confirmo la devolución.", at=NOW)

    assert s.reply_decision is ReplyDecision.EDITED
    assert 0 < (s.edit_distance_permille or 0) <= 1000
    event = s.pull_events()[-1]
    assert event.payload()["decision"] == "edited"
    assert event.payload()["edit_distance_permille"] == s.edit_distance_permille


def test_discarding_and_ignoring_a_draft() -> None:
    discarded, ignored = ready(), ready()

    assert discarded.discard_reply(at=NOW) is True
    assert ignored.ignore_reply(at=NOW) is True

    assert discarded.reply_decision is ReplyDecision.DISCARDED
    assert ignored.reply_decision is ReplyDecision.IGNORED
    assert ignored.pull_events()[-1].actor.role is ActorRole.SYSTEM
    assert discarded.discard_reply(at=NOW) is False
    assert discarded.recommends_escalation  # the rest of the list stays


def test_a_suggestion_without_a_draft_has_nothing_to_decide() -> None:
    s = ready([ToolSuggestion(tool="leer_productos@1")])

    assert s.reply_sent(sent_text="hola", at=NOW) is False
    assert s.discard_reply(at=NOW) is False


def test_taking_the_escalation_recommendation_is_recorded_once() -> None:
    s = ready()

    assert s.escalation_taken(at=NOW) is True
    assert s.escalation_taken(at=NOW) is False

    assert s.escalation_accepted
    event = s.pull_events()[-1]
    assert (event.payload()["subject"], event.payload()["decision"]) == ("escalation", "accepted")


def test_there_is_nothing_to_take_without_a_recommendation() -> None:
    assert ready([ReplySuggestion(text=DRAFT)]).escalation_taken(at=NOW) is False


def test_purge_clears_every_text_and_ignores_an_undecided_draft() -> None:
    s = ready()

    assert s.purge(at=NOW + DRAFT_TTL) is True

    assert s.items == ()
    assert s.purged_at is not None
    assert s.reply_decision is ReplyDecision.IGNORED
    assert s.kinds == ("reply", "tool", "action", "escalate")  # what was proposed stays
    assert s.reply_hash == text_hash(DRAFT)
    assert s.purge(at=NOW + DRAFT_TTL) is False


def test_it_expires_after_twenty_four_hours() -> None:
    s = ready()

    assert not s.is_expired(NOW + DRAFT_TTL - timedelta(seconds=1))
    assert s.is_expired(NOW + DRAFT_TTL)


def test_the_events_carry_ids_and_enums_never_a_text() -> None:
    s = suggestion()
    s.record_answer(raw=everything(), run_id="run-1", trace_id="t-1", at=NOW)
    s.reply_sent(sent_text="Texto secreto del analista", at=NOW)
    s.escalation_taken(at=NOW)
    s.purge(at=NOW)

    dumped = json.dumps([e.payload() for e in s.pull_events()], ensure_ascii=False)

    for secret in (DRAFT, "Texto secreto", "supervisión", "disputa por 120", "Ver los dos cobros"):
        assert secret not in dumped


@pytest.mark.parametrize(
    ("draft", "sent", "low", "high"),
    [
        ("igual", "igual", 0, 0),
        ("Hola Lorena, revisé tu cuenta", "Hola Lorena, revisé tu cuenta.", 1, 100),
        ("aaaa", "zzzz", 900, 1000),
    ],
)
def test_the_edit_distance_runs_from_zero_to_a_thousand(
    draft: str, sent: str, low: int, high: int
) -> None:
    assert low <= edit_distance_permille(draft, sent) <= high
