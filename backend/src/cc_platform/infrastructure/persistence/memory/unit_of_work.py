"""In-memory Unit of Work (tests, demos without a database)."""

from __future__ import annotations

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.infrastructure.persistence.memory.repositories import (
    InMemoryEventLogRepository,
    InMemoryLoginAccountRepository,
    InMemoryMfaChallengeRepository,
    InMemoryStaffRepository,
    InMemoryStaffSessionRepository,
)
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.unit_of_work_base import BaseUnitOfWork


class InMemoryUnitOfWork(BaseUnitOfWork):
    staff: InMemoryStaffRepository
    login_accounts: InMemoryLoginAccountRepository
    mfa_challenges: InMemoryMfaChallengeRepository
    sessions: InMemoryStaffSessionRepository
    event_log: InMemoryEventLogRepository

    def __init__(
        self, store: InMemoryStore, *, bus: EventBus, ids: IdGenerator, clock: Clock
    ) -> None:
        super().__init__(bus=bus, ids=ids, clock=clock)
        self._store = store

    async def _begin(self) -> None:
        self.staff = InMemoryStaffRepository(self._store.staff, self.track)
        self.login_accounts = InMemoryLoginAccountRepository(self._store.login_accounts, self.track)
        self.mfa_challenges = InMemoryMfaChallengeRepository(self._store.mfa_challenges, self.track)
        self.sessions = InMemoryStaffSessionRepository(self._store.sessions, self.track)
        self.event_log = InMemoryEventLogRepository(self._store.events)

    def _repositories(
        self,
    ) -> tuple[
        InMemoryStaffRepository,
        InMemoryLoginAccountRepository,
        InMemoryMfaChallengeRepository,
        InMemoryStaffSessionRepository,
        InMemoryEventLogRepository,
    ]:
        return (self.staff, self.login_accounts, self.mfa_challenges, self.sessions, self.event_log)

    async def _commit(self) -> None:
        # No await between verify and apply: the check-and-write is atomic on the event loop.
        repositories = self._repositories()
        for repository in repositories:
            repository.verify()
        for repository in repositories:
            repository.apply()

    async def _rollback(self) -> None:
        if not hasattr(self, "staff"):
            return
        for repository in self._repositories():
            repository.discard()

    async def _close(self) -> None:
        return None
