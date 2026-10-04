"""``GET /api/v1/me/home`` (slice 6 contract §3): shape, ``since`` across sign-ins, the
activity rows over SQL, and RBAC (analysts only)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta

from fastapi.testclient import TestClient

from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, TEAM_LEAD, bearer

HOME = "/api/v1/me/home"
ITEM_KEYS = {
    "kind",
    "caseId",
    "customerName",
    "occurredAt",
    "language",
    "readOnly",
    "caseStatus",
    "inboxStatus",
    "slaDueAt",
    "firstResponseAt",
    "actorName",
    "targetName",
    "reason",
    "waitedSeconds",
    "previousCasesCount",
    "lastCloseReason",
    "messageCount",
}


def test_first_sign_in_answers_the_fallback_and_the_team(
    client: TestClient, sign_in: Callable[[str], str], clock: FixedClock
) -> None:
    response = client.get(HOME, headers=bearer(sign_in(ANALYST.email)))
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"since", "sinceSource", "activity", "teamNow", "serverTime"}
    assert body["sinceSource"] == "fallback"
    assert body["since"] == (clock.now() - timedelta(hours=8)).isoformat().replace("+00:00", "Z")
    team = body["teamNow"]
    assert set(team) == {"teamId", "teamName", "availableCount", "analystCount", "queues"}
    assert team["teamId"].startswith("TEAM-")
    assert (team["availableCount"], team["analystCount"]) == (0, 3)
    assert [(q["language"], q["waiting"]) for q in team["queues"]] == [("es", 2), ("pt", 1)]
    # The seeded story of the last hour (her arrivals and customers' messages) is news.
    activity = body["activity"]
    assert activity["total"] == len(activity["items"]) > 0
    assert all(set(item) == ITEM_KEYS for item in activity["items"])
    assert all(item["readOnly"] is False for item in activity["items"])


def test_since_is_the_previous_session_after_signing_out(
    client: TestClient, sign_in: Callable[[str], str], clock: FixedClock
) -> None:
    first = sign_in(ANALYST.email)
    clock.advance(timedelta(minutes=10))
    signed_out = clock.now()
    assert client.post("/api/v1/auth/logout", headers=bearer(first)).status_code == 204
    clock.advance(timedelta(hours=1))
    body = client.get(HOME, headers=bearer(sign_in(ANALYST.email))).json()
    assert body["sinceSource"] == "previous_session"
    assert body["since"] == signed_out.isoformat().replace("+00:00", "Z")
    assert body["activity"] == {"items": [], "total": 0}


def test_messages_and_a_reassignment_show_up_over_sql(
    client: TestClient,
    sign_in: Callable[[str], str],
    customer_session: Callable[..., str],
    clock: FixedClock,
) -> None:
    daniela = sign_in(ANALYST.email)
    assert client.post("/api/v1/auth/logout", headers=bearer(daniela)).status_code == 204
    clock.advance(timedelta(minutes=1))
    beatriz = customer_session(1002)
    for text in ("¿Hola?", "contesten!!"):
        cmid = str(uuid.uuid4())
        sent = client.post(
            "/api/v1/customer/conversation/turns",
            json={"text": text, "clientMessageId": cmid},
            headers={**bearer(beatriz), "Idempotency-Key": cmid},
        )
        assert sent.status_code in (200, 201), sent.text
    lucia = sign_in(SUPERVISOR.email)
    larissa = seed_case_id(103)
    moved = client.put(
        f"/api/v1/supervision/cases/{larissa}/assignee",
        json={
            "analystId": "STF-" + "0" * 25 + "4",
            "expectedAnalystId": "STF-" + "0" * 25 + "1",
            "confirmPaused": True,
        },
        headers=bearer(lucia),
    )
    assert moved.status_code == 200, moved.text

    items = client.get(HOME, headers=bearer(sign_in(ANALYST.email))).json()["activity"]["items"]
    by_kind = {item["kind"]: item for item in items}
    assert set(by_kind) == {"customer_messages", "reassigned_away"}
    assert by_kind["customer_messages"]["messageCount"] == 2
    assert by_kind["customer_messages"]["customerName"] == "Beatriz Salcedo Prieto"
    away = by_kind["reassigned_away"]
    assert (away["caseId"], away["readOnly"], away["actorName"], away["targetName"]) == (
        larissa,
        True,
        "Lucía Herrera",
        "Sebastián Cárdenas",
    )


def test_only_analysts_have_a_home(
    client: TestClient, sign_in: Callable[[str], str], customer_session: Callable[..., str]
) -> None:
    for seed in (SUPERVISOR, ADMIN_ONLY):
        response = client.get(HOME, headers=bearer(sign_in(seed.email)))
        assert (response.status_code, response.json()["code"]) == (403, "forbidden")
        assert response.json()["requiredRoles"] == ["analyst"]
    # Analista + Supervisora: she is an analyst.
    assert client.get(HOME, headers=bearer(sign_in(TEAM_LEAD.email))).status_code == 200
    # A customer token is not a staff session at all.
    customer = client.get(HOME, headers=bearer(customer_session(2001)))
    assert (customer.status_code, customer.json()["code"]) == (401, "unauthenticated")
    assert client.get(HOME).json()["code"] == "unauthenticated"
