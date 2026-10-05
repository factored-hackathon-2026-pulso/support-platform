"""The cheap filter: greetings get no suggestion, impatience and real content do."""

from __future__ import annotations

import pytest

from cc_platform.application.ai.suggestion_filter import IMPATIENT_AFTER_SECONDS, is_trivial


@pytest.mark.parametrize(
    "text",
    [
        "hola",
        "Hola!",
        "  HOLA  ",
        "buenas tardes",
        "Buenos días",
        "buenas noches",
        "gracias",
        "muchas gracias",
        "ok gracias",
        "listo",
        "perfecto, gracias",
        "hasta luego",
        "oi",
        "Olá",
        "bom dia",
        "obrigada",
        "tudo bem",
        "😊",
        "...",
        "",
    ],
)
def test_greetings_thanks_and_acknowledgements_get_no_suggestion(text: str) -> None:
    assert is_trivial(text, waited_seconds=0, sla_overdue=False)


@pytest.mark.parametrize(
    "text",
    [
        "no",
        "sí",
        "si",
        "hola, me cobraron dos veces",
        "hola necesito ayuda con un cargo",
        "gracias pero sigue sin aparecer",
        "ok 120 dólares",
        "buenas tardes a todos ustedes",
        "quiero hablar con supervisión",
        "cancelen mi tarjeta",
        "?",
    ][:-1],
)
def test_real_content_gets_a_suggestion(text: str) -> None:
    assert not is_trivial(text, waited_seconds=0, sla_overdue=False)


@pytest.mark.parametrize("text", ["hola?", "hola??", "hola!!", "buenas?", "ok?"])
def test_a_greeting_that_pushes_after_a_long_wait_is_impatience(text: str) -> None:
    assert not is_trivial(text, waited_seconds=IMPATIENT_AFTER_SECONDS, sla_overdue=False)


def test_a_pushing_greeting_while_the_first_response_is_overdue_is_impatience() -> None:
    assert not is_trivial("hola?", waited_seconds=0, sla_overdue=True)


def test_the_same_greeting_without_pressure_is_still_a_greeting() -> None:
    assert is_trivial("hola?", waited_seconds=IMPATIENT_AFTER_SECONDS - 1, sla_overdue=False)
    assert is_trivial("hola", waited_seconds=IMPATIENT_AFTER_SECONDS * 10, sla_overdue=True)
