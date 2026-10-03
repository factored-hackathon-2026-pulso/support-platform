"""Repository ports of the people context (one per aggregate)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Protocol

from cc_platform.domain.people.availability import AnalystAvailability
from cc_platform.domain.people.login_account import FailedAttemptCounter, LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Staff, StaffRole


class StaffRepository(Protocol):
    async def get(self, staff_id: str) -> Staff | None: ...

    async def get_by_email(self, email: str) -> Staff | None:
        """``email`` must already be normalised (``normalize_email``)."""
        ...

    async def list(self, *, role: StaffRole | None = None) -> list[Staff]:
        """All staff ordered by name, optionally filtered by role."""
        ...

    async def add(self, staff: Staff) -> None: ...

    async def save(self, staff: Staff) -> None: ...


class LoginAccountRepository(Protocol):
    async def get(self, staff_id: str) -> LoginAccount | None: ...

    async def add(self, account: LoginAccount) -> None: ...

    async def save(self, account: LoginAccount) -> None: ...


class MfaChallengeRepository(Protocol):
    async def get(self, challenge_id: str) -> MfaChallenge | None: ...

    async def add(self, challenge: MfaChallenge) -> None: ...

    async def save(self, challenge: MfaChallenge) -> None: ...


class StaffSessionRepository(Protocol):
    async def get(self, session_id: str) -> StaffSession | None: ...

    async def active_staff_ids(self, now: datetime) -> set[str]:
        """Staff with at least one active session (not ended, ``expires_at > now``)."""
        ...

    async def add(self, session: StaffSession) -> None: ...

    async def save(self, session: StaffSession) -> None: ...


class UnknownLoginAttempts(Protocol):
    """Storage of failed-login counters for emails that match no active account.

    A wrong password for a real account answers ``invalid_credentials`` with a
    ``remainingAttempts`` countdown and locks (423) on the fifth failure (canvas
    ``BoLogin``/``BoLocked``). An unknown email must answer exactly the same way, or the
    countdown itself tells an attacker which emails belong to staff. The rules live in the
    domain (``FailedAttemptCounter``); adapters only store counters by email (normalised)
    and may keep them process-local and bounded, since no real account sits behind them.
    """

    async def get(self, email: str) -> FailedAttemptCounter:
        """The stored counter, or an empty one."""
        ...

    async def update(
        self, email: str, change: Callable[[FailedAttemptCounter], FailedAttemptCounter]
    ) -> FailedAttemptCounter:
        """Atomically replace the counter with ``change(current)`` and return the new one.

        Must be atomic per email (lock, or compare-and-set with retry in a shared store), so
        parallel guesses cannot overwrite each other. Exceptions raised by ``change`` (e.g.
        ``AccountLockedError``) propagate and leave the counter untouched.
        """
        ...


class AnalystAvailabilityRepository(Protocol):
    async def get(self, staff_id: str) -> AnalystAvailability | None:
        """``None`` means the analyst never set it: treat as paused."""
        ...

    async def list(self) -> list[AnalystAvailability]: ...

    async def add(self, availability: AnalystAvailability) -> None:
        """Insert; a concurrent insert for the same analyst raises ``ConcurrentUpdateError``."""
        ...

    async def save(self, availability: AnalystAvailability) -> None: ...
