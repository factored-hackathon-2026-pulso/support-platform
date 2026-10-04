"""The notification center over the API (slice 10): the three routes, RBAC (any staff role,
only her own), pagination, problems and the live envelopes on ``staff:<id>``."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.notifications import (
    Notification,
    NotificationPage,
    NotificationReadResult,
    NotificationsReadAllResult,
)
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_escalation_id
from tests.api.test_cases_realtime import connect, subscribe, until_pong
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, bearer

SignIn = Callable[[str], str]
URL = "/api/v1/me/notifications"
MARCELA = seed_case_id(101)
ESC_MARCELA = seed_escalation_id(101)


def problem(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body: dict[str, Any] = response.json()
    assert body["code"] == code
    return body


def page(client: TestClient, token: str, **params: Any) -> dict[str, Any]:
    response = client.get(URL, headers=bearer(token), params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert NotificationPage.model_validate(body).model_dump(mode="json", by_alias=True) == body
    return body


def test_every_route_needs_a_staff_session(client: TestClient, customer_session: Any) -> None:
    customer = customer_session(2001)
    for headers in ({}, bearer("not-a-token"), bearer(customer)):
        problem(client.get(URL, headers=headers), 401, "unauthenticated")
        problem(client.post(f"{URL}/read-all", headers=headers), 401, "unauthenticated")
        some = f"{URL}/NTF-00000000000000000000000001/read"
        problem(client.post(some, headers=headers), 401, "unauthenticated")


def test_every_role_reads_its_own_list(client: TestClient, sign_in: SignIn) -> None:
    daniela = page(client, sign_in(ANALYST.email))
    kinds = {item["kind"] for item in daniela["items"]}
    assert "escalation_answered" in kinds
    assert {item["role"] for item in daniela["items"]} == {"analyst"}
    assert daniela["unreadCount"] == sum(1 for i in daniela["items"] if i["readAt"] is None)
    lucia = page(client, sign_in(SUPERVISOR.email))
    assert {"case_escalated", "case_queued"} <= {item["kind"] for item in lucia["items"]}
    valeria = page(client, sign_in(ADMIN_ONLY.email))
    lock, accepted = valeria["items"]
    assert (lock["kind"], lock["targetName"], lock["failedAttempts"], lock["caseId"]) == (
        "account_locked",
        "Mariana Duque",
        5,
        None,
    )
    # Part 4: Tatiana accepted her invitation an hour before the seed (already read).
    assert (accepted["kind"], accepted["targetName"], accepted["readAt"] is not None) == (
        "invitation_accepted",
        "Tatiana Rojas",
        True,
    )
    assert valeria["unreadCount"] == 1


def test_cursor_pagination(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ANALYST.email)
    everything = page(client, token, limit=100)
    assert everything["nextCursor"] is None
    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        body = page(client, token, **params)
        seen.extend(item["id"] for item in body["items"])
        cursor = body["nextCursor"]
        if cursor is None:
            break
    assert seen == [item["id"] for item in everything["items"]]
    for bad in ("nope", "1.CASE-1", "9" * 30):
        response = client.get(URL, headers=bearer(token), params={"cursor": bad})
        problem(response, 422, "invalid_value")
    for limit in (0, 101):
        response = client.get(URL, headers=bearer(token), params={"limit": limit})
        problem(response, 422, "validation_error")


def test_reading_one_and_all_only_her_own(client: TestClient, sign_in: SignIn) -> None:
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    unread = [i for i in page(client, daniela)["items"] if i["readAt"] is None]
    target = unread[0]["id"]
    first = client.post(f"{URL}/{target}/read", headers=bearer(daniela))
    assert first.status_code == 200, first.text
    body = first.json()
    parsed = NotificationReadResult.model_validate(body)
    assert parsed.model_dump(mode="json", by_alias=True) == body
    assert (body["changed"], body["unreadCount"]) == (True, len(unread) - 1)
    assert body["notification"]["readAt"] is not None
    again = client.post(f"{URL}/{target}/read", headers=bearer(daniela)).json()
    assert (again["changed"], again["unreadCount"]) == (False, len(unread) - 1)
    # Someone else's notification, an unknown id and a malformed one: 404.
    problem(client.post(f"{URL}/{target}/read", headers=bearer(lucia)), 404, "not_found")
    problem(client.post(f"{URL}/NTF-{'9' * 26}/read", headers=bearer(daniela)), 404, "not_found")
    problem(client.post(f"{URL}/nope/read", headers=bearer(daniela)), 404, "not_found")
    everything = client.post(f"{URL}/read-all", headers=bearer(daniela))
    assert everything.status_code == 200, everything.text
    result = everything.json()
    assert NotificationsReadAllResult.model_validate(result).model_dump(by_alias=True) == result
    assert result == {"updated": len(unread) - 1, "unreadCount": 0}
    assert page(client, daniela)["unreadCount"] == 0
    assert page(client, lucia)["unreadCount"] > 0  # hers are untouched


def test_live_envelopes_on_her_staff_topic(client: TestClient, sign_in: SignIn) -> None:
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    daniela_id = ANALYST.id
    with connect(client, daniela) as ws:
        assert ws.receive_json()["type"] == "welcome"
        assert subscribe(ws, f"staff:{daniela_id}")["type"] == "subscribed"
        before = page(client, daniela)["unreadCount"]
        answered = client.post(
            f"/api/v1/supervision/escalations/{ESC_MARCELA}/response",
            headers=bearer(lucia),
            json={"note": "Sigue tú con ella."},
        )
        assert answered.status_code == 200, answered.text
        created = [e for e in until_pong(ws) if e["type"] == "notification.created"]
        (envelope,) = created
        payload = envelope["data"]["payload"]
        notification = payload["notification"]
        assert (
            Notification.model_validate(notification).model_dump(mode="json", by_alias=True)
            == notification
        )
        assert (notification["kind"], notification["caseId"], notification["actorName"]) == (
            "escalation_answered",
            MARCELA,
            "Lucía Herrera",
        )
        assert payload["unreadCount"] == before + 1
        assert envelope["id"] == notification["id"]
        read = client.post(f"{URL}/{notification['id']}/read", headers=bearer(daniela))
        assert read.status_code == 200
        (signal,) = [e for e in until_pong(ws) if e["type"] == "notifications.read"]
        assert signal["data"]["payload"] == {
            "notificationIds": [notification["id"]],
            "unreadCount": before,
        }
        client.post(f"{URL}/read-all", headers=bearer(daniela))
        (everything,) = [e for e in until_pong(ws) if e["type"] == "notifications.read"]
        assert everything["data"]["payload"] == {"notificationIds": None, "unreadCount": 0}


def test_another_person_cannot_follow_her_topic(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    with connect(client, lucia) as ws:
        assert ws.receive_json()["type"] == "welcome"
        reply = subscribe(ws, f"staff:{ANALYST.id}")
        assert reply["type"] == "error"
