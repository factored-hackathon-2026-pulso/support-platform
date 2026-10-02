"""Versioned aggregate repository base (SQLAlchemy Core, explicit row ↔ aggregate mapping).

Writes use optimistic locking: an aggregate is saved with
``UPDATE … WHERE <key> = :key AND version = :loaded`` and the version is bumped, so two
requests that loaded the same revision cannot both win; the loser gets
``ConcurrentUpdateError`` instead of silently overwriting the other's change.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any, cast

from sqlalchemy import Column, CursorResult, RowMapping, Table, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import ConcurrentUpdateError, ConflictError, NotFoundError
from cc_platform.infrastructure.persistence.sqlalchemy import tables

type Tracker = Callable[[AggregateRoot], None]
type Row = RowMapping


class VersionedRepository[A: AggregateRoot](ABC):
    """Insert / compare-and-set update / load for one aggregate table (Template Method).

    Subclasses give the table, its key column and the row mapping both ways.
    """

    table: Table
    #: See ``_StagedRepository.insert_race_is_retryable`` (memory adapter): a duplicate
    #: insert of an on-demand aggregate means "created concurrently" → retry.
    insert_race_is_retryable = False

    def __init__(self, session: AsyncSession, track: Tracker) -> None:
        self._session = session
        self._track = track

    # ----------------------------------------------------------------- mapping hooks
    @property
    def _key_column(self) -> Column[Any]:
        return self.table.c.id

    @abstractmethod
    def _key(self, aggregate: A) -> str: ...

    @abstractmethod
    def _to_row(self, aggregate: A) -> dict[str, Any]: ...

    @abstractmethod
    def _from_row(self, row: Row) -> A: ...

    # ----------------------------------------------------------------- operations
    async def _get_where(self, *criteria: Any) -> A | None:
        result = await self._session.execute(select(self.table).where(*criteria))
        return self._load(result.mappings().first())

    async def get(self, key: str) -> A | None:
        return await self._get_where(self._key_column == key)

    async def add(self, aggregate: A) -> None:
        statement = insert(self.table).values(
            **self._to_row(aggregate), **{tables.VERSION_COLUMN: 1}
        )
        # On conflict the transaction is unusable; the Unit of Work rolls it back on exit.
        try:
            await self._session.execute(statement)
        except IntegrityError as exc:
            if self.insert_race_is_retryable:
                raise ConcurrentUpdateError(entity=self.table.name) from exc
            raise ConflictError("Ya existe un registro con esos datos.") from exc
        aggregate.mark_persisted(1)
        self._track(aggregate)

    async def save(self, aggregate: A) -> None:
        key = self._key(aggregate)
        expected = aggregate.version
        if expected < 1:
            raise NotFoundError(id=key)  # never loaded nor added: nothing to update
        version = self.table.c[tables.VERSION_COLUMN]
        statement = (
            update(self.table)
            .where(self._key_column == key, version == expected)
            .values(**self._to_row(aggregate), **{tables.VERSION_COLUMN: expected + 1})
        )
        result = cast("CursorResult[Any]", await self._session.execute(statement))
        if result.rowcount != 1:
            raise ConcurrentUpdateError(entity=self.table.name, id=key)
        aggregate.mark_persisted(expected + 1)
        self._track(aggregate)

    def _materialize(self, row: Row) -> A:
        aggregate = self._from_row(row)
        aggregate.mark_persisted(row[tables.VERSION_COLUMN])
        return aggregate

    def _load(self, row: Row | None) -> A | None:
        if row is None:
            return None
        aggregate = self._materialize(row)
        self._track(aggregate)
        return aggregate
