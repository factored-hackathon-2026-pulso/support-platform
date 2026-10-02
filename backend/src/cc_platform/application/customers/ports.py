"""Ports of the customers context: the masked directory and customer session tokens."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from cc_platform.domain.cases.values import CaseChannel
from cc_platform.domain.customers.customer import Customer


class CustomerRepository(Protocol):
    """Masked customer read model (seeded; no use case writes it in slice 1)."""

    async def get(self, customer_id: str) -> Customer | None: ...

    async def get_many(self, customer_ids: Collection[str]) -> dict[str, Customer]: ...

    async def list(self) -> list[Customer]:
        """All customers ordered by id."""
        ...

    async def add(self, customer: Customer) -> None: ...


@dataclass(frozen=True, slots=True)
class CustomerSessionClaims:
    session_id: str
    customer_id: str
    channel: CaseChannel
    issued_at: datetime
    expires_at: datetime


class CustomerTokenService(Protocol):
    """Signed customer tokens. A separate audience from staff tokens: neither kind is
    accepted where the other is expected."""

    def issue(self, claims: CustomerSessionClaims) -> str: ...

    def read(self, token: str) -> CustomerSessionClaims:
        """Verify signature and audience (not expiry: the use case checks it against the
        ``Clock``). Raises ``AuthenticationRequiredError`` on any failure."""
        ...
