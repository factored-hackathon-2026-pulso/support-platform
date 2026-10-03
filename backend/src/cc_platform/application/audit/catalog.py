"""Audit catalog (slice 3 contract §5.3): the one place that says, for every event type the
platform emits, its family, whether it changes something, and a Spanish description.

Descriptions read like the "Qué hizo" column of the audit log: the actor is shown next to
them, so they start with a verb ("Asignó el caso a Daniela Ríos…"). Names come from a
lookup (``AuditNames``); times are never written into them (the UI shows times in the
viewer's zone). An unknown type falls back to "Evento {event_type}" in the ``other``
family; a test runs ``describe`` over every emitted type and fails on that fallback.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from cc_platform.application.cases import copy
from cc_platform.application.events import StoredEvent
from cc_platform.domain.cases.values import LANGUAGE_RULE_ID, AssignmentReason, CloseReason
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.json import JsonObject


class AuditFamily(StrEnum):
    CONVERSATION = "conversation"
    ASSIGNMENT = "assignment"
    LIFECYCLE = "lifecycle"
    AVAILABILITY = "availability"
    ACCESS = "access"
    OTHER = "other"


#: Family of each known event type (anything else is ``other``).
FAMILY: Mapping[str, AuditFamily] = {
    "case.opened": AuditFamily.LIFECYCLE,
    "case.queued": AuditFamily.ASSIGNMENT,
    "case.assigned": AuditFamily.ASSIGNMENT,
    "case.status_changed": AuditFamily.LIFECYCLE,
    "case.read": AuditFamily.CONVERSATION,
    "case.first_responded": AuditFamily.CONVERSATION,
    "case.closed": AuditFamily.LIFECYCLE,
    "case.viewed": AuditFamily.ACCESS,
    "turn.created": AuditFamily.CONVERSATION,
    "staff.availability_changed": AuditFamily.AVAILABILITY,
    "customer.session_started": AuditFamily.ACCESS,
    "auth.password_accepted": AuditFamily.ACCESS,
    "auth.mfa_challenge_issued": AuditFamily.ACCESS,
    "auth.login_failed": AuditFamily.ACCESS,
    "auth.mfa_failed": AuditFamily.ACCESS,
    "auth.account_locked": AuditFamily.ACCESS,
    "auth.session_started": AuditFamily.ACCESS,
    "auth.session_ended": AuditFamily.ACCESS,
}

#: Types that change something ("CAMBIO"; "Solo acciones que cambian algo").
CHANGES_STATE: frozenset[str] = frozenset(
    {
        "case.opened",
        "case.queued",
        "case.assigned",
        "case.status_changed",
        "case.closed",
        "staff.availability_changed",
        "auth.account_locked",
    }
)


def family_of(event_type: str) -> AuditFamily:
    return FAMILY.get(event_type, AuditFamily.OTHER)


def types_of(family: AuditFamily) -> frozenset[str]:
    """The known event types of ``family`` (``other`` has none: it is "the rest")."""
    return frozenset(t for t, f in FAMILY.items() if f is family)


@dataclass(frozen=True, slots=True)
class AuditNames:
    """Name lookup for descriptions: staff and customers by id, and each case's language."""

    people: Mapping[str, str] = field(default_factory=dict)
    case_languages: Mapping[str, Language] = field(default_factory=dict)

    def name(self, person_id: object) -> str:
        if not isinstance(person_id, str):
            return "alguien"
        return self.people.get(person_id, person_id)


