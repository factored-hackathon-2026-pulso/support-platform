"""The cheap filter before a suggestion (ADR 0005 §5): not every message deserves a run.

A greeting, a thanks or an "ok" gets no suggestion: it costs a model call and only distracts the
analyst. Pure and language-agnostic on purpose (Spanish and Portuguese share one vocabulary): it
never calls agent-core and never decides what to say, only whether to ask.

Two cares:

- "yes" and "no" are never trivial (they answer a question the analyst asked);
- a greeting with a question mark after a long wait ("hola?" 20 minutes in) is impatience, not a
  greeting, and so is any "!" or "?" while the first response is overdue.
"""

from __future__ import annotations

import re
import unicodedata

#: A customer who has waited this long and writes "hola?" is chasing us, not greeting.
IMPATIENT_AFTER_SECONDS = 300

#: At most this many words can be a greeting or an acknowledgement ("buenas tardes", "ok gracias").
MAX_TRIVIAL_WORDS = 4

_VOCABULARY = frozenset(
    {
        # Spanish
        "hola", "holi", "holis", "buenas", "buenos", "buen", "buena", "dia", "dias", "tarde",
        "tardes", "noche", "noches", "gracias", "muchas", "mil", "ok", "okey", "okay", "vale",
        "listo", "perfecto", "dale", "genial", "entendido", "chao", "adios", "hasta", "luego",
        "saludos",
        # Portuguese
        "oi", "ola", "bom", "boa", "obrigado", "obrigada", "valeu", "certo", "beleza", "entendi",
        "tchau", "ate", "logo", "tudo", "bem",
    }
)  # fmt: skip

_WORDS = re.compile(r"[a-z0-9]+")


def _plain(text: str) -> str:
    """Lower case, no accents."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def is_trivial(text: str, *, waited_seconds: int, sla_overdue: bool) -> bool:
    """Whether a customer message needs no suggestion (``waited_seconds``: how long the customer
    has been waiting for an answer, ``sla_overdue``: the first response is late)."""
    plain = _plain(text)
    words = _WORDS.findall(plain)
    if not words:
        return True  # nothing but punctuation or emoji
    if len(words) > MAX_TRIVIAL_WORDS or not all(word in _VOCABULARY for word in words):
        return False
    pushing = "?" in plain or "!" in plain
    return not (pushing and (waited_seconds >= IMPATIENT_AFTER_SECONDS or sla_overdue))
