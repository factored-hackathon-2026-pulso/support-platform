"""All use cases of the application, grouped by bounded context (``use_cases.people.login``).

Each context contributes one frozen bundle (``<context>/use_cases.py``); adding a context
adds one field here instead of growing a flat list of dozens of use cases.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ai.use_cases import AssistantUseCases
from cc_platform.application.audit.use_cases import AuditUseCases
from cc_platform.application.cases.use_cases import CasesUseCases, ChannelsUseCases
from cc_platform.application.customers.use_cases import CustomersUseCases
from cc_platform.application.notifications.use_cases import NotificationsUseCases
from cc_platform.application.people.admin.use_cases import AdministrationUseCases
from cc_platform.application.people.onboarding.use_cases import OnboardingUseCases
from cc_platform.application.people.use_cases import PeopleUseCases
from cc_platform.application.platform.use_cases import PlatformUseCases


@dataclass(frozen=True, slots=True)
class UseCases:
    people: PeopleUseCases
    cases: CasesUseCases
    channels: ChannelsUseCases
    customers: CustomersUseCases
    audit: AuditUseCases
    administration: AdministrationUseCases
    notifications: NotificationsUseCases
    onboarding: OnboardingUseCases
    platform: PlatformUseCases
    """Slice 18: the platform-wide settings (the AI switch)."""
    assistant: AssistantUseCases | None = None
    """ADR 0003: ``None`` while agent-core is not configured."""
