"""Spanish labels of administration (slice 4 §1.2): one source for the audit descriptions.

The frontend keeps the same role labels (``features/admin/model.ts``, pinned by a test).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

from cc_platform.application.cases.copy import LANGUAGE_NAME
from cc_platform.domain.people.staff import Language, StaffRole

ROLE_LABEL: Mapping[StaffRole, str] = {
    StaffRole.ANALYST: "Analista",
    StaffRole.SUPERVISOR: "Supervisión",
    StaffRole.ADMIN: "Administración",
}

__all__ = ["LANGUAGE_NAME", "ROLE_LABEL", "join_es", "language_names", "role_labels"]


def join_es(items: Sequence[str]) -> str:
    """A list in Spanish: "A", "A y B", "A, B y C" (empty → "")."""
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return f"{', '.join(items[:-1])} y {items[-1]}"


def role_labels(values: Iterable[object]) -> list[str]:
    """Labels of role values (as stored in payloads), canonical order, unknown ones skipped."""
    held = {str(value) for value in values}
    return [ROLE_LABEL[role] for role in StaffRole if role.value in held]


def language_names(values: Iterable[object]) -> list[str]:
    """Lower-case names of language values, sorted like the payloads (es, pt)."""
    held = {str(value) for value in values}
    return [LANGUAGE_NAME[language] for language in Language if language.value in held]
