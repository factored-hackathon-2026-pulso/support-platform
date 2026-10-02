"""Repository port of the routing context."""

from __future__ import annotations

from typing import Protocol

from cc_platform.domain.routing.routing_step import RoutingStep


class RoutingStepRepository(Protocol):
    async def add(self, step: RoutingStep) -> None: ...

    async def list_for_case(self, case_id: str) -> list[RoutingStep]:
        """Steps of a case in the order they happened."""
        ...
