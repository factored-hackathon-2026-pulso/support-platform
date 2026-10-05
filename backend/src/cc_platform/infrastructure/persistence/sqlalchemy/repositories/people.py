"""SQLAlchemy repositories of the people context (explicit row ↔ aggregate mapping).

Writes use optimistic locking (``VersionedRepository`` in ``base.py``).
"""

from __future__ import annotations

from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import Column, select
from sqlalchemy.exc import IntegrityError

from cc_platform.domain.people.admin_roster import ROSTER_ID, AdminRoster
from cc_platform.domain.people.availability import AnalystAvailability, AvailabilityStatus
from cc_platform.domain.people.errors import EmailTakenError, TeamNameTakenError
from cc_platform.domain.people.invitation import Invitation, InvitationState
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge, MfaChallengeStatus, MfaMethod
from cc_platform.domain.people.password_reset import PasswordReset, PasswordResetState
from cc_platform.domain.people.preferences import StaffPreferences, UiLanguage
from cc_platform.domain.people.session import SessionEndReason, StaffSession
from cc_platform.domain.people.staff import AccountSetup, Language, Staff, StaffRole
from cc_platform.domain.people.team import Team
from cc_platform.domain.shared.errors import ConcurrentUpdateError, DomainError
from cc_platform.infrastructure.persistence.sqlalchemy import tables
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.base import (
    Row,
    VersionedRepository,
)


def _violates(exc: IntegrityError, column: str) -> bool:
    """Whether a unique violation names ``column`` (SQLite: ``staff.email``; Postgres: the
    constraint ``uq_staff_email``; both mention the column)."""
    return column in str(exc.orig)


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
            "team_id": aggregate.team_id,
            "active": aggregate.active,
            "created_at": aggregate.created_at,
            "creation_key": aggregate.creation_key,
            "setup": aggregate.setup.value,
        }

    def _from_row(self, row: Row) -> Staff:
        return Staff(
            id=row["id"],
            name=row["name"],
            email=row["email"],
            roles=frozenset(StaffRole(value) for value in row["roles"]),
            languages=frozenset(Language(value) for value in row["languages"]),
            team_id=row["team_id"],
            created_at=row["created_at"],
            active=row["active"],
            creation_key=row["creation_key"],
            setup=AccountSetup(row["setup"]),
        )

    def _integrity_error(self, exc: IntegrityError, *, insert: bool) -> DomainError:
        if _violates(exc, "creation_key"):
            return ConcurrentUpdateError(entity=self.table.name)  # a concurrent replay
        if _violates(exc, "email"):
            return EmailTakenError()
        return super()._integrity_error(exc, insert=insert)

    async def get_by_email(self, email: str) -> Staff | None:
        return await self._get_where(tables.staff.c.email == email)

    async def get_by_creation_key(self, key: str) -> Staff | None:
        return await self._get_where(tables.staff.c.creation_key == key)

    async def list(self, *, role: StaffRole | None = None) -> list[Staff]:
        result = await self._session.execute(
            select(tables.staff).order_by(tables.staff.c.name, tables.staff.c.id)
        )
        people = [self._materialize(row) for row in result.mappings()]
        # Roles are a JSON list; filtering in Python keeps the SQL portable (table is small).
        return [person for person in people if role is None or person.has_role(role)]


