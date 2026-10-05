"""Slice 23c: administration picks the invitee's platform language; her emails and the
activation screens follow it (``uiLanguage``)."""

from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from cc_platform.infrastructure.seed.onboarding import BRUNA
from cc_platform.infrastructure.seed.people import seed_team_id
from tests.api.test_onboarding_api import API, token_for
from tests.support import ADMIN_ONLY, bearer

SignIn = Callable[[str], str]
ANA = {
    "name": "Ana Gil",
    "email": "ana.gil@latambank.example",
    "roles": ["analyst"],
    "languages": ["pt"],
    "teamId": seed_team_id(2),
}


def newest_subject(client: TestClient, email: str) -> str:
    items = client.get("/api/v1/dev/mailbox").json()["items"]
    subject: str = next(m["subject"] for m in items if m["to"] == email)
    return subject


def test_the_invitee_gets_her_language(client: TestClient, sign_in: SignIn) -> None:
    admin = bearer(sign_in(ADMIN_ONLY.email))
    created = client.post("/api/v1/admin/users", json={**ANA, "uiLanguage": "pt-BR"}, headers=admin)
    assert created.status_code == 201, created.text
    assert newest_subject(client, ANA["email"]) == "Seu convite para a Plataforma CC do LATAM Bank"
    check = client.post(f"{API}/invitations/check", json={"token": token_for(client, ANA["email"])})
    assert check.json()["uiLanguage"] == "pt-BR"
    # Bruna (seeded) was invited in Portuguese; without a choice it is Spanish.
    bruna = client.post(f"{API}/invitations/check", json={"token": token_for(client, BRUNA.email)})
    assert bruna.json()["uiLanguage"] == "pt-BR"
    other = {**ANA, "email": "otra.persona@latambank.example"}
    assert client.post("/api/v1/admin/users", json=other, headers=admin).status_code == 201
    assert newest_subject(client, other["email"]) == "Te invitaron a la Plataforma CC de LATAM Bank"


def test_only_known_languages(client: TestClient, sign_in: SignIn) -> None:
    admin = bearer(sign_in(ADMIN_ONLY.email))
    for bad in ("pt", "en", ""):
        body = {**ANA, "uiLanguage": bad}
        response = client.post("/api/v1/admin/users", json=body, headers=admin)
        assert (response.status_code, response.json()["code"]) == (422, "validation_error")
