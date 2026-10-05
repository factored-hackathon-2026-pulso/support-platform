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
from cc_platform.application.people.admin import copy as admin_copy
from cc_platform.domain.cases.values import (
    LANGUAGE_RULE_ID,
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseType,
    CloseReason,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.json import JsonObject


class AuditFamily(StrEnum):
    CONVERSATION = "conversation"
    ASSIGNMENT = "assignment"
    LIFECYCLE = "lifecycle"
    AVAILABILITY = "availability"
    ACCESS = "access"
    ADMINISTRATION = "administration"
    ESCALATION = "escalation"
    AGENTS = "agents"
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
    "case.rated": AuditFamily.LIFECYCLE,
    "case.priority_changed": AuditFamily.LIFECYCLE,
    "case.type_changed": AuditFamily.LIFECYCLE,
    "case.viewed": AuditFamily.ACCESS,
    "turn.created": AuditFamily.CONVERSATION,
    # the assistant (ADR 0003): agent-core handles a conversation before people do
    "case.assistant_started": AuditFamily.LIFECYCLE,
    "case.assistant_released": AuditFamily.ASSIGNMENT,
    "assistant.session_started": AuditFamily.CONVERSATION,
    "assistant.turn_answered": AuditFamily.CONVERSATION,
    "assistant.input_queued": AuditFamily.CONVERSATION,
    "assistant.step_up_verified": AuditFamily.ACCESS,
    "assistant.step_up_rejected": AuditFamily.ACCESS,
    "assistant.ended": AuditFamily.LIFECYCLE,
    "copilot.query_asked": AuditFamily.CONVERSATION,
    "copilot.answered": AuditFamily.CONVERSATION,
    "copilot.suggestion_requested": AuditFamily.CONVERSATION,
    "copilot.suggestion_ready": AuditFamily.CONVERSATION,
    "copilot.suggestion_none": AuditFamily.CONVERSATION,
    "copilot.suggestion_failed": AuditFamily.CONVERSATION,
    "copilot.suggestion_decided": AuditFamily.CONVERSATION,
    "copilot.tool_used": AuditFamily.CONVERSATION,
    # the agent builder (slice 16): who changed which agent, and who approved and published it
    "builder.proposal_created": AuditFamily.AGENTS,
    "builder.proposal_tracked": AuditFamily.AGENTS,
    "builder.draft_saved": AuditFamily.AGENTS,
    "builder.proposal_validated": AuditFamily.AGENTS,
    "builder.proposal_frozen": AuditFamily.AGENTS,
    "builder.proposal_reopened": AuditFamily.AGENTS,
    "builder.proposal_evaluated": AuditFamily.AGENTS,
    "builder.proposal_approved": AuditFamily.AGENTS,
    "builder.proposal_rejected": AuditFamily.AGENTS,
    "builder.proposal_published": AuditFamily.AGENTS,
    "builder.alias_promoted": AuditFamily.AGENTS,
    "builder.release_revoked": AuditFamily.AGENTS,
    "builder.question_asked": AuditFamily.AGENTS,
    "builder.answered": AuditFamily.AGENTS,
    # escalations to supervision (slice 9)
    "escalation.opened": AuditFamily.ESCALATION,
    "escalation.withdrawn": AuditFamily.ESCALATION,
    "escalation.answered": AuditFamily.ESCALATION,
    "escalation.taken": AuditFamily.ESCALATION,
    "escalation.reassigned": AuditFamily.ESCALATION,
    "escalation.closed": AuditFamily.ESCALATION,
    "escalation.acknowledged": AuditFamily.ESCALATION,
    # simulated phone calls (slice 12): part of the conversation with the customer
    "call.started": AuditFamily.CONVERSATION,
    "call.answered": AuditFamily.CONVERSATION,
    "call.held": AuditFamily.CONVERSATION,
    "call.resumed": AuditFamily.CONVERSATION,
    "call.mute_changed": AuditFamily.CONVERSATION,
    "call.ended": AuditFamily.CONVERSATION,
    "staff.availability_changed": AuditFamily.AVAILABILITY,
    # slice 23: her own settings (the UI language), next to her other self changes
    "staff.ui_language_changed": AuditFamily.ACCESS,
    "customer.session_started": AuditFamily.ACCESS,
    "auth.password_accepted": AuditFamily.ACCESS,
    "auth.mfa_challenge_issued": AuditFamily.ACCESS,
    "auth.login_failed": AuditFamily.ACCESS,
    "auth.mfa_failed": AuditFamily.ACCESS,
    "auth.account_locked": AuditFamily.ACCESS,
    "auth.session_started": AuditFamily.ACCESS,
    "auth.session_ended": AuditFamily.ACCESS,
    # administration (slice 4 §7.1)
    "staff.created": AuditFamily.ADMINISTRATION,
    "staff.profile_updated": AuditFamily.ADMINISTRATION,
    "staff.roles_changed": AuditFamily.ADMINISTRATION,
    "staff.languages_changed": AuditFamily.ADMINISTRATION,
    "staff.team_changed": AuditFamily.ADMINISTRATION,
    "staff.deactivated": AuditFamily.ADMINISTRATION,
    "staff.reactivated": AuditFamily.ADMINISTRATION,
    "staff.account_unlocked": AuditFamily.ADMINISTRATION,
    "team.created": AuditFamily.ADMINISTRATION,
    "team.renamed": AuditFamily.ADMINISTRATION,
    "team.deactivated": AuditFamily.ADMINISTRATION,
    "team.reactivated": AuditFamily.ADMINISTRATION,
    # secure onboarding (part 4): what administration sends…
    "staff.invitation_sent": AuditFamily.ADMINISTRATION,
    "staff.invitation_resent": AuditFamily.ADMINISTRATION,
    "staff.invitation_cancelled": AuditFamily.ADMINISTRATION,
    "staff.password_reset_link_sent": AuditFamily.ADMINISTRATION,
    # the AI maturity per case type (slice 21): the rule advances it, Supervisión moves it back
    "ai.stage_advanced": AuditFamily.AGENTS,
    "ai.stage_moved_back": AuditFamily.AGENTS,
    "ai.agent_ready": AuditFamily.AGENTS,
    "ai.agent_activated": AuditFamily.AGENTS,
    # the AI switch (slice 18): a platform-wide setting of Administración
    "platform.ai_toggled": AuditFamily.ADMINISTRATION,
    # …and what the person does with the link (her own access)
    "staff.invitation_accepted": AuditFamily.ACCESS,
    "staff.mfa_enrolled": AuditFamily.ACCESS,
    "staff.password_reset": AuditFamily.ACCESS,
}

