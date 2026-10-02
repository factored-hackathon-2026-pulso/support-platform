"""Routing tiers: the ``Responder`` port (Chain of Responsibility) — AI extension point.

A case is offered to the tiers in order judge → tree → ai_agent → human. Each automated
tier is a ``Responder`` that returns a ``RoutingDecision``; ``RouteCase``
(``application/routing/route_case.py``) records every decision as a ``routing_step``
(contracts/platform_history.json) and stops at the first tier that resolves, mitigates or
hands off. ``abstained`` passes the case to the next tier. The human tier is the terminal
handler of the chain (an ``AssignmentPolicy`` strategy picks the analyst), not a
``Responder``: it records an ``Assignment``, not a routing step.

Today judge/tree/ai_agent are null responders that abstain with ``component_not_connected``
(``infrastructure/routing/null_responders.py``), so every case reaches a person. The AI
team plugs real implementations in by registering them in the ``ResponderRegistry``
(in-process, or a ``RemoteResponder`` that calls an HTTP endpoint) from the composition
root, without touching the core. Automated tiers act only through the tools use case (same
RBAC, policies and approvals as people) and never decide an abono (rule 6) nor resolve
charges over 1.000.000 COP or when the customer asks for a person (rule 10).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol

# The vocabulary lives in the domain (``RoutingStep`` needs it); re-exported here so the
# AI team finds everything about the port in one module.
from cc_platform.domain.routing.values import ComponentRef, Handoff, RoutingOutcome, Tier
from cc_platform.domain.shared.json import JsonValue

__all__ = [
    "ComponentRef",
    "Handoff",
    "Responder",
    "ResponderRegistry",
    "RoutingContext",
    "RoutingDecision",
    "RoutingOutcome",
    "Tier",
]


@dataclass(frozen=True, slots=True)
class RoutingContext:
    """Read-only view of the case a responder decides on (masked customer data only)."""

    case_id: str
    customer_ref: str
    channel: str
    language: str
    origin: str
    transcript: Sequence[Mapping[str, JsonValue]] = ()
    facts: Mapping[str, JsonValue] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    outcome: RoutingOutcome
    tier: Tier
    component: ComponentRef
    reason_code: str
    policy_rule_id: str | None = None
    confidence: float | None = None
    inputs_used: tuple[str, ...] = ()
    handoff: Handoff | None = None
    topic: str | None = None
    """Judge only: intent from the contract taxonomy (``disputar_cargo``…)."""
    component_name: str | None = None
    """Display name for "Cómo llegó a ti" (e.g. "Agente de disputas"); ``None`` = default."""


class Responder(Protocol):
    """One routing tier implementation (Strategy inside a Chain of Responsibility)."""

    @property
    def tier(self) -> Tier: ...

    @property
    def component(self) -> ComponentRef: ...

    async def respond(self, context: RoutingContext) -> RoutingDecision:
        """Decide on the case. Must not raise for business outcomes: abstain instead."""
        ...


class ResponderRegistry(Protocol):
    def register(self, responder: Responder) -> None:
        """Add or replace (by tier) the responder of a tier."""
        ...

    def chain(self) -> Sequence[Responder]:
        """Automated responders in routing order (judge, tree, ai_agent)."""
        ...