# ----------------------------------------------------------------------------- teams
class SqlTeamRepository(VersionedRepository[Team]):
    table = tables.teams

    def _key(self, aggregate: Team) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Team) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "name": aggregate.name,
            "name_key": aggregate.name_key,
            "active": aggregate.active,
            "created_at": aggregate.created_at,
            "creation_key": aggregate.creation_key,
        }

    def _from_row(self, row: Row) -> Team:
        return Team(
            id=row["id"],
            name=row["name"],
            active=row["active"],
            created_at=row["created_at"],
            creation_key=row["creation_key"],
        )

    def _integrity_error(self, exc: IntegrityError, *, insert: bool) -> DomainError:
        if _violates(exc, "creation_key"):
            return ConcurrentUpdateError(entity=self.table.name)
        if _violates(exc, "name_key"):
            return TeamNameTakenError()
        return super()._integrity_error(exc, insert=insert)

    async def get_many(self, team_ids: Collection[str]) -> dict[str, Team]:
        if not team_ids:
            return {}
        result = await self._session.execute(
            select(tables.teams).where(tables.teams.c.id.in_(list(team_ids)))
        )
        return {row["id"]: self._materialize(row) for row in result.mappings()}

    async def get_by_creation_key(self, key: str) -> Team | None:
        return await self._get_where(tables.teams.c.creation_key == key)

    async def list(self) -> list[Team]:
        c = tables.teams.c
        result = await self._session.execute(select(tables.teams).order_by(c.name_key, c.id))
        return [self._materialize(row) for row in result.mappings()]


# ----------------------------------------------------------------------------- admin roster
class SqlAdminRosterRepository(VersionedRepository[AdminRoster]):
    table = tables.admin_roster
    insert_race_is_retryable = True

    def _key(self, aggregate: AdminRoster) -> str:
        return aggregate.id

    def _to_row(self, aggregate: AdminRoster) -> dict[str, Any]:
        return {"id": aggregate.id, "admin_ids": sorted(aggregate.admin_ids)}

    def _from_row(self, row: Row) -> AdminRoster:
        return AdminRoster(id=row["id"], admin_ids=frozenset(row["admin_ids"]))

    async def get(self, key: str = ROSTER_ID) -> AdminRoster | None:
        return await super().get(key)


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
            "totp_secret": aggregate.totp_secret,
        }

    def _from_row(self, row: Row) -> LoginAccount:
        return LoginAccount(
            staff_id=row["staff_id"],
            password_hash=row["password_hash"],
            failed_attempts=row["failed_attempts"],
            locked_until=row["locked_until"],
            last_login_at=row["last_login_at"],
            totp_secret=row["totp_secret"],
        )

    async def list(self) -> list[LoginAccount]:
        table = tables.login_accounts
        result = await self._session.execute(select(table).order_by(table.c.staff_id))
        return [self._materialize(row) for row in result.mappings()]


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

    async def list_pending_for(self, staff_id: str, now: datetime) -> list[MfaChallenge]:
        c = tables.mfa_challenges.c
        result = await self._session.execute(
            select(tables.mfa_challenges)
            .where(
                c.staff_id == staff_id,
                c.status == MfaChallengeStatus.PENDING.value,
                c.expires_at > now,
            )
            .order_by(c.issued_at, c.id)
        )
        challenges: list[MfaChallenge] = []
        for row in result.mappings():
            challenge = self._load(row)
            if challenge is not None:
                challenges.append(challenge)
        return challenges


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

    async def list_active_for(self, staff_id: str, now: datetime) -> list[StaffSession]:
        c = tables.staff_sessions.c
        result = await self._session.execute(
            select(tables.staff_sessions)
            .where(c.staff_id == staff_id, c.ended_at.is_(None), c.expires_at > now)
            .order_by(c.issued_at, c.id)
        )
        sessions: list[StaffSession] = []
        for row in result.mappings():
            session = self._load(row)
            if session is not None:
                sessions.append(session)
        return sessions


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


# ----------------------------------------------------------------------------- preferences
class SqlStaffPreferencesRepository(VersionedRepository[StaffPreferences]):
    table = tables.staff_preferences
    insert_race_is_retryable = True

    @property
    def _key_column(self) -> Column[Any]:
        return tables.staff_preferences.c.staff_id

    def _key(self, aggregate: StaffPreferences) -> str:
        return aggregate.staff_id

    def _to_row(self, aggregate: StaffPreferences) -> dict[str, Any]:
        return {"staff_id": aggregate.staff_id, "ui_language": aggregate.ui_language.value}

    def _from_row(self, row: Row) -> StaffPreferences:
        return StaffPreferences(
            staff_id=row["staff_id"], ui_language=UiLanguage(row["ui_language"])
        )


