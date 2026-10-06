"""``SqlAgentProfileRepository``: what Supervisión sets for an agent by its id (its photo)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Column, select

from cc_platform.domain.ai.profile import AgentProfile
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


class SqlAgentProfileRepository(VersionedRepository[AgentProfile]):
    """One row per agent id, created the first time a photo is picked."""

    table = tables.agent_profiles
    insert_race_is_retryable = True

    @property
    def _key_column(self) -> Column[Any]:
        return self.table.c.agent_id

    def _key(self, aggregate: AgentProfile) -> str:
        return aggregate.agent_id

    def _to_row(self, aggregate: AgentProfile) -> dict[str, Any]:
        return {"agent_id": aggregate.agent_id, "avatar": aggregate.avatar}

    def _from_row(self, row: Row) -> AgentProfile:
        return AgentProfile(agent_id=row["agent_id"], avatar=row["avatar"])

    async def list(self) -> list[AgentProfile]:
        result = await self._session.execute(select(self.table).order_by(self.table.c.agent_id))
        return [p for row in result.mappings().all() if (p := self._load(row)) is not None]
