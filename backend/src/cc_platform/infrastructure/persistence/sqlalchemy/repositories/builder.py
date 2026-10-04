"""SQLAlchemy repositories of the agent builder (ADR 0003, slice 16)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, cast

from sqlalchemy import select

from cc_platform.domain.ai.builder import (
    BuilderMessage,
    BuilderProposal,
    BuilderThread,
    ProposalSource,
)
from cc_platform.domain.shared.json import iso_utc
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def _message_to_json(m: BuilderMessage) -> dict[str, Any]:
    return {
        "id": m.id,
        "role": m.role,
        "text": m.text,
        "created_at": iso_utc(m.created_at),
        "client_message_id": m.client_message_id,
        "answers": m.answers,
    }


def _message_from_json(raw: dict[str, Any]) -> BuilderMessage:
    return BuilderMessage(
        id=raw["id"],
        role=cast("Literal['person', 'agent']", raw["role"]),
        text=raw["text"],
        created_at=datetime.fromisoformat(raw["created_at"]),
        client_message_id=raw.get("client_message_id"),
        answers=raw.get("answers"),
    )


class SqlBuilderThreadRepository(VersionedRepository[BuilderThread]):
    table = tables.builder_threads
    #: ``staff_id`` is unique: two first messages racing means retry.
    insert_race_is_retryable = True

    def _key(self, aggregate: BuilderThread) -> str:
        return aggregate.id

    def _to_row(self, aggregate: BuilderThread) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "staff_id": aggregate.staff_id,
            "agent": aggregate.agent,
            "agent_session_id": aggregate.agent_session_id,
            "run_id": aggregate.run_id,
            "runs": aggregate.runs,
            "messages": [_message_to_json(m) for m in aggregate.messages],
            "last_trace_id": aggregate.last_trace_id,
            "created_at": aggregate.created_at,
            "updated_at": aggregate.updated_at,
        }

    def _from_row(self, row: Row) -> BuilderThread:
        return BuilderThread(
            id=row["id"],
            staff_id=row["staff_id"],
            agent=row["agent"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            agent_session_id=row["agent_session_id"],
            run_id=row["run_id"],
            runs=row["runs"],
            messages=tuple(_message_from_json(m) for m in row["messages"]),
            last_trace_id=row["last_trace_id"],
        )

    async def get_for(self, staff_id: str) -> BuilderThread | None:
        return await self._get_where(self.table.c.staff_id == staff_id)


class SqlBuilderProposalRepository(VersionedRepository[BuilderProposal]):
    table = tables.builder_proposals
    #: Two people bringing the same proposal in at once: the second one retries and finds it.
    insert_race_is_retryable = True

    def _key(self, aggregate: BuilderProposal) -> str:
        return aggregate.id

    def _to_row(self, aggregate: BuilderProposal) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "agent_id": aggregate.agent_id,
            "title": aggregate.title,
            "origin": aggregate.origin,
            "created_by": aggregate.created_by,
            "registered_by": aggregate.registered_by,
            "source": aggregate.source,
            "state": aggregate.state,
            "rev": aggregate.rev,
            "base_release_id": aggregate.base_release_id,
            "candidate_hash": aggregate.candidate_hash,
            "created_at": aggregate.created_at,
            "updated_at": aggregate.updated_at,
            "refreshed_at": aggregate.refreshed_at,
        }

    def _from_row(self, row: Row) -> BuilderProposal:
        return BuilderProposal(
            id=row["id"],
            agent_id=row["agent_id"],
            title=row["title"],
            origin=row["origin"],
            created_by=row["created_by"],
            registered_by=row["registered_by"],
            source=cast("ProposalSource", row["source"]),
            state=row["state"],
            rev=row["rev"],
            base_release_id=row["base_release_id"],
            candidate_hash=row["candidate_hash"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            refreshed_at=row["refreshed_at"],
        )

    async def search(
        self, *, agent_id: str | None = None, state: str | None = None, limit: int = 50
    ) -> list[BuilderProposal]:
        c = self.table.c
        statement = select(self.table)
        if agent_id is not None:
            statement = statement.where(c.agent_id == agent_id)
        if state is not None:
            statement = statement.where(c.state == state)
        statement = statement.order_by(c.updated_at.desc(), c.id.desc()).limit(limit)
        result = await self._session.execute(statement)
        return [
            aggregate
            for aggregate in (self._load(row) for row in result.mappings().all())
            if aggregate is not None
        ]
