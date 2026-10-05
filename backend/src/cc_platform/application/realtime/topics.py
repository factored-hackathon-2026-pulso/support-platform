"""Realtime topics and who may subscribe to them.

Topics (brief §4.4):

- ``case:<CASE-id>``: everything that happens in one case (turns, status, reads, close).
- ``inbox:<STF-id>``: the case list of one staff member (assignment changes, new cases).
- ``customer:<CUS-id>``: one customer's own conversation (customer chat simulator); only
  that customer's token may subscribe, never staff.

- ``supervision:queues``: the language queues (``queue.updated``, ``queue.case_queued``);
  supervisors only.
- ``supervision:team``: rows of "Equipo y colas" that may have changed (``team.updated``);
  supervisors only.
- ``supervision:escalations``: escalations to supervision (``escalation.updated``, slice 9);
  supervisors only.
- ``admin:directory``: people and teams of the directory that may have changed
  (``directory.updated``); admins only (slice 4).
- ``staff:<STF-id>``: one person's own profile and roles (``me.updated``); only that person,
  whatever her roles (slice 4).
- ``platform:settings``: the platform-wide settings (``platform.updated``, the AI switch,
  slice 18); every staff member and every customer session may follow it.
- ``ai:stages``: a case type changed stage (``ai.stage_updated``, slice 21); analysts and
  supervisors (never customers).

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
    CUSTOMER = "customer"
    SUPERVISION = "supervision"
    ADMIN = "admin"
    STAFF = "staff"
    PLATFORM = "platform"
    AI = "ai"


_KEY_PREFIX: dict[TopicKind, IdPrefix] = {
    TopicKind.CASE: IdPrefix.CASE,
    TopicKind.INBOX: IdPrefix.STAFF,
    TopicKind.CUSTOMER: IdPrefix.CUSTOMER,
    TopicKind.STAFF: IdPrefix.STAFF,
}

SUPERVISION_QUEUES = "queues"
SUPERVISION_TEAM = "team"
SUPERVISION_ESCALATIONS = "escalations"
_SUPERVISION_KEYS = frozenset({SUPERVISION_QUEUES, SUPERVISION_TEAM, SUPERVISION_ESCALATIONS})
ADMIN_DIRECTORY = "directory"
PLATFORM_SETTINGS = "settings"
AI_STAGES = "stages"


@dataclass(frozen=True, slots=True)
class Topic:
    kind: TopicKind
    key: str

    def __str__(self) -> str:
        return f"{self.kind.value}:{self.key}"

    @classmethod
    def case(cls, case_id: str) -> Topic:
        return cls(TopicKind.CASE, case_id)

    @classmethod
    def inbox(cls, staff_id: str) -> Topic:
        return cls(TopicKind.INBOX, staff_id)

    @classmethod
    def customer(cls, customer_id: str) -> Topic:
        return cls(TopicKind.CUSTOMER, customer_id)

    @classmethod
    def supervision_queues(cls) -> Topic:
        return cls(TopicKind.SUPERVISION, SUPERVISION_QUEUES)

    @classmethod
    def supervision_team(cls) -> Topic:
        return cls(TopicKind.SUPERVISION, SUPERVISION_TEAM)

    @classmethod
    def supervision_escalations(cls) -> Topic:
        return cls(TopicKind.SUPERVISION, SUPERVISION_ESCALATIONS)

    @classmethod
    def admin_directory(cls) -> Topic:
        return cls(TopicKind.ADMIN, ADMIN_DIRECTORY)

    @classmethod
    def staff(cls, staff_id: str) -> Topic:
        return cls(TopicKind.STAFF, staff_id)

    @classmethod
    def platform_settings(cls) -> Topic:
        return cls(TopicKind.PLATFORM, PLATFORM_SETTINGS)

    @classmethod
    def ai_stages(cls) -> Topic:
        return cls(TopicKind.AI, AI_STAGES)

    @classmethod
    def parse(cls, raw: str) -> Topic:
        name, sep, key = raw.partition(":")
        try:
            kind = TopicKind(name)
        except ValueError:
            raise InvalidTopicError(topic=raw) from None
        if kind is TopicKind.SUPERVISION:
            valid = key in _SUPERVISION_KEYS
        elif kind is TopicKind.ADMIN:
            valid = key == ADMIN_DIRECTORY
        elif kind is TopicKind.PLATFORM:
            valid = key == PLATFORM_SETTINGS
        elif kind is TopicKind.AI:
            valid = key == AI_STAGES
        else:
            valid = is_valid_id(key, _KEY_PREFIX[kind])
        if not sep or not valid:
            raise InvalidTopicError(topic=raw)
        return cls(kind, key)


@dataclass(frozen=True, slots=True)
class TopicAccessPolicy:
    """Who may listen to what (role checks; the case-level check is async, see above)."""

    def can_subscribe(self, actor: Actor, topic: Topic) -> bool:  # noqa: PLR0911 - one per kind
        match topic.kind:
            case TopicKind.CASE:
                return actor.has_any_role({StaffRole.ANALYST, StaffRole.SUPERVISOR})
            case TopicKind.INBOX:
                return topic.key == actor.staff_id or actor.has_any_role({StaffRole.SUPERVISOR})
            case TopicKind.CUSTOMER:
                return False  # a customer's own channel; staff follow ``case:`` instead
            case TopicKind.SUPERVISION:
                return actor.has_any_role({StaffRole.SUPERVISOR})
            case TopicKind.ADMIN:
                return actor.has_any_role({StaffRole.ADMIN})
            case TopicKind.STAFF:
                return topic.key == actor.staff_id
            case TopicKind.PLATFORM:
                return True  # the AI switch: everyone who is signed in
            case TopicKind.AI:
                return actor.has_any_role({StaffRole.ANALYST, StaffRole.SUPERVISOR})

    def can_customer_subscribe(self, customer: CustomerActor, topic: Topic) -> bool:
        """A customer token may only follow its own ``customer:<id>`` topic and the platform
        settings (slice 18: the simulator follows the AI switch)."""
        if topic.kind is TopicKind.PLATFORM:
            return True
        return topic.kind is TopicKind.CUSTOMER and topic.key == customer.customer_id
