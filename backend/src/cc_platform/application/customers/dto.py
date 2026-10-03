"""Outputs of the customers use cases (simulator picker and customer sessions)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.domain.cases.values import CaseChannel, CustomerConversationStatus
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale
from cc_platform.domain.people.staff import Language


@dataclass(frozen=True, slots=True)
class OpenConversationView:
    case_id: str
    channel: CaseChannel
    status: CustomerConversationStatus


@dataclass(frozen=True, slots=True)
class DemoCustomerView:
    id: str
    display_name: str
    locale: CustomerLocale
    language: Language
    country: CountryCode
    city: str
    suggestions: tuple[str, ...]
    open_conversation: OpenConversationView | None
    closed_conversation_count: int


@dataclass(frozen=True, slots=True)
class CustomerSelfView:
    id: str
    display_name: str
    locale: CustomerLocale
    language: Language


@dataclass(frozen=True, slots=True)
class CustomerSessionGrant:
    token: str
    expires_at: datetime
    customer: CustomerSelfView
    channel: CaseChannel
