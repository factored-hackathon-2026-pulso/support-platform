"""Vocabulary of the cases context, aligned with ``contracts/platform_history.json``.

Enum values are part of the public API (OpenAPI enums the frontend generates types from).
"""

from __future__ import annotations

from enum import StrEnum

from cc_platform.domain.shared.actor import ActorRole


class CaseChannel(StrEnum):
    """Contract ``case.channel`` subset (``whatsapp``/``video`` are out of scope)."""

    APP_CHAT = "app_chat"
    WEB_CHAT = "web_chat"
    PHONE = "phone"
    EMAIL = "email"

    @property
    def is_chat(self) -> bool:
        """Only chat works live in slice 1; phone and email are read-only layouts."""
        return self in (CaseChannel.APP_CHAT, CaseChannel.WEB_CHAT)


class ChannelSessionKind(StrEnum):
    """Identity the contact already carried (contract ``identity_check.channel_session``)."""

    APP_SESSION = "app_session"
    WEB_SESSION = "web_session"
    CALLER_NUMBER = "caller_number"
    EMAIL_ADDRESS = "email_address"
    OUTBOUND_CALL = "outbound_call"

    @property
    def verified(self) -> bool:
        """Rule 1: app/web session and a registered caller number identify the customer;
        email and a call the bank makes do not (security questions needed, slice 3)."""
        return self in (
            ChannelSessionKind.APP_SESSION,
            ChannelSessionKind.WEB_SESSION,
            ChannelSessionKind.CALLER_NUMBER,
        )

    @classmethod
    def for_chat(cls, channel: CaseChannel) -> ChannelSessionKind:
        return cls.WEB_SESSION if channel is CaseChannel.WEB_CHAT else cls.APP_SESSION


class CaseOrigin(StrEnum):
    """Who started the case. ``regulator``/``branch``: the bank must call the customer."""

    CUSTOMER = "customer"
    REGULATOR = "regulator"
    BRANCH = "branch"

    @property
    def is_outbound(self) -> bool:
        return self is not CaseOrigin.CUSTOMER


class CaseTopic(StrEnum):
    """Judge taxonomy (contract ``case.topic``). Nullable in slice 1: no judge yet."""

    CONSULTAR_MOVIMIENTOS = "consultar_movimientos"
    CONSULTAR_CARGO = "consultar_cargo"
    DISPUTAR_CARGO = "disputar_cargo"
    COBRO_DUPLICADO = "cobro_duplicado"
    ESTADO_DISPUTA = "estado_disputa"
    FRAUDE_URGENTE = "fraude_urgente"
    HABLAR_CON_HUMANO = "hablar_con_humano"
    FUERA_DE_ALCANCE = "fuera_de_alcance"
    PROBLEMA_APP = "problema_app"


class CasePriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class CaseStatus(StrEnum):
    """Stored state machine of a case (see ``Case``)."""

    ROUTING = "routing"
    QUEUED = "queued"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    IN_CALL = "in_call"
    TO_CALL = "to_call"
    AWAITING_APPROVAL = "awaiting_approval"
    CLOSED = "closed"


#: Statuses in which a case sits in its analyst's inbox (counted as her open load).
OPEN_ASSIGNED_STATUSES: frozenset[CaseStatus] = frozenset(
    {
        CaseStatus.ASSIGNED,
        CaseStatus.IN_PROGRESS,
        CaseStatus.IN_CALL,
        CaseStatus.TO_CALL,
        CaseStatus.AWAITING_APPROVAL,
    }
)

#: Statuses an analyst may close a case from.
CLOSABLE_STATUSES: frozenset[CaseStatus] = frozenset(
    {CaseStatus.ASSIGNED, CaseStatus.IN_PROGRESS, CaseStatus.IN_CALL, CaseStatus.TO_CALL}
)

#: Statuses in which the assignee may write in the chat.
REPLYABLE_STATUSES: frozenset[CaseStatus] = frozenset({CaseStatus.ASSIGNED, CaseStatus.IN_PROGRESS})


class InboxStatus(StrEnum):
    """Canvas bucket of a case in "Casos" (derived from ``CaseStatus``, never stored)."""

    NEW = "new"
    TO_REPLY = "to_reply"
    LIVE = "live"
    TO_CALL = "to_call"
    WAITING = "waiting"


class TurnAuthorRole(StrEnum):
    """Contract ``turn.author_role``."""

    CUSTOMER = "customer"
    ANALYST = "analyst"
    SYSTEM = "system"
    TREE = "tree"
    JUDGE = "judge"
    AI_AGENT = "ai_agent"
    COPILOT = "copilot"

    @property
    def actor_role(self) -> ActorRole:
        return ActorRole(self.value)

    @property
    def is_bot(self) -> bool:
        return self in (TurnAuthorRole.TREE, TurnAuthorRole.JUDGE, TurnAuthorRole.AI_AGENT)


class TurnKind(StrEnum):
    """``message`` = conversation; ``routing`` = staff banner on how the case arrived;
    ``notice`` = platform note. Slice 3 adds ``action`` (verified tool-call cards)."""

    MESSAGE = "message"
    ROUTING = "routing"
    NOTICE = "notice"


class TurnAudience(StrEnum):
    """``staff`` turns never reach the customer (REST or socket)."""

    EVERYONE = "everyone"
    STAFF = "staff"


class AssignmentReason(StrEnum):
    LANGUAGE_LEAST_LOADED = "language_least_loaded"
    QUEUE_DRAINED = "queue_drained"
    OUTBOUND_FOLLOWUP = "outbound_followup"


class ContactReason(StrEnum):
    """Contract ``case_close.contact_reason`` (the bank's own Spanish values)."""

    TRANSACCIONAL = "Transaccional"
    QUEJA = "Queja"
    PRODUCTO = "Producto"
    RETENCION = "Retención"
    TECNICO = "Técnico"
    COMERCIAL = "Comercial"


class ResolutionCode(StrEnum):
    """Contract ``case_close.resolution_code`` (the five "Qué se hizo" phrases)."""

    ADJUSTMENT = "adjustment"
    ESCALATED_TO_AREA = "escalated_to_area"
    EXPLAINED = "explained"
    COMPENSATION = "compensation"
    CORRECTION = "correction"


class FollowUp(StrEnum):
    """Close dialog "Seguimiento"; the server turns it into ``followup_at``."""

    NONE = "none"
    TOMORROW = "tomorrow"
    IN_TWO_DAYS = "in_two_days"


class CustomerConversationStatus(StrEnum):
    """Customer-facing projection of ``CaseStatus``."""

    WAITING_AGENT = "waiting_agent"
    WITH_AGENT = "with_agent"
    CLOSED = "closed"

    @classmethod
    def of(cls, status: CaseStatus) -> CustomerConversationStatus:
        if status is CaseStatus.CLOSED:
            return cls.CLOSED
        if status in (CaseStatus.ROUTING, CaseStatus.QUEUED):
            return cls.WAITING_AGENT
        return cls.WITH_AGENT


class CustomerTurnAuthor(StrEnum):
    """Customer-facing author: automated tiers are shown as one "bot"."""

    CUSTOMER = "customer"
    ANALYST = "analyst"
    BOT = "bot"
    SYSTEM = "system"

    @classmethod
    def of(cls, role: TurnAuthorRole) -> CustomerTurnAuthor:
        if role is TurnAuthorRole.CUSTOMER:
            return cls.CUSTOMER
        if role is TurnAuthorRole.ANALYST:
            return cls.ANALYST
        if role.is_bot:
            return cls.BOT
        return cls.SYSTEM
