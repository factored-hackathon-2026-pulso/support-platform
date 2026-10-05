"""Part 4 API: the public onboarding routes (invitation and reset links), TOTP at sign-in,
the dev mailbox, the problem shapes (410 / 422 / 423 / 429) and the realtime signals."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from cc_platform.api.schemas.onboarding import (
    ActivatedAccount,
    DevMailbox,
    InvitationCheck,
    PasswordResetCheck,
    PasswordResetDone,
    TotpEnrollment,
)
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.bootstrap.settings import Settings
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.onboarding import BRUNA, TATIANA, TATIANA_TOTP_SECRET
from cc_platform.infrastructure.seed.people import seed_staff_id, seed_team_id
from tests.api.test_cases_realtime import connect, subscribe, until_pong
from tests.support import (
    ADMIN_ONLY,
    DEV_MFA_CODE,
    INVITED_PASSWORD,
    PASSWORD,
    TOMAS,
    bearer,
    make_settings,
)

SignIn = Callable[[str], str]
API = "/api/v1/onboarding"
TOMAS_ID = seed_staff_id(8)


def model_roundtrip(schema: Any, body: dict[str, Any]) -> None:
    assert schema.model_validate(body).model_dump(mode="json", by_alias=True) == body


def token_for(client: TestClient, email: str) -> str:
    mailbox = client.get("/api/v1/dev/mailbox").json()
    model_roundtrip(DevMailbox, mailbox)
    link = next(m["link"] for m in mailbox["items"] if m["to"] == email)
    token: str = parse_qs(urlparse(link).query)["token"][0]
    return token


def sign_in_with(client: TestClient, email: str, password: str, code: str) -> Any:
    login = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return client.post(
        "/api/v1/auth/mfa", json={"challengeId": login.json()["challengeId"], "code": code}
    )


def test_the_invitation_link_end_to_end(
    client: TestClient, container: Container, clock: FixedClock
) -> None:
    token = token_for(client, BRUNA.email)
    check = client.post(f"{API}/invitations/check", json={"token": token})
    assert check.status_code == 200, check.text
    model_roundtrip(InvitationCheck, check.json())
    assert (check.json()["name"], check.json()["teamName"], check.json()["roles"]) == (
        "Bruna Esteves",
        "Equipo Andes",
        ["analyst"],
    )
    assert check.json()["passwordRules"] == {
        "minLength": 12,
        "maxLength": 128,
        "rules": ["min_length", "personal_info", "common"],
    }

    early = client.post(f"{API}/invitations/activate", json={"token": token, "code": "123456"})
    assert (early.status_code, early.json()["code"]) == (409, "invalid_transition")
    weak = client.post(f"{API}/invitations/password", json={"token": token, "password": "bruna"})
    assert (weak.status_code, weak.json()["code"]) == (422, "password_rejected")
    assert weak.json()["reasons"] == ["min_length", "personal_info"]

    enrolled = client.post(
        f"{API}/invitations/password", json={"token": token, "password": INVITED_PASSWORD}
    )
    assert enrolled.status_code == 200, enrolled.text
    body = enrolled.json()
    model_roundtrip(TotpEnrollment, body)
    assert body["otpauthUri"].startswith("otpauth://totp/LATAM%20Bank%20CC:bruna.esteves")
    assert (body["digits"], body["periodSeconds"], body["issuer"]) == (6, 30, "LATAM Bank CC")

    good = container.totp.code_at(body["secret"], clock.now())
    wrong = "000000" if good != "000000" else "111111"
    bad = client.post(f"{API}/invitations/activate", json={"token": token, "code": wrong})
    assert (bad.status_code, bad.json()["code"], bad.json()["remainingAttempts"]) == (
        422,
        "totp_invalid",
        4,
    )
    activated = client.post(f"{API}/invitations/activate", json={"token": token, "code": good})
    assert activated.status_code == 200, activated.text
    model_roundtrip(ActivatedAccount, activated.json())
    assert activated.json() == {"name": "Bruna Esteves", "email": BRUNA.email}

    used = client.post(f"{API}/invitations/check", json={"token": token})
    assert (used.status_code, used.json()["code"]) == (410, "link_invalid")
    # Her sign-in takes the code of her app; the development code is refused.
    rejected = sign_in_with(client, BRUNA.email, INVITED_PASSWORD, DEV_MFA_CODE)
    assert (rejected.status_code, rejected.json()["code"]) == (401, "mfa_invalid")
    session = sign_in_with(client, BRUNA.email, INVITED_PASSWORD, good)
    assert session.status_code == 200
    assert session.json()["staff"]["active"] is True


def test_tatiana_needs_her_authenticator(client: TestClient, container: Container) -> None:
    code = container.totp.code_at(TATIANA_TOTP_SECRET, container.clock.now())
    assert sign_in_with(client, TATIANA.email, PASSWORD, code).status_code == 200
    refused = sign_in_with(client, TATIANA.email, PASSWORD, DEV_MFA_CODE)
    assert refused.json()["code"] == "mfa_invalid"


def test_unusable_links_answer_one_generic_problem(client: TestClient) -> None:
    for path in ("invitations/check", "password-resets/check"):
        response = client.post(f"{API}/{path}", json={"token": "a" * 43})
        assert response.status_code == 410
        assert response.headers["content-type"] == "application/problem+json"
        body = response.json()
        assert (body["code"], body["detail"]) == ("link_invalid", "El enlace venció o ya se usó.")
        assert not {"name", "email", "staffId"} & set(body)
    extra = client.post(f"{API}/invitations/check", json={"token": "x", "staffId": "STF-1"})
    assert (extra.status_code, extra.json()["code"]) == (422, "validation_error")
    missing = client.post(f"{API}/invitations/check", json={})
    assert missing.json()["code"] == "validation_error"


def test_too_many_unusable_links_are_rate_limited(client: TestClient) -> None:
    for _ in range(9):
        assert client.post(f"{API}/invitations/check", json={"token": "b" * 43}).status_code == 410
    limited = client.post(f"{API}/invitations/check", json={"token": "b" * 43})
    assert (limited.status_code, limited.json()["code"]) == (429, "rate_limited")
    assert limited.json()["unlockAt"].endswith("Z")
    # Even a valid link waits now (same client).
    valid = client.post(f"{API}/invitations/check", json={"token": token_for(client, BRUNA.email)})
    assert valid.status_code == 429


def test_wrong_codes_lock_the_activation(client: TestClient, container: Container) -> None:
    token = token_for(client, BRUNA.email)
    enrolled = client.post(
        f"{API}/invitations/password", json={"token": token, "password": INVITED_PASSWORD}
    ).json()
    good = container.totp.code_at(enrolled["secret"], container.clock.now())
    wrong = "000000" if good != "000000" else "111111"
    for _ in range(4):
        response = client.post(f"{API}/invitations/activate", json={"token": token, "code": wrong})
        assert response.status_code == 422
    locked = client.post(f"{API}/invitations/activate", json={"token": token, "code": wrong})
    assert (locked.status_code, locked.json()["code"]) == (423, "account_locked")
    assert locked.json()["unlockAt"].endswith("Z")


def test_the_password_reset_link_end_to_end(client: TestClient, sign_in: SignIn) -> None:
    tomas = sign_in(TOMAS.email)
    admin = sign_in(ADMIN_ONLY.email)
    sent = client.post(f"/api/v1/admin/users/{TOMAS_ID}/password-reset", headers=bearer(admin))
    assert (sent.status_code, sent.json()["revokedSessions"]) == (200, 1)
    assert client.get("/api/v1/auth/me", headers=bearer(tomas)).status_code == 401
    token = token_for(client, TOMAS.email)
    check = client.post(f"{API}/password-resets/check", json={"token": token})
    assert check.status_code == 200
    model_roundtrip(PasswordResetCheck, check.json())
    assert check.json()["email"] == TOMAS.email
    weak = client.post(
        f"{API}/password-resets/complete", json={"token": token, "password": "tomas.arango.1"}
    )
    assert weak.json()["reasons"] == ["personal_info"]
    done = client.post(
        f"{API}/password-resets/complete", json={"token": token, "password": INVITED_PASSWORD}
    )
    assert done.status_code == 200, done.text
    model_roundtrip(PasswordResetDone, done.json())
    again = client.post(
        f"{API}/password-resets/complete", json={"token": token, "password": INVITED_PASSWORD}
    )
    assert (again.status_code, again.json()["code"]) == (410, "link_invalid")
    old = client.post("/api/v1/auth/login", json={"email": TOMAS.email, "password": PASSWORD})
    assert old.json()["code"] == "invalid_credentials"
    assert sign_in_with(client, TOMAS.email, INVITED_PASSWORD, DEV_MFA_CODE).status_code == 200


def test_invitations_signal_the_directory(
    client: TestClient, sign_in: SignIn, container: Container
) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    andes = seed_team_id(1)
    with connect(client, admin) as ws:
        ws.receive_json()
        assert subscribe(ws, "admin:directory")["type"] == "subscribed"
        token = token_for(client, BRUNA.email)
        secret = client.post(
            f"{API}/invitations/password", json={"token": token, "password": INVITED_PASSWORD}
        ).json()["secret"]
        code = container.totp.code_at(secret, container.clock.now())
        client.post(f"{API}/invitations/activate", json={"token": token, "code": code})
        envelopes = [e for e in until_pong(ws) if e["type"] == "directory.updated"]
    payloads = [e["data"]["payload"] for e in envelopes]
    assert {"staffIds": [BRUNA.id], "teamIds": [andes]} in payloads
    assert all(e["type"] != "staff.invitation_accepted" for e in envelopes)


def test_the_meta_and_the_dev_mailbox(client: TestClient) -> None:
    assert client.get("/api/v1/meta").json()["devMailbox"] is True
    items = client.get("/api/v1/dev/mailbox", params={"limit": 1}).json()["items"]
    assert len(items) == 1
    assert items[0]["kind"] == "invitation"
    assert client.get("/api/v1/dev/mailbox", params={"limit": 0}).status_code == 422


@pytest.fixture
def quiet_client(tmp_path: Path) -> Iterator[TestClient]:
    """The same app with the dev mailbox off (what ``CC_ENV=test`` gets by default)."""
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'quiet.db'}", dev_mailbox=None
    )
    container = build_container(settings, clock=FixedClock(), ids=SequentialIdGenerator())
    with TestClient(create_app(container=container)) as test_client:
        yield test_client


def test_without_the_dev_mailbox_there_is_no_mailbox(quiet_client: TestClient) -> None:
    assert quiet_client.get("/api/v1/meta").json()["devMailbox"] is False
    missing = quiet_client.get("/api/v1/dev/mailbox")
    assert (missing.status_code, missing.json()["code"]) == (404, "not_found")


def test_settings_keep_the_dev_mailbox_out_of_production() -> None:
    assert make_settings(env="dev", dev_mailbox=None).dev_mailbox_enabled
    assert not make_settings(env="test", dev_mailbox=None).dev_mailbox_enabled
    assert make_settings(env="test", dev_mailbox=True).dev_mailbox_enabled
    prod = {
        "env": "prod",
        "session_secret": "a-production-secret-that-is-long-enough-0123456789",
        "seed_demo_data": False,
        # The rest of the deploy runtime contract (docs/platform/deploy-env.md).
        "database_url": "postgresql+asyncpg://cc_app:x@db.internal/cc",
        "public_app_url": "https://support.example.org",
        "cors_origins": [],
    }
    totp_key = "a" * 43 + "="  # 32 url-safe base64 bytes
    with pytest.raises(ValueError, match="CC_DEV_MAILBOX"):
        Settings(_env_file=None, dev_mailbox=True, totp_secret_key=totp_key, **prod)
    with pytest.raises(ValueError, match="CC_TOTP_SECRET_KEY"):
        Settings(_env_file=None, **prod)
    ok = Settings(_env_file=None, totp_secret_key=totp_key, **prod)
    assert not ok.dev_mailbox_enabled
