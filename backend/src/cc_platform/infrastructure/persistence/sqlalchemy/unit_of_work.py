"""SQLAlchemy async Unit of Work: one ``AsyncSession`` (one transaction) per unit."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.event_log import (
    SqlEventLogRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.people import (
    SqlLoginAccountRepository,
    SqlMfaChallengeRepository,
    SqlStaffRepository,
    SqlStaffSessionRepository,
)
from cc_platform.infrastructure.persistence.unit_of_work_base import BaseUnitOfWork


class SqlAlchemyUnitOfWork(BaseUnitOfWork):
    staff: SqlStaffRepository
    login_accounts: SqlLoginAccountRepository
    mfa_challenges: SqlMfaChallengeRepository
    sessions: SqlStaffSessionRepository
    event_log: SqlEventLogRepository

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        bus: EventBus,
        ids: IdGenerator,
        clock: Clock,
    ) -> None:
        super().__init__(bus=bus, ids=ids, clock=clock)
        self._session_factory = session_factory
        self._session: AsyncSession | None = None

    async def _begin(self) -> None:
        session = self._session_factory()
        self._session = session
        self.staff = SqlStaffRepository(session, self.track)
        self.login_accounts = SqlLoginAccountRepository(session, self.track)
        self.mfa_challenges = SqlMfaChallengeRepository(session, self.track)
        self.sessions = SqlStaffSessionRepository(session, self.track)
        self.event_log = SqlEventLogRepository(session)

    async def _commit(self) -> None:
        await self._require_session().commit()

    async def _rollback(self) -> None:
        if self._session is not None:
            await self._session.rollback()

    async def _close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    def _require_session(self) -> AsyncSession:
        if self._session is None:
            raise RuntimeError("Unit of Work used outside of 'async with'")
        return self._session
