"""Append-only event log repository (SQLAlchemy)."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.application.events import EventPage, EventRecord, StoredEvent
from cc_platform.infrastructure.persistence.cursors import clamp_limit, decode_cursor, encode_cursor
from cc_platform.infrastructure.persistence.sqlalchemy import tables


class SqlEventLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def append(self, records: Sequence[EventRecord]) -> None:
        if not records:
            return
        await self._session.execute(
            insert(tables.event_log),
            [
                {
                    "event_id": record.event_id,
                    "event_type": record.event_type,
                    "entity": record.entity,
                    "entity_id": record.entity_id,
                    "case_id": record.case_id,
                    "actor_role": record.actor_role,
                    "actor_id": record.actor_id,
                    "event_time": record.event_time,
                    "ingested_at": record.ingested_at,
                    "payload": record.payload(),
                }
                for record in records
            ],
        )

    async def page(
        self,
        *,
        after: str | None = None,
        limit: int = 100,
        case_id: str | None = None,
        entity_id: str | None = None,
    ) -> EventPage:
        size = clamp_limit(limit)
        log = tables.event_log
        statement = (
            select(log)
            .where(log.c.sequence > decode_cursor(after))
            .order_by(log.c.sequence)
            .limit(size + 1)
        )
        if case_id is not None:
            statement = statement.where(log.c.case_id == case_id)
        if entity_id is not None:
            statement = statement.where(log.c.entity_id == entity_id)
        rows = (await self._session.execute(statement)).mappings().all()
        items = tuple(StoredEvent(**dict(row)) for row in rows[:size])
        has_more = len(rows) > size
        return EventPage(
            items=items,
            next_cursor=encode_cursor(items[-1].sequence) if has_more and items else None,
        )
