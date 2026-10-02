"""Process-local storage shared by every ``InMemoryUnitOfWork`` of one container."""

from __future__ import annotations

from dataclasses import dataclass, field

from cc_platform.application.events import StoredEvent
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Staff


@dataclass
class InMemoryStore:
    staff: dict[str, Staff] = field(default_factory=dict)
    login_accounts: dict[str, LoginAccount] = field(default_factory=dict)
    mfa_challenges: dict[str, MfaChallenge] = field(default_factory=dict)
    sessions: dict[str, StaffSession] = field(default_factory=dict)
    events: list[StoredEvent] = field(default_factory=list)
