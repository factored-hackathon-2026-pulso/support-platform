"""``SqlCaseTypeMaturityRepository``: the AI maturity per case type (slice 21)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Column, select

from cc_platform.domain.ai.maturity import (
    AgentStatus,
    CaseTypeMaturity,
    MaturityStage,
    StageChange,
    StageSignals,
)
from cc_platform.domain.cases.values import CaseType
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def signals_to_json(signals: StageSignals) -> dict[str, Any]:
    return {
        "closed_cases": signals.closed_cases,
        "resolved_cases": signals.resolved_cases,
        "asked_cases": signals.asked_cases,
        "tool_cases": signals.tool_cases,
        "tool_used_cases": signals.tool_used_cases,
        "recent_drafts": signals.recent_drafts,
    }


def signals_from_json(raw: dict[str, Any]) -> StageSignals:
    return StageSignals(
        closed_cases=int(raw.get("closed_cases", 0)),
        resolved_cases=int(raw.get("resolved_cases", 0)),
        asked_cases=int(raw.get("asked_cases", 0)),
        tool_cases=int(raw.get("tool_cases", 0)),
        tool_used_cases=int(raw.get("tool_used_cases", 0)),
        recent_drafts=str(raw.get("recent_drafts", "")),
    )


class SqlCaseTypeMaturityRepository(VersionedRepository[CaseTypeMaturity]):
    """One row per case type, created the first time something happens to it."""

    table = tables.case_type_maturity
    insert_race_is_retryable = True

    @property
    def _key_column(self) -> Column[Any]:
        return self.table.c.case_type

    def _key(self, aggregate: CaseTypeMaturity) -> str:
        return aggregate.case_type.value

    def _to_row(self, aggregate: CaseTypeMaturity) -> dict[str, Any]:
        return {
            "case_type": aggregate.case_type.value,
            "stage": int(aggregate.stage),
            "agent": aggregate.agent.value,
            "signals": signals_to_json(aggregate.signals),
            "stage_since": {str(k): v.isoformat() for k, v in aggregate.stage_since.items()},
            "agent_since": aggregate.agent_since,
            "agent_id": aggregate.agent_id,
            "agent_name": aggregate.agent_name,
            "agent_paused": aggregate.agent_paused,
            "changed_at": aggregate.changed_at,
            "changed_by_id": aggregate.changed_by_id,
            "last_change": aggregate.last_change.value if aggregate.last_change else None,
        }

    def _from_row(self, row: Row) -> CaseTypeMaturity:
        return CaseTypeMaturity(
            case_type=CaseType(row["case_type"]),
            stage=MaturityStage(row["stage"]),
            agent=AgentStatus(row["agent"]),
            signals=signals_from_json(row["signals"]),
            stage_since={
                int(k): datetime.fromisoformat(v) for k, v in dict(row["stage_since"]).items()
            },
            agent_since=row["agent_since"],
            agent_id=row["agent_id"],
            agent_name=row["agent_name"],
            agent_paused=bool(row["agent_paused"]),
            changed_at=row["changed_at"],
            changed_by_id=row["changed_by_id"],
            last_change=StageChange(row["last_change"]) if row["last_change"] else None,
        )

    async def get(self, key: str) -> CaseTypeMaturity | None:
        return await super().get(str(key))  # a ``CaseType`` is its value

    async def list(self) -> list[CaseTypeMaturity]:
        result = await self._session.execute(select(self.table).order_by(self.table.c.case_type))
        found: list[CaseTypeMaturity] = []
        for row in result.mappings():
            maturity = self._load(row)
            if maturity is not None:
                found.append(maturity)
        return found
