"""``Customer``: the minimal profile of a person who writes to the bank (seeded read model).

Only what the platform needs to route and greet: display name, locale (which gives the
conversation language), country and city. There is no customer file: no documents,
segments, products or contact data. ``simulator`` marks the invented customers listed first
in the customer chat simulator; ``suggestions`` are opener chips written in the customer's
own voice and locale.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix, require_id


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
    country: CountryCode
    city: str
    locale: CustomerLocale
    simulator: bool = False
    suggestions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        require_id(self.id, IdPrefix.CUSTOMER)
        if not self.display_name.strip():
            raise InvalidValueError("customer name must not be empty", field="display_name")

    @property
    def language(self) -> Language:
        """Conversation language (no detection: the locale decides)."""
        return self.locale.language

    @property
    def first_name(self) -> str:
        return self.display_name.split()[0]
