"""Slice 23: a person's own preferences (the UI language): ``GET|PUT /me/preferences``, the
value in ``/auth/me``, the audit row and ``preferences.updated`` on her ``staff:<id>`` only."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.api.test_cases_realtime import connect, subscribe, until_pong
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, TOMAS, bearer

SignIn = Callable[[str], str]
DANIELA_ID, TOMAS_ID = seed_staff_id(1), seed_staff_id(8)


def put_language(client: TestClient, token: str, language: str) -> Any:
    return client.put(
        "/api/v1/me/preferences", json={"uiLanguage": language}, headers=bearer(token)
    )


def of_type(envelopes: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [e for e in envelopes if e["type"] == kind]


def test_spanish_until_she_changes_it(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ANALYST.email)
    assert client.get("/api/v1/me/preferences", headers=bearer(token)).json() == {
        "uiLanguage": "es"
    }
    me = client.get("/api/v1/auth/me", headers=bearer(token)).json()
    assert me["preferences"] == {"uiLanguage": "es"}

    changed = put_language(client, token, "pt-BR")
    assert changed.status_code == 200, changed.text
    assert changed.json() == {"uiLanguage": "pt-BR"}
    assert client.get("/api/v1/me/preferences", headers=bearer(token)).json() == {
        "uiLanguage": "pt-BR"
    }
    # It follows her: a new session reads it, another person keeps hers.
    again = client.get("/api/v1/auth/me", headers=bearer(sign_in(ANALYST.email))).json()
    assert again["preferences"] == {"uiLanguage": "pt-BR"}
    other = client.get("/api/v1/auth/me", headers=bearer(sign_in(TOMAS.email))).json()
    assert other["preferences"] == {"uiLanguage": "es"}


def test_every_role_has_preferences(client: TestClient, sign_in: SignIn) -> None:
    for email in (SUPERVISOR.email, ADMIN_ONLY.email):
        response = put_language(client, sign_in(email), "pt-BR")
        assert response.status_code == 200, response.text


def test_only_known_languages(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ANALYST.email)
    for bad in ("pt", "en", "", "PT-BR"):
        response = put_language(client, token, bad)
        assert response.status_code == 422, bad
        assert response.json()["code"] == "validation_error"
    extra = client.put(
        "/api/v1/me/preferences",
        json={"uiLanguage": "es", "theme": "dark"},
        headers=bearer(token),
    )
    assert extra.status_code == 422
    assert client.get("/api/v1/me/preferences").status_code == 401


def test_the_change_is_audited_once(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ANALYST.email)
    put_language(client, token, "pt-BR")
    put_language(client, token, "pt-BR")  # same value: no event
    lucia = sign_in(SUPERVISOR.email)
    rows = client.get(
        "/api/v1/audit/events",
        params={"actorId": DANIELA_ID, "family": "access", "limit": 50},
        headers=bearer(lucia),
    ).json()["items"]
    changes = [row for row in rows if row["type"] == "staff.ui_language_changed"]
    assert [row["description"] for row in changes] == [
        "Cambió el idioma de la plataforma a Português"
    ]
    assert changes[0]["changesState"] is True


def test_her_other_sessions_follow(client: TestClient, sign_in: SignIn) -> None:
    first, second = sign_in(ANALYST.email), sign_in(ANALYST.email)
    with connect(client, second) as mine, connect(client, sign_in(TOMAS.email)) as other:
        mine.receive_json()
        other.receive_json()
        subscribe(mine, f"staff:{DANIELA_ID}")
        subscribe(other, f"staff:{TOMAS_ID}")
        put_language(client, first, "pt-BR")
        received = of_type(until_pong(mine), "preferences.updated")
        assert of_type(until_pong(other), "preferences.updated") == []
        # the raw event never reaches a socket
        put_language(client, first, "es")
        later = until_pong(mine)
        assert of_type(later, "staff.ui_language_changed") == []
    (envelope,) = received
    assert envelope["data"]["payload"] == {"uiLanguage": "pt-BR"}
    assert envelope["data"]["entityId"] == DANIELA_ID
    assert [e["data"]["payload"] for e in of_type(later, "preferences.updated")] == [
        {"uiLanguage": "es"}
    ]


def test_the_audit_speaks_the_readers_language(client: TestClient, sign_in: SignIn) -> None:
    """Slice 23c: "Qué hizo" is rendered in the reader's UI language when the log is read."""
    put_language(client, sign_in(ANALYST.email), "pt-BR")
    lucia = sign_in(SUPERVISOR.email)
    params = {"actorId": DANIELA_ID, "family": "access", "limit": 50}

    def descriptions() -> list[str]:
        rows = client.get("/api/v1/audit/events", params=params, headers=bearer(lucia))
        return [r["description"] for r in rows.json()["items"] if r["type"].startswith("staff.ui")]

    assert descriptions() == ["Cambió el idioma de la plataforma a Português"]
    put_language(client, lucia, "pt-BR")  # the reader switches: the same row, in Portuguese
    assert descriptions() == ["Mudou o idioma da plataforma para Português"]
    rows = client.get("/api/v1/audit/events", params=params, headers=bearer(lucia)).json()
    one = client.get(f"/api/v1/audit/events/{rows['items'][0]['id']}", headers=bearer(lucia))
    assert one.json()["description"] == rows["items"][0]["description"]
