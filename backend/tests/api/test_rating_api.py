"""Customer rating over the API (slice 7 contract §3–§6): the endpoint and its problems, the
staff and supervision read sides, the audit row (never the comment) and the realtime fan-out."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.customer import CustomerConversation
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.api.test_cases_realtime import assert_contract_payloads, connect, subscribe, until_pong
from tests.support import ANALYST, SUPERVISOR, bearer

SignIn = Callable[[str], str]
CustomerSession = Callable[..., str]

CLAUDIA_CLOSED, HECTOR_CLOSED, PATRICIA_OPEN = (
    seed_case_id(105),
    seed_case_id(106),
    seed_case_id(108),
)
PATRICIA_REFUND = seed_case_id(104)
CLAUDIA, HECTOR, PATRICIA = 1005, 1006, 1004
DANIELA_ID = seed_staff_id(ANALYST.number)
CLAUDIA_ID = seed_customer_id(CLAUDIA)


def rate(
    client: TestClient,
    token: str | None,
    case_id: str,
    body: dict[str, Any],
    key: str | None = "rating-0000-0001",
) -> Any:
    headers: dict[str, str] = bearer(token) if token else {}
    if key is not None:
        headers["Idempotency-Key"] = key
    return client.post(
        f"/api/v1/customer/conversations/{case_id}/rating", headers=headers, json=body
    )


def problem(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body: dict[str, Any] = response.json()
    assert body["code"] == code
    return body


def test_the_customer_rates_and_a_retry_replays(
    client: TestClient, customer_session: CustomerSession
) -> None:
    claudia = customer_session(CLAUDIA)
    created = rate(client, claudia, CLAUDIA_CLOSED, {"score": 3, "comment": "  Bien, gracias  "})
    assert created.status_code == 201, created.text
    body = created.json()
    assert CustomerConversation.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["caseId"] == CLAUDIA_CLOSED
    assert body["status"] == "closed"
    assert body["rating"] == {
        "score": 3,
        "comment": "Bien, gracias",
        "ratedAt": "2026-10-02T14:00:00Z",
    }
    replay = rate(client, claudia, CLAUDIA_CLOSED, {"score": 3, "comment": "Bien, gracias"})
    assert replay.status_code == 200
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json() == body
    problem(rate(client, claudia, CLAUDIA_CLOSED, {"score": 4}), 409, "idempotency_conflict")
    twice = rate(client, claudia, CLAUDIA_CLOSED, {"score": 3}, key="rating-0000-0002")
    problem(twice, 409, "already_rated")
    # The simulator reads it with the conversation (no survey any more). Slice 12: her
    # current conversation is Daniela's follow-up call (116), so 105 is a past one.
    past = client.get(f"/api/v1/customer/conversations/{CLAUDIA_CLOSED}", headers=bearer(claudia))
    assert past.json()["conversation"]["rating"] == body["rating"]


def test_blank_comment_is_null_and_the_comment_is_optional(
    client: TestClient, customer_session: CustomerSession
) -> None:
    response = rate(client, customer_session(CLAUDIA), CLAUDIA_CLOSED, {"score": 1, "comment": " "})
    assert response.status_code == 201, response.text
    assert response.json()["rating"]["comment"] is None


def test_rating_problems(client: TestClient, customer_session: CustomerSession) -> None:
    hector, patricia = customer_session(HECTOR), customer_session(PATRICIA)
    problem(rate(client, hector, HECTOR_CLOSED, {"score": 4}), 409, "already_rated")
    not_closed = problem(
        rate(client, patricia, PATRICIA_OPEN, {"score": 4}), 409, "case_not_closed"
    )
    assert not_closed["currentStatus"] == "assigned"
    # Someone else's case is answered like an unknown one.
    problem(rate(client, hector, CLAUDIA_CLOSED, {"score": 4}), 404, "not_found")
    problem(rate(client, hector, seed_case_id(999), {"score": 4}), 404, "not_found")
    for body in (
        {"score": 0},
        {"score": 5},
        {"score": "4x"},
        {},
        {"score": 3, "comment": "x" * 501},
    ):
        problem(rate(client, hector, CLAUDIA_CLOSED, body), 422, "validation_error")
    problem(rate(client, hector, CLAUDIA_CLOSED, {"score": 3, "extra": 1}), 422, "validation_error")
    problem(rate(client, hector, CLAUDIA_CLOSED, {"score": 3}, key=None), 422, "validation_error")
    problem(
        rate(client, hector, CLAUDIA_CLOSED, {"score": 3}, key="short"), 422, "validation_error"
    )


def test_only_a_customer_token_rates(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    problem(rate(client, None, CLAUDIA_CLOSED, {"score": 4}), 401, "unauthenticated")
    staff = sign_in(ANALYST.email)
    problem(rate(client, staff, CLAUDIA_CLOSED, {"score": 4}), 401, "unauthenticated")
    lucia = sign_in(SUPERVISOR.email)
    problem(rate(client, lucia, CLAUDIA_CLOSED, {"score": 4}), 401, "unauthenticated")


def test_staff_read_the_rating_on_the_closed_case(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    rate(client, customer_session(CLAUDIA), CLAUDIA_CLOSED, {"score": 2, "comment": "Lento"})
    daniela = bearer(sign_in(ANALYST.email))
    closed = client.get("/api/v1/cases/inbox?status=closed", headers=daniela).json()["items"]
    ratings = {item["id"]: item["rating"] for item in closed}
    assert ratings[CLAUDIA_CLOSED] == {
        "score": 2,
        "comment": "Lento",
        "ratedAt": "2026-10-02T14:00:00Z",
    }
    assert ratings[HECTOR_CLOSED] is not None
    assert ratings[HECTOR_CLOSED]["score"] == 3
    assert ratings[PATRICIA_REFUND]["comment"] == "Muy clara la explicación del plazo, gracias."
    detail = client.get(f"/api/v1/cases/{CLAUDIA_CLOSED}", headers=daniela).json()
    assert detail["case"]["rating"]["score"] == 2
    open_items = client.get("/api/v1/cases/inbox", headers=daniela).json()["items"]
    assert all(item["rating"] is None for item in open_items)


def test_supervision_shows_the_seven_day_figures(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    lucia = bearer(sign_in(SUPERVISOR.email))

    def figures() -> dict[str, dict[str, Any]]:
        team = client.get("/api/v1/supervision/team", headers=lucia).json()
        return {a["name"]: a["recentRatings"] for a in team["analysts"]}

    before = figures()
    assert before["Daniela Ríos"] == {"count": 2, "average": 3.5}
    assert before["Julián Ortega"] == {"count": 0, "average": None}
    rate(client, customer_session(CLAUDIA), CLAUDIA_CLOSED, {"score": 4})
    assert figures()["Daniela Ríos"]["count"] == 3
    assert figures()["Daniela Ríos"]["average"] == 11 / 3


def test_the_audit_names_the_score_never_the_comment(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    rate(client, customer_session(CLAUDIA), CLAUDIA_CLOSED, {"score": 3, "comment": "Muy amable"})
    lucia = bearer(sign_in(SUPERVISOR.email))
    page = client.get(
        "/api/v1/audit/events", headers=lucia, params={"caseId": CLAUDIA_CLOSED, "limit": 5}
    ).json()
    event = page["items"][0]
    assert event["type"] == "case.rated"
    assert event["description"] == "El cliente calificó el caso: Bien"
    assert (event["family"], event["changesState"]) == ("lifecycle", True)
    assert event["actor"]["role"] == "customer"
    assert event["payload"] == {"score": 3, "analyst_id": DANIELA_ID, "comment_length": 10}
    assert event["redactedFields"] == ["comment"]
    one = client.get(f"/api/v1/audit/events/{event['id']}", headers=lucia).json()
    assert "Muy amable" not in str(one)
    # The seeded rating with its comment is redacted the same way.
    seeded = client.get(
        "/api/v1/audit/events", headers=lucia, params={"caseId": PATRICIA_REFUND, "limit": 100}
    ).json()["items"]
    (patricia,) = [e for e in seeded if e["type"] == "case.rated"]
    assert patricia["description"] == "El cliente calificó el caso: Excelente"
    assert "comment" not in patricia["payload"]


def test_a_rating_reaches_the_analyst_the_customer_and_supervision(
    client: TestClient, sign_in: SignIn, customer_session: CustomerSession
) -> None:
    claudia = customer_session(CLAUDIA)
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    with (
        connect(client, daniela) as analyst_ws,
        connect(client, claudia) as customer_ws,
        connect(client, lucia) as supervisor_ws,
    ):
        for ws in (analyst_ws, customer_ws, supervisor_ws):
            assert ws.receive_json()["type"] == "welcome"
        assert subscribe(analyst_ws, f"inbox:{DANIELA_ID}")["type"] == "subscribed"
        assert subscribe(customer_ws, f"customer:{CLAUDIA_ID}")["type"] == "subscribed"
        assert subscribe(supervisor_ws, "supervision:team")["type"] == "subscribed"
        assert subscribe(supervisor_ws, f"case:{CLAUDIA_CLOSED}")["type"] == "subscribed"

        key = str(uuid.uuid4())
        assert rate(client, claudia, CLAUDIA_CLOSED, {"score": 4}, key=key).status_code == 201

        inbox = until_pong(analyst_ws)
        updated = [e for e in inbox if e["type"] == "case.updated"]
        assert [e["data"]["payload"]["rating"]["score"] for e in updated] == [4]
        assert updated[0]["data"]["actor"] == {"role": "customer", "id": CLAUDIA_ID}
        assert_contract_payloads(inbox)

        customer = until_pong(customer_ws)
        conversation = [e for e in customer if e["type"] == "conversation.updated"]
        assert [e["data"]["payload"]["rating"]["score"] for e in conversation] == [4]
        assert_contract_payloads(customer, customer=True)

        supervision = until_pong(supervisor_ws)
        team = [e for e in supervision if e["type"] == "team.updated"]
        assert [e["data"]["payload"] for e in team] == [{"staffIds": [DANIELA_ID]}]
        case_updates = [e for e in supervision if e["type"] == "case.updated"]
        assert len(case_updates) == 1
