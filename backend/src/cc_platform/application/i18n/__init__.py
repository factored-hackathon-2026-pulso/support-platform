"""Server-rendered texts in the reader's UI language (slice 23c, ADR 0008).

The server renders a few texts for a person: the audit's "Qué hizo" (``application/audit``),
and the invitation and password-reset emails (``application/people/onboarding``). Each is
written in the UI language of the person who reads it (``ui_language_of``; for an invitee,
the language administration chose for her).

One catalog module per language: ``es`` (the source) and ``pt_br``. Keys are flat and
namespaced (``audit.caseClosed``, ``email.invitation.body``, ``priority.high``); values are
``str.format`` templates with named placeholders (``{person}``). ``tests/unit/application/
test_server_i18n.py`` checks that both catalogs have the same keys and the same placeholders,
so a missing translation fails the build, never a reader.

Plurals: ``key_one`` / ``key_other`` (``Texts.plural``), picked by ``count == 1``: the only
counts the server writes are 1 or more (sessions, violations, minutes are never words).
"""

from __future__ import annotations

import string
from collections.abc import Mapping, Sequence
from functools import cache

from cc_platform.application.i18n import es, pt_br
from cc_platform.domain.people.preferences import DEFAULT_UI_LANGUAGE, UiLanguage

Catalog = Mapping[str, str]

CATALOGS: Mapping[UiLanguage, Catalog] = {
    UiLanguage.SPANISH: es.CATALOG,
    UiLanguage.PORTUGUESE_BRAZIL: pt_br.CATALOG,
}


class Texts:
    """The server's words in one UI language: ``t("audit.caseClosed", label="Duplicado")``."""

    __slots__ = ("_catalog", "language")

    def __init__(self, language: UiLanguage, catalog: Catalog) -> None:
        self.language = language
        self._catalog = catalog

    def __call__(self, key: str, /, **params: object) -> str:
        template = self._catalog[key]
        return template.format(**params) if params else template

    def plural(self, key: str, count: int, /, **params: object) -> str:
        """``key_one`` for 1, ``key_other`` otherwise; ``{count}`` is available to both."""
        suffix = "one" if count == 1 else "other"
        return self(f"{key}_{suffix}", count=count, **params)

    def join(self, items: Sequence[str]) -> str:
        """A list in this language: "A", "A y B", "A, B y C" ("A, B e C"); empty → ""."""
        if not items:
            return ""
        if len(items) == 1:
            return items[0]
        return f"{', '.join(items[:-1])} {self('list.and')} {items[-1]}"


@cache
def texts(language: UiLanguage = DEFAULT_UI_LANGUAGE) -> Texts:
    """The translator of ``language`` (one per language, shared)."""
    return Texts(language, CATALOGS[language])


def placeholders(template: str) -> frozenset[str]:
    """The named placeholders of a template (``{person}`` → ``person``)."""
    return frozenset(name for _, name, _, _ in string.Formatter().parse(template) if name)


__all__ = ["CATALOGS", "Catalog", "Texts", "placeholders", "texts"]
