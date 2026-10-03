"""Server-written texts (slice 2 contract §3.3): Spanish for staff banners, the case
language for what the customer sees.

``routing`` turns are staff-only assignment banners; ``notice`` turns reach the customer.
Queue labels, close-reason labels and the display zone are team-generated values.
"""

from __future__ import annotations

import math
from datetime import datetime
from zoneinfo import ZoneInfo

from cc_platform.domain.cases.values import CloseReason
from cc_platform.domain.people.staff import Language

#: Platform display zone for dates written into banners (team-generated choice).
DISPLAY_ZONE = ZoneInfo("America/Bogota")

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
    """ "1 oct, 09:05" in the platform display zone."""
    local = at.astimezone(DISPLAY_ZONE)
    return f"{local.day} {_MONTHS[local.month - 1]}, {local:%H:%M}"


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


def wrote_again(first_name: str, closed_at: datetime, reason: CloseReason) -> str:
    return (
        f"{first_name} volvió a escribir. Su caso anterior se cerró el "
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
