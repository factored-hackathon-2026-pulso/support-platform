from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta

from fastapi.testclient import TestClient

from cc_platform.infrastructure.clock import FixedClock
from tests.support import ANALYST, AUTOMATION_ADMIN, DEV_MFA_CODE, PASSWORD, bearer

PROBLEM = "application/problem+json"


def login(client: TestClient, password: str = PASSWORD, email: str = ANALYST.email):  # type: ignore[no-untyped-def]
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_full_login_flow_returns_session_and_staff(client: TestClient, clock: FixedClock) -> None:
    first = login(client)
    assert first.status_code == 200
    body = first.json()
    assert body["mfaRequired"] is True
    assert body["methods"] == ["totp", "sms", "backup_code"]
    assert body["challengeId"].startswith("MFA-")

    second = client.post(
        "/api/v1/auth/mfa", json={"challengeId": body["challengeId"], "code": DEV_MFA_CODE}
    )
    assert second.status_code == 200
    session = second.json()
    assert session["tokenType"] == "Bearer"
    assert session["session"]["expiresAt"] == (
        clock.now() + timedelta(hours=8)
    ).isoformat().replace("+00:00", "Z")
    assert session["staff"] == {
        "id": "STF-00000000000000000000000001",
        "name": "Daniela Ríos",
        "email": "daniela.rios@latambank.example",
        "roles": ["analyst"],
        "level": "Specialist",
        "languages": ["es", "pt"],
        "team": "Disputas · Equipo Andes",
        "requiresFourEyes": False,
    }

    me = client.get("/api/v1/auth/me", headers=bearer(session["token"]))
    assert me.status_code == 200
    assert me.json()["staff"]["id"] == session["staff"]["id"]
    assert me.json()["session"]["id"] == session["session"]["id"]


def test_wrong_password_is_a_problem_with_remaining_attempts(client: TestClient) -> None:
    response = login(client, password="nope")
    assert response.status_code == 401
    assert response.headers["content-type"] == PROBLEM
    problem = response.json()
    assert problem["type"] == "urn:cc-platform:problem:invalid_credentials"
    assert problem["code"] == "invalid_credentials"
    assert problem["status"] == 401
    assert problem["remainingAttempts"] == 4
    assert problem["instance"] == "/api/v1/auth/login"
    assert problem["requestId"] == response.headers["X-Request-ID"]
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_lockout_after_five_failures_and_unlock_after_fifteen_minutes(
    client: TestClient, clock: FixedClock
) -> None:
    remaining = [login(client, password="nope").json().get("remainingAttempts") for _ in range(4)]
    assert remaining == [4, 3, 2, 1]

    locked = login(client, password="nope")
    assert locked.status_code == 423
    assert locked.json()["code"] == "account_locked"
    unlock_at = (clock.now() + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
    assert locked.json()["unlockAt"] == unlock_at

    still_locked = login(client)
    assert still_locked.status_code == 423
    assert still_locked.json()["unlockAt"] == unlock_at

    clock.advance(timedelta(minutes=15))
    assert login(client).status_code == 200


def test_wrong_mfa_code(client: TestClient) -> None:
    challenge = login(client).json()["challengeId"]
    wrong = client.post("/api/v1/auth/mfa", json={"challengeId": challenge, "code": "999999"})
    assert wrong.status_code == 401
    assert wrong.json()["code"] == "mfa_invalid"
    assert wrong.json()["remainingAttempts"] == 2

    unknown = client.post(
        "/api/v1/auth/mfa", json={"challengeId": "MFA-nope", "code": DEV_MFA_CODE}
    )
    assert unknown.status_code == 401
    assert unknown.json()["code"] == "mfa_challenge_invalid"


def test_wrong_mfa_codes_count_toward_the_lockout(client: TestClient) -> None:
    for _ in range(4):
        assert login(client, password="nope").status_code == 401
    challenge = login(client).json()["challengeId"]
    locked = client.post("/api/v1/auth/mfa", json={"challengeId": challenge, "code": "999999"})
    assert locked.status_code == 423
    assert locked.json()["code"] == "account_locked"
    assert locked.json()["unlockAt"]
    # The open challenge cannot finish the sign-in while the account is locked.
    retry = client.post("/api/v1/auth/mfa", json={"challengeId": challenge, "code": DEV_MFA_CODE})
    assert retry.status_code == 423


def test_unknown_email_is_indistinguishable_from_a_wrong_password(client: TestClient) -> None:
    """Anti-enumeration: same status, code and countdown; only requestId/instance differ."""

    def shape(email: str) -> list[tuple[int, dict[str, object]]]:
        out = []
        for _ in range(6):
            response = login(client, password="nope", email=email)
            body = {k: v for k, v in response.json().items() if k not in {"requestId", "unlockAt"}}
            out.append((response.status_code, body))
        return out

    assert shape("nadie@latambank.example") == shape(ANALYST.email)


def test_me_requires_a_token(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"

    forged = client.get("/api/v1/auth/me", headers=bearer("forged.token.value"))
    assert forged.status_code == 401
    assert forged.json()["code"] == "unauthenticated"


def test_session_expires_with_the_clock(
    client: TestClient, clock: FixedClock, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(ANALYST.email)
    clock.advance(timedelta(hours=8))
    response = client.get("/api/v1/auth/me", headers=bearer(token))
    assert response.status_code == 401
    assert response.json()["code"] == "session_expired"


def test_logout_revokes_the_token(client: TestClient, sign_in: Callable[[str], str]) -> None:
    token = sign_in(AUTOMATION_ADMIN.email)
    assert client.get("/api/v1/auth/me", headers=bearer(token)).json()["staff"]["requiresFourEyes"]

    assert client.post("/api/v1/auth/logout", headers=bearer(token)).status_code == 204
    after = client.get("/api/v1/auth/me", headers=bearer(token))
    assert after.status_code == 401
    assert client.post("/api/v1/auth/logout", headers=bearer(token)).status_code == 401


def test_invalid_body_is_a_validation_problem(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": ANALYST.email})
    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM
    problem = response.json()
    assert problem["code"] == "validation_error"
    assert problem["errors"][0]["loc"] == ["body", "password"]

    extra = client.post(
        "/api/v1/auth/login", json={"email": ANALYST.email, "password": PASSWORD, "role": "admin"}
    )
    assert extra.status_code == 422
