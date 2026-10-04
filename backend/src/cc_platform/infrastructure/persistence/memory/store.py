"""Process-local storage shared by every ``InMemoryUnitOfWork`` of one container."""

from __future__ import annotations

from dataclasses import dataclass, field

from cc_platform.application.events import StoredEvent
from cc_platform.domain.ai.session import AssistantSession
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.call import Call
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.escalation import Escalation
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.customers.customer import Customer
from cc_platform.domain.notifications.notification import Notification
from cc_platform.domain.people.admin_roster import AdminRoster
from cc_platform.domain.people.availability import AnalystAvailability
from cc_platform.domain.people.invitation import Invitation
from cc_platform.domain.people.login_account import LoginAccount
from cc_platform.domain.people.mfa import MfaChallenge
from cc_platform.domain.people.password_reset import PasswordReset
from cc_platform.domain.people.session import StaffSession
from cc_platform.domain.people.staff import Staff
from cc_platform.domain.people.team import Team


@dataclass
class InMemoryStore:
    staff: dict[str, Staff] = field(default_factory=dict)
    teams: dict[str, Team] = field(default_factory=dict)
    admin_roster: dict[str, AdminRoster] = field(default_factory=dict)
    login_accounts: dict[str, LoginAccount] = field(default_factory=dict)
    mfa_challenges: dict[str, MfaChallenge] = field(default_factory=dict)
    sessions: dict[str, StaffSession] = field(default_factory=dict)
    availability: dict[str, AnalystAvailability] = field(default_factory=dict)
    invitations: dict[str, Invitation] = field(default_factory=dict)
    password_resets: dict[str, PasswordReset] = field(default_factory=dict)
    customers: dict[str, Customer] = field(default_factory=dict)
    cases: dict[str, Case] = field(default_factory=dict)
    turns: dict[str, Turn] = field(default_factory=dict)
    assignments: dict[str, Assignment] = field(default_factory=dict)
    case_slots: dict[str, CustomerCaseSlot] = field(default_factory=dict)
    escalations: dict[str, Escalation] = field(default_factory=dict)
    calls: dict[str, Call] = field(default_factory=dict)
    notifications: dict[str, Notification] = field(default_factory=dict)
    assistant_sessions: dict[str, AssistantSession] = field(default_factory=dict)
    bank_links: dict[str, str] = field(default_factory=dict)
    events: list[StoredEvent] = field(default_factory=list)
