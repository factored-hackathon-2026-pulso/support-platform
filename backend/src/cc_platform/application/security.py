"""Authenticated principal and role-based access control (RBAC).

Every API route declares the roles it allows (brief §4.5) through ``require_roles`` in the
API layer, which delegates to ``ensure_any_role`` here so use cases and the WebSocket
endpoint apply the exact same rule.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.errors import ForbiddenError
from cc_platform.domain.cases.values import CaseChannel
from cc_platform.domain.people.staff import ROLE_PRECEDENCE, StaffRole
from cc_platform.domain.shared.actor import ActorRef, ActorRole


@dataclass(frozen=True, slots=True)
class Actor:
    """A staff member authenticated by a valid, active session."""

    staff_id: str
    name: str
    roles: frozenset[StaffRole]
    session_id: str
    session_expires_at: datetime

    def has_any_role(self, roles: Iterable[StaffRole]) -> bool:
        return not self.roles.isdisjoint(roles)

    def acting_as(self, allowed: Iterable[StaffRole] | None = None) -> ActorRef:
        """Actor reference for events: the highest-precedence role that is also allowed."""
        candidates = self.roles if allowed is None else self.roles.intersection(allowed)
        role = next((r for r in ROLE_PRECEDENCE if r in candidates), None)
        if role is None:
            raise ForbiddenError(r.value for r in (allowed or ()))
        return ActorRef(role=role.actor_role, actor_id=self.staff_id)


@dataclass(frozen=True, slots=True)
class CustomerActor:
    """A customer authenticated by a customer session token (simulator app/web session).

    Only ever sees their own conversation and only turns meant for everyone (rule 2).
    """

    customer_id: str
    display_name: str
    session_id: str
    channel: CaseChannel
    session_expires_at: datetime

    def actor_ref(self) -> ActorRef:
        return ActorRef(role=ActorRole.CUSTOMER, actor_id=self.customer_id)


def ensure_any_role(actor: Actor, allowed: Iterable[StaffRole]) -> None:
    allowed_set = frozenset(allowed)
    if not actor.has_any_role(allowed_set):
        raise ForbiddenError(role.value for role in allowed_set)
