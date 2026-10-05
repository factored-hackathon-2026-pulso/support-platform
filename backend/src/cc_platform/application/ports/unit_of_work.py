"""Unit of Work port.

A Unit of Work is one business transaction. Use cases open one per command::

    async with self._uow() as uow:
        account = await uow.login_accounts.get(staff_id)
        account.register_failed_attempt(...)
        await uow.login_accounts.save(account)
        await uow.commit()

On ``commit`` the implementation (1) pulls the pending domain events of every aggregate it
loaded or stored, plus any recorded with ``record``, (2) appends them to the event log in
the **same transaction** as the state change, (3) commits, and (4) publishes the records on
the event bus. Leaving the block without committing rolls back and drops the events.

Each bounded context adds its repositories as attributes here as it is implemented.
"""

from __future__ import annotations

from collections.abc import Callable
from types import TracebackType
from typing import TYPE_CHECKING, Protocol, Self

from cc_platform.domain.shared.events import DomainEvent

if TYPE_CHECKING:
    # Annotations only: importing the context packages at runtime would be circular
    # (their use cases import this module).
    from cc_platform.application.ai.maturity import CaseTypeMaturityRepository
    from cc_platform.application.ai.ports import (
        AssistantSessionRepository,
        BankCustomerLinks,
        BuilderProposalRepository,
        BuilderThreadRepository,
        CopilotSuggestionRepository,
        CopilotThreadRepository,
    )
    from cc_platform.application.cases.ports import (
        AnalystHomeReader,
        AssignmentRepository,
        CallRepository,
        CaseRepository,
        CustomerCaseSlotRepository,
        EscalationRepository,
        TurnRepository,
    )
    from cc_platform.application.customers.ports import CustomerRepository
    from cc_platform.application.notifications.ports import NotificationRepository
    from cc_platform.application.people.ports import (
        AdminRosterRepository,
        AnalystAvailabilityRepository,
        InvitationRepository,
        LoginAccountRepository,
        MfaChallengeRepository,
        PasswordResetRepository,
        StaffPreferencesRepository,
        StaffRepository,
        StaffSessionRepository,
        TeamRepository,
    )
    from cc_platform.application.platform.ports import PlatformSettingsRepository
    from cc_platform.application.ports.event_log import EventLogRepository


class UnitOfWork(Protocol):
    # Read-only members so adapters may expose their concrete repository types.
    @property
    def staff(self) -> StaffRepository: ...

    @property
    def teams(self) -> TeamRepository: ...

    @property
    def admin_roster(self) -> AdminRosterRepository: ...

    @property
    def platform_settings(self) -> PlatformSettingsRepository:
        """Slice 18: the platform-wide settings (the AI switch), a singleton."""
        ...

    @property
    def login_accounts(self) -> LoginAccountRepository: ...

    @property
    def mfa_challenges(self) -> MfaChallengeRepository: ...

    @property
    def sessions(self) -> StaffSessionRepository: ...

    @property
    def availability(self) -> AnalystAvailabilityRepository: ...

    @property
    def preferences(self) -> StaffPreferencesRepository:
        """Slice 23: each person's own settings (the UI language)."""
        ...

    @property
    def invitations(self) -> InvitationRepository:
        """Part 4: one invitation per person (single-use link, only its hash stored)."""
        ...

    @property
    def password_resets(self) -> PasswordResetRepository:
        """Part 4: one password-reset link per person."""
        ...

    @property
    def customers(self) -> CustomerRepository: ...

    @property
    def cases(self) -> CaseRepository: ...

    @property
    def turns(self) -> TurnRepository: ...

    @property
    def assignments(self) -> AssignmentRepository: ...

    @property
    def case_slots(self) -> CustomerCaseSlotRepository: ...

    @property
    def escalations(self) -> EscalationRepository: ...

    @property
    def calls(self) -> CallRepository:
        """Simulated phone calls of the cases (slice 12)."""
        ...

    @property
    def assistant_sessions(self) -> AssistantSessionRepository:
        """ADR 0003: the conversation each assistant-handled case holds with agent-core."""
        ...

    @property
    def copilot_threads(self) -> CopilotThreadRepository:
        """ADR 0003: each analyst's conversation with the copilot about a case."""
        ...

    @property
    def copilot_suggestions(self) -> CopilotSuggestionRepository:
        """ADR 0005: what the copilot proposed for a case and what the analyst did with it."""
        ...

    @property
    def case_type_maturity(self) -> CaseTypeMaturityRepository:
        """Slice 21: how far the AI matured for each case type (stage, signals)."""
        ...

    @property
    def builder_threads(self) -> BuilderThreadRepository:
        """ADR 0003 (slice 16): each supervisor's conversation with the builder agent."""
        ...

    @property
    def builder_proposals(self) -> BuilderProposalRepository:
        """ADR 0003 (slice 16): the platform's index of agent-core's proposals."""
        ...

    @property
    def bank_links(self) -> BankCustomerLinks:
        """ADR 0003: platform customer → dataset customer (agent-core's customer principal)."""
        ...

    @property
    def notifications(self) -> NotificationRepository:
        """Each person's notifications (slice 10): a projection, not in the event log."""
        ...

    @property
    def event_log(self) -> EventLogRepository: ...

    @property
    def analyst_home(self) -> AnalystHomeReader:
        """Read-only queries of the analyst home (slice 6); never staged or committed."""
        ...

    async def __aenter__(self) -> Self: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None: ...

    async def commit(self) -> None: ...

    async def rollback(self) -> None: ...

    def record(self, *events: DomainEvent) -> None:
        """Queue events that do not belong to a tracked aggregate."""
        ...


type UnitOfWorkFactory = Callable[[], UnitOfWork]
