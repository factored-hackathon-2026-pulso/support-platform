"""``SqlCopilotSuggestionRepository``: the copilot's suggestions (ADR 0005).

``items`` is a JSON list of typed suggestions (``{"type": "reply" | "tool" | "action" |
"escalate", …}``); the purge empties it and the aggregate keeps ``kinds``, ``tool_ids`` and the
draft's hash.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select

from cc_platform.domain.ai.suggestion import (
    ActionSuggestion,
    CopilotSuggestion,
    EscalationSuggestion,
    ReplyDecision,
    ReplySuggestion,
    Suggestion,
    SuggestionStatus,
    SuggestionTrigger,
    ToolSuggestion,
)
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def suggestion_to_json(item: Suggestion) -> dict[str, Any]:
    if isinstance(item, ReplySuggestion):
        return {
            "type": "reply",
            "text": item.text,
            "citations": list(item.citations),
            "language": item.language,
        }
    if isinstance(item, ToolSuggestion):
        return {"type": "tool", "tool": item.tool, "label": item.label, "why": item.why}
    if isinstance(item, ActionSuggestion):
        return {"type": "action", "tool": item.tool, "summary": item.summary}
    return {
        "type": "escalate",
        "reason_code": item.reason_code,
        "evidence": list(item.evidence),
        "motive_draft": item.motive_draft,
    }


def suggestion_from_json(raw: dict[str, Any]) -> Suggestion:
    kind = raw["type"]
    if kind == "reply":
        return ReplySuggestion(
            text=raw["text"],
            citations=tuple(raw.get("citations", ())),
            language=raw.get("language", "es"),
        )
    if kind == "tool":
        return ToolSuggestion(tool=raw["tool"], label=raw.get("label", ""), why=raw.get("why", ""))
    if kind == "action":
        return ActionSuggestion(tool=raw["tool"], summary=raw["summary"])
    return EscalationSuggestion(
        reason_code=raw["reason_code"],
        evidence=tuple(raw.get("evidence", ())),
        motive_draft=raw.get("motive_draft", ""),
    )


class SqlCopilotSuggestionRepository(VersionedRepository[CopilotSuggestion]):
    table = tables.copilot_suggestions
    #: ``(case_id, analyst_id, request_key)`` is unique: two identical manual requests racing means
    #: the second must retry and find the first.
    insert_race_is_retryable = True

    def _key(self, aggregate: CopilotSuggestion) -> str:
        return aggregate.id

    def _to_row(self, aggregate: CopilotSuggestion) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "case_id": aggregate.case_id,
            "analyst_id": aggregate.analyst_id,
            "agent": aggregate.agent,
            "trigger": aggregate.trigger.value,
            "status": aggregate.status.value,
            "based_on_sequence": aggregate.based_on_sequence,
            "request_key": aggregate.request_key,
            "items": [suggestion_to_json(i) for i in aggregate.items],
            "kinds": list(aggregate.kinds),
            "tool_ids": list(aggregate.tool_ids),
            "reply_hash": aggregate.reply_hash,
            "reply_decision": (
                aggregate.reply_decision.value if aggregate.reply_decision is not None else None
            ),
            "edit_distance_permille": aggregate.edit_distance_permille,
            "escalation_accepted": aggregate.escalation_accepted,
            "truncated": aggregate.truncated,
            "run_id": aggregate.run_id,
            "trace_id": aggregate.trace_id,
            "failure_code": aggregate.failure_code,
            "purged_at": aggregate.purged_at,
            "created_at": aggregate.created_at,
            "updated_at": aggregate.updated_at,
        }

    def _from_row(self, row: Row) -> CopilotSuggestion:
        decision = row["reply_decision"]
        return CopilotSuggestion(
            id=row["id"],
            case_id=row["case_id"],
            analyst_id=row["analyst_id"],
            agent=row["agent"],
            trigger=SuggestionTrigger(row["trigger"]),
            based_on_sequence=row["based_on_sequence"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            status=SuggestionStatus(row["status"]),
            request_key=row["request_key"],
            items=tuple(suggestion_from_json(i) for i in row["items"]),
            kinds=tuple(row["kinds"]),
            tool_ids=tuple(row["tool_ids"]),
            reply_hash=row["reply_hash"],
            reply_decision=ReplyDecision(decision) if decision is not None else None,
            edit_distance_permille=row["edit_distance_permille"],
            escalation_accepted=bool(row["escalation_accepted"]),
            truncated=bool(row["truncated"]),
            run_id=row["run_id"],
            trace_id=row["trace_id"],
            failure_code=row["failure_code"],
            purged_at=row["purged_at"],
        )

    async def get_by_request_key(
        self, case_id: str, analyst_id: str, request_key: str
    ) -> CopilotSuggestion | None:
        c = self.table.c
        return await self._get_where(
            c.case_id == case_id, c.analyst_id == analyst_id, c.request_key == request_key
        )

    async def latest_for(self, case_id: str, analyst_id: str) -> CopilotSuggestion | None:
        c = self.table.c
        result = await self._session.execute(
            select(self.table)
            .where(c.case_id == case_id, c.analyst_id == analyst_id)
            .order_by(c.created_at.desc(), c.id.desc())
            .limit(1)
        )
        return self._load(result.mappings().first())

    async def list_expired(
        self, *, created_before: datetime, limit: int
    ) -> list[CopilotSuggestion]:
        c = self.table.c
        result = await self._session.execute(
            select(self.table)
            .where(
                c.status == SuggestionStatus.READY.value,
                c.purged_at.is_(None),
                c.created_at <= created_before,
            )
            .order_by(c.created_at, c.id)
            .limit(limit)
        )
        found: list[CopilotSuggestion] = []
        for row in result.mappings():
            suggestion = self._load(row)
            if suggestion is not None:
                found.append(suggestion)
        return found
