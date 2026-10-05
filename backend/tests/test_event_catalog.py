"""The event catalog (``docs/platform/api/engine-signals.md``, catalog 1.3.0): every emitted type is
documented with its payload and ``schema_version``, every logged payload carries that version, and
no engine signal carries a free text."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from cc_platform.application.events import EventRecord
from cc_platform.domain.ai.session import HandoffReask
from cc_platform.domain.ai.suggestion import (
    UNRECOGNIZED_CODE,
    EscalationDecision,
    IgnoreCause,
    ReplyDecision,
    event_code,
)
from cc_platform.domain.platform.events import PlatformAiToggled
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.events import EVENT_CATALOG_VERSION, DomainEvent
from cc_platform.scripts import event_catalog
from cc_platform.scripts.event_catalog import DEFAULT_DOC, event_classes, payload_keys, render

T = datetime(2026, 10, 5, 12, tzinfo=UTC)

#: What the engine reads to measure the AI (the brief's P5 list and the 1.3.0 additions): ids,
#: closed values and counters only.
ENGINE_SIGNALS = frozenset(
    {
        "copilot.suggestion_requested",
        "copilot.suggestion_ready",
        "copilot.suggestion_none",
        "copilot.suggestion_failed",
        "copilot.suggestion_shown",
        "copilot.suggestion_decided",
        "copilot.suggestion_ignored",
        "copilot.tool_used",
        "copilot.item_decided",
        "copilot.query_asked",
        "copilot.answered",
        "assistant.session_started",
        "assistant.turn_answered",
        "assistant.ended",
        "case.type_changed",
        "case.handoff_rated",
        "ai.stage_advanced",
        "ai.stage_moved_back",
        "ai.agent_ready",
        "ai.agent_activated",
        "ai.agent_renamed",
        "ai.agent_paused",
        "ai.agent_resumed",
        "platform.ai_toggled",
    }
)

#: Words that make a payload key look like it could carry text (the engine exporter's redaction
#: tokens plus the platform's own text fields).
_TEXT_TOKENS = frozenset(
    {
        "text", "body", "message", "content", "name", "email", "phone", "note", "comment",
        "subject", "summary", "description", "title", "motive", "answer", "reason", "line",
        "evidence", "draft",
    }
)  # fmt: skip
_COUNT_SUFFIXES = frozenset({"id", "ids", "ref", "length", "count", "at", "sequence"})

#: Keys whose words look like text but whose values are closed (an enum or a code).
CLOSED_KEYS = frozenset(
    {
        ("auth.session_ended", "reason"),
        ("case.assigned", "reason"),
        ("case.assistant_released", "reason"),
        ("case.closed", "reason"),
        ("case.queued", "reason_code"),
        ("case.status_changed", "reason"),
        ("call.ended", "end_reason"),
        ("copilot.suggestion_decided", "reason_code"),
        ("copilot.suggestion_decided", "subject"),
        ("staff.availability_changed", "reason"),
    }
)


def _looks_like_text(key: str) -> bool:
    tokens = key.lower().split("_")
    return tokens[-1] not in _COUNT_SUFFIXES and any(t in _TEXT_TOKENS for t in tokens)


def test_the_document_lists_every_emitted_event_type() -> None:
    doc = DEFAULT_DOC.read_text(encoding="utf-8")
    missing = [e.event_type for e in event_classes() if f"`{e.event_type}`" not in doc]
    assert missing == [], f"not in engine-signals.md: {missing}"
    assert event_catalog.main(["--check"]) == 0, "run: python -m cc_platform.scripts.event_catalog"


def test_the_document_carries_the_catalog_version_and_the_closed_values() -> None:
    doc = DEFAULT_DOC.read_text(encoding="utf-8")
    assert f"**Catalog version: {EVENT_CATALOG_VERSION}**" in doc
    assert f"### {EVENT_CATALOG_VERSION}" in doc  # its changelog entry
    for enum in (IgnoreCause, HandoffReask, EscalationDecision, ReplyDecision):
        for member in enum:
            assert f"`{member.value}`" in doc, f"{enum.__name__}.{member.name}"


def test_a_stale_document_fails_the_check(tmp_path: Path) -> None:
    stale = tmp_path / "engine-signals.md"
    stale.write_text(
        "x\n" + event_catalog.BEGIN + "\n| `case.opened` |\n" + event_catalog.END + "\n",
        encoding="utf-8",
    )
    assert event_catalog.main(["--check", "--doc", str(stale)]) == 1


def test_every_engine_signal_is_emitted() -> None:
    emitted = {e.event_type for e in event_classes()}
    assert emitted >= ENGINE_SIGNALS


def test_no_engine_signal_carries_a_free_text() -> None:
    for event in event_classes():
        if event.event_type not in ENGINE_SIGNALS:
            continue
        assert event.free_text_keys == frozenset(), event.event_type
        for key in payload_keys(event):
            assert key.type in {"string", "integer", "boolean", "date-time", "string[]"}, (
                event.event_type,
                key.key,
            )
            if _looks_like_text(key.key):
                assert (event.event_type, key.key) in CLOSED_KEYS, (event.event_type, key.key)


def test_every_key_that_may_carry_text_is_declared() -> None:
    """A new key named like text must be declared free text (and the engine told) or listed as
    closed here on purpose."""
    for event in event_classes():
        assert event.free_text_keys <= {k.key for k in payload_keys(event)}, event.event_type
        for key in payload_keys(event):
            if _looks_like_text(key.key) and not key.free_text:
                assert (event.event_type, key.key) in CLOSED_KEYS, (event.event_type, key.key)


def test_every_logged_payload_carries_its_schema_version() -> None:
    event = PlatformAiToggled(
        occurred_at=T, actor=ActorRef.system(), entity_id="platform", enabled=True
    )
    record = EventRecord(event_id="EVT-1", event=event, ingested_at=T)

    assert record.payload() == {"enabled": True, "schema_version": 1}
    assert event.payload() == {"enabled": True}  # the domain fact itself is unchanged


def test_every_type_has_a_positive_schema_version_and_unique_name() -> None:
    classes = event_classes()
    assert len({e.event_type for e in classes}) == len(classes)
    for event in classes:
        assert isinstance(event.schema_version, int)
        assert event.schema_version >= 1
        assert re.fullmatch(r"[a-z]+\.[a-z_]+", event.event_type), event.event_type
        assert event.event_type != DomainEvent.event_type


def test_the_rendered_catalog_names_free_text_and_omitted_keys() -> None:
    rendered = render()
    assert "`text`: string **free text**" in rendered
    assert "`subject`: string (omitted when null) **free text**" in rendered
    assert "`from`: string<br>`to`: string" in rendered  # renamed keys (case.type_changed)


@pytest.mark.parametrize(
    ("code", "kept"),
    [
        ("policy:fraude", "policy:fraude"),
        ("regla_monto@2", "regla_monto@2"),
        ("El cliente dice que le robaron", UNRECOGNIZED_CODE),
        ("", UNRECOGNIZED_CODE),
        ("x" * 121, UNRECOGNIZED_CODE),
    ],
)
def test_an_event_code_is_a_code_or_unrecognized(code: str, kept: str) -> None:
    assert event_code(code) == kept
