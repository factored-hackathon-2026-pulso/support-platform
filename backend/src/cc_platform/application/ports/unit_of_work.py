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
    from cc_platform.application.cases.ports import (
        AnalystHomeReader,
        AssignmentRepository,
        CaseRepository,
        CustomerCaseSlotRepository,
        TurnRepository,
    )
    from cc_platform.application.customers.ports import CustomerRepository
    from cc_platform.application.people.ports import (
        AdminRosterRepository,
        AnalystAvailabilityRepository,
        LoginAccountRepository,
        MfaChallengeRepository,
        StaffRepository,
        StaffSessionRepository,
        TeamRepository,
    )
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
    def login_accounts(self) -> LoginAccountRepository: ...

    @property
    def mfa_challenges(self) -> MfaChallengeRepository: ...

    @property
    def sessions(self) -> StaffSessionRepository: ...

    @property
    def availability(self) -> AnalystAvailabilityRepository: ...

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
