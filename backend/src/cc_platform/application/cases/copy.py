"""Server-written texts (slice 2 contract §3.3): Spanish for staff banners, the case
language for what the customer sees.

``routing`` turns are staff-only assignment banners; ``notice`` turns reach the customer.
Queue labels, close-reason labels and the display zone are team-generated values.
"""

from __future__ import annotations

import math
from datetime import datetime
from zoneinfo import ZoneInfo

from cc_platform.domain.cases.values import CaseChannel, CloseReason
from cc_platform.domain.people.staff import Language

#: Display zone for dates baked into stored banner text (team-generated choice). Every
#: other time in the UI is formatted by the client in the viewer's own zone, so a banner
#: that carries a server-written time must name this zone (``DISPLAY_ZONE_LABEL``).
DISPLAY_ZONE = ZoneInfo("America/Bogota")
DISPLAY_ZONE_LABEL = "hora Bogotá"

LANGUAGE_NAME: dict[Language, str] = {Language.SPANISH: "español", Language.PORTUGUESE: "portugués"}

#: Team-generated queue names, one per conversation language.
QUEUE_LABEL: dict[Language, str] = {
    Language.SPANISH: "Cola en español",
    Language.PORTUGUESE: "Cola en portugués",
}

#: Team-generated close-reason labels (the UI shows the same ones).
CLOSE_REASON_LABEL: dict[CloseReason, str] = {
    CloseReason.RESOLVED: "Resuelto",
    CloseReason.CUSTOMER_UNRESPONSIVE: "El cliente no respondió",
    CloseReason.DUPLICATE: "Duplicado",
    CloseReason.OUT_OF_SCOPE: "Fuera de alcance",
    CloseReason.OTHER: "Otro",
}

NOTICE_OPENED: dict[Language, str] = {
    Language.SPANISH: "Recibimos tu mensaje. En unos minutos te responde una persona del equipo.",
    Language.PORTUGUESE: (
        "Recebemos sua mensagem. Em poucos minutos uma pessoa da equipe vai te responder."
    ),
}

NOTICE_CLOSED: dict[Language, str] = {
    Language.SPANISH: (
        "La conversación terminó. Si necesitas algo más, escríbenos y te atendemos en una "
        "nueva conversación."
    ),
    Language.PORTUGUESE: (
        "A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma "
        "nova conversa."
    ),
}

_MONTHS = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic")


def _rule_3(language: Language) -> str:
    return " (regla 3)" if language is Language.PORTUGUESE else ""


def in_sentence(label: str) -> str:
    """ "Cola en portugués" → "cola en portugués" (inside a sentence)."""
    return label[:1].lower() + label[1:]


def display_datetime(at: datetime) -> str:
    """ "1 oct, 09:05 hora Bogotá": the display zone, always named next to the time."""
    local = at.astimezone(DISPLAY_ZONE)
    return f"{local.day} {_MONTHS[local.month - 1]}, {local:%H:%M} {DISPLAY_ZONE_LABEL}"


def queue_wait_minutes(seconds: float) -> int:
    """Minutes rounded up, minimum 1."""
    return max(1, math.ceil(seconds / 60))


def assigned_on_arrival(analyst_name: str, language: Language) -> str:
    return (
        f"Asignado a {analyst_name} porque está disponible y habla "
        f"{LANGUAGE_NAME[language]}{_rule_3(language)}."
    )


def queued(language: Language, label: str) -> str:
    return (
        f"No hay personas disponibles que hablen {LANGUAGE_NAME[language]}: el caso espera en "
        f"la {in_sentence(label)}."
    )


def assigned_from_queue(analyst_name: str, waited_minutes: int, label: str) -> str:
    return f"Asignado a {analyst_name} después de {waited_minutes} min en la {in_sentence(label)}."


def wrote_again(
    first_name: str,
    closed_at: datetime,
    reason: CloseReason,
    channel: CaseChannel = CaseChannel.CHAT_APP,
) -> str:
    """Staff banner of a case that follows a closed one ("volvió a llamar" by phone)."""
    verb = "volvió a llamar" if channel is CaseChannel.PHONE_INBOUND else "volvió a escribir"
    return (
        f"{first_name} {verb}. Su caso anterior se cerró el "
        f"{display_datetime(closed_at)} ({CLOSE_REASON_LABEL[reason].lower()})."
    )


# ----------------------------------------------------------------------------- supervision
#: Customer notice on a reassignment (case language; first name of the new analyst). Never
#: says who reassigned, why, who held it before or that she was paused.
NOTICE_REASSIGNED: dict[Language, str] = {
    Language.SPANISH: "Ahora te atiende {name}, de nuestro equipo.",
    Language.PORTUGUESE: "Agora quem te atende é {name}, da nossa equipe.",
}


def reassigned_notice(language: Language, analyst_first_name: str) -> str:
    return NOTICE_REASSIGNED[language].format(name=analyst_first_name)


def _paused_suffix(sentence: str, paused_first_name: str | None) -> str:
    """ "… a Tomás Arango." → "… a Tomás Arango (Tomás estaba en pausa)." """
    if paused_first_name is None:
        return sentence
    return f"{sentence.removesuffix('.')} ({paused_first_name} estaba en pausa)."


