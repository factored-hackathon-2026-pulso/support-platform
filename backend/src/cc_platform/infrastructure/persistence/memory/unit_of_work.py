"""In-memory Unit of Work (tests, demos without a database)."""

from __future__ import annotations

from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_bus import EventBus
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.infrastructure.persistence.memory.repositories import (
    InMemoryAdminRosterRepository,
    InMemoryAnalystAvailabilityRepository,
    InMemoryAnalystHomeReader,
    InMemoryAssignmentRepository,
    InMemoryAssistantSessionRepository,
    InMemoryBankCustomerLinks,
    InMemoryBuilderProposalRepository,
    InMemoryBuilderThreadRepository,
    InMemoryCallRepository,
    InMemoryCaseRepository,
    InMemoryCopilotThreadRepository,
    InMemoryCustomerCaseSlotRepository,
    InMemoryCustomerRepository,
    InMemoryEscalationRepository,
    InMemoryEventLogRepository,
    InMemoryInvitationRepository,
    InMemoryLoginAccountRepository,
    InMemoryMfaChallengeRepository,
    InMemoryNotificationRepository,
    InMemoryPasswordResetRepository,
    InMemoryStaffRepository,
    InMemoryStaffSessionRepository,
    InMemoryTeamRepository,
    InMemoryTurnRepository,
)
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.unit_of_work_base import BaseUnitOfWork


class InMemoryUnitOfWork(BaseUnitOfWork):
    staff: InMemoryStaffRepository
    teams: InMemoryTeamRepository
    admin_roster: InMemoryAdminRosterRepository
    login_accounts: InMemoryLoginAccountRepository
    mfa_challenges: InMemoryMfaChallengeRepository
    sessions: InMemoryStaffSessionRepository
    availability: InMemoryAnalystAvailabilityRepository
    invitations: InMemoryInvitationRepository
    password_resets: InMemoryPasswordResetRepository
    customers: InMemoryCustomerRepository
    cases: InMemoryCaseRepository
    turns: InMemoryTurnRepository
    assignments: InMemoryAssignmentRepository
    case_slots: InMemoryCustomerCaseSlotRepository
    escalations: InMemoryEscalationRepository
    calls: InMemoryCallRepository
    notifications: InMemoryNotificationRepository
    assistant_sessions: InMemoryAssistantSessionRepository
    copilot_threads: InMemoryCopilotThreadRepository
    builder_threads: InMemoryBuilderThreadRepository
    builder_proposals: InMemoryBuilderProposalRepository
    bank_links: InMemoryBankCustomerLinks
    event_log: InMemoryEventLogRepository
    analyst_home: InMemoryAnalystHomeReader

    def __init__(
        self, store: InMemoryStore, *, bus: EventBus, ids: IdGenerator, clock: Clock
    ) -> None:
        super().__init__(bus=bus, ids=ids, clock=clock)
        self._store = store

    async def _begin(self) -> None:
        store, track = self._store, self.track
        self.staff = InMemoryStaffRepository(store.staff, track)
        self.teams = InMemoryTeamRepository(store.teams, track)
        self.admin_roster = InMemoryAdminRosterRepository(store.admin_roster, track)
        self.login_accounts = InMemoryLoginAccountRepository(store.login_accounts, track)
        self.mfa_challenges = InMemoryMfaChallengeRepository(store.mfa_challenges, track)
        self.sessions = InMemoryStaffSessionRepository(store.sessions, track)
        self.availability = InMemoryAnalystAvailabilityRepository(store.availability, track)
        self.invitations = InMemoryInvitationRepository(store.invitations, track)
        self.password_resets = InMemoryPasswordResetRepository(store.password_resets, track)
        self.customers = InMemoryCustomerRepository(store.customers)
        self.cases = InMemoryCaseRepository(store.cases, track, store.assignments)
        self.turns = InMemoryTurnRepository(store.turns)
        self.assignments = InMemoryAssignmentRepository(store.assignments)
        self.case_slots = InMemoryCustomerCaseSlotRepository(store.case_slots, track)
        self.escalations = InMemoryEscalationRepository(store.escalations, track)
        self.calls = InMemoryCallRepository(store.calls, track)
        self.notifications = InMemoryNotificationRepository(store.notifications, track)
        self.assistant_sessions = InMemoryAssistantSessionRepository(
            store.assistant_sessions, track
        )
        self.copilot_threads = InMemoryCopilotThreadRepository(store.copilot_threads, track)
        self.builder_threads = InMemoryBuilderThreadRepository(store.builder_threads, track)
        self.builder_proposals = InMemoryBuilderProposalRepository(store.builder_proposals, track)
        self.bank_links = InMemoryBankCustomerLinks(store.bank_links)
        self.event_log = InMemoryEventLogRepository(store.events)
        self.analyst_home = InMemoryAnalystHomeReader(
            store.sessions, store.cases, store.assignments, store.events
        )

    def _repositories(
        self,
    ) -> tuple[
        InMemoryStaffRepository
        | InMemoryTeamRepository
        | InMemoryAdminRosterRepository
        | InMemoryLoginAccountRepository
        | InMemoryMfaChallengeRepository
        | InMemoryStaffSessionRepository
        | InMemoryAnalystAvailabilityRepository
        | InMemoryInvitationRepository
        | InMemoryPasswordResetRepository
        | InMemoryCustomerRepository
        | InMemoryCaseRepository
        | InMemoryTurnRepository
        | InMemoryAssignmentRepository
        | InMemoryCustomerCaseSlotRepository
        | InMemoryEscalationRepository
        | InMemoryCallRepository
        | InMemoryNotificationRepository
        | InMemoryAssistantSessionRepository
        | InMemoryCopilotThreadRepository
        | InMemoryBuilderThreadRepository
        | InMemoryBuilderProposalRepository
        | InMemoryBankCustomerLinks
        | InMemoryEventLogRepository,
        ...,
    ]:
        # Aggregates with a version first: a lost race surfaces as ConcurrentUpdateError.
        return (
            self.teams,
            self.staff,
            self.admin_roster,
            self.login_accounts,
            self.mfa_challenges,
            self.sessions,
            self.availability,
            self.invitations,
            self.password_resets,
            self.case_slots,
            self.cases,
            self.escalations,
            self.calls,
            self.assistant_sessions,
            self.copilot_threads,
            self.builder_threads,
            self.builder_proposals,
            self.bank_links,
            self.notifications,
            self.customers,
            self.turns,
            self.assignments,
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
