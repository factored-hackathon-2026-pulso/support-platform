"""Realtime topics and who may subscribe to them.

Topics (brief §4.4):

- ``case:<CASE-id>``: everything that happens in one case (turns, tool calls, approvals...).
- ``inbox:<STF-id>``: the case list of one staff member (assignment changes, new cases).
- ``approvals``: the supervisors' approval queue ("Por aprobar").
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from cc_platform.application.errors import InvalidTopicError
from cc_platform.application.security import Actor
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id


class TopicKind(StrEnum):
    CASE = "case"
    INBOX = "inbox"
    APPROVALS = "approvals"


_KEY_PREFIX: dict[TopicKind, IdPrefix] = {
    TopicKind.CASE: IdPrefix.CASE,
    TopicKind.INBOX: IdPrefix.STAFF,
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
    """Who may listen to what. Case-level checks (assignment, team) arrive with ``cases``."""

    def can_subscribe(self, actor: Actor, topic: Topic) -> bool:
        match topic.kind:
            case TopicKind.CASE:
                return actor.has_any_role({StaffRole.ANALYST, StaffRole.SUPERVISOR})
            case TopicKind.INBOX:
                return topic.key == actor.staff_id or actor.has_any_role({StaffRole.SUPERVISOR})
            case TopicKind.APPROVALS:
                return actor.has_any_role({StaffRole.SUPERVISOR})
