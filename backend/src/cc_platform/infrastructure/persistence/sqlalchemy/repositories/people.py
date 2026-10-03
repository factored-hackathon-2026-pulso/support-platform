"""SQLAlchemy repositories of the people context (explicit row ↔ aggregate mapping).

Writes use optimistic locking (``VersionedRepository`` in ``base.py``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Column, select

from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge, MfaChallengeStatus, MfaMethod
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import Language, Staff, StaffRole
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


# ----------------------------------------------------------------------------- staff
class SqlStaffRepository(VersionedRepository[Staff]):
    table = tables.staff

    def _key(self, aggregate: Staff) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Staff) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "name": aggregate.name,
            "email": aggregate.email,
            "roles": sorted(role.value for role in aggregate.roles),
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
class SqlLoginAccountRepository(VersionedRepository[LoginAccount]):
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
class SqlMfaChallengeRepository(VersionedRepository[MfaChallenge]):
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
class SqlStaffSessionRepository(VersionedRepository[StaffSession]):
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

    async def active_staff_ids(self, now: datetime) -> set[str]:
        c = tables.staff_sessions.c
        result = await self._session.execute(
            select(c.staff_id).where(c.ended_at.is_(None), c.expires_at > now).distinct()
        )
        return {staff_id for (staff_id,) in result}


# ----------------------------------------------------------------------------- availability
class SqlAnalystAvailabilityRepository(VersionedRepository[AnalystAvailability]):
    table = tables.analyst_availability
    insert_race_is_retryable = True

    @property
    def _key_column(self) -> Column[Any]:
        return tables.analyst_availability.c.staff_id

    def _key(self, aggregate: AnalystAvailability) -> str:
        return aggregate.staff_id

    def _to_row(self, aggregate: AnalystAvailability) -> dict[str, Any]:
        return {
            "staff_id": aggregate.staff_id,
            "status": aggregate.status.value,
            "since": aggregate.since,
        }

    def _from_row(self, row: Row) -> AnalystAvailability:
        return AnalystAvailability(
            staff_id=row["staff_id"], status=AvailabilityStatus(row["status"]), since=row["since"]
        )

    async def list(self) -> list[AnalystAvailability]:
        table = tables.analyst_availability
        result = await self._session.execute(select(table).order_by(table.c.staff_id))
        return [self._materialize(row) for row in result.mappings()]
