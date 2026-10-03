"""Append-only event log repository (SQLAlchemy)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import ColumnElement, Select, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.application.events import EventPage, EventRecord, StoredEvent
from cc_platform.application.ports.event_log import AuditFilters
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

    async def search(
        self, filters: AuditFilters, *, before: int | None, limit: int
    ) -> list[StoredEvent]:
        log = tables.event_log
        statement = select(log).where(*_criteria(filters)).order_by(log.c.sequence.desc())
        if before is not None:
            statement = statement.where(log.c.sequence < before)
        return await self._fetch(statement.limit(limit))

    async def get(self, event_id: str) -> StoredEvent | None:
        log = tables.event_log
        found = await self._fetch(select(log).where(log.c.event_id == event_id))
        return found[0] if found else None

    async def latest(self, event_type: str, actor_id: str, case_id: str) -> StoredEvent | None:
        log = tables.event_log
        statement = (
            select(log)
            .where(
                log.c.event_type == event_type,
                log.c.actor_id == actor_id,
                log.c.case_id == case_id,
            )
            .order_by(log.c.sequence.desc())
            .limit(1)
        )
        found = await self._fetch(statement)
        return found[0] if found else None

    async def _fetch(self, statement: Select[Any]) -> list[StoredEvent]:
        rows = (await self._session.execute(statement)).mappings().all()
        return [StoredEvent(**dict(row)) for row in rows]


def _like_pattern(text: str) -> str:
    """``%text%`` with LIKE wildcards escaped (portable: ``lower(col) LIKE … ESCAPE '\\'``)."""
    escaped = text.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _criteria(filters: AuditFilters) -> list[ColumnElement[bool]]:
    c = tables.event_log.c
    criteria: list[ColumnElement[bool]] = []
    if filters.actor_roles is not None:
        criteria.append(c.actor_role.in_(sorted(filters.actor_roles)))
    if filters.actor_id is not None:
        criteria.append(c.actor_id == filters.actor_id)
    if filters.case_id is not None:
        criteria.append(c.case_id == filters.case_id)
    if filters.event_types is not None:
        criteria.append(c.event_type.in_(sorted(filters.event_types)))
    if filters.exclude_event_types:
        criteria.append(c.event_type.not_in(sorted(filters.exclude_event_types)))
    if filters.occurred_from is not None:
        criteria.append(c.event_time >= filters.occurred_from)
    if filters.occurred_to is not None:
        criteria.append(c.event_time < filters.occurred_to)
    if filters.text:
        pattern = _like_pattern(filters.text)
        criteria.append(
            or_(
                *(
                    func.lower(column).like(pattern, escape="\\")
                    for column in (c.event_id, c.entity_id, c.case_id, c.actor_id)
                )
            )
        )
    return criteria
