"""Domain events of the routing context."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.shared.events import DomainEvent
from cc_platform.domain.shared.json import JsonObject


@dataclass(frozen=True, kw_only=True, slots=True)
class RoutingStepRecorded(DomainEvent):
    """Contract ``routing_step``: one tier decided on the case (actor = the component)."""

    event_type = "routing_step.recorded"
    entity = "routing_step"

    tier: str
    component_id: str | None
    component_version: str | None
    outcome: str
    reason_code: str | None
    policy_rule_id: str | None
    confidence: float | None
    inputs_used: tuple[str, ...]
    handoff: JsonObject | None