#: Every administration type changes something (slice 4 §7.1).
ADMINISTRATION_TYPES: frozenset[str] = frozenset(
    t for t, f in FAMILY.items() if f is AuditFamily.ADMINISTRATION
)

#: Types that change something ("CAMBIO"; "Solo acciones que cambian algo").
CHANGES_STATE: frozenset[str] = frozenset(
    {
        "case.opened",
        "case.queued",
        "case.assigned",
        "case.status_changed",
        "case.closed",
        "case.rated",
        "case.priority_changed",
        "case.type_changed",
        "case.assistant_started",
        "case.assistant_released",
        "assistant.ended",
        "builder.proposal_created",
        "builder.draft_saved",
        "builder.proposal_frozen",
        "builder.proposal_reopened",
        "builder.proposal_evaluated",
        "builder.proposal_approved",
        "builder.proposal_rejected",
        "builder.proposal_published",
        "builder.alias_promoted",
        "builder.release_revoked",
        "ai.stage_advanced",
        "ai.stage_moved_back",
        "ai.agent_ready",
        "ai.agent_activated",
        "escalation.opened",
        "escalation.withdrawn",
        "escalation.answered",
        "escalation.taken",
        "escalation.reassigned",
        "escalation.closed",
        "call.started",
        "call.answered",
        "call.held",
        "call.resumed",
        "call.mute_changed",
        "call.ended",
        "staff.availability_changed",
        "staff.ui_language_changed",
        "auth.account_locked",
        "staff.invitation_accepted",
        "staff.mfa_enrolled",
        "staff.password_reset",
        *ADMINISTRATION_TYPES,
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


#: Slice 12: how a case opened, inside a sentence ("Abrió un caso nuevo por …").
CHANNEL_PHRASE: Mapping[str, str] = {
    CaseChannel.CHAT_APP.value: "chat en la app",
    CaseChannel.CHAT_WEB.value: "chat web",
    CaseChannel.PHONE_INBOUND.value: "llamada entrante",
    CaseChannel.PHONE_OUTBOUND.value: "llamada saliente",
    CaseChannel.EMAIL.value: "correo",
}


def _channel_phrase(channel: str | None) -> str:
    return CHANNEL_PHRASE.get(channel or "", CHANNEL_PHRASE[CaseChannel.CHAT_APP.value])


# ----------------------------------------------------------------------------- descriptions
def _case_opened(event: StoredEvent, _names: AuditNames) -> str:
    raw = _text(event.payload, "channel")
    channel = _channel_phrase(raw)
    if raw == CaseChannel.PHONE_OUTBOUND.value:  # slice 12: an analyst's follow-up
        return "Abrió un caso de seguimiento para llamar al cliente"
    if _text(event.payload, "previous_case_id"):
        verb = "Volvió a llamar" if raw == CaseChannel.PHONE_INBOUND.value else "Volvió a escribir"
        return f"{verb} y abrió un caso nuevo por {channel}"
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
    if reason == AssignmentReason.OUTBOUND_CALL.value:  # slice 12: she called the customer
        return "Se asignó el caso para hacer una llamada de seguimiento"
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


#: Slice 7: the 1–4 scale in words (the frontend uses the same ones, ``RATING_SCALE``).
RATING_LABEL: Mapping[int, str] = {1: "Mal", 2: "Regular", 3: "Bien", 4: "Excelente"}


def _case_rated(event: StoredEvent, _names: AuditNames) -> str:
    """Never the comment (privacy, like message text): only the score."""
    score = _int(event.payload, "score")
    label = RATING_LABEL.get(score or 0)
    return f"El cliente calificó el caso: {label}" if label else "El cliente calificó el caso"


#: Slice 8: the priority levels in words (the frontend uses the same ones, ``CASE_PRIORITY``).
PRIORITY_LABEL: Mapping[str, str] = {
    CasePriority.NONE.value: "Sin prioridad",
    CasePriority.LOW.value: "Baja",
    CasePriority.MEDIUM.value: "Media",
    CasePriority.HIGH.value: "Alta",
    CasePriority.CRITICAL.value: "Crítica",
}


def _case_priority_changed(event: StoredEvent, _names: AuditNames) -> str:
    """Next to the actor: "Daniela Ríos · Cambió la prioridad a Alta"."""
    to = _text(event.payload, "to")
    if to == CasePriority.NONE.value:
        return "Quitó la prioridad"
    label = PRIORITY_LABEL.get(to or "")
    return f"Cambió la prioridad a {label}" if label else "Cambió la prioridad"


#: Slice 18: the case types in words (the frontend uses the same ones, ``CASE_TYPE``). The
#: names are the dataset's complaint subcategories; "Tarjeta virtual" is team-generated.
CASE_TYPE_LABEL: Mapping[str, str] = {
    CaseType.NONE.value: "Sin tipo",
    CaseType.UNRECOGNIZED_CHARGE.value: "Cargo no reconocido",
    CaseType.UNDUE_CHARGE.value: "Cobro indebido",
    CaseType.APP_ISSUE.value: "Problema con app",
    CaseType.BRANCH_SERVICE.value: "Atención en sucursal",
    CaseType.SERVICE_QUALITY.value: "Calidad de servicio",
    CaseType.VIRTUAL_CARD.value: "Tarjeta virtual",
}


def _case_type_changed(event: StoredEvent, _names: AuditNames) -> str:
    """Next to the actor: "Daniela Ríos · Cambió el tipo de caso a Cobro indebido"."""
    to = _text(event.payload, "to")
    if to == CaseType.NONE.value:
        return "Quitó el tipo de caso"
    label = CASE_TYPE_LABEL.get(to or "")
    return f"Cambió el tipo de caso a {label}" if label else "Cambió el tipo de caso"


def _escalation_taken(event: StoredEvent, names: AuditNames) -> str:
    """Next to the supervisor: "Felipe Echeverri · Tomó el caso escalado de Daniela Ríos"."""
    return f"Tomó el caso escalado de {names.name(event.payload.get('previous_analyst_id'))}"


def _escalation_reassigned(event: StoredEvent, names: AuditNames) -> str:
    previous = names.name(event.payload.get("previous_analyst_id"))
    return (
        f"Reasignó el caso escalado de {previous} a {names.name(event.payload.get('analyst_id'))}"
    )


def _case_viewed(_event: StoredEvent, _names: AuditNames) -> str:
    return "Abrió la conversación en modo supervisión (solo lectura)"


#: ``turn.created`` by (kind, author role); ``None`` = any author. Slice 12 adds call lines,
#: internal notes (staff only) and emails.
_TURN_TEXT: Mapping[tuple[str, str | None], str] = {
    ("notice", None): "La plataforma le envió un aviso al cliente",
    ("routing", None): "Dejó una nota de asignación para el equipo",
    ("note", None): "Dejó una nota interna para el equipo",
    ("email", "customer"): "Envió un correo",
    ("email", None): "Respondió por correo",
    ("transcript", "system"): "Anotó un cambio de la llamada en la transcripción",
    ("transcript", None): "Habló en la llamada",
    ("message", "customer"): "Escribió un mensaje",
    ("message", "assistant"): "Respondió al cliente (asistente)",
}


def _turn_created(event: StoredEvent, _names: AuditNames) -> str:
    kind = _text(event.payload, "kind") or "message"
    role = _text(event.payload, "author_role")
    return _TURN_TEXT.get((kind, role)) or _TURN_TEXT.get((kind, None)) or "Respondió al cliente"


# ----------------------------------------------------------------------------- assistant
#: ``case.assistant_released`` by reason (never a message text or a handoff's content).
_RELEASE_TEXT: Mapping[str, str] = {
    "escalated": "El asistente escaló el caso a una persona",
    "ended": "El asistente terminó su atención sin resolver el caso",
    "failed": "El asistente no pudo seguir y el caso pasó a una persona",
    "supervision": "Tomó el caso del asistente",
    "customer_request": "Pidió hablar con una persona",
    "ai_disabled": "El caso pasó a una persona porque se apagaron las funciones de IA",
}

_ASSISTANT_END_TEXT: Mapping[str, str] = {
    "resolved": "El asistente resolvió la conversación",
    "escalated": "El asistente terminó: escaló el caso a una persona",
    "ended": "El asistente terminó su atención sin resolver",
    "failed": "El asistente dejó de atender por una falla",
    "released": "La atención del asistente terminó: el caso pasó a una persona",
}


def _assistant_released(event: StoredEvent, _names: AuditNames) -> str:
    return _RELEASE_TEXT.get(_text(event.payload, "reason") or "", "El caso salió del asistente")


def _assistant_ended(event: StoredEvent, _names: AuditNames) -> str:
    return _ASSISTANT_END_TEXT.get(_text(event.payload, "result") or "", "Terminó el asistente")


# --------------------------------------------------------------------------- suggestions (ADR 0005)
_SUGGESTION_DECISION_TEXT: Mapping[str, str] = {
    "used": "Usó el borrador del copiloto tal cual",
    "edited": "Usó el borrador del copiloto con cambios",
    "discarded": "Descartó el borrador del copiloto",
    "ignored": "El borrador del copiloto quedó sin decidir",
}


def _suggestion_decided(event: StoredEvent, _names: AuditNames) -> str:
    if _text(event.payload, "subject") == "escalation":
        return "Escaló el caso con la recomendación del copiloto"
    return _SUGGESTION_DECISION_TEXT.get(
        _text(event.payload, "decision") or "", "Decidió sobre una sugerencia del copiloto"
    )


# --------------------------------------------------------------------------- stages (slice 21)
#: What a case type's copilot does at each stage (ADR 0006 §1); the frontend uses the same words.
STAGE_TEXT: Mapping[int, str] = {
    0: "solo personas",
    1: "el copiloto responde",
    2: "el copiloto propone herramientas",
    3: "el copiloto propone respuestas",
}


def _stage_type(event: StoredEvent) -> str:
    return CASE_TYPE_LABEL.get(_text(event.payload, "case_type") or "", "un tipo de caso")


def _stage(event: StoredEvent) -> str:
    stage = event.payload.get("to_stage")
    if not isinstance(stage, int) or stage not in STAGE_TEXT:
        return "otra etapa"
    return f"la etapa {stage}: {STAGE_TEXT[stage]}"


def _stage_advanced(event: StoredEvent, _names: AuditNames) -> str:
    """By the system: "Subió Cobro indebido a la etapa 3: el copiloto propone respuestas"."""
    return f"Subió {_stage_type(event)} a {_stage(event)}"


def _stage_moved_back(event: StoredEvent, _names: AuditNames) -> str:
    """Next to the supervisor: "Devolvió Problema con app a la etapa 1: el copiloto responde"
    (or, from "ready for an agent" back to stage 3, "Retiró la propuesta de agente de …")."""
    if event.payload.get("from_stage") == event.payload.get("to_stage"):
        return f"Retiró la propuesta de agente de {_stage_type(event)}"
    return f"Devolvió {_stage_type(event)} a {_stage(event)}"


# ----------------------------------------------------------------------------- builder (slice 16)
_VERDICT_TEXT: Mapping[str, str] = {
    "pass": "La evaluación de la propuesta pasó el gate",
    "fail": "La evaluación de la propuesta no pasó el gate: volvió a borrador",
    "failed_infra": "La evaluación de la propuesta falló por la infraestructura",
}


def _builder_validated(event: StoredEvent, _names: AuditNames) -> str:
    count = _int(event.payload, "violations") or 0
    if count == 0:
        return "Validó la propuesta: sin violaciones"
    return f"Validó la propuesta: {count} {'violación' if count == 1 else 'violaciones'}"


def _builder_approved(event: StoredEvent, _names: AuditNames) -> str:
    if (_int(event.payload, "yardstick_loosened") or 0) > 0:
        return "Aprobó la propuesta, aceptando que afloja la vara de evaluación"
    return "Aprobó la propuesta"


def _builder_promoted(event: StoredEvent, _names: AuditNames) -> str:
    alias = _text(event.payload, "alias") or "staging"
    return f"Promovió una versión de un agente a {alias}"


def _builder_evaluated(event: StoredEvent, _names: AuditNames) -> str:
    return _VERDICT_TEXT.get(_text(event.payload, "verdict") or "", "Evaluó la propuesta")


# ----------------------------------------------------------------------------- calls (slice 12)
def _call_started(event: StoredEvent, names: AuditNames) -> str:
    """Next to the actor: "Daniela Ríos · Llamó a Claudia Restrepo Varela"; the reason is
    never shown (only its length)."""
    if _text(event.payload, "direction") == "outbound":
        return f"Llamó a {names.name(event.payload.get('customer_id'))}"
    return "Llamó a la línea de atención"


def _call_answered(event: StoredEvent, _names: AuditNames) -> str:
    if _text(event.payload, "answered_by_role") == "customer":
        return "Contestó la llamada"
    return "Atendió la llamada"


def _call_mute_changed(event: StoredEvent, _names: AuditNames) -> str:
    return "Silenció su micrófono" if event.payload.get("muted") is True else "Activó su micrófono"


def _call_ended(event: StoredEvent, _names: AuditNames) -> str:
    reason = _text(event.payload, "end_reason")
    if reason == "rejected":
        return "Rechazó la llamada"
    if reason == "cancelled":
        return "Colgó antes de que contestaran"
    minutes = copy.queue_wait_minutes(_int(event.payload, "duration_seconds") or 0)
    return f"Terminó la llamada · duró {minutes} min"


def _availability_changed(event: StoredEvent, names: AuditNames) -> str:
    reason = _text(event.payload, "reason")
    if reason == "deactivated":
        return f"Dejó en pausa a {names.name(event.entity_id)} al desactivar su cuenta"
    if reason == "role_removed":
        return f"Dejó en pausa a {names.name(event.entity_id)} al quitarle el rol de Analista"
    to_status = _text(event.payload, "to_status")
    return "Pasó a Disponible" if to_status == "available" else "Pasó a En pausa"


#: Slice 23: each UI language by its own name (as the language menu shows it).
UI_LANGUAGE_NAME: Mapping[str, str] = {"es": "Español", "pt-BR": "Português"}


def _ui_language_changed(event: StoredEvent, _names: AuditNames) -> str:
    to_language = _text(event.payload, "to_language") or ""
    name = UI_LANGUAGE_NAME.get(to_language, to_language)
    return f"Cambió el idioma de la plataforma a {name}"


def _customer_session(event: StoredEvent, _names: AuditNames) -> str:
    channel = "web" if _text(event.payload, "channel") == CaseChannel.CHAT_WEB.value else "app"
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


def _session_ended(event: StoredEvent, names: AuditNames) -> str:
    if _text(event.payload, "reason") != "revoked":
        return "Cerró sesión"
    owner = _text(event.payload, "staff_id")
    if owner is not None and owner != event.actor_id:
        return f"Cerró la sesión de {names.name(owner)}"  # administration ended it
    return "Su sesión se revocó"


# ----------------------------------------------------------------------------- administration
def _strings(payload: JsonObject, key: str) -> list[str]:
    value = payload.get(key)
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _sessions_suffix(event: StoredEvent) -> str:
    revoked = _int(event.payload, "revoked_sessions") or 0
    if revoked == 1:
        return " y cerró su sesión"
    if revoked > 1:
        return f" y cerró sus {revoked} sesiones"
    return ""


def _staff_created(event: StoredEvent, names: AuditNames) -> str:
    person = names.people.get(event.entity_id) or _text(event.payload, "name") or "alguien"
    parts = [f"Creó la cuenta de {person}"]
    roles = admin_copy.join_es(admin_copy.role_labels(_strings(event.payload, "roles")))
    if roles:
        parts.append(roles)
    team = _text(event.payload, "team_name")
    if team:
        parts.append(team)
    return " · ".join(parts)


def _profile_updated(event: StoredEvent, names: AuditNames) -> str:
    fields = set(_strings(event.payload, "changed_fields"))
    before = _text(event.payload, "from_name") or names.name(event.entity_id)
    after = _text(event.payload, "to_name") or names.name(event.entity_id)
    if fields == {"name"}:
        return f"Cambió el nombre de {before} a {after}"
    if fields == {"email"}:
        return f"Cambió el correo de {after}"
    return f"Cambió el nombre y el correo de {after} (antes {before})"


def _roles_changed(event: StoredEvent, names: AuditNames) -> str:
    person = names.name(event.entity_id)
    added = admin_copy.join_es(admin_copy.role_labels(_strings(event.payload, "added")))
    removed = admin_copy.join_es(admin_copy.role_labels(_strings(event.payload, "removed")))
    if added and removed:
        return f"Cambió los roles de {person}: le dio {added} y le quitó {removed}"
    if removed:
        return f"Le quitó a {person} el rol de {removed}"
    return f"Le dio a {person} el rol de {added}"


def _languages_changed(event: StoredEvent, names: AuditNames) -> str:
    person = names.name(event.entity_id)
    spoken = admin_copy.join_es(admin_copy.language_names(_strings(event.payload, "to_languages")))
    if not spoken:
        return f"Cambió los idiomas de {person}: ya no tiene idiomas"
    return f"Cambió los idiomas de {person}: ahora habla {spoken}"


def _team_changed(event: StoredEvent, names: AuditNames) -> str:
    before = _text(event.payload, "from_team_name") or "otro equipo"
    after = _text(event.payload, "to_team_name") or "otro equipo"
    return f"Pasó a {names.name(event.entity_id)} de {before} a {after}"


def _staff_deactivated(event: StoredEvent, names: AuditNames) -> str:
    return f"Desactivó la cuenta de {names.name(event.entity_id)}{_sessions_suffix(event)}"


def _staff_reactivated(event: StoredEvent, names: AuditNames) -> str:
    return f"Reactivó la cuenta de {names.name(event.entity_id)}"


def _account_unlocked(event: StoredEvent, names: AuditNames) -> str:
    person = names.name(event.entity_id)
    if event.payload.get("was_locked") is True:
        return f"Desbloqueó la cuenta de {person}"
    return f"Reinició los intentos de ingreso de {person}"


def _reset_link_sent(event: StoredEvent, names: AuditNames) -> str:
    """Part 4: next to the admin: "Le envió a Tomás Arango un enlace para restablecer la
    contraseña y cerró su sesión"."""
    person = names.name(event.entity_id)
    return f"Le envió a {person} un enlace para restablecer la contraseña{_sessions_suffix(event)}"


def _team_name(event: StoredEvent) -> str:
    return _text(event.payload, "name") or event.entity_id


def _team_renamed(event: StoredEvent, _names: AuditNames) -> str:
    before = _text(event.payload, "from_name") or event.entity_id
    after = _text(event.payload, "to_name") or event.entity_id
    return f"Le cambió el nombre al equipo {before}: ahora es {after}"


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
    "case.rated": _case_rated,
    "case.priority_changed": _case_priority_changed,
    "case.type_changed": _case_type_changed,
    "case.viewed": _case_viewed,
    "turn.created": _turn_created,
    # ADR 0003: the assistant (ids and enums only; the audit never shows what was said)
    "case.assistant_started": _fixed("La conversación empezó con el asistente"),
    "case.assistant_released": _assistant_released,
    "assistant.session_started": _fixed("Empezó la sesión con el asistente"),
    "assistant.turn_answered": _fixed("El asistente respondió"),
    "assistant.input_queued": _fixed("Respondió a la confirmación del asistente"),
    "assistant.step_up_verified": _fixed("Pasó la verificación adicional"),
    "assistant.step_up_rejected": _fixed("Falló la verificación adicional"),
    "assistant.ended": _assistant_ended,
    # slice 15: the copilot (the audit never shows what was asked or answered)
    "copilot.query_asked": _fixed("Le preguntó algo al copiloto sobre el caso"),
    "copilot.answered": _fixed("El copiloto respondió"),
    "copilot.suggestion_requested": _fixed("Se pidió una sugerencia al copiloto"),
    "copilot.suggestion_ready": _fixed("El copiloto preparó una sugerencia"),
    "copilot.suggestion_none": _fixed("El copiloto no tenía nada que sugerir"),
    "copilot.suggestion_failed": _fixed("No se pudo preparar la sugerencia del copiloto"),
    "copilot.suggestion_decided": _suggestion_decided,
    "copilot.tool_used": _fixed("Usó una herramienta que propuso el copiloto"),
    # slice 21: the stages per case type (the rule's steps are the system's)
    "ai.stage_advanced": _stage_advanced,
    "ai.stage_moved_back": _stage_moved_back,
    "ai.agent_ready": lambda event, _names: f"Propuso un agente para {_stage_type(event)}",
    "ai.agent_activated": lambda event, _names: f"Activó el agente de {_stage_type(event)}",
    # slice 16: the agent builder (the audit never shows a draft, a reason or a chat text)
    "builder.proposal_created": _fixed("Creó una propuesta de cambio de un agente"),
    "builder.proposal_tracked": _fixed("Agregó una propuesta del constructor a la lista"),
    "builder.draft_saved": _fixed("Guardó el borrador de una propuesta"),
    "builder.proposal_validated": _builder_validated,
    "builder.proposal_frozen": _fixed("Congeló la candidata de una propuesta"),
    "builder.proposal_reopened": _fixed("Reabrió una propuesta para editarla"),
    "builder.proposal_evaluated": _builder_evaluated,
    "builder.proposal_approved": _builder_approved,
    "builder.proposal_rejected": _fixed("Rechazó la propuesta: volvió a borrador"),
    "builder.proposal_published": _fixed("Publicó la propuesta como una versión nueva del agente"),
    "builder.alias_promoted": _builder_promoted,
    "builder.release_revoked": _fixed("Revocó una versión de un agente"),
    "builder.question_asked": _fixed("Le escribió al constructor de agentes"),
    "builder.answered": _fixed("El constructor de agentes respondió"),
    # slice 9: the log shows the actor next to them ("Daniela Ríos · Escaló el caso a
    # supervisión"); the motive and the answer are never shown (only their length).
    "escalation.opened": _fixed("Escaló el caso a supervisión"),
    "escalation.withdrawn": _fixed("Retiró el escalamiento"),
    "escalation.answered": _fixed("Respondió el escalamiento"),
    "escalation.taken": _escalation_taken,
    "escalation.reassigned": _escalation_reassigned,
    "escalation.closed": _fixed("El escalamiento terminó porque se cerró el caso"),
    "escalation.acknowledged": _fixed("Leyó lo que hizo supervisión con su escalamiento"),
    # slice 12: simulated calls (gender-neutral, next to the actor's name)
    "call.started": _call_started,
    "call.answered": _call_answered,
    "call.held": _fixed("Puso la llamada en espera"),
    "call.resumed": _fixed("Retomó la llamada"),
    "call.mute_changed": _call_mute_changed,
    "call.ended": _call_ended,
    "staff.availability_changed": _availability_changed,
    "staff.ui_language_changed": _ui_language_changed,
    "customer.session_started": _customer_session,
    "auth.password_accepted": _fixed("Ingresó la contraseña correcta"),
    "auth.mfa_challenge_issued": _fixed("Se le pidió el código de verificación"),
    "auth.login_failed": _login_failed,
    "auth.mfa_failed": _mfa_failed,
    "auth.account_locked": _account_locked,
    "auth.session_started": _fixed("Inició sesión"),
    "auth.session_ended": _session_ended,
    "staff.created": _staff_created,
    "staff.profile_updated": _profile_updated,
    "staff.roles_changed": _roles_changed,
    "staff.languages_changed": _languages_changed,
    "staff.team_changed": _team_changed,
    "staff.deactivated": _staff_deactivated,
    "staff.reactivated": _staff_reactivated,
    "staff.account_unlocked": _account_unlocked,
    # part 4 (secure onboarding): the person's own steps are written next to her name
    "staff.invitation_sent": lambda event, names: (
        f"Invitó a {names.name(event.entity_id)} por correo"
    ),
    "staff.invitation_resent": lambda event, names: (
        f"Reenvió la invitación a {names.name(event.entity_id)}"
    ),
    "staff.invitation_cancelled": lambda event, names: (
        f"Canceló la invitación de {names.name(event.entity_id)}"
    ),
    "staff.password_reset_link_sent": _reset_link_sent,
    "platform.ai_toggled": lambda event, _names: (
        "Activó las funciones de IA"
        if event.payload.get("enabled") is True
        else "Desactivó las funciones de IA"
    ),
    "staff.invitation_accepted": _fixed("Aceptó la invitación y activó su cuenta"),
    "staff.mfa_enrolled": _fixed("Configuró la verificación en dos pasos"),
    "staff.password_reset": _fixed("Creó una contraseña nueva con el enlace de restablecimiento"),
    "team.created": lambda event, _names: f"Creó el equipo {_team_name(event)}",
    "team.renamed": _team_renamed,
    "team.deactivated": lambda event, _names: f"Desactivó el equipo {_team_name(event)}",
    "team.reactivated": lambda event, _names: f"Reactivó el equipo {_team_name(event)}",
}


def fallback_description(event_type: str) -> str:
    return f"Evento {event_type}"


def describe(event: StoredEvent, names: AuditNames) -> str:
    """Spanish "Qué hizo" text of one event (contract §5.3)."""
    describer = _DESCRIBERS.get(event.event_type)
    return describer(event, names) if describer else fallback_description(event.event_type)
