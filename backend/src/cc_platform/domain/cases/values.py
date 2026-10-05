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


class CaseType(StrEnum):
    """What the case is about (slice 18, ADR 0006): the AI matures per case type.

    The values are the dataset's complaint subcategories (``complaints.subcategory`` in
    data-lab; names from its aggregate report ``reports/demand/complaints_by_subcategory.csv``,
    never from records) plus ``none`` (the dataset's ``(null)`` subcategory, and every case
    when it opens). ``virtual_card`` ("Tarjeta virtual") is **team-generated**: a new product
    the demo shows maturing from zero; it is not in the dataset.
    """

    NONE = "none"
    UNRECOGNIZED_CHARGE = "unrecognized_charge"
    """"Cargo no reconocido" (dataset category Transactions)."""
    UNDUE_CHARGE = "undue_charge"
    """"Cobro indebido" (dataset category Fees)."""
    APP_ISSUE = "app_issue"
    """"Problema con app" (dataset category Technical)."""
    BRANCH_SERVICE = "branch_service"
    """"Atención en sucursal" (dataset category Branch)."""
    SERVICE_QUALITY = "service_quality"
    """"Calidad de servicio" (dataset category Service)."""
    VIRTUAL_CARD = "virtual_card"
    """"Tarjeta virtual": team-generated (a new product, not a dataset subcategory)."""


class CaseStatus(StrEnum):
    """Stored state machine of a case (see ``Case``)."""

    QUEUED = "queued"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"
    WITH_ASSISTANT = "with_assistant"
    """ADR 0003: the agent (agent-core) is handling the conversation. Nobody holds the case, it
    is in no queue and in no inbox, and no first-response SLA runs. It leaves this state when
    the agent resolves it (``closed``) or hands it to people (``queued``)."""


#: Statuses in which a case is open and not yet closed, whoever holds it (an agent included).
OPEN_STATUSES: frozenset[CaseStatus] = frozenset(
    {
        CaseStatus.QUEUED,
        CaseStatus.WITH_ASSISTANT,
        CaseStatus.ASSIGNED,
        CaseStatus.IN_PROGRESS,
    }
)

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
    ASSISTANT = "assistant"
    """ADR 0003: the agent (agent-core). Its turns are public; ``author_id`` is the agent that
    answered (``id@version``). Never a first response of the SLA, which is a person's."""

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


class StaffLineKind(StrEnum):
    """Slice 23c: what a staff-only transcript line (a ``routing`` turn) says. The turn keeps
    the facts (``StaffLine``: this kind and its parameters) next to its stored Spanish text,
    so each viewer's UI writes the sentence in her own language."""

    ASSIGNED_ON_ARRIVAL = "assigned_on_arrival"
    ASSIGNED_FROM_ASSISTANT = "assigned_from_assistant"
    QUEUED = "queued"
    ASSIGNED_FROM_QUEUE = "assigned_from_queue"
    WROTE_AGAIN = "wrote_again"
    ASSIGNED_BY_SUPERVISION = "assigned_by_supervision"
    REASSIGNED = "reassigned"
    ESCALATED = "escalated"
    ESCALATION_WITHDRAWN = "escalation_withdrawn"
    ESCALATION_ANSWERED = "escalation_answered"
    ESCALATION_TAKEN = "escalation_taken"
    ASSISTANT_RELEASED = "assistant_released"
    FOLLOW_UP_CALL = "follow_up_call"


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
    ASSISTANT_HANDOFF = "assistant_handoff"
    """ADR 0003: the agent escalated (or failed) and the case was placed like a new arrival."""


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
    WITH_ASSISTANT = "with_assistant"
    """ADR 0003: the automated assistant answers. Here "agent" keeps meaning a person
    (``with_agent``); the assistant has its own value."""
    CLOSED = "closed"

    @classmethod
    def of(cls, status: CaseStatus) -> CustomerConversationStatus:
        if status is CaseStatus.CLOSED:
            return cls.CLOSED
        if status is CaseStatus.QUEUED:
            return cls.WAITING_AGENT
        if status is CaseStatus.WITH_ASSISTANT:
            return cls.WITH_ASSISTANT
        return cls.WITH_AGENT


class CustomerTurnAuthor(StrEnum):
    """Customer-facing author of a turn."""

    CUSTOMER = "customer"
    ANALYST = "analyst"
    SYSTEM = "system"
    ASSISTANT = "assistant"

    @classmethod
    def of(cls, role: TurnAuthorRole) -> CustomerTurnAuthor:
        return cls(role.value)
