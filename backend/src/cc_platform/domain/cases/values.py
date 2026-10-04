"""Vocabulary of the cases context (slice 2 contract §2.1).

Enum values are part of the public API (OpenAPI enums the frontend generates types from).
Slice 12: a case opens by chat (app or web), by a phone call (simulated: no telephony) or by
email (simulated: no mail server). There are no routing tiers or bots.
"""

from __future__ import annotations

from enum import StrEnum

from cc_platform.domain.shared.actor import ActorRole


class CaseChannel(StrEnum):
    """How the case opened (slice 12). Later contacts of any channel join the open case (one
    open case per customer), so a chat case may hold a call or an email too.

    ``phone_outbound`` is a case staff opened to call the customer (a follow-up); an outbound
    call placed on an open case keeps that case's channel.
    """

    CHAT_APP = "chat_app"
    CHAT_WEB = "chat_web"
    PHONE_INBOUND = "phone_inbound"
    PHONE_OUTBOUND = "phone_outbound"
    EMAIL = "email"

    @property
    def is_chat(self) -> bool:
        return self in CHAT_CHANNELS


#: The channels a customer chat session can open a case from (the simulator's app and web).
CHAT_CHANNELS: frozenset[CaseChannel] = frozenset({CaseChannel.CHAT_APP, CaseChannel.CHAT_WEB})


class CasePriority(StrEnum):
    """How urgent a case is, as staff judge it (slice 8). The levels follow the dataset's
    ``complaints.priority`` (Low, Medium, High, Critical) plus ``none``: every case opens
    with ``none`` and its analyst or supervision sets it (``ChangeCasePriority``). It does
    not drive the first-response SLA (a fixed target, ``SlaPolicy``)."""

    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class CaseStatus(StrEnum):
    """Stored state machine of a case (see ``Case``)."""

    QUEUED = "queued"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


#: Statuses in which a case sits in its analyst's open inbox (counted as her open load).
OPEN_ASSIGNED_STATUSES: frozenset[CaseStatus] = frozenset(
    {CaseStatus.ASSIGNED, CaseStatus.IN_PROGRESS}
)

#: Statuses the assignee may close a case from.
CLOSABLE_STATUSES: frozenset[CaseStatus] = OPEN_ASSIGNED_STATUSES

#: Statuses in which the assignee may write in the chat.
REPLYABLE_STATUSES: frozenset[CaseStatus] = OPEN_ASSIGNED_STATUSES


class InboxStatus(StrEnum):
    """Bucket of a case in "Casos" (derived from ``CaseStatus``, never stored)."""

    NEW = "new"
    TO_REPLY = "to_reply"
    WAITING = "waiting"
    CLOSED = "closed"


class TurnAuthorRole(StrEnum):
    """Who wrote a turn: the customer, an analyst or the platform (notices, banners)."""

    CUSTOMER = "customer"
    ANALYST = "analyst"
    SYSTEM = "system"

    @property
    def actor_role(self) -> ActorRole:
        return ActorRole(self.value)


class TurnKind(StrEnum):
    """``message`` = chat conversation; ``routing`` = staff-only assignment banner (how the
    case arrived); ``notice`` = platform note. Slice 12: ``transcript`` = a line of a call
    (said by the customer or the analyst, or a ``system`` line when the call is held, resumed
    or ends); ``note`` = an analyst's internal note (staff only); ``email`` = an email of the
    case thread (``subject`` set; from the customer = inbound, from an analyst = outbound)."""

    MESSAGE = "message"
    ROUTING = "routing"
    NOTICE = "notice"
    TRANSCRIPT = "transcript"
    NOTE = "note"
    EMAIL = "email"


class EmailDirection(StrEnum):
    """Slice 12: ``in`` = the customer wrote to the bank; ``out`` = an analyst answered."""

    IN = "in"
    OUT = "out"


#: Turns that are a contact of the conversation for the inbox (last message, unread, "Por
#: responder", first response): chat messages and emails. Call lines are not (the call
#: itself is the contact: answering it is the first response).
CONVERSATION_KINDS: frozenset[TurnKind] = frozenset({TurnKind.MESSAGE, TurnKind.EMAIL})


class TurnAudience(StrEnum):
    """``staff`` turns never reach the customer (REST or socket)."""

    EVERYONE = "everyone"
    STAFF = "staff"


class AssignmentReason(StrEnum):
    """Why a case reached its analyst: on arrival, from the queue when someone became
    available, ``manual`` (a supervisor chose her, from the queue or by reassignment) or
    ``outbound_call`` (she opened it to call the customer, slice 12)."""

    LANGUAGE_LEAST_LOADED = "language_least_loaded"
    QUEUE_DRAINED = "queue_drained"
    MANUAL = "manual"
    OUTBOUND_CALL = "outbound_call"
    """Slice 12: the analyst opened the case herself to call the customer (a follow-up)."""


#: Policy id of rule 3 (data-lab/docs/policies.md): a case only goes to an analyst who speaks its
#: language (a Portuguese case only to a Portuguese speaker).
LANGUAGE_RULE_ID = "H1"


class CloseReason(StrEnum):
    """Why the assignee closed a case. Team-generated list (not from the dataset)."""

    RESOLVED = "resolved"
    CUSTOMER_UNRESPONSIVE = "customer_unresponsive"
    DUPLICATE = "duplicate"
    OUT_OF_SCOPE = "out_of_scope"
    OTHER = "other"


class CustomerConversationStatus(StrEnum):
    """Customer-facing projection of ``CaseStatus``."""

    WAITING_AGENT = "waiting_agent"
    WITH_AGENT = "with_agent"
    CLOSED = "closed"

    @classmethod
    def of(cls, status: CaseStatus) -> CustomerConversationStatus:
        if status is CaseStatus.CLOSED:
            return cls.CLOSED
        if status is CaseStatus.QUEUED:
            return cls.WAITING_AGENT
        return cls.WITH_AGENT


class CustomerTurnAuthor(StrEnum):
    """Customer-facing author of a turn."""

    CUSTOMER = "customer"
    ANALYST = "analyst"
    SYSTEM = "system"

    @classmethod
    def of(cls, role: TurnAuthorRole) -> CustomerTurnAuthor:
        return cls(role.value)
