"""``Customer``: masked read model of a bank customer (never written by use cases yet).

Only what the platform may show to the person attending: display name, segment, location,
locale and document type (no document number, phone or email). Slice 2 adds the customer
file (products, complaints, contacts, who saw what). ``simulator`` marks the invented
customers listed in the customer chat simulator, with opener ``suggestions`` written in the
customer's own voice and locale.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


class CustomerSegment(StrEnum):
    BASIC = "Basic"
    PLUS = "Plus"
    PREMIUM = "Premium"


class CountryCode(StrEnum):
    CO = "CO"
    MX = "MX"
    AR = "AR"
    BR = "BR"


class CustomerLocale(StrEnum):
    ES_CO = "es-CO"
    ES_MX = "es-MX"
    ES_AR = "es-AR"
    PT_BR = "pt-BR"

    @property
    def language(self) -> Language:
        return Language.PORTUGUESE if self is CustomerLocale.PT_BR else Language.SPANISH


@dataclass(frozen=True, slots=True)
class Customer:
    id: str
    display_name: str
    segment: CustomerSegment
    country: CountryCode
    city: str
    locale: CustomerLocale
    customer_since: date
    document_type: str
    simulator: bool = False
    suggestions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.CUSTOMER)
        if not self.display_name.strip():
            raise InvalidValueError("customer name must not be empty", field="display_name")

    @property
    def language(self) -> Language:
        """Conversation language (no detection in slice 1: the profile decides)."""
        return self.locale.language

    @property
    def first_name(self) -> str:
        return self.display_name.split()[0]
