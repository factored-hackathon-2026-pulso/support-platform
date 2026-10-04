"""Persistence ports of the ``ai`` context (ADR 0003)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from cc_platform.domain.ai.builder import BuilderProposal, BuilderThread
from cc_platform.domain.ai.copilot import CopilotThread
from cc_platform.domain.ai.session import AssistantSession


class AssistantSessionRepository(Protocol):
    """One session per case that opened in the agent's hands (optimistic concurrency)."""

    async def get(self, session_id: str) -> AssistantSession | None: ...

    async def get_by_case(self, case_id: str) -> AssistantSession | None: ...

    async def add(self, session: AssistantSession) -> None: ...

    async def save(self, session: AssistantSession) -> None: ...


class CopilotThreadRepository(Protocol):
    """One thread per (case, analyst) (optimistic concurrency)."""

    async def get_for(self, case_id: str, analyst_id: str) -> CopilotThread | None: ...

    async def add(self, thread: CopilotThread) -> None: ...

    async def save(self, thread: CopilotThread) -> None: ...


class BuilderThreadRepository(Protocol):
    """One thread per person (optimistic concurrency)."""

    async def get_for(self, staff_id: str) -> BuilderThread | None: ...

    async def add(self, thread: BuilderThread) -> None: ...

    async def save(self, thread: BuilderThread) -> None: ...


class BuilderProposalRepository(Protocol):
    """The platform's index of agent-core's proposals (optimistic concurrency)."""

    async def get(self, proposal_id: str) -> BuilderProposal | None: ...

    async def search(
        self, *, agent_id: str | None = None, state: str | None = None, limit: int = 50
    ) -> list[BuilderProposal]:
        """Newest first (by the registry's ``updated_at``)."""
        ...

    async def add(self, proposal: BuilderProposal) -> None: ...

    async def save(self, proposal: BuilderProposal) -> None: ...


class BankCustomerLinks(Protocol):
    """Which dataset customer each platform customer is (agent-core's customer principal)."""

    async def get(self, customer_id: str) -> str | None: ...

    async def set_many(self, links: Mapping[str, str]) -> int:
        """Upsert ``{platform customer id: dataset customer id}``; returns how many changed."""
        ...
