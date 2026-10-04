"""``AnalystHomeReader`` over SQLAlchemy Core (slice 6): a fixed number of indexed queries.

- the previous session: ``staff_sessions`` by ``staff_id`` (indexed);
- the touched cases: ``cases`` by ``(assigned_analyst_id, status | closed_at)`` and
  ``assignments`` by ``(staff_id, assigned_at)`` / ``(previous_staff_id, assigned_at)``;
- their events: ``event_log`` by ``(case_id, sequence)``, filtered by type and time;
- the customers' cases: ``cases`` by ``(customer_id, opened_at)``.

Portable SQL only (``coalesce``, ``union``, ``IN``): no SQLite-only constructs.
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime

from sqlalchemy import and_, func, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.application.cases.ports import CustomerCaseFact
from cc_platform.application.events import StoredEvent
from cc_platform.domain.cases.values import OPEN_ASSIGNED_STATUSES, CloseReason
from cc_platform.infrastructure.persistence.sqlalchemy import tables

#: Keeps every ``IN (...)`` list well under the bind-parameter limits of SQLite/Postgres.
_CHUNK = 500


def _chunks(values: Collection[str]) -> list[list[str]]:
    ordered = sorted(set(values))
    return [ordered[i : i + _CHUNK] for i in range(0, len(ordered), _CHUNK)]


class SqlAnalystHomeReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def previous_session_end(
        self, staff_id: str, *, current_session_id: str, now: datetime
    ) -> datetime | None:
        c = tables.staff_sessions.c
        ended = func.coalesce(c.ended_at, c.expires_at)
        statement = select(func.max(ended)).where(
            c.staff_id == staff_id,
            c.id != current_session_id,
            or_(c.ended_at.is_not(None), c.expires_at <= now),
        )
        value: datetime | None = (await self._session.execute(statement)).scalar()
        return value

    async def touched_case_ids(self, staff_id: str, since: datetime) -> set[str]:
        c, a = tables.cases.c, tables.assignments.c
        held = select(c.id).where(
            c.assigned_analyst_id == staff_id,
            or_(
                c.status.in_(sorted(s.value for s in OPEN_ASSIGNED_STATUSES)),
                c.closed_at > since,
            ),
        )
        assigned = select(a.case_id).where(a.staff_id == staff_id, a.assigned_at > since)
        taken_away = select(a.case_id).where(a.previous_staff_id == staff_id, a.assigned_at > since)
        rows = await self._session.execute(union(held, assigned, taken_away))
        return {case_id for (case_id,) in rows}

    async def case_events(
        self, case_ids: Collection[str], *, since: datetime, event_types: Collection[str]
    ) -> list[StoredEvent]:
        if not case_ids or not event_types:
            return []
        log = tables.event_log
        found: list[StoredEvent] = []
        for chunk in _chunks(case_ids):
            statement = (
                select(log)
                .where(
                    and_(
                        log.c.case_id.in_(chunk),
                        log.c.event_time > since,
                        log.c.event_type.in_(sorted(event_types)),
                    )
                )
                .order_by(log.c.sequence)
            )
            rows = (await self._session.execute(statement)).mappings().all()
            found.extend(StoredEvent(**dict(row)) for row in rows)
        found.sort(key=lambda event: event.sequence)
        return found

    async def customer_cases(
        self, customer_ids: Collection[str]
    ) -> dict[str, list[CustomerCaseFact]]:
        c = tables.cases.c
        facts: dict[str, list[CustomerCaseFact]] = {}
        for chunk in _chunks(customer_ids):
            statement = select(c.id, c.customer_id, c.opened_at, c.close_reason).where(
                c.customer_id.in_(chunk)
            )
            for row in await self._session.execute(statement):
                facts.setdefault(row.customer_id, []).append(
                    CustomerCaseFact(
                        case_id=row.id,
                        opened_at=row.opened_at,
                        close_reason=CloseReason(row.close_reason) if row.close_reason else None,
                    )
                )
        return facts
