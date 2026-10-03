"""Customers context use cases: the simulator picker and customer sessions.

Every seeded customer is a chat customer and is listed in the picker: the simulator ones
first (fresh customers with opener chips), then everyone else by name.

Customer sessions are stateless signed tokens (audience ``cc-customer``, separate from
staff tokens): ``sub`` = customer id, ``sid`` = ``CSN-…``, ``channel``. There is no
revocation list yet (documented gap); expiry is checked against the ``Clock``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from cc_platform.application.cases.customer_chat import current_case
from cc_platform.application.customers.dto import (
    CustomerSelfView,
    CustomerSessionGrant,
    DemoCustomerView,
    OpenConversationView,
)
from cc_platform.application.customers.ports import CustomerSessionClaims, CustomerTokenService
from cc_platform.application.errors import AuthenticationRequiredError, SessionExpiredError
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import CustomerActor
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import CaseChannel, CustomerConversationStatus
from cc_platform.domain.customers.customer import Customer
from cc_platform.domain.customers.events import CustomerSessionStarted
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


def _open_conversation(case: Case | None) -> OpenConversationView | None:
    if case is None or case.is_closed:
        return None
    return OpenConversationView(
        case_id=case.id, channel=case.channel, status=CustomerConversationStatus.of(case.status)
    )


def _self_view(customer: Customer) -> CustomerSelfView:
    return CustomerSelfView(
        id=customer.id,
        display_name=customer.display_name,
        locale=customer.locale,
        language=customer.language,
    )


@dataclass(frozen=True, slots=True)
class ListDemoCustomers:
    """Simulator customers first (by id), then every other seeded customer by name."""

    uow: UnitOfWorkFactory

    async def execute(self) -> list[DemoCustomerView]:
        views: list[tuple[bool, str, DemoCustomerView]] = []
        async with self.uow() as uow:
            for customer in await uow.customers.list():
                cases = await uow.cases.list_for_customer(customer.id)
                view = DemoCustomerView(
                    id=customer.id,
                    display_name=customer.display_name,
                    locale=customer.locale,
                    language=customer.language,
                    country=customer.country,
                    city=customer.city,
                    suggestions=customer.suggestions,
                    open_conversation=_open_conversation(await current_case(uow, customer.id)),
                    closed_conversation_count=sum(1 for case in cases if case.is_closed),
                )
                order = customer.id if customer.simulator else customer.display_name
                views.append((not customer.simulator, order, view))
        return [view for *_key, view in sorted(views, key=lambda item: (item[0], item[1]))]


@dataclass(frozen=True, slots=True)
class StartCustomerSession:
    uow: UnitOfWorkFactory
    tokens: CustomerTokenService
    clock: Clock
    ids: IdGenerator
    ttl: timedelta

    async def execute(
        self, customer_id: str, channel: CaseChannel | None = None
    ) -> CustomerSessionGrant:
        """Sign in as a seeded customer. While a case is open its channel wins (one open
        case per customer)."""
        now = self.clock.now()
        session_id = self.ids.new_id(IdPrefix.CUSTOMER_SESSION)
        async with self.uow() as uow:
            customer = (
                await uow.customers.get(customer_id)
                if is_valid_id(customer_id, IdPrefix.CUSTOMER)
                else None
            )
            if customer is None:
                raise NotFoundError("No encontramos ese cliente.", customerId=customer_id)
            open_case = _open_conversation(await current_case(uow, customer.id))
            session_channel = (
                open_case.channel if open_case is not None else channel or CaseChannel.APP_CHAT
            )
            uow.record(
                CustomerSessionStarted(
                    occurred_at=now,
                    actor=CustomerActor(
                        customer.id, customer.display_name, session_id, session_channel, now
                    ).actor_ref(),
                    entity_id=customer.id,
                    session_id=session_id,
                    channel=session_channel.value,
                )
            )
            await uow.commit()
        claims = CustomerSessionClaims(
            session_id=session_id,
            customer_id=customer.id,
            channel=session_channel,
            issued_at=now,
            expires_at=now + self.ttl,
        )
        return CustomerSessionGrant(
            token=self.tokens.issue(claims),
            expires_at=claims.expires_at,
            customer=_self_view(customer),
            channel=session_channel,
        )


@dataclass(frozen=True, slots=True)
class AuthenticateCustomer:
    """Resolve a customer token to a ``CustomerActor`` (staff tokens are rejected)."""

    uow: UnitOfWorkFactory
    tokens: CustomerTokenService
    clock: Clock

    async def execute(self, token: str | None) -> CustomerActor:
        if not token:
            raise AuthenticationRequiredError()
        claims = self.tokens.read(token)
        if self.clock.now() >= claims.expires_at:
            raise SessionExpiredError()
        async with self.uow() as uow:
            customer = await uow.customers.get(claims.customer_id)
        if customer is None:
            raise AuthenticationRequiredError()
        return CustomerActor(
            customer_id=customer.id,
            display_name=customer.display_name,
            session_id=claims.session_id,
            channel=claims.channel,
            session_expires_at=claims.expires_at,
        )


@dataclass(frozen=True, slots=True)
class CustomersUseCases:
    list_demo_customers: ListDemoCustomers
    start_session: StartCustomerSession
    authenticate: AuthenticateCustomer
