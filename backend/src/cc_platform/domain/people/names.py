"""Names of people and teams: one normalisation, one comparison key (slice 4 §1.3, §2.1).

A name is trimmed and its inner runs of whitespace collapse to one space. Lengths are
team-generated limits: a person 2–120 characters, a team 2–80. ``fold`` is the comparison
key used for uniqueness (team names), sorting and search: case-folded, accents stripped,
spaces collapsed ("Disputas · Equipo Pacífico" and "disputas · equipo pacifico" are the same
team name).
"""

from __future__ import annotations

import unicodedata

from cc_platform.domain.shared.errors import InvalidValueError

#: Team-generated limits (contract §1.3).
PERSON_NAME_LENGTH = (2, 120)
TEAM_NAME_LENGTH = (2, 80)


def collapse_spaces(value: str) -> str:
    return " ".join(value.split())


def fold(value: str) -> str:
    """Case- and accent-insensitive key with collapsed spaces."""
    decomposed = unicodedata.normalize("NFKD", collapse_spaces(value))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def _normalize(value: str, limits: tuple[int, int], *, field: str, message: str) -> str:
    collapsed = collapse_spaces(value)
    low, high = limits
    if not low <= len(collapsed) <= high:
        raise InvalidValueError(message, field=field)
    return collapsed


def normalize_person_name(value: str) -> str:
    return _normalize(
        value,
        PERSON_NAME_LENGTH,
        field="name",
        message="Escribe el nombre completo (entre 2 y 120 caracteres).",
    )


def normalize_team_name(value: str) -> str:
    return _normalize(
        value,
        TEAM_NAME_LENGTH,
        field="name",
        message="Escribe un nombre de equipo de entre 2 y 80 caracteres.",
    )


def team_name_key(name: str) -> str:
    """Uniqueness key of a team name (unique among all teams, active or not)."""
    return fold(name)
