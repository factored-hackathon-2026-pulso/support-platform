"""``RoutingStep``: one tier's decision on a case (append-only, contract ``routing_step``)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.routing.events import RoutingStepRecorded
from cc_platform.domain.routing.values import ComponentRef, Handoff, RoutingOutcome, Tier
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id

_TIER_ACTOR: dict[Tier, ActorRole] = {
    Tier.JUDGE: ActorRole.JUDGE,
    Tier.TREE: ActorRole.TREE,
    Tier.AI_AGENT: ActorRole.AI_AGENT,
}


@dataclass(frozen=True, slots=True)
class RoutingStep:
    id: str
    case_id: str
    tier: Tier
    component: ComponentRef | None
    outcome: RoutingOutcome
    occurred_at: datetime
    component_name: str | None = None
    reason_code: str | None = None
    policy_rule_id: str | None = None
    confidence: float | None = None
    inputs_used: tuple[str, ...] = ()
    handoff: Handoff | None = None

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.ROUTING_STEP)
        require_id(self.case_id, IdPrefix.CASE)
        if self.confidence is not None and not 0.0 <= self.confidence <= 1.0:
            raise InvalidValueError("confidence must be between 0 and 1", field="confidence")

    @property
    def actor(self) -> ActorRef:
        role = _TIER_ACTOR.get(self.tier)
        if role is None or self.component is None:
            return ActorRef.system()
        return ActorRef(role, str(self.component))

    def recorded_event(self) -> RoutingStepRecorded:
        return RoutingStepRecorded(
            occurred_at=self.occurred_at,
            actor=self.actor,
            entity_id=self.id,
            case_id=self.case_id,
            tier=self.tier.value,
            component_id=self.component.component_id if self.component else None,
            component_version=self.component.component_version if self.component else None,
            outcome=self.outcome.value,
            reason_code=self.reason_code,
            policy_rule_id=self.policy_rule_id,
            confidence=self.confidence,
            inputs_used=self.inputs_used,
            handoff=self.handoff.to_json() if self.handoff else None,
        )
