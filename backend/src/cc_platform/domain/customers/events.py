"""Domain events of the customers context."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.shared.events import DomainEvent


@dataclass(frozen=True, kw_only=True, slots=True)
class CustomerSessionStarted(DomainEvent):
    """A customer opened the chat (simulator app/web session). Token material never logged."""

    event_type = "customer.session_started"
    entity = "customer"

    session_id: str
    channel: str
