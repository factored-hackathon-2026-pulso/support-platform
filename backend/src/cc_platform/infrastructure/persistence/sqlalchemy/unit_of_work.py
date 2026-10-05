"""SQLAlchemy async Unit of Work: one ``AsyncSession`` (one transaction) per unit."""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.domain.shared.errors import ConcurrentUpdateError
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.analyst_home import (
    SqlAnalystHomeReader,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.assistant import (
    SqlAssistantSessionRepository,
    SqlBankCustomerLinks,
    SqlCopilotThreadRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.builder import (
    SqlBuilderProposalRepository,
    SqlBuilderThreadRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.cases import (
    SqlAssignmentRepository,
    SqlCallRepository,
    SqlCaseRepository,
    SqlCustomerCaseSlotRepository,
    SqlCustomerRepository,
    SqlEscalationRepository,
    SqlTurnRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.event_log import (
    SqlEventLogRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.notifications import (
    SqlNotificationRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.people import (
    SqlAdminRosterRepository,
    SqlAnalystAvailabilityRepository,
    SqlInvitationRepository,
    SqlLoginAccountRepository,
    SqlMfaChallengeRepository,
    SqlPasswordResetRepository,
    SqlStaffRepository,
    SqlStaffSessionRepository,
    SqlTeamRepository,
)
from cc_platform.infrastructure.persistence.sqlalchemy.repositories.platform import (
    SqlPlatformSettingsRepository,
)
from cc_platform.infrastructure.persistence.unit_of_work_base import BaseUnitOfWork

#: SQLite's busy answers: another connection holds the write lock past the busy timeout.
_LOCK_CONTENTION = ("database is locked", "database table is locked")


def is_lock_contention(error: BaseException) -> bool:
    """Whether a driver error means "another writer holds the lock" (nothing was written)."""
    return isinstance(error, OperationalError) and any(
        marker in str(error.orig) for marker in _LOCK_CONTENTION
    )


class SqlAlchemyUnitOfWork(BaseUnitOfWork):
    staff: SqlStaffRepository
    teams: SqlTeamRepository
    admin_roster: SqlAdminRosterRepository
    platform_settings: SqlPlatformSettingsRepository
    login_accounts: SqlLoginAccountRepository
    mfa_challenges: SqlMfaChallengeRepository
    sessions: SqlStaffSessionRepository
    availability: SqlAnalystAvailabilityRepository
    invitations: SqlInvitationRepository
    password_resets: SqlPasswordResetRepository
    customers: SqlCustomerRepository
    cases: SqlCaseRepository
    turns: SqlTurnRepository
    assignments: SqlAssignmentRepository
    case_slots: SqlCustomerCaseSlotRepository
    escalations: SqlEscalationRepository
    calls: SqlCallRepository
    notifications: SqlNotificationRepository
    assistant_sessions: SqlAssistantSessionRepository
    copilot_threads: SqlCopilotThreadRepository
    builder_threads: SqlBuilderThreadRepository
    builder_proposals: SqlBuilderProposalRepository
    bank_links: SqlBankCustomerLinks
    event_log: SqlEventLogRepository
    analyst_home: SqlAnalystHomeReader

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
        self.teams = SqlTeamRepository(session, self.track)
        self.admin_roster = SqlAdminRosterRepository(session, self.track)
        self.platform_settings = SqlPlatformSettingsRepository(session, self.track)
        self.login_accounts = SqlLoginAccountRepository(session, self.track)
        self.mfa_challenges = SqlMfaChallengeRepository(session, self.track)
        self.sessions = SqlStaffSessionRepository(session, self.track)
        self.availability = SqlAnalystAvailabilityRepository(session, self.track)
        self.invitations = SqlInvitationRepository(session, self.track)
        self.password_resets = SqlPasswordResetRepository(session, self.track)
        self.customers = SqlCustomerRepository(session)
        self.cases = SqlCaseRepository(session, self.track)
        self.turns = SqlTurnRepository(session)
        self.assignments = SqlAssignmentRepository(session)
        self.case_slots = SqlCustomerCaseSlotRepository(session, self.track)
        self.escalations = SqlEscalationRepository(session, self.track)
        self.calls = SqlCallRepository(session, self.track)
        self.notifications = SqlNotificationRepository(session, self.track)
        self.assistant_sessions = SqlAssistantSessionRepository(session, self.track)
        self.copilot_threads = SqlCopilotThreadRepository(session, self.track)
        self.builder_threads = SqlBuilderThreadRepository(session, self.track)
        self.builder_proposals = SqlBuilderProposalRepository(session, self.track)
        self.bank_links = SqlBankCustomerLinks(session)
        self.event_log = SqlEventLogRepository(session)
        self.analyst_home = SqlAnalystHomeReader(session)

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        """Lock contention is a concurrent update: the transaction is rolled back, so a
        command in ``retry_on_conflict`` re-runs on fresh state instead of answering 500."""
        await super().__aexit__(exc_type, exc, tb)
        if exc is not None and is_lock_contention(exc):
            raise ConcurrentUpdateError() from exc

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
