"""SQLAlchemy repositories of the people context (explicit row ↔ aggregate mapping).

Writes use optimistic locking (``_VersionedRepository``): an aggregate is saved with
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

from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge, MfaChallengeStatus, MfaMethod
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import Language, Staff, StaffLevel, StaffRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import ConcurrentUpdateError, ConflictError, NotFoundError
from cc_platform.infrastructure.persistence.sqlalchemy import tables

type Tracker = Callable[[AggregateRoot], None]
type Row = RowMapping


class _VersionedRepository[A: AggregateRoot](ABC):
    """Insert / compare-and-set update / load for one aggregate table (Template Method).

    Subclasses give the table, its key column and the row mapping both ways.
    """

    table: Table

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


# ----------------------------------------------------------------------------- staff
class SqlStaffRepository(_VersionedRepository[Staff]):
    table = tables.staff

    def _key(self, aggregate: Staff) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Staff) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "name": aggregate.name,
            "email": aggregate.email,
            "roles": sorted(role.value for role in aggregate.roles),
            "level": aggregate.level.value,
            "languages": sorted(language.value for language in aggregate.languages),
            "team": aggregate.team,
            "active": aggregate.active,
        }

    def _from_row(self, row: Row) -> Staff:
        return Staff(
            id=row["id"],
            name=row["name"],
            email=row["email"],
            roles=frozenset(StaffRole(value) for value in row["roles"]),
            level=StaffLevel(row["level"]),
            languages=frozenset(Language(value) for value in row["languages"]),
            team=row["team"],
            active=row["active"],
        )

    async def get_by_email(self, email: str) -> Staff | None:
        return await self._get_where(tables.staff.c.email == email)

    async def list(self, *, role: StaffRole | None = None) -> list[Staff]:
        result = await self._session.execute(
            select(tables.staff).order_by(tables.staff.c.name, tables.staff.c.id)
        )
        people = [self._materialize(row) for row in result.mappings()]
        # Roles are a JSON list; filtering in Python keeps the SQL portable (table is small).
        return [person for person in people if role is None or person.has_role(role)]


# ----------------------------------------------------------------------------- login accounts
class SqlLoginAccountRepository(_VersionedRepository[LoginAccount]):
    table = tables.login_accounts

    @property
    def _key_column(self) -> Column[Any]:
        return tables.login_accounts.c.staff_id

    def _key(self, aggregate: LoginAccount) -> str:
        return aggregate.staff_id

    def _to_row(self, aggregate: LoginAccount) -> dict[str, Any]:
        return {
            "staff_id": aggregate.staff_id,
            "password_hash": aggregate.password_hash,
            "failed_attempts": aggregate.failed_attempts,
            "locked_until": aggregate.locked_until,
            "last_login_at": aggregate.last_login_at,
        }

    def _from_row(self, row: Row) -> LoginAccount:
        return LoginAccount(
            staff_id=row["staff_id"],
            password_hash=row["password_hash"],
            failed_attempts=row["failed_attempts"],
            locked_until=row["locked_until"],
            last_login_at=row["last_login_at"],
        )


# ----------------------------------------------------------------------------- mfa challenges
class SqlMfaChallengeRepository(_VersionedRepository[MfaChallenge]):
    table = tables.mfa_challenges

    def _key(self, aggregate: MfaChallenge) -> str:
        return aggregate.id

    def _to_row(self, aggregate: MfaChallenge) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "staff_id": aggregate.staff_id,
            "issued_at": aggregate.issued_at,
            "expires_at": aggregate.expires_at,
            "max_attempts": aggregate.max_attempts,
            "attempts": aggregate.attempts,
            "status": aggregate.status.value,
            "verified_at": aggregate.verified_at,
            "method": aggregate.method.value if aggregate.method else None,
        }

    def _from_row(self, row: Row) -> MfaChallenge:
        return MfaChallenge(
            id=row["id"],
            staff_id=row["staff_id"],
            issued_at=row["issued_at"],
            expires_at=row["expires_at"],
            max_attempts=row["max_attempts"],
            attempts=row["attempts"],
            status=MfaChallengeStatus(row["status"]),
            verified_at=row["verified_at"],
            method=MfaMethod(row["method"]) if row["method"] else None,
        )


# ----------------------------------------------------------------------------- sessions
class SqlStaffSessionRepository(_VersionedRepository[StaffSession]):
    table = tables.staff_sessions

    def _key(self, aggregate: StaffSession) -> str:
        return aggregate.id

    def _to_row(self, aggregate: StaffSession) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "staff_id": aggregate.staff_id,
            "issued_at": aggregate.issued_at,
            "expires_at": aggregate.expires_at,
            "mfa_method": aggregate.mfa_method.value,
            "ended_at": aggregate.ended_at,
            "end_reason": aggregate.end_reason.value if aggregate.end_reason else None,
        }

    def _from_row(self, row: Row) -> StaffSession:
        return StaffSession(
            id=row["id"],
            staff_id=row["staff_id"],
            issued_at=row["issued_at"],
            expires_at=row["expires_at"],
            mfa_method=MfaMethod(row["mfa_method"]),
            ended_at=row["ended_at"],
            end_reason=SessionEndReason(row["end_reason"]) if row["end_reason"] else None,
        )
