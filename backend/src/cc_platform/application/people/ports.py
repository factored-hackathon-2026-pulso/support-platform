"""Repository ports of the people context (one per aggregate)."""

from __future__ import annotations

from collections.abc import Callable, Collection
from datetime import datetime
from typing import Protocol

from cc_platform.domain.people.admin_roster import AdminRoster
from cc_platform.domain.people.availability import AnalystAvailability
from cc_platform.domain.people.invitation import Invitation
from cc_platform.domain.people.login_account import FailedAttemptCounter, LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.password_reset import PasswordReset
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Staff, StaffRole
from cc_platform.domain.people.team import Team


class StaffRepository(Protocol):
    async def get(self, staff_id: str) -> Staff | None: ...

    async def get_by_email(self, email: str) -> Staff | None:
        """``email`` must already be normalised (``normalize_email``)."""
        ...

    async def list(self, *, role: StaffRole | None = None) -> list[Staff]:
        """All staff (active or not) ordered by name, optionally filtered by role."""
        ...

    async def get_by_creation_key(self, key: str) -> Staff | None:
        """The person created with that ``Idempotency-Key`` (slice 4 §3.9)."""
        ...

    async def add(self, staff: Staff) -> None:
        """Insert. A used email raises ``EmailTakenError``; a used creation key raises
        ``ConcurrentUpdateError`` (a concurrent replay: retry and find it)."""
        ...

    async def save(self, staff: Staff) -> None:
        """Compare-and-set on ``version``; an email used by someone else raises
        ``EmailTakenError``."""
        ...


class TeamRepository(Protocol):
    async def get(self, team_id: str) -> Team | None: ...

    async def get_many(self, team_ids: Collection[str]) -> dict[str, Team]: ...

    async def get_by_creation_key(self, key: str) -> Team | None: ...

    async def list(self) -> list[Team]:
        """Every team, by ``name_key`` then id."""
        ...

    async def add(self, team: Team) -> None:
        """Insert. A used ``name_key`` raises ``TeamNameTakenError``; a used creation key
        raises ``ConcurrentUpdateError``."""
        ...

    async def save(self, team: Team) -> None:
        """Compare-and-set on ``version``; a ``name_key`` used by another team raises
        ``TeamNameTakenError``."""
        ...


class AdminRosterRepository(Protocol):
    async def get(self) -> AdminRoster | None: ...

    async def add(self, roster: AdminRoster) -> None:
        """Insert the singleton; a concurrent insert raises ``ConcurrentUpdateError``."""
        ...

    async def save(self, roster: AdminRoster) -> None: ...


class LoginAccountRepository(Protocol):
    async def get(self, staff_id: str) -> LoginAccount | None: ...

    async def list(self) -> list[LoginAccount]: ...

    async def add(self, account: LoginAccount) -> None: ...

    async def save(self, account: LoginAccount) -> None: ...


class MfaChallengeRepository(Protocol):
    async def get(self, challenge_id: str) -> MfaChallenge | None: ...

    async def list_pending_for(self, staff_id: str, now: datetime) -> list[MfaChallenge]:
        """``staff_id``'s open challenges (``pending``, ``expires_at > now``)."""
        ...

    async def add(self, challenge: MfaChallenge) -> None: ...

    async def save(self, challenge: MfaChallenge) -> None: ...


class StaffSessionRepository(Protocol):
    async def get(self, session_id: str) -> StaffSession | None: ...

    async def active_staff_ids(self, now: datetime) -> set[str]:
        """Staff with at least one active session (not ended, ``expires_at > now``)."""
        ...

    async def list_active_for(self, staff_id: str, now: datetime) -> list[StaffSession]:
        """``staff_id``'s active sessions (not ended, ``expires_at > now``)."""
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


class InvitationRepository(Protocol):
    """Part 4. One invitation per person (``staff_id`` unique)."""

    async def get(self, invitation_id: str) -> Invitation | None: ...

    async def get_for_staff(self, staff_id: str) -> Invitation | None: ...

    async def get_by_token_hash(self, token_hash: str) -> Invitation | None: ...

    async def list(self) -> list[Invitation]: ...

    async def add(self, invitation: Invitation) -> None:
        """Insert; a second invitation for the same person raises ``ConcurrentUpdateError``
        (two concurrent creates: retry and find it)."""
        ...

    async def save(self, invitation: Invitation) -> None: ...


class PasswordResetRepository(Protocol):
    """Part 4. One reset link per person (``staff_id`` unique; a new link replaces it)."""

    async def get_for_staff(self, staff_id: str) -> PasswordReset | None: ...

    async def get_by_token_hash(self, token_hash: str) -> PasswordReset | None: ...

    async def add(self, reset: PasswordReset) -> None:
        """Insert; a concurrent insert for the same person raises ``ConcurrentUpdateError``."""
        ...

    async def save(self, reset: PasswordReset) -> None: ...
