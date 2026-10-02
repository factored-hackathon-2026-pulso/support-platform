"""Routing vocabulary shared by the domain and the ``Responder`` port (AI extension point).

Names and values follow ``routing_step`` in ``contracts/platform_history.json``.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.json import JsonObject


class Tier(StrEnum):
    JUDGE = "judge"
    TREE = "tree"
    AI_AGENT = "ai_agent"
    HUMAN = "human"
    SUPERVISOR = "supervisor"


class RoutingOutcome(StrEnum):
    RESOLVED = "resolved"
    MITIGATED = "mitigated"
    HANDED_OFF = "handed_off"
    ABSTAINED = "abstained"

    @property
    def passes_case_on(self) -> bool:
        """``abstained`` hands the case to the next tier without having acted on it."""
        return self is RoutingOutcome.ABSTAINED


class RouteStopKind(StrEnum):
    """Stops of "Cómo llegó a ti" (read model): entry point, tiers, queue, the analyst."""

    ENTRY = "entry"
    TIER = "tier"
    QUEUE = "queue"
    ASSIGNEE = "assignee"


@dataclass(frozen=True, slots=True)
class ComponentRef:
    """An automated component version; serialised as ``component_id@component_version``."""

    component_id: str
    component_version: str

    def __post_init__(self) -> None:
        if not self.component_id.strip() or not self.component_version.strip():
            raise InvalidValueError("component id and version are required", field="component")

    def __str__(self) -> str:
        return f"{self.component_id}@{self.component_version}"


@dataclass(frozen=True, slots=True)
class Handoff:
    """What a tier hands to the next one so the customer is not asked again (rule 10).

    Contract ``routing_step.handoff``: ``request`` (what the customer asked), ``verified_facts``
    (facts checked with their source), ``actions_taken`` (ids of verified tool calls: actions
    are claimed only with evidence, rule 9), ``evidence`` (tool_call / turn ids backing them),
    ``open_questions`` and a short Spanish ``summary`` shown in "Cómo llegó a ti".
    """

    verified_facts: tuple[str, ...] = ()
    actions_taken: tuple[str, ...] = ()
    open_questions: tuple[str, ...] = ()
    summary: str | None = None
    request: str | None = None
    evidence: tuple[str, ...] = ()

    def to_json(self) -> JsonObject:
        return {
            "request": self.request,
            "verified_facts": list(self.verified_facts),
            "actions_taken": list(self.actions_taken),
            "evidence": list(self.evidence),
            "open_questions": list(self.open_questions),
            "summary": self.summary,
        }

    @classmethod
    def from_json(cls, data: JsonObject) -> Handoff:
        def strings(key: str) -> tuple[str, ...]:
            value = data.get(key)
            return tuple(str(item) for item in value) if isinstance(value, list) else ()

        def text(key: str) -> str | None:
            value = data.get(key)
            return value if isinstance(value, str) else None

        return cls(
            verified_facts=strings("verified_facts"),
            actions_taken=strings("actions_taken"),
            open_questions=strings("open_questions"),
            summary=text("summary"),
            request=text("request"),
            evidence=strings("evidence"),
        )