# ----------------------------------------------------------------------------- helpers
def _text(payload: JsonObject, key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def _int(payload: JsonObject, key: str) -> int | None:
    value = payload.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _language(event: StoredEvent, names: AuditNames) -> Language:
    """The case language (from the lookup; rule ``H1`` only ever applies to Portuguese)."""
    if event.case_id is not None and event.case_id in names.case_languages:
        return names.case_languages[event.case_id]
    raw = _text(event.payload, "language")
    if raw in {lang.value for lang in Language}:
        return Language(raw)
    rule = _text(event.payload, "policy_rule_id")
    return Language.PORTUGUESE if rule == LANGUAGE_RULE_ID else Language.SPANISH


def _queue(language: Language) -> str:
    return copy.in_sentence(copy.QUEUE_LABEL[language])


def _channel_phrase(channel: str | None) -> str:
    return "chat web" if channel == "web_chat" else "chat en la app"


# ----------------------------------------------------------------------------- descriptions
def _case_opened(event: StoredEvent, _names: AuditNames) -> str:
    channel = _channel_phrase(_text(event.payload, "channel"))
    if _text(event.payload, "previous_case_id"):
        return f"Volvió a escribir y abrió un caso nuevo por {channel}"
    return f"Abrió un caso nuevo por {channel}"


def _case_queued(event: StoredEvent, names: AuditNames) -> str:
    language = _language(event, names)
    label = _text(event.payload, "queue_label") or copy.QUEUE_LABEL[language]
    return (
        f"Dejó el caso en la {copy.in_sentence(label)}: nadie disponible habla "
        f"{copy.LANGUAGE_NAME[language]}"
    )


def _case_assigned(event: StoredEvent, names: AuditNames) -> str:
    payload = event.payload
    analyst = names.name(payload.get("assigned_analyst_id"))
    language = _language(event, names)
    reason = _text(payload, "reason")
    previous = payload.get("previous_analyst_id")
    if reason == AssignmentReason.QUEUE_DRAINED.value:
        minutes = copy.queue_wait_minutes(_int(payload, "waited_seconds") or 0)
        text = f"Asignó el caso a {analyst} desde la {_queue(language)} después de {minutes} min"
    elif reason == AssignmentReason.MANUAL.value and previous:
        text = f"Reasignó el caso de {names.name(previous)} a {analyst}"
    elif reason == AssignmentReason.MANUAL.value:
        text = f"Asignó el caso a {analyst} desde la {_queue(language)}"
    else:
        rule = " (regla 3)" if language is Language.PORTUGUESE else ""
        text = (
            f"Asignó el caso a {analyst}: estaba disponible y habla "
            f"{copy.LANGUAGE_NAME[language]}{rule}"
        )
    if payload.get("paused_override") is True:
        text += f" ({analyst} estaba en pausa)"
    return text


_STATUS_REASONS = {
    "opened_by_assignee": "Abrió el caso por primera vez",
    "closed": "El caso pasó a cerrado",
    "reassigned": "El caso volvió a «sin abrir» por la reasignación",
}


def _case_status_changed(event: StoredEvent, _names: AuditNames) -> str:
    return _STATUS_REASONS.get(_text(event.payload, "reason") or "", "Cambió el estado del caso")


def _case_read(event: StoredEvent, _names: AuditNames) -> str:
    return f"Leyó la conversación hasta el mensaje {_int(event.payload, 'read_sequence') or 0}"


def _case_first_responded(event: StoredEvent, _names: AuditNames) -> str:
    minutes = math.ceil((_int(event.payload, "response_seconds") or 0) / 60)
    met = "cumplido" if event.payload.get("sla_met") is True else "vencido"
    return f"Primera respuesta en {minutes} min · SLA {met}"


def _case_closed(event: StoredEvent, _names: AuditNames) -> str:
    raw = _text(event.payload, "reason")
    labels = {reason.value: label for reason, label in copy.CLOSE_REASON_LABEL.items()}
    label = labels.get(raw or "", copy.CLOSE_REASON_LABEL[CloseReason.OTHER])
    return f"Cerró el caso · {label}"


def _case_viewed(_event: StoredEvent, _names: AuditNames) -> str:
    return "Abrió la conversación en modo supervisión (solo lectura)"


def _turn_created(event: StoredEvent, _names: AuditNames) -> str:
    kind = _text(event.payload, "kind")
    if kind == "notice":
        return "La plataforma le envió un aviso al cliente"
    if kind == "routing":
        return "Dejó una nota de asignación para el equipo"
    if _text(event.payload, "author_role") == "customer":
        return "Escribió un mensaje"
    return "Respondió al cliente"


def _availability_changed(event: StoredEvent, _names: AuditNames) -> str:
    to_status = _text(event.payload, "to_status")
    return "Pasó a Disponible" if to_status == "available" else "Pasó a En pausa"


def _customer_session(event: StoredEvent, _names: AuditNames) -> str:
    channel = "web" if _text(event.payload, "channel") == "web_chat" else "app"
    return f"Abrió el chat ({channel})"


def _login_failed(event: StoredEvent, _names: AuditNames) -> str:
    factor = "código" if _text(event.payload, "factor") == "mfa" else "contraseña"
    remaining = _int(event.payload, "remaining_attempts") or 0
    return f"Intento de ingreso fallido ({factor}) · quedan {remaining}"


def _mfa_failed(event: StoredEvent, _names: AuditNames) -> str:
    remaining = _int(event.payload, "remaining_attempts") or 0
    return f"Código de verificación incorrecto · quedan {remaining}"


def _account_locked(event: StoredEvent, _names: AuditNames) -> str:
    raw = _text(event.payload, "locked_until")
    minutes = 0
    if raw is not None:
        locked_until = datetime.fromisoformat(raw)
        minutes = math.ceil((locked_until - event.event_time).total_seconds() / 60)
    attempts = _int(event.payload, "failed_attempts") or 0
    return f"La cuenta quedó bloqueada por {minutes} min tras {attempts} intentos"


def _session_ended(event: StoredEvent, _names: AuditNames) -> str:
    return "Su sesión se revocó" if _text(event.payload, "reason") == "revoked" else "Cerró sesión"


def _fixed(text: str) -> Callable[[StoredEvent, AuditNames], str]:
    return lambda _event, _names: text


_DESCRIBERS: Mapping[str, Callable[[StoredEvent, AuditNames], str]] = {
    "case.opened": _case_opened,
    "case.queued": _case_queued,
    "case.assigned": _case_assigned,
    "case.status_changed": _case_status_changed,
    "case.read": _case_read,
    "case.first_responded": _case_first_responded,
    "case.closed": _case_closed,
    "case.viewed": _case_viewed,
    "turn.created": _turn_created,
    "staff.availability_changed": _availability_changed,
    "customer.session_started": _customer_session,
    "auth.password_accepted": _fixed("Ingresó la contraseña correcta"),
    "auth.mfa_challenge_issued": _fixed("Se le pidió el código de verificación"),
    "auth.login_failed": _login_failed,
    "auth.mfa_failed": _mfa_failed,
    "auth.account_locked": _account_locked,
    "auth.session_started": _fixed("Inició sesión"),
    "auth.session_ended": _session_ended,
}


def fallback_description(event_type: str) -> str:
    return f"Evento {event_type}"


def describe(event: StoredEvent, names: AuditNames) -> str:
    """Spanish "Qué hizo" text of one event (contract §5.3)."""
    describer = _DESCRIBERS.get(event.event_type)
    return describer(event, names) if describer else fallback_description(event.event_type)
