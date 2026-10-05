"""The AI switch over the API (slice 18 contract §2, §4–§6): Administración reads and changes it,
staff read it in ``/auth/me``, the simulator in ``/customer/platform``; the audit row and the
live ``platform.updated`` on ``platform:settings`` for staff and customers."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.platform import (
    AdminPlatformSettings,
    PlatformSettings,
    SetAiEnabledResult,
)
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.api.test_cases_realtime import connect, subscribe, until_pong
from tests.support import (
    ADMIN_ONLY,
    ANALYST,
    DEV_MFA_CODE,
    PASSWORD,
    SUPERVISOR,
    bearer,
    make_settings,
)

SignIn = Callable[[str], str]
CustomerSession = Callable[..., str]
NATALIA = 2001


def set_ai(client: TestClient, token: str | None, body: Any) -> Any:
    headers = bearer(token) if token else {}
    return client.put("/api/v1/admin/platform/ai", headers=headers, json=body)


def problem(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    body: dict[str, Any] = response.json()
    assert body["code"] == code
    return body


def test_the_default_comes_from_the_deployment(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    response = client.get("/api/v1/admin/platform", headers=bearer(admin))
    assert response.status_code == 200, response.text
    body = response.json()
    assert AdminPlatformSettings.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body == {
        "aiEnabled": True,
        "agentCoreConfigured": False,
        "version": 0,
        "updatedAt": None,
        "updatedByName": None,
    }
    me = client.get("/api/v1/auth/me", headers=bearer(sign_in(ANALYST.email))).json()
    assert me["platform"] == {"aiEnabled": True}


def test_cc_ai_enabled_false_starts_with_ai_off(clock: FixedClock, tmp_path: Path) -> None:
    settings = make_settings(
        ai_enabled=False, database_url=f"sqlite+aiosqlite:///{tmp_path / 'off.db'}"
    )
    container = build_container(settings, clock=clock, ids=SequentialIdGenerator())
    with TestClient(create_app(container=container)) as client:
        login = client.post(
            "/api/v1/auth/login", json={"email": ANALYST.email, "password": PASSWORD}
        ).json()
        session = client.post(
            "/api/v1/auth/mfa", json={"challengeId": login["challengeId"], "code": DEV_MFA_CODE}
        ).json()
        me = client.get("/api/v1/auth/me", headers=bearer(session["token"])).json()
        assert me["platform"] == {"aiEnabled": False}


def test_administration_turns_it_off_and_on(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    off = set_ai(client, admin, {"enabled": False})
    assert off.status_code == 200, off.text
    body = off.json()
    assert SetAiEnabledResult.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["changed"] is True
    settings = body["settings"]
    assert (settings["aiEnabled"], settings["version"]) == (False, 1)
    assert settings["updatedByName"] == ADMIN_ONLY.name
    assert settings["updatedAt"] is not None

    again = set_ai(client, admin, {"enabled": False})
    assert again.json() == {**body, "changed": False}

    me = client.get("/api/v1/auth/me", headers=bearer(sign_in(SUPERVISOR.email))).json()
    assert me["platform"] == {"aiEnabled": False}
    customer = customer_session(NATALIA)
    seen = client.get("/api/v1/customer/platform", headers=bearer(customer))
    assert seen.status_code == 200, seen.text
    assert PlatformSettings.model_validate(seen.json()).ai_enabled is False

    on = set_ai(client, admin, {"enabled": True}).json()
    assert (on["changed"], on["settings"]["aiEnabled"], on["settings"]["version"]) == (
        True,
        True,
        2,
    )
    assert client.get("/api/v1/customer/platform", headers=bearer(customer)).json() == {
        "aiEnabled": True
    }


def test_only_administration_changes_it(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    for email in (ANALYST.email, SUPERVISOR.email):
        token = sign_in(email)
        forbidden = problem(set_ai(client, token, {"enabled": False}), 403, "forbidden")
        assert forbidden["requiredRoles"] == ["admin"]
        problem(client.get("/api/v1/admin/platform", headers=bearer(token)), 403, "forbidden")
    problem(set_ai(client, None, {"enabled": False}), 401, "unauthenticated")
    customer = customer_session(NATALIA)
    problem(set_ai(client, customer, {"enabled": False}), 401, "unauthenticated")
    problem(client.get("/api/v1/customer/platform"), 401, "unauthenticated")
    admin = sign_in(ADMIN_ONLY.email)
    for bad in ({}, {"enabled": "maybe"}, {"enabled": True, "extra": 1}):
        problem(set_ai(client, admin, bad), 422, "validation_error")


def test_the_audit_says_who_turned_it_off(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    set_ai(client, admin, {"enabled": False})
    set_ai(client, admin, {"enabled": True})
    page = client.get(
        "/api/v1/audit/events",
        headers=bearer(admin),
        params={"family": "administration", "limit": 5},
    ).json()
    toggles = [e for e in page["items"] if e["type"] == "platform.ai_toggled"]
    assert [(e["actor"]["name"], e["description"]) for e in toggles] == [
        (ADMIN_ONLY.name, "Activó las funciones de IA"),
        (ADMIN_ONLY.name, "Desactivó las funciones de IA"),
    ]
    assert [e["payload"] for e in toggles] == [{"enabled": True}, {"enabled": False}]
    assert all(e["changesState"] for e in toggles)


def test_the_change_reaches_staff_and_customers_live(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    daniela, admin = sign_in(ANALYST.email), sign_in(ADMIN_ONLY.email)
    customer = customer_session(NATALIA)
    with connect(client, daniela) as staff_ws, connect(client, customer) as customer_ws:
        for ws in (staff_ws, customer_ws):
            assert ws.receive_json()["type"] == "welcome"
            assert subscribe(ws, "platform:settings")["type"] == "subscribed"
        assert subscribe(staff_ws, "platform:other")["type"] == "error"

        set_ai(client, admin, {"enabled": False})
        for ws in (staff_ws, customer_ws):
            updates = [e for e in until_pong(ws) if e["type"] == "platform.updated"]
            assert [e["data"]["payload"] for e in updates] == [{"aiEnabled": False}]
            assert updates[0]["data"]["actor"]["id"] is None  # customers listen too

        set_ai(client, admin, {"enabled": False})  # no change, no envelope
        assert [e for e in until_pong(staff_ws) if e["type"] == "platform.updated"] == []
