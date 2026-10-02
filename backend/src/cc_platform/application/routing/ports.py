"""Routing tiers: the ``Responder`` port (Chain of Responsibility) — AI extension point.

A case is offered to the tiers in order judge → tree → ai_agent → human. Each tier is a
``Responder`` that returns a ``RoutingDecision``; the routing use case (``routing`` slice)
records every decision as a ``routing_step`` (contracts/platform_history.json) and stops at
the first tier that resolves, mitigates and hands off, or hands off. ``abstained`` passes
the case to the next tier.

Today only the human tier exists; judge/tree/ai_agent are registered as null responders that
abstain. The AI team plugs real implementations in by registering them in the
``ResponderRegistry`` (in-process, or a ``RemoteResponder`` that calls an HTTP endpoint) from
the composition root, without touching the core. Automated tiers act only through the tools
use case (same RBAC, policies and approvals as people) and never decide an abono (rule 6)
nor resolve charges over 1.000.000 COP or when the customer asks for a person (rule 10).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from cc_platform.domain.shared.json import JsonValue


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


@dataclass(frozen=True, slots=True)
class ComponentRef:
    """An automated component version; serialised as ``component_id@component_version``."""

    component_id: str
    component_version: str

    def __str__(self) -> str:
        return f"{self.component_id}@{self.component_version}"


@dataclass(frozen=True, slots=True)
class Handoff:
    """What the next tier needs to continue without asking the customer again (rule 10)."""

    verified_facts: tuple[str, ...] = ()
    actions_taken: tuple[str, ...] = ()
    """Ids of verified tool calls (``CALL-…``): actions are claimed only with evidence (rule 9)."""
    open_questions: tuple[str, ...] = ()
    summary: str | None = None


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
        """Responders in routing order (judge, tree, ai_agent, human)."""
        ...
