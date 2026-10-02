"""Null responders: the judge, decision tree and AI agent tiers before any AI is connected.

Each one abstains with ``component_not_connected`` and touches no customer data
(``inputs_used = ()``), so every case reaches a person while the full chain is still
recorded as ``routing_step`` rows for the AI team. Replace one by registering a real
``Responder`` for the same tier in ``bootstrap/container.py``.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.routing.ports import (
    ComponentRef,
    RoutingContext,
    RoutingDecision,
    RoutingOutcome,
    Tier,
)

NOT_CONNECTED = "component_not_connected"
NULL_VERSION = "0.1.0"


@dataclass(frozen=True, slots=True)
class NullResponder:
    tier: Tier
    component: ComponentRef

    async def respond(self, context: RoutingContext) -> RoutingDecision:
        return RoutingDecision(
            outcome=RoutingOutcome.ABSTAINED,
            tier=self.tier,
            component=self.component,
            reason_code=NOT_CONNECTED,
            inputs_used=(),
            handoff=None,
        )


def null_judge() -> NullResponder:
    return NullResponder(Tier.JUDGE, ComponentRef("null_judge", NULL_VERSION))


def null_tree() -> NullResponder:
    return NullResponder(Tier.TREE, ComponentRef("null_tree", NULL_VERSION))


def null_ai_agent() -> NullResponder:
    return NullResponder(Tier.AI_AGENT, ComponentRef("null_ai_agent", NULL_VERSION))
