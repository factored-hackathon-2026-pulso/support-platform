"""Realtime topics and who may subscribe to them.

Topics (brief §4.4):

- ``case:<CASE-id>``: everything that happens in one case (turns, tool calls, approvals...).
- ``inbox:<STF-id>``: the case list of one staff member (assignment changes, new cases).
- ``approvals``: the supervisors' approval queue ("Por aprobar").
- ``customer:<CUS-id>``: one customer's own conversation (customer chat simulator); only
  that customer's token may subscribe, never staff.

``case:`` topics also need a case-level check (assignee or supervisor), which needs the
case: the WebSocket endpoint runs ``AuthorizeCaseSubscription`` after this role check.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from cc_platform.application.errors import InvalidTopicError
from cc_platform.application.security import Actor, CustomerActor
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


class TopicKind(StrEnum):
    CASE = "case"
    INBOX = "inbox"
    APPROVALS = "approvals"
    CUSTOMER = "customer"


_KEY_PREFIX: dict[TopicKind, IdPrefix] = {
    TopicKind.CASE: IdPrefix.CASE,
    TopicKind.INBOX: IdPrefix.STAFF,
    TopicKind.CUSTOMER: IdPrefix.CUSTOMER,
}


@dataclass(frozen=True, slots=True)
class Topic:
    kind: TopicKind
    key: str | None = None

    def __str__(self) -> str:
        return self.kind.value if self.key is None else f"{self.kind.value}:{self.key}"

    @classmethod
    def case(cls, case_id: str) -> Topic:
        return cls(TopicKind.CASE, case_id)

    @classmethod
    def inbox(cls, staff_id: str) -> Topic:
        return cls(TopicKind.INBOX, staff_id)

    @classmethod
    def approvals(cls) -> Topic:
        return cls(TopicKind.APPROVALS)

    @classmethod
    def customer(cls, customer_id: str) -> Topic:
        return cls(TopicKind.CUSTOMER, customer_id)

    @classmethod
    def parse(cls, raw: str) -> Topic:
        name, sep, key = raw.partition(":")
        try:
            kind = TopicKind(name)
        except ValueError:
            raise InvalidTopicError(topic=raw) from None
        expected = _KEY_PREFIX.get(kind)
        if expected is None:
            if sep:
                raise InvalidTopicError(topic=raw)
            return cls(kind)
        if not is_valid_id(key, expected):
            raise InvalidTopicError(topic=raw)
        return cls(kind, key)


@dataclass(frozen=True, slots=True)
class TopicAccessPolicy:
    """Who may listen to what (role checks; the case-level check is async, see above)."""

    def can_subscribe(self, actor: Actor, topic: Topic) -> bool:
        match topic.kind:
            case TopicKind.CASE:
                return actor.has_any_role({StaffRole.ANALYST, StaffRole.SUPERVISOR})
            case TopicKind.INBOX:
                return topic.key == actor.staff_id or actor.has_any_role({StaffRole.SUPERVISOR})
            case TopicKind.APPROVALS:
                return actor.has_any_role({StaffRole.SUPERVISOR})
            case TopicKind.CUSTOMER:
                return False  # a customer's own channel; staff follow ``case:`` instead

    def can_customer_subscribe(self, customer: CustomerActor, topic: Topic) -> bool:
        """A customer token may only follow its own ``customer:<id>`` topic."""
        return topic.kind is TopicKind.CUSTOMER and topic.key == customer.customer_id
