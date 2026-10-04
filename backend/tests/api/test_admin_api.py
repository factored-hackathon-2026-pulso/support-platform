"""Administration API (slice 4 §5, part 4): RBAC on every route, the problem shapes and
extensions, ``version_conflict.current``, idempotent invitations, the invitation and reset
links (never a password), and what an account change does to the person's next request."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.api.schemas.administration import (
    AdminTeam,
    AdminTeamDetail,
    AdminTeamList,
    AdminUser,
    AdminUserChange,
    AdminUserList,
    InvitedUser,
    PasswordResetLinkSent,
)
from cc_platform.bootstrap.container import Container
from cc_platform.infrastructure.seed.people import seed_staff_id, seed_team_id
from tests.support import (
    ADMIN,
    ADMIN_ONLY,
    ANALYST,
    DEV_MFA_CODE,
    MARIANA,
    PASSWORD,
    SUPERVISOR,
    TEAM_LEAD,
    TOMAS,
    bearer,
)

SignIn = Callable[[str], str]
PROBLEM = "application/problem+json"
ANDES, PACIFICO, CARIBE = seed_team_id(1), seed_team_id(2), seed_team_id(4)
DANIELA_ID, TOMAS_ID, VALERIA_ID = seed_staff_id(1), seed_staff_id(8), seed_staff_id(7)
FELIPE_ID, MARIANA_ID, ANDRES_ID = seed_staff_id(11), seed_staff_id(12), seed_staff_id(13)
TATIANA_ID, BRUNA_ID = seed_staff_id(14), seed_staff_id(15)
UNKNOWN_STAFF = "STF-" + "9" * 26
NEW_USER = {
    "name": "Ana Gil",
    "email": "ana.gil@latambank.example",
    "roles": ["analyst"],
    "languages": ["pt"],
    "teamId": PACIFICO,
}

#: Every administration route with a body that passes validation.
ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/api/v1/admin/users", None),
    ("GET", f"/api/v1/admin/users/{DANIELA_ID}", None),
    ("POST", "/api/v1/admin/users", NEW_USER),
    ("PATCH", f"/api/v1/admin/users/{DANIELA_ID}", {"expectedVersion": 1, "name": "Daniela R"}),
    ("POST", f"/api/v1/admin/users/{TOMAS_ID}/deactivate", {"expectedVersion": 1}),
    ("POST", f"/api/v1/admin/users/{ANDRES_ID}/reactivate", {"expectedVersion": 1}),
    ("POST", f"/api/v1/admin/users/{MARIANA_ID}/unlock", None),
    ("POST", f"/api/v1/admin/users/{MARIANA_ID}/password-reset", None),
    ("POST", f"/api/v1/admin/users/{BRUNA_ID}/invitation/resend", None),
    ("POST", f"/api/v1/admin/users/{BRUNA_ID}/invitation/cancel", None),
    ("GET", "/api/v1/admin/teams", None),
    ("GET", f"/api/v1/admin/teams/{ANDES}", None),
    ("POST", "/api/v1/admin/teams", {"name": "Equipo Sur"}),
    ("PATCH", f"/api/v1/admin/teams/{CARIBE}", {"expectedVersion": 1, "name": "Caribe"}),
    ("POST", f"/api/v1/admin/teams/{CARIBE}/deactivate", {"expectedVersion": 1}),
    ("POST", f"/api/v1/admin/teams/{CARIBE}/reactivate", {"expectedVersion": 1}),
]


def call(
    client: TestClient, method: str, path: str, body: dict[str, Any] | None, token: str | None
) -> Any:
    headers = bearer(token) if token else {}
    return client.request(method, path, json=body, headers=headers)


@pytest.mark.parametrize(("method", "path", "body"), ROUTES)
def test_every_route_is_for_administration_only(
    client: TestClient, sign_in: SignIn, method: str, path: str, body: dict[str, Any] | None
) -> None:
    assert call(client, method, path, body, None).json()["code"] == "unauthenticated"
    for seed in (ANALYST, SUPERVISOR, TEAM_LEAD):
        response = call(client, method, path, body, sign_in(seed.email))
        assert response.status_code == 403, (seed.name, path)
        assert response.json()["requiredRoles"] == ["admin"]
    allowed = call(client, method, path, body, sign_in(ADMIN_ONLY.email))
    assert allowed.status_code in {200, 201}, (path, allowed.text)


def test_list_and_get_users(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN_ONLY.email)
    listed = client.get("/api/v1/admin/users", headers=bearer(token)).json()
    assert AdminUserList.model_validate(listed).model_dump(mode="json", by_alias=True) == listed
    assert listed["roleCounts"] == {"all": 13, "analyst": 7, "supervisor": 5, "admin": 2}
    assert listed["statusCounts"] == {
        "active": 13,
        "locked": 1,
        "invited": 1,
        "inactive": 1,
        "all": 15,
    }
    invited = client.get(
        "/api/v1/admin/users", params={"status": "invited"}, headers=bearer(token)
    ).json()
    (bruna,) = invited["items"]
    assert (bruna["id"], bruna["status"], bruna["secondFactor"]) == (BRUNA_ID, "invited", None)
    assert bruna["invitation"]["status"] == "pending"
    assert set(bruna["invitation"]) == {
        "id", "status", "createdAt", "sentAt", "expiresAt", "resendCount"
    }  # fmt: skip
    mariana = next(u for u in listed["items"] if u["id"] == MARIANA_ID)
    assert (mariana["status"], mariana["failedAttempts"]) == ("locked", 5)
    assert mariana["lockedUntil"].endswith("Z")
    filtered = client.get(
        "/api/v1/admin/users",
        params={"role": "admin", "status": "all", "teamId": seed_team_id(3), "q": "valeria"},
        headers=bearer(token),
    ).json()
    assert [u["id"] for u in filtered["items"]] == [VALERIA_ID]
    assert filtered["items"][0]["guards"] == {"isSelf": True, "lastActiveAdmin": False}
    daniela = client.get(f"/api/v1/admin/users/{DANIELA_ID}", headers=bearer(token)).json()
    assert AdminUser.model_validate(daniela).model_dump(mode="json", by_alias=True) == daniela
    assert daniela["openCases"] == {"total": 6, "es": 5, "pt": 1}
    assert daniela["team"] == {"id": ANDES, "name": "Equipo Andes"}
    for bad in (UNKNOWN_STAFF, "nope", "CASE-" + "0" * 26):
        missing = client.get(f"/api/v1/admin/users/{bad}", headers=bearer(token))
        assert (missing.status_code, missing.json()["code"]) == (404, "not_found")
    for params in ({"status": "bloqueadas"}, {"role": "ceo"}, {"language": "fr"}, {"q": ""}):
        invalid = client.get("/api/v1/admin/users", params=params, headers=bearer(token))
        assert invalid.json()["code"] == "validation_error", params


def test_create_user_and_replay(client: TestClient, sign_in: SignIn, container: Container) -> None:
    token = sign_in(ADMIN_ONLY.email)
    headers = {**bearer(token), "Idempotency-Key": "create-ana-0001"}
    created = client.post("/api/v1/admin/users", json=NEW_USER, headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert InvitedUser.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert set(body) == {"user"}  # part 4: never a password
    assert (body["user"]["status"], body["user"]["invitation"]["status"]) == ("invited", "pending")
    assert "password" not in created.text.lower()
    replay = client.post("/api/v1/admin/users", json=NEW_USER, headers=headers)
    assert replay.status_code == 200
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json()["user"]["id"] == body["user"]["id"]
    other = client.post(
        "/api/v1/admin/users", json={**NEW_USER, "email": "otra@latambank.example"}, headers=headers
    )
    assert (other.status_code, other.json()["code"]) == (409, "idempotency_conflict")
    duplicate = client.post("/api/v1/admin/users", json=NEW_USER, headers=bearer(token))
    assert (duplicate.status_code, duplicate.json()["code"]) == (409, "email_taken")
    assert duplicate.json()["field"] == "email"
    # She cannot sign in until she accepts the invitation (one email, despite the replay).
    login = client.post(
        "/api/v1/auth/login", json={"email": NEW_USER["email"], "password": PASSWORD}
    )
    assert login.json()["code"] == "invalid_credentials"
    mailbox = client.get("/api/v1/dev/mailbox").json()["items"]
    assert [m["to"] for m in mailbox].count(NEW_USER["email"]) == 1


def test_invitation_resend_and_cancel(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN_ONLY.email)
    resent = client.post(f"/api/v1/admin/users/{BRUNA_ID}/invitation/resend", headers=bearer(token))
    assert resent.status_code == 200, resent.text
    assert (
        AdminUserChange.model_validate(resent.json()).model_dump(mode="json", by_alias=True)
        == resent.json()
    )
    assert resent.json()["user"]["invitation"]["resendCount"] == 1
    cancelled = client.post(
        f"/api/v1/admin/users/{BRUNA_ID}/invitation/cancel", headers=bearer(token)
    )
    assert (cancelled.status_code, cancelled.json()["user"]["status"]) == (200, "cancelled")
    again = client.post(f"/api/v1/admin/users/{BRUNA_ID}/invitation/cancel", headers=bearer(token))
    assert (again.status_code, again.json()["code"]) == (409, "invalid_transition")
    for staff_id in (TATIANA_ID, DANIELA_ID):  # active people have no pending invitation
        resend = client.post(
            f"/api/v1/admin/users/{staff_id}/invitation/resend", headers=bearer(token)
        )
        assert (resend.status_code, resend.json()["code"]) == (409, "invalid_transition")
    missing = client.post(
        f"/api/v1/admin/users/{UNKNOWN_STAFF}/invitation/resend", headers=bearer(token)
    )
    assert (missing.status_code, missing.json()["code"]) == (404, "not_found")
    listed = client.get("/api/v1/admin/users?status=all", headers=bearer(token)).json()
    assert BRUNA_ID not in {u["id"] for u in listed["items"]}
    assert listed["statusCounts"]["invited"] == 0
    # Reactivating or resetting someone who never activated her account is refused.
    tatiana = client.get(f"/api/v1/admin/users/{TATIANA_ID}", headers=bearer(token)).json()
    assert tatiana["secondFactor"] == "totp"
    reactivate = client.post(
        f"/api/v1/admin/users/{BRUNA_ID}/reactivate",
        json={"expectedVersion": cancelled.json()["user"]["version"]},
        headers=bearer(token),
    )
    assert (reactivate.status_code, reactivate.json()["code"]) == (409, "staff_invited")
    reset = client.post(f"/api/v1/admin/users/{BRUNA_ID}/password-reset", headers=bearer(token))
    assert (reset.status_code, reset.json()["code"]) == (409, "staff_invited")


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({**NEW_USER, "name": " A "}, (422, "invalid_value", {"field": "name"})),
        ({**NEW_USER, "email": "ana"}, (422, "invalid_value", {"field": "email"})),
        ({**NEW_USER, "languages": []}, (422, "invalid_value", {"field": "languages"})),
        ({**NEW_USER, "teamId": "TEAM-x"}, (422, "invalid_value", {"field": "teamId"})),
        ({**NEW_USER, "teamId": CARIBE}, (422, "team_inactive", {"teamId": CARIBE})),
        ({**NEW_USER, "roles": []}, (422, "validation_error", {})),
        ({**NEW_USER, "roles": ["analyst", "analyst"]}, (422, "validation_error", {})),
        ({**NEW_USER, "level": 2}, (422, "validation_error", {})),
    ],
)
def test_create_user_problems(
    client: TestClient,
    sign_in: SignIn,
    body: dict[str, Any],
    expected: tuple[int, str, dict[str, Any]],
) -> None:
    status, code, extra = expected
    response = client.post("/api/v1/admin/users", json=body, headers=bearer(sign_in(ADMIN.email)))
    assert response.status_code == status
    assert response.headers["content-type"] == PROBLEM
    problem = response.json()
    assert problem["code"] == code
    assert {key: problem[key] for key in extra} == extra


def test_bad_idempotency_keys_are_rejected(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN.email)
    for key in ("short", "has spaces in it", "x" * 65):
        response = client.post(
            "/api/v1/admin/users", json=NEW_USER, headers={**bearer(token), "Idempotency-Key": key}
        )
        assert response.json()["code"] == "validation_error", key


def test_version_conflict_carries_the_current_record(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN_ONLY.email)
    tomas = client.get(f"/api/v1/admin/users/{TOMAS_ID}", headers=bearer(token)).json()
    first = client.patch(
        f"/api/v1/admin/users/{TOMAS_ID}",
        json={"expectedVersion": tomas["version"], "name": "Tomás Arango Paz"},
        headers=bearer(token),
    )
    assert first.status_code == 200
    assert first.json()["changed"] is True
    stale = client.patch(
        f"/api/v1/admin/users/{TOMAS_ID}",
        json={"expectedVersion": tomas["version"], "languages": ["es"]},
        headers=bearer(token),
    )
    assert stale.status_code == 409
    problem = stale.json()
    assert problem["code"] == "version_conflict"
    assert problem["currentVersion"] == tomas["version"] + 1
    current = problem["current"]
    assert AdminUser.model_validate(current).model_dump(mode="json", by_alias=True) == current
    assert (current["name"], current["version"]) == ("Tomás Arango Paz", tomas["version"] + 1)
    team = client.get(f"/api/v1/admin/teams/{CARIBE}", headers=bearer(token)).json()["team"]
    stale_team = client.post(
        f"/api/v1/admin/teams/{CARIBE}/reactivate",
        json={"expectedVersion": team["version"] + 1},
        headers=bearer(token),
    ).json()
    assert stale_team["code"] == "version_conflict"
    assert AdminTeam.model_validate(stale_team["current"]).id == CARIBE


def test_patch_needs_something_to_change(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN.email)
    for body in ({"expectedVersion": 1}, {"expectedVersion": 0, "name": "X Y"}, {"name": "X Y"}):
        response = client.patch(f"/api/v1/admin/users/{TOMAS_ID}", json=body, headers=bearer(token))
        assert response.json()["code"] == "validation_error", body


def test_guard_rail_problems(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN_ONLY.email)
    me = client.get(f"/api/v1/admin/users/{VALERIA_ID}", headers=bearer(token)).json()
    own = client.patch(
        f"/api/v1/admin/users/{VALERIA_ID}",
        json={"expectedVersion": me["version"], "roles": ["supervisor"]},
        headers=bearer(token),
    ).json()
    assert (own["code"], own["status"], own["action"]) == (
        "self_change_forbidden",
        422,
        "remove_own_admin",
    )
    off = client.post(
        f"/api/v1/admin/users/{VALERIA_ID}/deactivate",
        json={"expectedVersion": me["version"]},
        headers=bearer(token),
    ).json()
    assert off["action"] == "deactivate_self"
    reset = client.post(f"/api/v1/admin/users/{VALERIA_ID}/password-reset", headers=bearer(token))
    assert reset.json()["action"] == "reset_own_password"
    daniela = client.get(f"/api/v1/admin/users/{DANIELA_ID}", headers=bearer(token)).json()
    blocked = client.post(
        f"/api/v1/admin/users/{DANIELA_ID}/deactivate",
        json={"expectedVersion": daniela["version"]},
        headers=bearer(token),
    ).json()
    assert (blocked["code"], blocked["blockReason"], blocked["openCases"]) == (
        "staff_has_open_cases",
        "deactivate",
        6,
    )
    assert len(blocked["caseIds"]) == 6
    pt = client.patch(
        f"/api/v1/admin/users/{DANIELA_ID}",
        json={"expectedVersion": daniela["version"], "languages": ["es"]},
        headers=bearer(token),
    ).json()
    assert (pt["blockReason"], pt["caseLanguage"], pt["openCases"]) == ("remove_language", "pt", 1)
    andes = client.get(f"/api/v1/admin/teams/{ANDES}", headers=bearer(token)).json()["team"]
    full = client.post(
        f"/api/v1/admin/teams/{ANDES}/deactivate",
        json={"expectedVersion": andes["version"]},
        headers=bearer(token),
    ).json()
    assert (full["code"], full["memberCount"]) == ("team_not_empty", 6)  # + Tatiana, Bruna
    andres = client.post(f"/api/v1/admin/users/{ANDRES_ID}/password-reset", headers=bearer(token))
    assert (andres.status_code, andres.json()["code"]) == (409, "staff_inactive")
    taken = client.post("/api/v1/admin/teams", json={"name": "EQUIPO andes"},
                        headers=bearer(token)).json()  # fmt: skip
    assert (taken["code"], taken["field"]) == ("team_name_taken", "name")


def test_reset_password_response(client: TestClient, sign_in: SignIn) -> None:
    response = client.post(
        f"/api/v1/admin/users/{MARIANA_ID}/password-reset", headers=bearer(sign_in(ADMIN.email))
    )
    assert response.status_code == 200
    body = response.json()
    assert PasswordResetLinkSent.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert set(body) == {"user", "revokedSessions", "expiresAt"}  # part 4: never a password
    assert body["user"]["status"] == "active"  # the lock is cleared
    # The link went to her email; her password keeps working until she sets a new one.
    (email,) = [m for m in client.get("/api/v1/dev/mailbox").json()["items"]
                if m["to"] == MARIANA.email]  # fmt: skip
    assert (email["kind"], email["subject"]) == (
        "password_reset",
        "Crea una contraseña nueva para la Plataforma CC",
    )
    assert "/restablecer?token=" in email["link"]
    login = client.post("/api/v1/auth/login", json={"email": MARIANA.email, "password": PASSWORD})
    assert login.status_code == 200


def start_sign_in(client: TestClient, email: str, password: str = PASSWORD) -> str:
    """The password step only: the challenge id of a sign-in still waiting for its code."""
    login = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    challenge_id: str = login.json()["challengeId"]
    return challenge_id


def finish_sign_in(client: TestClient, challenge_id: str) -> Any:
    return client.post("/api/v1/auth/mfa", json={"challengeId": challenge_id, "code": DEV_MFA_CODE})


def test_a_password_reset_cancels_a_sign_in_past_the_password_step(
    client: TestClient, sign_in: SignIn
) -> None:
    pending = start_sign_in(client, TOMAS.email)  # the old password, before the reset
    admin = sign_in(ADMIN.email)
    reset = client.post(f"/api/v1/admin/users/{TOMAS_ID}/password-reset", headers=bearer(admin))
    assert reset.status_code == 200
    late = finish_sign_in(client, pending)
    assert (late.status_code, late.json()["code"]) == (401, "mfa_challenge_invalid")
    assert "token" not in late.json()
    fresh = finish_sign_in(client, start_sign_in(client, TOMAS.email))
    assert fresh.status_code == 200


def test_deactivate_and_reactivate_cancel_a_sign_in_past_the_password_step(
    client: TestClient, sign_in: SignIn
) -> None:
    pending = start_sign_in(client, TOMAS.email)
    admin = sign_in(ADMIN.email)
    current = client.get(f"/api/v1/admin/users/{TOMAS_ID}", headers=bearer(admin)).json()
    off = client.post(
        f"/api/v1/admin/users/{TOMAS_ID}/deactivate",
        json={"expectedVersion": current["version"]},
        headers=bearer(admin),
    ).json()
    on = client.post(
        f"/api/v1/admin/users/{TOMAS_ID}/reactivate",
        json={"expectedVersion": off["user"]["version"]},
        headers=bearer(admin),
    )
    assert on.json()["changed"] is True
    late = finish_sign_in(client, pending)
    assert (late.status_code, late.json()["code"]) == (401, "mfa_challenge_invalid")
    assert finish_sign_in(client, start_sign_in(client, TOMAS.email)).status_code == 200


def test_unlock_then_mariana_signs_in(client: TestClient, sign_in: SignIn) -> None:
    locked = client.post("/api/v1/auth/login", json={"email": MARIANA.email, "password": PASSWORD})
    assert (locked.status_code, locked.json()["code"]) == (423, "account_locked")
    token = sign_in(ADMIN_ONLY.email)
    response = client.post(f"/api/v1/admin/users/{MARIANA_ID}/unlock", headers=bearer(token))
    assert (response.json()["changed"], response.json()["revokedSessions"]) == (True, 0)
    assert sign_in(MARIANA.email)
    again = client.post(f"/api/v1/admin/users/{MARIANA_ID}/unlock", headers=bearer(token))
    assert again.json()["changed"] is False
    events = client.get(
        "/api/v1/audit/events", params={"family": "administration"}, headers=bearer(token)
    ).json()["items"]
    assert events[0]["description"] == "Desbloqueó la cuenta de Mariana Duque"
    assert events[0]["entity"] == "staff"


def test_teams_endpoints(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN_ONLY.email)
    listed = client.get("/api/v1/admin/teams", params={"status": "all"}, headers=bearer(token))
    body = listed.json()
    assert AdminTeamList.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["statusCounts"] == {"active": 3, "inactive": 1, "all": 4}
    assert [t["name"] for t in body["items"]] == [
        "Administración de la plataforma",
        "Equipo Andes",
        "Equipo Caribe",
        "Equipo Pacífico",
    ]
    detail = client.get(f"/api/v1/admin/teams/{PACIFICO}", headers=bearer(token)).json()
    assert AdminTeamDetail.model_validate(detail).model_dump(mode="json", by_alias=True) == detail
    assert detail["team"]["memberCount"] == 6
    headers = {**bearer(token), "Idempotency-Key": "team-sur-0001"}
    created = client.post("/api/v1/admin/teams", json={"name": "Equipo Sur"}, headers=headers)
    assert created.status_code == 201
    replay = client.post("/api/v1/admin/teams", json={"name": "equipo sur"}, headers=headers)
    assert (replay.status_code, replay.headers["Idempotent-Replayed"]) == (200, "true")
    team_id = created.json()["id"]
    renamed = client.patch(
        f"/api/v1/admin/teams/{team_id}",
        json={"expectedVersion": 1, "name": "Equipo Austral"},
        headers=bearer(token),
    ).json()
    assert (renamed["changed"], renamed["team"]["name"], renamed["team"]["version"]) == (
        True,
        "Equipo Austral",
        2,
    )
    off = client.post(
        f"/api/v1/admin/teams/{team_id}/deactivate", json={"expectedVersion": 2},
        headers=bearer(token),
    ).json()  # fmt: skip
    assert off["team"]["active"] is False
    move_in = client.patch(
        f"/api/v1/admin/users/{TOMAS_ID}",
        json={"expectedVersion": 1, "teamId": team_id},
        headers=bearer(token),
    ).json()
    assert (move_in["code"], move_in["teamId"]) == ("team_inactive", team_id)
    assert client.get("/api/v1/admin/teams/TEAM-x", headers=bearer(token)).status_code == 404


def test_a_role_removed_applies_on_the_next_request(client: TestClient, sign_in: SignIn) -> None:
    felipe = sign_in(TEAM_LEAD.email)
    assert client.get("/api/v1/supervision/team", headers=bearer(felipe)).status_code == 200
    admin = sign_in(ADMIN_ONLY.email)
    current = client.get(f"/api/v1/admin/users/{FELIPE_ID}", headers=bearer(admin)).json()
    changed = client.patch(
        f"/api/v1/admin/users/{FELIPE_ID}",
        json={"expectedVersion": current["version"], "roles": ["analyst"]},
        headers=bearer(admin),
    )
    assert changed.status_code == 200
    denied = client.get("/api/v1/supervision/team", headers=bearer(felipe))
    assert (denied.status_code, denied.json()["code"]) == (403, "forbidden")
    me = client.get("/api/v1/auth/me", headers=bearer(felipe)).json()  # same token, new roles
    assert me["staff"]["roles"] == ["analyst"]


def test_a_deactivated_account_loses_its_token_and_cannot_sign_in(
    client: TestClient, sign_in: SignIn
) -> None:
    tomas = sign_in(TOMAS.email)
    admin = sign_in(ADMIN.email)
    current = client.get(f"/api/v1/admin/users/{TOMAS_ID}", headers=bearer(admin)).json()
    result = client.post(
        f"/api/v1/admin/users/{TOMAS_ID}/deactivate",
        json={"expectedVersion": current["version"]},
        headers=bearer(admin),
    ).json()
    assert (result["changed"], result["revokedSessions"]) == (True, 1)
    assert client.get("/api/v1/auth/me", headers=bearer(tomas)).json()["code"] == "unauthenticated"
    login = client.post("/api/v1/auth/login", json={"email": TOMAS.email, "password": PASSWORD})
    assert (login.status_code, login.json()["code"]) == (401, "invalid_credentials")
    assert login.json()["detail"] == "El correo o la contraseña no coinciden."


def test_admin_audit_family_and_staff_include_inactive(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ADMIN_ONLY.email)
    events = client.get(
        "/api/v1/audit/events", params={"family": "administration"}, headers=bearer(token)
    ).json()["items"]
    assert [e["description"] for e in events] == [
        "Invitó a Bruna Esteves por correo",
        "Creó la cuenta de Bruna Esteves · Analista · Equipo Andes",
        "Desactivó el equipo Equipo Caribe",
        "Invitó a Tatiana Rojas por correo",
        "Creó la cuenta de Tatiana Rojas · Analista · Equipo Andes",
        "Desactivó la cuenta de Andrés Villamil",
        "Creó el equipo Equipo Caribe",
        "Le dio a Felipe Echeverri el rol de Supervisión",
    ]
    assert {e["family"] for e in events} == {"administration"}
    assert events[2]["entity"] == "team"
    # Part 4: Tatiana's own steps are her access (next to her name).
    tatiana = client.get(
        "/api/v1/audit/events",
        params={"family": "access", "actorId": TATIANA_ID},
        headers=bearer(token),
    ).json()["items"]
    assert [e["description"] for e in tatiana] == [
        "Aceptó la invitación y activó su cuenta",
        "Configuró la verificación en dos pasos",
    ]
    by_team = client.get(
        "/api/v1/audit/events", params={"q": CARIBE}, headers=bearer(token)
    ).json()["items"]
    assert len(by_team) == 2
    access = client.get(
        "/api/v1/audit/events",
        params={"family": "access", "actorId": MARIANA_ID},
        headers=bearer(token),
    ).json()["items"]
    assert access[0]["description"] == "La cuenta quedó bloqueada por 15 min tras 5 intentos"
