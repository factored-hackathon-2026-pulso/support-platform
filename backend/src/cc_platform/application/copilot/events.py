"""Copilot stream events (ADR 0002): an application-level union whose ``type`` strings equal
the AG-UI 1.0 event names. The API adapter maps them to ``ag_ui.core`` models and encodes
them as SSE; domain and application never import the AG-UI SDK.

Only the subset the platform emits is declared. Field names are snake_case here and become
camelCase on the wire.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import ClassVar

from cc_platform.domain.shared.json import JsonObject, JsonValue


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotEvent:
    type: ClassVar[str] = "CUSTOM"


@dataclass(frozen=True, kw_only=True, slots=True)
class RunStarted(CopilotEvent):
    type = "RUN_STARTED"
    thread_id: str
    run_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class RunFinished(CopilotEvent):
    type = "RUN_FINISHED"
    thread_id: str
    run_id: str
    outcome: JsonObject = field(default_factory=lambda: {"type": "success"})


@dataclass(frozen=True, kw_only=True, slots=True)
class RunError(CopilotEvent):
    type = "RUN_ERROR"
    message: str
    code: str | None = None


@dataclass(frozen=True, kw_only=True, slots=True)
class StepStarted(CopilotEvent):
    type = "STEP_STARTED"
    step_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class StepFinished(CopilotEvent):
    type = "STEP_FINISHED"
    step_name: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TextMessageStart(CopilotEvent):
    type = "TEXT_MESSAGE_START"
    message_id: str
    role: str = "assistant"


@dataclass(frozen=True, kw_only=True, slots=True)
class TextMessageContent(CopilotEvent):
    type = "TEXT_MESSAGE_CONTENT"
    message_id: str
    delta: str


@dataclass(frozen=True, kw_only=True, slots=True)
class TextMessageEnd(CopilotEvent):
    type = "TEXT_MESSAGE_END"
    message_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class ActivitySnapshot(CopilotEvent):
    """Typed answer table: ``content = {title, columns, rows, source}``."""

    type = "ACTIVITY_SNAPSHOT"
    message_id: str
    activity_type: str
    content: JsonObject
    replace: bool = True


@dataclass(frozen=True, kw_only=True, slots=True)
class ToolCallStart(CopilotEvent):
    type = "TOOL_CALL_START"
    tool_call_id: str
    tool_call_name: str
    parent_message_id: str | None = None


@dataclass(frozen=True, kw_only=True, slots=True)
class ToolCallArgs(CopilotEvent):
    type = "TOOL_CALL_ARGS"
    tool_call_id: str
    delta: str


@dataclass(frozen=True, kw_only=True, slots=True)
class ToolCallEnd(CopilotEvent):
    type = "TOOL_CALL_END"
    tool_call_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class ToolCallResult(CopilotEvent):
    type = "TOOL_CALL_RESULT"
    message_id: str
    tool_call_id: str
    content: str
    role: str = "tool"


@dataclass(frozen=True, kw_only=True, slots=True)
class StateSnapshot(CopilotEvent):
    type = "STATE_SNAPSHOT"
    snapshot: JsonObject


@dataclass(frozen=True, kw_only=True, slots=True)
class StateDelta(CopilotEvent):
    """RFC 6902 JSON Patch operations."""

    type = "STATE_DELTA"
    delta: Sequence[JsonValue]


@dataclass(frozen=True, kw_only=True, slots=True)
class MessagesSnapshot(CopilotEvent):
    type = "MESSAGES_SNAPSHOT"
    messages: Sequence[JsonObject]
