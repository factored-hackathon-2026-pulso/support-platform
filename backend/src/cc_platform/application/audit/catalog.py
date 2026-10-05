"""Audit catalog (slice 3 contract §5.3): the one place that says, for every event type the
platform emits, its family, whether it changes something, and its description.

Descriptions read like the "Qué hizo" column of the audit log: the actor is shown next to
them, so they start with a verb ("Asignó el caso a Daniela Ríos…"). They are rendered when
the log is read, in the reader's UI language (slice 23c): the words live in the server
catalogs (``application/i18n``, ``audit.*`` keys), Spanish the source. Names come from a
lookup (``AuditNames``); times are never written into them (the UI shows times in the
viewer's zone). An unknown type falls back to "Evento {event_type}" in the ``other``
family; a test runs ``describe`` over every emitted type and fails on that fallback.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from cc_platform.application.cases import copy
from cc_platform.application.events import StoredEvent
from cc_platform.application.i18n import Texts, texts
from cc_platform.domain.cases.values import (
    LANGUAGE_RULE_ID,
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseType,
    CloseReason,
)
from cc_platform.domain.people.preferences import DEFAULT_UI_LANGUAGE, UiLanguage
from cc_platform.domain.people.staff import Language, StaffRole
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
    "copilot.item_decided": AuditFamily.CONVERSATION,
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
    "ai.agent_renamed": AuditFamily.AGENTS,
    "ai.agent_paused": AuditFamily.AGENTS,
    "ai.agent_resumed": AuditFamily.AGENTS,
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
        "ai.agent_renamed",
        "ai.agent_paused",
        "ai.agent_resumed",
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

    def name(self, person_id: object, t: Texts | None = None) -> str:
        if not isinstance(person_id, str):
            return (t or texts())("someone")
        return self.people.get(person_id, person_id)


Describer = Callable[[StoredEvent, AuditNames, Texts], str]


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


def _queue(language: Language, t: Texts) -> str:
    return copy.in_sentence(t(f"queue.{language.value}"))


def _label(t: Texts, prefix: str, value: object, known: Iterable[str]) -> str | None:
    """``t("<prefix>.<value>")`` for a known enum value, else ``None``."""
    if isinstance(value, str) and value in set(known):
        return t(f"{prefix}.{value}")
    return None


def _channel_phrase(channel: str | None, t: Texts) -> str:
    known = {c.value for c in CaseChannel}
    return t(f"channel.{channel if channel in known else CaseChannel.CHAT_APP.value}")


def _case_type(event: StoredEvent, t: Texts) -> str:
    raw = _text(event.payload, "case_type")
    return _label(t, "caseType", raw, (c.value for c in CaseType)) or t("audit.stage.someType")


def _role_list(t: Texts, values: Iterable[object]) -> str:
    """Role labels in canonical order (unknown values skipped), as a list of this language."""
    held = {str(value) for value in values}
    return t.join([t(f"role.{role.value}") for role in StaffRole if role.value in held])


def _language_list(t: Texts, values: Iterable[object]) -> str:
    held = {str(value) for value in values}
    return t.join([t(f"language.{lang.value}") for lang in Language if lang.value in held])


def _strings(payload: JsonObject, key: str) -> list[str]:
    value = payload.get(key)
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


# ----------------------------------------------------------------------------- cases
def _case_opened(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    raw = _text(event.payload, "channel")
    channel = _channel_phrase(raw, t)
    if raw == CaseChannel.PHONE_OUTBOUND.value:  # slice 12: an analyst's follow-up
        return t("audit.caseOpened.followUp")
    if _text(event.payload, "previous_case_id"):
        again = "calledAgain" if raw == CaseChannel.PHONE_INBOUND.value else "wroteAgain"
        return t(f"audit.caseOpened.{again}", channel=channel)
    return t("audit.caseOpened.new", channel=channel)


def _case_queued(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    language = _language(event, names)
    stored = _text(event.payload, "queue_label")  # a Spanish snapshot: only Spanish uses it
    label = stored if stored and t.language is UiLanguage.SPANISH else None
    queue = copy.in_sentence(label) if label else _queue(language, t)
    return t("audit.caseQueued", queue=queue, language=t(f"language.{language.value}"))


def _case_assigned(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    payload = event.payload
    analyst = names.name(payload.get("assigned_analyst_id"), t)
    language = _language(event, names)
    reason = _text(payload, "reason")
    previous = payload.get("previous_analyst_id")
    if reason == AssignmentReason.OUTBOUND_CALL.value:  # slice 12: she called the customer
        return t("audit.caseAssigned.followUp")
    if reason == AssignmentReason.QUEUE_DRAINED.value:
        minutes = copy.queue_wait_minutes(_int(payload, "waited_seconds") or 0)
        text = t(
            "audit.caseAssigned.fromQueueAfter",
            analyst=analyst,
            queue=_queue(language, t),
            minutes=minutes,
        )
    elif reason == AssignmentReason.MANUAL.value and previous:
        text = t("audit.caseAssigned.reassigned", previous=names.name(previous, t), analyst=analyst)
    elif reason == AssignmentReason.MANUAL.value:
        text = t("audit.caseAssigned.fromQueue", analyst=analyst, queue=_queue(language, t))
    else:
        rule = t("audit.rule3") if language is Language.PORTUGUESE else ""
        spoken = t(f"language.{language.value}")
        text = t("audit.caseAssigned.available", analyst=analyst, language=spoken) + rule
    if payload.get("paused_override") is True:
        text += t("audit.caseAssigned.paused", analyst=analyst)
    return text


_STATUS_REASONS: Mapping[str, str] = {
    "opened_by_assignee": "audit.caseStatus.openedByAssignee",
    "closed": "audit.caseStatus.closed",
    "reassigned": "audit.caseStatus.reassigned",
}


def _case_status_changed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    return t(_STATUS_REASONS.get(_text(event.payload, "reason") or "", "audit.caseStatus.other"))


def _case_read(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    return t("audit.caseRead", sequence=_int(event.payload, "read_sequence") or 0)


def _case_first_responded(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    minutes = math.ceil((_int(event.payload, "response_seconds") or 0) / 60)
    met = "met" if event.payload.get("sla_met") is True else "missed"
    return t(f"audit.firstResponse.{met}", minutes=minutes)


def _case_closed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    raw = _text(event.payload, "reason")
    label = _label(t, "closeReason", raw, (r.value for r in CloseReason))
    return t("audit.caseClosed", label=label or t(f"closeReason.{CloseReason.OTHER.value}"))


#: Slice 7: the 1–4 rating scale (the words are the catalogs' ``rating.<score>``).
RATING_SCORES = (1, 2, 3, 4)


def _case_rated(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    """Never the comment (privacy, like message text): only the score."""
    score = _int(event.payload, "score")
    if score in RATING_SCORES:
        return t("audit.caseRated.score", label=t(f"rating.{score}"))
    return t("audit.caseRated.plain")


def _case_priority_changed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    """Next to the actor: "Daniela Ríos · Cambió la prioridad a Alta"."""
    to = _text(event.payload, "to")
    if to == CasePriority.NONE.value:
        return t("audit.priority.removed")
    label = _label(t, "priority", to, (p.value for p in CasePriority))
    return t("audit.priority.changedTo", label=label) if label else t("audit.priority.changed")


def _case_type_changed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    """Next to the actor: "Daniela Ríos · Cambió el tipo de caso a Cobro indebido"."""
    to = _text(event.payload, "to")
    if to == CaseType.NONE.value:
        return t("audit.caseType.removed")
    label = _label(t, "caseType", to, (c.value for c in CaseType))
    return t("audit.caseType.changedTo", label=label) if label else t("audit.caseType.changed")


def _escalation_taken(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    """Next to the supervisor: "Felipe Echeverri · Tomó el caso escalado de Daniela Ríos"."""
    return t(
        "audit.escalation.taken", previous=names.name(event.payload.get("previous_analyst_id"), t)
    )


def _escalation_reassigned(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    return t(
        "audit.escalation.reassigned",
        previous=names.name(event.payload.get("previous_analyst_id"), t),
        analyst=names.name(event.payload.get("analyst_id"), t),
    )


#: ``turn.created`` by (kind, author role); ``None`` = any author. Slice 12 adds call lines,
#: internal notes (staff only) and emails.
_TURN_TEXT: Mapping[tuple[str, str | None], str] = {
    ("notice", None): "audit.turn.notice",
    ("routing", None): "audit.turn.routing",
    ("note", None): "audit.turn.note",
    ("email", "customer"): "audit.turn.emailFromCustomer",
    ("email", None): "audit.turn.email",
    ("transcript", "system"): "audit.turn.callEvent",
    ("transcript", None): "audit.turn.callLine",
    ("message", "customer"): "audit.turn.customerMessage",
    ("message", "assistant"): "audit.turn.assistantMessage",
}


def _turn_created(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    kind = _text(event.payload, "kind") or "message"
    role = _text(event.payload, "author_role")
    key = _TURN_TEXT.get((kind, role)) or _TURN_TEXT.get((kind, None)) or "audit.turn.reply"
    return t(key)


# ----------------------------------------------------------------------------- assistant
#: ``case.assistant_released`` reasons and ``assistant.ended`` results with their own words
#: (never a message text or a handoff's content).
_RELEASE_REASONS = frozenset(
    {"escalated", "ended", "failed", "supervision", "customer_request", "ai_disabled"}
)
_ASSISTANT_RESULTS = frozenset({"resolved", "escalated", "ended", "failed", "released"})


def _assistant_released(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    reason = _text(event.payload, "reason")
    return t(f"audit.assistantReleased.{reason if reason in _RELEASE_REASONS else 'other'}")


def _assistant_ended(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    result = _text(event.payload, "result")
    return t(f"audit.assistantEnded.{result if result in _ASSISTANT_RESULTS else 'other'}")


# --------------------------------------------------------------------------- suggestions (ADR 0005)
_SUGGESTION_DECISIONS = frozenset({"used", "edited", "discarded", "ignored"})


def _suggestion_decided(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    if _text(event.payload, "subject") == "escalation":
        return t("audit.suggestion.escalation")
    decision = _text(event.payload, "decision")
    return t(f"audit.suggestion.{decision if decision in _SUGGESTION_DECISIONS else 'other'}")


# --------------------------------------------------------------------------- stages (slice 21)
#: The stages a case type's copilot goes through (ADR 0006 §1); words: ``stage.<n>``.
STAGES = (0, 1, 2, 3)


def _stage(event: StoredEvent, t: Texts) -> str:
    stage = event.payload.get("to_stage")
    if not isinstance(stage, int) or isinstance(stage, bool) or stage not in STAGES:
        return t("audit.stage.other")
    return t("audit.stage.numbered", stage=stage, text=t(f"stage.{stage}"))


def _stage_advanced(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    """By the system: "Subió Cobro indebido a la etapa 3: el copiloto propone respuestas"."""
    return t("audit.stage.advanced", type=_case_type(event, t), stage=_stage(event, t))


def _stage_moved_back(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    """Next to the supervisor: "Devolvió Problema con app a la etapa 1: el copiloto responde"
    (or, from "ready for an agent" back to stage 3, "Retiró la propuesta de agente de …")."""
    if event.payload.get("from_stage") == event.payload.get("to_stage"):
        return t("audit.stage.proposalWithdrawn", type=_case_type(event, t))
    return t("audit.stage.movedBack", type=_case_type(event, t), stage=_stage(event, t))


# ----------------------------------------------------------------------------- builder (slice 16)
_VERDICTS = frozenset({"pass", "fail", "failed_infra"})


def _builder_validated(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    count = _int(event.payload, "violations") or 0
    if count == 0:
        return t("audit.builder.validatedClean")
    return t.plural("audit.builder.validated", count)


def _builder_approved(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    if (_int(event.payload, "yardstick_loosened") or 0) > 0:
        return t("audit.builder.approvedLoosened")
    return t("audit.builder.approved")


def _builder_promoted(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    return t("audit.builder.promoted", alias=_text(event.payload, "alias") or "staging")


def _builder_evaluated(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    verdict = _text(event.payload, "verdict")
    return t(f"audit.builder.verdict.{verdict if verdict in _VERDICTS else 'other'}")


# ----------------------------------------------------------------------------- calls (slice 12)
def _call_started(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    """Next to the actor: "Daniela Ríos · Llamó a Claudia Restrepo Varela"; the reason is
    never shown (only its length)."""
    if _text(event.payload, "direction") == "outbound":
        return t("audit.call.outbound", customer=names.name(event.payload.get("customer_id"), t))
    return t("audit.call.inbound")


def _call_answered(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    if _text(event.payload, "answered_by_role") == "customer":
        return t("audit.call.answeredByCustomer")
    return t("audit.call.answered")


def _call_mute_changed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    return t("audit.call.muted" if event.payload.get("muted") is True else "audit.call.unmuted")


def _call_ended(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    reason = _text(event.payload, "end_reason")
    if reason == "rejected":
        return t("audit.call.rejected")
    if reason == "cancelled":
        return t("audit.call.cancelled")
    minutes = copy.queue_wait_minutes(_int(event.payload, "duration_seconds") or 0)
    return t("audit.call.ended", minutes=minutes)


def _availability_changed(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    reason = _text(event.payload, "reason")
    if reason == "deactivated":
        return t("audit.availability.deactivated", person=names.name(event.entity_id, t))
    if reason == "role_removed":
        return t("audit.availability.roleRemoved", person=names.name(event.entity_id, t))
    to_status = _text(event.payload, "to_status")
    return t(f"audit.availability.{'available' if to_status == 'available' else 'paused'}")


def _ui_language_changed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    """The language by its own name ("Português") in every UI language."""
    to_language = _text(event.payload, "to_language") or ""
    known = {language.value for language in UiLanguage}
    name = t(f"uiLanguage.{to_language}") if to_language in known else to_language
    return t("audit.uiLanguageChanged", name=name)


def _customer_session(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    channel = "web" if _text(event.payload, "channel") == CaseChannel.CHAT_WEB.value else "app"
    return t("audit.customerSession", channel=channel)


def _login_failed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    factor = t(
        "audit.factor.mfa" if _text(event.payload, "factor") == "mfa" else "audit.factor.password"
    )
    remaining = _int(event.payload, "remaining_attempts") or 0
    return t("audit.loginFailed", factor=factor, remaining=remaining)


def _mfa_failed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    return t("audit.mfaFailed", remaining=_int(event.payload, "remaining_attempts") or 0)


def _account_locked(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    raw = _text(event.payload, "locked_until")
    minutes = 0
    if raw is not None:
        locked_until = datetime.fromisoformat(raw)
        minutes = math.ceil((locked_until - event.event_time).total_seconds() / 60)
    attempts = _int(event.payload, "failed_attempts") or 0
    return t("audit.accountLocked", minutes=minutes, attempts=attempts)


def _session_ended(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    if _text(event.payload, "reason") != "revoked":
        return t("audit.sessionEnded")
    owner = _text(event.payload, "staff_id")
    if owner is not None and owner != event.actor_id:
        return t("audit.sessionEndedBy", person=names.name(owner, t))  # administration ended it
    return t("audit.sessionRevoked")


# ----------------------------------------------------------------------------- administration
def _sessions_suffix(event: StoredEvent, t: Texts) -> str:
    revoked = _int(event.payload, "revoked_sessions") or 0
    return t.plural("audit.sessionsSuffix", revoked) if revoked > 0 else ""


def _staff_created(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    person = names.people.get(event.entity_id) or _text(event.payload, "name") or t("someone")
    parts = [t("audit.staffCreated", person=person)]
    roles = _role_list(t, _strings(event.payload, "roles"))
    if roles:
        parts.append(roles)
    team = _text(event.payload, "team_name")
    if team:
        parts.append(team)
    return " · ".join(parts)


def _profile_updated(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    fields = set(_strings(event.payload, "changed_fields"))
    before = _text(event.payload, "from_name") or names.name(event.entity_id, t)
    after = _text(event.payload, "to_name") or names.name(event.entity_id, t)
    if fields == {"name"}:
        return t("audit.profile.name", before=before, after=after)
    if fields == {"email"}:
        return t("audit.profile.email", after=after)
    return t("audit.profile.both", before=before, after=after)


def _roles_changed(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    person = names.name(event.entity_id, t)
    added = _role_list(t, _strings(event.payload, "added"))
    removed = _role_list(t, _strings(event.payload, "removed"))
    if added and removed:
        return t("audit.roles.both", person=person, added=added, removed=removed)
    if removed:
        return t("audit.roles.removed", person=person, removed=removed)
    return t("audit.roles.added", person=person, added=added)


def _languages_changed(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    person = names.name(event.entity_id, t)
    spoken = _language_list(t, _strings(event.payload, "to_languages"))
    if not spoken:
        return t("audit.languages.none", person=person)
    return t("audit.languages.spoken", person=person, spoken=spoken)


def _team_changed(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    before = _text(event.payload, "from_team_name") or t("audit.team.other")
    after = _text(event.payload, "to_team_name") or t("audit.team.other")
    return t("audit.teamChanged", person=names.name(event.entity_id, t), before=before, after=after)


def _person_sentence(key: str, *, sessions: bool = False) -> Describer:
    """A sentence about the person the event is about (``entity_id``), optionally followed by
    how many of her sessions ended."""

    def describe_person(event: StoredEvent, names: AuditNames, t: Texts) -> str:
        person = names.name(event.entity_id, t)
        if sessions:
            return t(key, person=person, sessions=_sessions_suffix(event, t))
        return t(key, person=person)

    return describe_person


def _account_unlocked(event: StoredEvent, names: AuditNames, t: Texts) -> str:
    person = names.name(event.entity_id, t)
    if event.payload.get("was_locked") is True:
        return t("audit.accountUnlocked", person=person)
    return t("audit.attemptsReset", person=person)


def _team_sentence(key: str) -> Describer:
    def describe_team(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
        return t(key, team=_text(event.payload, "name") or event.entity_id)

    return describe_team


def _team_renamed(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    before = _text(event.payload, "from_name") or event.entity_id
    after = _text(event.payload, "to_name") or event.entity_id
    return t("audit.teamRenamed", before=before, after=after)


def _ai_toggled(event: StoredEvent, _names: AuditNames, t: Texts) -> str:
    return t("audit.aiEnabled" if event.payload.get("enabled") is True else "audit.aiDisabled")


def _fixed(key: str) -> Describer:
    return lambda _event, _names, t: t(key)


def _about_type(key: str) -> Describer:
    return lambda event, _names, t: t(key, type=_case_type(event, t))


_DESCRIBERS: Mapping[str, Describer] = {
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
    "case.viewed": _fixed("audit.caseViewed"),
    "turn.created": _turn_created,
    # ADR 0003: the assistant (ids and enums only; the audit never shows what was said)
    "case.assistant_started": _fixed("audit.assistant.started"),
    "case.assistant_released": _assistant_released,
    "assistant.session_started": _fixed("audit.assistant.sessionStarted"),
    "assistant.turn_answered": _fixed("audit.assistant.turnAnswered"),
    "assistant.input_queued": _fixed("audit.assistant.inputQueued"),
    "assistant.step_up_verified": _fixed("audit.assistant.stepUpVerified"),
    "assistant.step_up_rejected": _fixed("audit.assistant.stepUpRejected"),
    "assistant.ended": _assistant_ended,
    # slice 15: the copilot (the audit never shows what was asked or answered)
    "copilot.query_asked": _fixed("audit.copilot.queryAsked"),
    "copilot.answered": _fixed("audit.copilot.answered"),
    "copilot.suggestion_requested": _fixed("audit.copilot.suggestionRequested"),
    "copilot.suggestion_ready": _fixed("audit.copilot.suggestionReady"),
    "copilot.suggestion_none": _fixed("audit.copilot.suggestionNone"),
    "copilot.suggestion_failed": _fixed("audit.copilot.suggestionFailed"),
    "copilot.suggestion_decided": _suggestion_decided,
    "copilot.tool_used": _fixed("audit.copilot.toolUsed"),
    "copilot.item_decided": _fixed("audit.copilot.itemDecided"),
    # slice 21: the stages per case type (the rule's steps are the system's)
    "ai.stage_advanced": _stage_advanced,
    "ai.stage_moved_back": _stage_moved_back,
    "ai.agent_ready": _about_type("audit.stage.agentReady"),
    "ai.agent_activated": _about_type("audit.stage.agentActivated"),
    "ai.agent_renamed": _about_type("audit.stage.agentRenamed"),
    "ai.agent_paused": _about_type("audit.stage.agentPaused"),
    "ai.agent_resumed": _about_type("audit.stage.agentResumed"),
    # slice 16: the agent builder (the audit never shows a draft, a reason or a chat text)
    "builder.proposal_created": _fixed("audit.builder.proposalCreated"),
    "builder.proposal_tracked": _fixed("audit.builder.proposalTracked"),
    "builder.draft_saved": _fixed("audit.builder.draftSaved"),
    "builder.proposal_validated": _builder_validated,
    "builder.proposal_frozen": _fixed("audit.builder.frozen"),
    "builder.proposal_reopened": _fixed("audit.builder.reopened"),
    "builder.proposal_evaluated": _builder_evaluated,
    "builder.proposal_approved": _builder_approved,
    "builder.proposal_rejected": _fixed("audit.builder.rejected"),
    "builder.proposal_published": _fixed("audit.builder.published"),
    "builder.alias_promoted": _builder_promoted,
    "builder.release_revoked": _fixed("audit.builder.revoked"),
    "builder.question_asked": _fixed("audit.builder.questionAsked"),
    "builder.answered": _fixed("audit.builder.answered"),
    # slice 9: the log shows the actor next to them ("Daniela Ríos · Escaló el caso a
    # supervisión"); the motive and the answer are never shown (only their length).
    "escalation.opened": _fixed("audit.escalation.opened"),
    "escalation.withdrawn": _fixed("audit.escalation.withdrawn"),
    "escalation.answered": _fixed("audit.escalation.answered"),
    "escalation.taken": _escalation_taken,
    "escalation.reassigned": _escalation_reassigned,
    "escalation.closed": _fixed("audit.escalation.closed"),
    "escalation.acknowledged": _fixed("audit.escalation.acknowledged"),
    # slice 12: simulated calls (gender-neutral, next to the actor's name)
    "call.started": _call_started,
    "call.answered": _call_answered,
    "call.held": _fixed("audit.call.held"),
    "call.resumed": _fixed("audit.call.resumed"),
    "call.mute_changed": _call_mute_changed,
    "call.ended": _call_ended,
    "staff.availability_changed": _availability_changed,
    "staff.ui_language_changed": _ui_language_changed,
    "customer.session_started": _customer_session,
    "auth.password_accepted": _fixed("audit.passwordAccepted"),
    "auth.mfa_challenge_issued": _fixed("audit.mfaChallengeIssued"),
    "auth.login_failed": _login_failed,
    "auth.mfa_failed": _mfa_failed,
    "auth.account_locked": _account_locked,
    "auth.session_started": _fixed("audit.sessionStarted"),
    "auth.session_ended": _session_ended,
    "staff.created": _staff_created,
    "staff.profile_updated": _profile_updated,
    "staff.roles_changed": _roles_changed,
    "staff.languages_changed": _languages_changed,
    "staff.team_changed": _team_changed,
    "staff.deactivated": _person_sentence("audit.staffDeactivated", sessions=True),
    "staff.reactivated": _person_sentence("audit.staffReactivated"),
    "staff.account_unlocked": _account_unlocked,
    # part 4 (secure onboarding): the person's own steps are written next to her name
    "staff.invitation_sent": _person_sentence("audit.invitationSent"),
    "staff.invitation_resent": _person_sentence("audit.invitationResent"),
    "staff.invitation_cancelled": _person_sentence("audit.invitationCancelled"),
    # "Le envió a Tomás Arango un enlace para restablecer la contraseña y cerró su sesión"
    "staff.password_reset_link_sent": _person_sentence("audit.resetLinkSent", sessions=True),
    "platform.ai_toggled": _ai_toggled,
    "staff.invitation_accepted": _fixed("audit.invitationAccepted"),
    "staff.mfa_enrolled": _fixed("audit.mfaEnrolled"),
    "staff.password_reset": _fixed("audit.passwordReset"),
    "team.created": _team_sentence("audit.teamCreated"),
    "team.renamed": _team_renamed,
    "team.deactivated": _team_sentence("audit.teamDeactivated"),
    "team.reactivated": _team_sentence("audit.teamReactivated"),
}


def fallback_description(event_type: str, language: UiLanguage = DEFAULT_UI_LANGUAGE) -> str:
    return texts(language)("audit.fallback", event_type=event_type)


def describe(
    event: StoredEvent, names: AuditNames, language: UiLanguage = DEFAULT_UI_LANGUAGE
) -> str:
    """The "Qué hizo" text of one event (contract §5.3) in the reader's UI language."""
    describer = _DESCRIBERS.get(event.event_type)
    if describer is None:
        return fallback_description(event.event_type, language)
    return describer(event, names, texts(language))