def manually_assigned_from_queue(
    supervisor_name: str,
    analyst_name: str,
    waited_minutes: int,
    label: str,
    *,
    paused_first_name: str | None = None,
) -> str:
    """Staff-only banner: a supervisor took the case out of the queue."""
    sentence = (
        f"{supervisor_name} asignó el caso a {analyst_name} después de {waited_minutes} min "
        f"en la {in_sentence(label)}."
    )
    return _paused_suffix(sentence, paused_first_name)


def reassigned(
    supervisor_name: str,
    previous_name: str,
    analyst_name: str,
    *,
    paused_first_name: str | None = None,
) -> str:
    """Staff-only banner: a supervisor moved an open case to another analyst."""
    sentence = f"{supervisor_name} pasó el caso de {previous_name} a {analyst_name}."
    return _paused_suffix(sentence, paused_first_name)


# ----------------------------------------------------------------------------- escalations
# Slice 9: staff-only banners in the transcript (``routing`` turns, never to the customer).


def escalated(analyst_name: str) -> str:
    return f"{analyst_name} escaló el caso a supervisión."


def escalation_withdrawn(analyst_name: str) -> str:
    return f"{analyst_name} retiró el escalamiento."


def escalation_answered(supervisor_name: str) -> str:
    return f"{supervisor_name} respondió el escalamiento."


def escalation_taken(supervisor_name: str, previous_name: str) -> str:
    """The supervisor took the escalated case herself (she also holds Analista)."""
    return f"{supervisor_name} tomó el caso de {previous_name}."


# ----------------------------------------------------------------------------- slice 12
# Calls and emails (simulated: no telephony, no mail server). Customer-facing texts in the
# case language; staff-facing ones in Spanish, gender-neutral.

NOTICE_OPENED_BY_CALL: dict[Language, str] = {
    Language.SPANISH: "Recibimos tu llamada. En un momento te atiende una persona del equipo.",
    Language.PORTUGUESE: "Recebemos sua ligação. Em instantes uma pessoa da equipe vai te atender.",
}

NOTICE_OPENED_BY_EMAIL: dict[Language, str] = {
    Language.SPANISH: "Recibimos tu correo. Una persona del equipo te responde por este medio.",
    Language.PORTUGUESE: "Recebemos seu e-mail. Uma pessoa da equipe vai te responder por aqui.",
}


def opened_notice(channel: CaseChannel, language: Language) -> str:
    """The "we got it" notice of a new case, by the channel that opened it."""
    if channel is CaseChannel.PHONE_INBOUND:
        return NOTICE_OPENED_BY_CALL[language]
    if channel is CaseChannel.EMAIL:
        return NOTICE_OPENED_BY_EMAIL[language]
    return NOTICE_OPENED[language]


#: ``system`` transcript lines of a call (everyone sees them, case language).
CALL_HELD: dict[Language, str] = {
    Language.SPANISH: "Llamada en espera.",
    Language.PORTUGUESE: "Chamada em espera.",
}
CALL_RESUMED: dict[Language, str] = {
    Language.SPANISH: "La llamada continúa.",
    Language.PORTUGUESE: "A chamada continua.",
}
CALL_ENDED: dict[Language, str] = {
    Language.SPANISH: "La llamada terminó.",
    Language.PORTUGUESE: "A chamada terminou.",
}
CALL_NOT_ANSWERED: dict[Language, str] = {
    Language.SPANISH: "La llamada terminó sin respuesta.",
    Language.PORTUGUESE: "A chamada terminou sem resposta.",
}

#: The email reply frame (slice 12): greeting with the customer's first name and the
#: analyst's signature, added by the platform around what the analyst wrote.
EMAIL_GREETING: dict[Language, str] = {
    Language.SPANISH: "Hola, {name}:",
    Language.PORTUGUESE: "Olá, {name}:",
}
EMAIL_CLOSING: dict[Language, str] = {
    Language.SPANISH: "Saludos,",
    Language.PORTUGUESE: "Atenciosamente,",
}
EMAIL_SIGNATURE_BANK = "LATAM Bank"
#: Prefix of a reply's subject ("Re: <subject of the thread>").
REPLY_PREFIX = "Re: "


def email_reply_body(
    language: Language, customer_first_name: str, analyst_name: str, body: str
) -> str:
    """ "Hola, Ignacio:\n\n<body>\n\nSaludos,\nDaniela Ríos\nLATAM Bank"."""
    greeting = EMAIL_GREETING[language].format(name=customer_first_name)
    signature = f"{EMAIL_CLOSING[language]}\n{analyst_name}\n{EMAIL_SIGNATURE_BANK}"
    return f"{greeting}\n\n{body}\n\n{signature}"


def reply_subject(thread_subject: str) -> str:
    """ "Re: <subject>", never "Re: Re: …"."""
    if thread_subject.lower().startswith(REPLY_PREFIX.lower()):
        return thread_subject
    return f"{REPLY_PREFIX}{thread_subject}"


def follow_up_call(analyst_name: str, customer_first_name: str) -> str:
    """Staff banner of a case an analyst opened to call the customer back (seed only)."""
    return f"{analyst_name} abrió este caso para llamar a {customer_first_name} (seguimiento)."
