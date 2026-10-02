"""In-memory Unit of Work (tests, demos without a database)."""

from __future__ import annotations

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.infrastructure.persistence.memory.repositories import (
    InMemoryAnalystAvailabilityRepository,
    InMemoryAssignmentRepository,
    InMemoryCaseRepository,
    InMemoryCustomerCaseSlotRepository,
    InMemoryCustomerRepository,
    InMemoryEventLogRepository,
    InMemoryLoginAccountRepository,
    InMemoryMfaChallengeRepository,
    InMemoryRoutingStepRepository,
    InMemoryStaffRepository,
    InMemoryStaffSessionRepository,
    InMemoryTurnRepository,
)
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.unit_of_work_base import BaseUnitOfWork


class InMemoryUnitOfWork(BaseUnitOfWork):
    staff: InMemoryStaffRepository
    login_accounts: InMemoryLoginAccountRepository
    mfa_challenges: InMemoryMfaChallengeRepository
    sessions: InMemoryStaffSessionRepository
    availability: InMemoryAnalystAvailabilityRepository
    customers: InMemoryCustomerRepository
    cases: InMemoryCaseRepository
    turns: InMemoryTurnRepository
    assignments: InMemoryAssignmentRepository
    case_slots: InMemoryCustomerCaseSlotRepository
    routing_steps: InMemoryRoutingStepRepository
    event_log: InMemoryEventLogRepository

    def __init__(
        self, store: InMemoryStore, *, bus: EventBus, ids: IdGenerator, clock: Clock
    ) -> None:
        super().__init__(bus=bus, ids=ids, clock=clock)
        self._store = store

    async def _begin(self) -> None:
        store, track = self._store, self.track
        self.staff = InMemoryStaffRepository(store.staff, track)
        self.login_accounts = InMemoryLoginAccountRepository(store.login_accounts, track)
        self.mfa_challenges = InMemoryMfaChallengeRepository(store.mfa_challenges, track)
        self.sessions = InMemoryStaffSessionRepository(store.sessions, track)
        self.availability = InMemoryAnalystAvailabilityRepository(store.availability, track)
        self.customers = InMemoryCustomerRepository(store.customers)
        self.cases = InMemoryCaseRepository(store.cases, track)
        self.turns = InMemoryTurnRepository(store.turns)
        self.assignments = InMemoryAssignmentRepository(store.assignments)
        self.case_slots = InMemoryCustomerCaseSlotRepository(store.case_slots, track)
        self.routing_steps = InMemoryRoutingStepRepository(store.routing_steps)
        self.event_log = InMemoryEventLogRepository(store.events)

    def _repositories(
        self,
    ) -> tuple[
        InMemoryStaffRepository
        | InMemoryLoginAccountRepository
        | InMemoryMfaChallengeRepository
        | InMemoryStaffSessionRepository
        | InMemoryAnalystAvailabilityRepository
        | InMemoryCustomerRepository
        | InMemoryCaseRepository
        | InMemoryTurnRepository
        | InMemoryAssignmentRepository
        | InMemoryCustomerCaseSlotRepository
        | InMemoryRoutingStepRepository
        | InMemoryEventLogRepository,
        ...,
    ]:
        # Aggregates with a version first: a lost race surfaces as ConcurrentUpdateError.
        return (
            self.staff,
            self.login_accounts,
            self.mfa_challenges,
            self.sessions,
            self.availability,
            self.case_slots,
            self.cases,
            self.customers,
            self.turns,
            self.assignments,
            self.routing_steps,
            self.event_log,
        )

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
