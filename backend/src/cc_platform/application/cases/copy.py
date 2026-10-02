"""Server-written texts (Spanish for staff banners; the case language for customers).

Routing banners are ``routing`` turns for staff only; notices are ``notice`` turns the
customer sees. Wording follows the slice 1 contract (§2.4).
"""

from __future__ import annotations

from cc_platform.domain.people.staff import Language

LANGUAGE_NAME: dict[Language, str] = {Language.SPANISH: "español", Language.PORTUGUESE: "portugués"}

QUEUE_LABEL: dict[Language, str] = {
    Language.SPANISH: "Cola de disputas",
    Language.PORTUGUESE: "Cola de disputas en portugués",
}

NOTICE_OPENED: dict[Language, str] = {
    Language.SPANISH: "Recibimos tu mensaje. En unos minutos te responde una persona del equipo.",
    Language.PORTUGUESE: (
        "Recebemos sua mensagem. Em poucos minutos uma pessoa da equipe vai te responder."
    ),
}

NOTICE_CLOSED: dict[Language, str] = {
    Language.SPANISH: "La conversación terminó. Gracias por comunicarte con LATAM Bank.",
    Language.PORTUGUESE: "A conversa foi encerrada. Obrigado por falar com o LATAM Bank.",
}


def _rule_3(language: Language) -> str:
    return " (regla 3)" if language is Language.PORTUGUESE else ""


def _in_queue(label: str) -> str:
    return label[:1].lower() + label[1:]


def assigned_after_null_chain(analyst_name: str, language: Language) -> str:
    return (
        "Ningún nivel automático está conectado todavía: el juez, el árbol y el agente de IA "
        f"pasaron el caso sin atenderlo. Asignado a {analyst_name} porque está disponible y "
        f"habla {LANGUAGE_NAME[language]}{_rule_3(language)}."
    )


def assigned_after_chain(analyst_name: str, language: Language) -> str:
    return (
        f"Asignado a {analyst_name} porque está disponible y habla "
        f"{LANGUAGE_NAME[language]}{_rule_3(language)}."
    )


def queued(language: Language, label: str) -> str:
    return (
        f"No hay personas disponibles que hablen {LANGUAGE_NAME[language]}: el caso espera en "
        f"la {_in_queue(label)}."
    )


def assigned_from_queue(analyst_name: str, waited_minutes: int, label: str) -> str:
    return f"Asignado a {analyst_name} después de {waited_minutes} min en la {_in_queue(label)}."
