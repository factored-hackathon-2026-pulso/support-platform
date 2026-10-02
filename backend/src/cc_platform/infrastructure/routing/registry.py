"""In-memory ``ResponderRegistry``: one responder per automated tier, in routing order."""

from __future__ import annotations

from collections.abc import Sequence

from cc_platform.application.routing.ports import Responder, Tier

ROUTING_ORDER: tuple[Tier, ...] = (Tier.JUDGE, Tier.TREE, Tier.AI_AGENT)


class InMemoryResponderRegistry:
    def __init__(self) -> None:
        self._by_tier: dict[Tier, Responder] = {}

    def register(self, responder: Responder) -> None:
        if responder.tier not in ROUTING_ORDER:
            raise ValueError(f"{responder.tier} is not an automated routing tier")
        self._by_tier[responder.tier] = responder

    def chain(self) -> Sequence[Responder]:
        return tuple(self._by_tier[tier] for tier in ROUTING_ORDER if tier in self._by_tier)
