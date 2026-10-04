"""Audit catalog of administration (slice 4 §7.1): the family, and every Spanish
description, including the session suffixes and the changed availability/session texts."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from cc_platform.application.audit.catalog import (
    CHANGES_STATE,
    FAMILY,
    AuditFamily,
    AuditNames,
    describe,
    types_of,
)
from cc_platform.application.events import StoredEvent
from cc_platform.application.people.admin.copy import ROLE_LABEL, join_es

T = datetime(2026, 10, 3, 14, tzinfo=UTC)
ANA, VALERIA = "STF-" + "0" * 22 + "1001", "STF-" + "0" * 25 + "7"
TEAM = "TEAM-" + "0" * 25 + "4"
NAMES = AuditNames(people={ANA: "Ana Gil", VALERIA: "Valeria Quintero"})


def stored(
    event_type: str, payload: dict[str, Any], *, entity_id: str = ANA, actor_id: str = VALERIA
) -> StoredEvent:
    return StoredEvent(
        sequence=1,
        event_id="EVT-" + "0" * 25 + "1",
        event_type=event_type,
        entity=event_type.split(".", maxsplit=1)[0],
        entity_id=entity_id,
        case_id=None,
        actor_role="admin",
        actor_id=actor_id,
        event_time=T,
        ingested_at=T,
        payload=payload,
    )


ADMIN_TYPES = {
    "staff.created", "staff.profile_updated", "staff.roles_changed", "staff.languages_changed",
    "staff.team_changed", "staff.deactivated", "staff.reactivated", "staff.account_unlocked",
    "staff.password_reset", "team.created", "team.renamed", "team.deactivated",
    "team.reactivated",
}  # fmt: skip


def test_the_administration_family_changes_state() -> None:
    assert types_of(AuditFamily.ADMINISTRATION) == ADMIN_TYPES
    assert ADMIN_TYPES <= CHANGES_STATE
    assert FAMILY["staff.availability_changed"] is AuditFamily.AVAILABILITY


@pytest.mark.parametrize(
    ("event_type", "payload", "expected"),
    [
        (
            "staff.created",
            {"name": "Ana Gil", "roles": ["analyst"], "languages": ["pt"],
             "team_id": TEAM, "team_name": "Equipo Andes"},
            "Creó la cuenta de Ana Gil · Analista · Equipo Andes",
        ),
        (
            "staff.created",
            {"name": "Ana Gil", "roles": ["analyst", "supervisor", "admin"], "languages": [],
             "team_id": TEAM, "team_name": "Equipo Sur"},
            "Creó la cuenta de Ana Gil · Analista, Supervisión y Administración · Equipo Sur",
        ),
        (
            "staff.profile_updated",
            {"changed_fields": ["name"], "from_name": "Ana Gil", "to_name": "Ana María Gil"},
            "Cambió el nombre de Ana Gil a Ana María Gil",
        ),
        (
            "staff.profile_updated",
            {"changed_fields": ["email"], "from_name": "Ana Gil", "to_name": "Ana Gil"},
            "Cambió el correo de Ana Gil",
        ),
        (
            "staff.profile_updated",
            {"changed_fields": ["name", "email"], "from_name": "Ana", "to_name": "Ana Gil"},
            "Cambió el nombre y el correo de Ana Gil (antes Ana)",
        ),
        (
            "staff.roles_changed",
            {"from_roles": ["analyst"], "to_roles": ["analyst", "supervisor"],
             "added": ["supervisor"], "removed": []},
            "Le dio a Ana Gil el rol de Supervisión",
        ),
        (
            "staff.roles_changed",
            {"from_roles": ["analyst", "admin"], "to_roles": ["analyst"],
             "added": [], "removed": ["admin"]},
            "Le quitó a Ana Gil el rol de Administración",
        ),
        (
            "staff.roles_changed",
            {"from_roles": ["analyst"], "to_roles": ["supervisor", "admin"],
             "added": ["supervisor", "admin"], "removed": ["analyst"]},
            "Cambió los roles de Ana Gil: le dio Supervisión y Administración y le quitó "
            "Analista",
        ),
        (
            "staff.languages_changed",
            {"from_languages": ["es"], "to_languages": ["es", "pt"], "added": ["pt"],
             "removed": []},
            "Cambió los idiomas de Ana Gil: ahora habla español y portugués",
        ),
        (
            "staff.languages_changed",
            {"from_languages": ["es"], "to_languages": [], "added": [], "removed": ["es"]},
            "Cambió los idiomas de Ana Gil: ya no tiene idiomas",
        ),
        (
            "staff.team_changed",
            {"from_team_id": TEAM, "from_team_name": "Equipo Andes",
             "to_team_id": TEAM, "to_team_name": "Equipo Pacífico"},
            "Pasó a Ana Gil de Equipo Andes a Equipo Pacífico",
        ),
        ("staff.deactivated", {"revoked_sessions": 0}, "Desactivó la cuenta de Ana Gil"),
        (
            "staff.deactivated",
            {"revoked_sessions": 1},
            "Desactivó la cuenta de Ana Gil y cerró su sesión",
        ),
        (
            "staff.deactivated",
            {"revoked_sessions": 3},
            "Desactivó la cuenta de Ana Gil y cerró sus 3 sesiones",
        ),
        ("staff.reactivated", {}, "Reactivó la cuenta de Ana Gil"),
        (
            "staff.account_unlocked",
            {"was_locked": True, "failed_attempts": 5},
            "Desbloqueó la cuenta de Ana Gil",
        ),
        (
            "staff.account_unlocked",
            {"was_locked": False, "failed_attempts": 2},
            "Reinició los intentos de ingreso de Ana Gil",
        ),
        (
            "staff.password_reset",
            {"revoked_sessions": 0, "cleared_lock": False},
            "Restableció la contraseña de Ana Gil",
        ),
        (
            "staff.password_reset",
            {"revoked_sessions": 2, "cleared_lock": True},
            "Restableció la contraseña de Ana Gil y cerró sus 2 sesiones",
        ),
        (
            "staff.availability_changed",
            {"from_status": "available", "to_status": "paused", "reason": "deactivated"},
            "Dejó en pausa a Ana Gil al desactivar su cuenta",
        ),
        (
            "staff.availability_changed",
            {"from_status": "available", "to_status": "paused", "reason": "role_removed"},
            "Dejó en pausa a Ana Gil al quitarle el rol de Analista",
        ),
        (
            "staff.availability_changed",
            {"from_status": "available", "to_status": "paused"},
            "Pasó a En pausa",
        ),
    ],
)  # fmt: skip
def test_staff_descriptions(event_type: str, payload: dict[str, Any], expected: str) -> None:
    assert describe(stored(event_type, payload), NAMES) == expected


@pytest.mark.parametrize(
    ("event_type", "payload", "expected"),
    [
        ("team.created", {"name": "Equipo Sur"}, "Creó el equipo Equipo Sur"),
        (
            "team.renamed",
            {"from_name": "Equipo Sur", "to_name": "Equipo Austral"},
            "Le cambió el nombre al equipo Equipo Sur: ahora es Equipo Austral",
        ),
        ("team.deactivated", {"name": "Equipo Sur"}, "Desactivó el equipo Equipo Sur"),
        ("team.reactivated", {"name": "Equipo Sur"}, "Reactivó el equipo Equipo Sur"),
    ],
)
def test_team_descriptions(event_type: str, payload: dict[str, Any], expected: str) -> None:
    assert describe(stored(event_type, payload, entity_id=TEAM), NAMES) == expected


def test_session_ended_by_administration_names_its_owner() -> None:
    by_admin = stored("auth.session_ended", {"staff_id": ANA, "reason": "revoked"},
                      entity_id="SES-" + "0" * 25 + "1")  # fmt: skip
    assert describe(by_admin, NAMES) == "Cerró la sesión de Ana Gil"
    own = stored("auth.session_ended", {"staff_id": ANA, "reason": "revoked"}, actor_id=ANA)
    assert describe(own, NAMES) == "Su sesión se revocó"
    logout = stored("auth.session_ended", {"staff_id": ANA, "reason": "logout"}, actor_id=ANA)
    assert describe(logout, NAMES) == "Cerró sesión"


def test_spanish_lists_and_role_labels() -> None:
    assert [join_es([]), join_es(["A"]), join_es(["A", "B"]), join_es(["A", "B", "C"])] == [
        "",
        "A",
        "A y B",
        "A, B y C",
    ]
    assert [ROLE_LABEL[r] for r in ROLE_LABEL] == ["Analista", "Supervisión", "Administración"]
