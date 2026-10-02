"""Components registry — AI extension point for self-improvement.

Every automated piece (tree branch, judge, AI agent, tool, suggestion rule) is a versioned
``component`` (contracts/platform_history.json). The automation context registers versions,
runs sandbox evaluations against the event log, activates a version with a rollout
percentage and stops it automatically when a stop condition trips. Signals detected from the
event log (repeated copilot queries, consistent tool sequences) feed proposals that become
new component versions.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from cc_platform.domain.shared.json import JsonObject


class ComponentKind(StrEnum):
    TOOL = "tool"
    SUGGESTION_RULE = "suggestion_rule"
    TREE_BRANCH = "tree_branch"
    JUDGE = "judge"
    AI_AGENT = "ai_agent"


class ComponentStatus(StrEnum):
    TESTING = "testing"
    ACTIVE = "active"
    RETIRED = "retired"


@dataclass(frozen=True, slots=True)
class StopCondition:
    """E.g. ``metric="handoff_rate", threshold=0.4, comparison="gt"`` over a window."""

    metric: str
    threshold: float
    comparison: str = "gt"
    window_minutes: int = 60


@dataclass(frozen=True, slots=True)
class ComponentVersion:
    component_id: str
    component_version: str
    kind: ComponentKind
    owner_team: str
    status: ComponentStatus = ComponentStatus.TESTING
    scope: JsonObject = field(default_factory=dict)
    tools_allowed: tuple[str, ...] = ()
    from_signal_id: str | None = None
    rollout_percent: int = 0
    stop_conditions: tuple[StopCondition, ...] = ()
    eval_summary: JsonObject | None = None
    approved_by: str | None = None


class ComponentRegistry(Protocol):
    async def register(self, version: ComponentVersion) -> None:
        """Add a new version in ``testing``. Versions are immutable once registered."""
        ...

    async def get(self, component_id: str, component_version: str) -> ComponentVersion | None: ...

    async def active_versions(
        self, kind: ComponentKind | None = None
    ) -> Sequence[ComponentVersion]: ...

    async def activate(
        self, component_id: str, component_version: str, *, rollout_percent: int, approved_by: str
    ) -> None:
        """Activate after a passing sandbox evaluation (four-eyes approval applies)."""
        ...

    async def retire(self, component_id: str, component_version: str, *, reason: str) -> None: ...