# ----------------------------------------------------------------------------- invitations
class SqlInvitationRepository(VersionedRepository[Invitation]):
    """Part 4. ``staff_id`` and ``token_hash`` are unique: a second invitation for the same
    person (two concurrent creates) is a concurrent update (the retry finds the first)."""

    table = tables.invitations
    insert_race_is_retryable = True

    def _key(self, aggregate: Invitation) -> str:
        return aggregate.id

    def _to_row(self, aggregate: Invitation) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "staff_id": aggregate.staff_id,
            "token_hash": aggregate.token_hash,
            "state": aggregate.state.value,
            "created_at": aggregate.created_at,
            "sent_at": aggregate.sent_at,
            "expires_at": aggregate.expires_at,
            "created_by": aggregate.created_by,
            "resend_count": aggregate.resend_count,
            "accepted_at": aggregate.accepted_at,
            "cancelled_at": aggregate.cancelled_at,
            "password_hash": aggregate.password_hash,
            "totp_secret": aggregate.totp_secret,
            "failed_codes": aggregate.failed_codes,
            "locked_until": aggregate.locked_until,
        }

    def _from_row(self, row: Row) -> Invitation:
        return Invitation(
            id=row["id"],
            staff_id=row["staff_id"],
            token_hash=row["token_hash"],
            state=InvitationState(row["state"]),
            created_at=row["created_at"],
            sent_at=row["sent_at"],
            expires_at=row["expires_at"],
            created_by=row["created_by"],
            resend_count=row["resend_count"],
            accepted_at=row["accepted_at"],
            cancelled_at=row["cancelled_at"],
            password_hash=row["password_hash"],
            totp_secret=row["totp_secret"],
            failed_codes=row["failed_codes"],
            locked_until=row["locked_until"],
        )

    def _integrity_error(self, exc: IntegrityError, *, insert: bool) -> DomainError:
        return ConcurrentUpdateError(entity=self.table.name)

    async def get_for_staff(self, staff_id: str) -> Invitation | None:
        return await self._get_where(tables.invitations.c.staff_id == staff_id)

    async def get_by_token_hash(self, token_hash: str) -> Invitation | None:
        return await self._get_where(tables.invitations.c.token_hash == token_hash)

    async def list(self) -> list[Invitation]:
        table = tables.invitations
        result = await self._session.execute(select(table).order_by(table.c.staff_id))
        return [self._materialize(row) for row in result.mappings()]


# ----------------------------------------------------------------------------- password resets
class SqlPasswordResetRepository(VersionedRepository[PasswordReset]):
    table = tables.password_resets
    insert_race_is_retryable = True

    def _key(self, aggregate: PasswordReset) -> str:
        return aggregate.id

    def _to_row(self, aggregate: PasswordReset) -> dict[str, Any]:
        return {
            "id": aggregate.id,
            "staff_id": aggregate.staff_id,
            "token_hash": aggregate.token_hash,
            "state": aggregate.state.value,
            "sent_at": aggregate.sent_at,
            "expires_at": aggregate.expires_at,
            "created_by": aggregate.created_by,
            "used_at": aggregate.used_at,
        }

    def _from_row(self, row: Row) -> PasswordReset:
        return PasswordReset(
            id=row["id"],
            staff_id=row["staff_id"],
            token_hash=row["token_hash"],
            state=PasswordResetState(row["state"]),
            sent_at=row["sent_at"],
            expires_at=row["expires_at"],
            created_by=row["created_by"],
            used_at=row["used_at"],
        )

    def _integrity_error(self, exc: IntegrityError, *, insert: bool) -> DomainError:
        return ConcurrentUpdateError(entity=self.table.name)

    async def get_for_staff(self, staff_id: str) -> PasswordReset | None:
        return await self._get_where(tables.password_resets.c.staff_id == staff_id)

    async def get_by_token_hash(self, token_hash: str) -> PasswordReset | None:
        return await self._get_where(tables.password_resets.c.token_hash == token_hash)
