"""Escalations over the API (slice 9): the analyst routes (escalate, withdraw, "Entendido"), the
supervision routes ("Escalados", answer, take), RBAC, problems, the audit rows (motive and
answer redacted) and the realtime fan-out; plus "Colas" (every open case of a language)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.cases import EscalationResult
from cc_platform.api.schemas.supervision import EscalationOverview, LanguageOpenCases
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_escalation_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.api.test_cases_realtime import assert_contract_payloads, connect, subscribe, until_pong
from tests.support import ADMIN_ONLY, ANALYST, JULIAN, SUPERVISOR, TEAM_LEAD, bearer

SignIn = Callable[[str], str]

PATRICIA, MARCELA, CAMILA, JOAQUIN, ROSA, LARISSA, GABRIELA = (
    seed_case_id(n) for n in (108, 101, 113, 107, 111, 103, 109)
)
ESC_MARCELA, ESC_CAMILA, ESC_JOAQUIN = (seed_escalation_id(n) for n in (101, 113, 107))
DANIELA_ID, JULIAN_ID, LUCIA_ID, FELIPE_ID = (
    seed_staff_id(n) for n in (ANALYST.number, JULIAN.number, SUPERVISOR.number, TEAM_LEAD.number)
)


def problem(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body: dict[str, Any] = response.json()
    assert body["code"] == code
    return body


def escalate(
    client: TestClient,
    token: str | None,
    case_id: str,
    motive: object = "Pide hablar con supervisión.",
    key: str = "esc-api-0001",
) -> Any:
    headers = {**(bearer(token) if token else {}), "Idempotency-Key": key}
    return client.post(
        f"/api/v1/cases/{case_id}/escalations", headers=headers, json={"motive": motive}
    )


def valid(body: dict[str, Any]) -> dict[str, Any]:
    assert EscalationResult.model_validate(body).model_dump(mode="json", by_alias=True) == body
    return body


# ----------------------------------------------------------------------------- analyst routes
def test_the_assignee_escalates_and_a_retry_replays(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    created = escalate(client, daniela, PATRICIA, "  Pide hablar con supervisión.  ")
    assert created.status_code == 201, created.text
    body = valid(created.json())
    assert (body["escalation"]["state"], body["escalation"]["motive"]) == (
        "open",
        "Pide hablar con supervisión.",
    )
    assert body["case"]["escalated"] is True
    replay = escalate(client, daniela, PATRICIA)
    assert replay.status_code == 200
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json()["escalation"]["id"] == body["escalation"]["id"]
    second = escalate(client, daniela, PATRICIA, key="esc-api-0002")
    assert problem(second, 409, "escalation_open")["escalationId"] == body["escalation"]["id"]
    detail = client.get(f"/api/v1/cases/{PATRICIA}", headers=bearer(daniela)).json()
    assert detail["escalation"]["id"] == body["escalation"]["id"]
    assert detail["capabilities"]["canEscalate"] is False


def test_escalate_rbac_and_validation(client: TestClient, sign_in: SignIn) -> None:
    problem(escalate(client, None, PATRICIA), 401, "unauthenticated")
    lucia, julian = sign_in(SUPERVISOR.email), sign_in(JULIAN.email)
    assert problem(escalate(client, lucia, PATRICIA), 403, "forbidden")["requiredRoles"] == [
        "analyst"
    ]
    problem(escalate(client, julian, PATRICIA), 403, "case_not_assigned")
    daniela = sign_in(ANALYST.email)
    for motive in ("", "   ", "x" * 501, None):
        problem(escalate(client, daniela, PATRICIA, motive), 422, "validation_error")
    no_key = client.post(
        f"/api/v1/cases/{PATRICIA}/escalations", headers=bearer(daniela), json={"motive": "Hola"}
    )
    problem(no_key, 422, "validation_error")
    problem(escalate(client, daniela, seed_case_id(999)), 404, "not_found")
    problem(escalate(client, daniela, seed_case_id(105)), 409, "case_closed")


def test_withdraw_and_acknowledge(client: TestClient, sign_in: SignIn) -> None:
    daniela, julian = sign_in(ANALYST.email), sign_in(JULIAN.email)
    base = f"/api/v1/cases/{MARCELA}/escalations/{ESC_MARCELA}"
    problem(client.post(f"{base}/withdraw", headers=bearer(julian)), 403, "case_not_assigned")
    wrong = f"/api/v1/cases/{MARCELA}/escalations/{ESC_CAMILA}/withdraw"
    problem(client.post(wrong, headers=bearer(daniela)), 404, "not_found")
    withdrawn = client.post(f"{base}/withdraw", headers=bearer(daniela))
    assert withdrawn.status_code == 200, withdrawn.text
    assert valid(withdrawn.json())["escalation"]["state"] == "withdrawn"
    again = problem(
        client.post(f"{base}/withdraw", headers=bearer(daniela)), 409, "escalation_not_open"
    )
    assert again["currentState"] == "withdrawn"

    ack = f"/api/v1/cases/{JOAQUIN}/escalations/{ESC_JOAQUIN}/acknowledge"
    first = client.post(ack, headers=bearer(daniela))
    assert first.status_code == 200, first.text
    assert valid(first.json())["escalation"]["acknowledgedAt"] is not None
    assert client.post(ack, headers=bearer(daniela)).json() == first.json()
    open_ack = f"/api/v1/cases/{CAMILA}/escalations/{ESC_CAMILA}/acknowledge"
    problem(client.post(open_ack, headers=bearer(julian)), 409, "invalid_transition")


# ----------------------------------------------------------------------------- supervision routes
def test_escalados_answer_and_take(client: TestClient, sign_in: SignIn) -> None:
    lucia, felipe = sign_in(SUPERVISOR.email), sign_in(TEAM_LEAD.email)
    overview = client.get("/api/v1/supervision/escalations", headers=bearer(lucia))
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert EscalationOverview.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["openCount"] == 2
    assert [item["escalation"]["id"] for item in body["items"][:2]] == [ESC_CAMILA, ESC_MARCELA]
    assert {item["canTake"] for item in body["items"]} == {False}  # Lucía holds no Analista
    felipe_items = client.get("/api/v1/supervision/escalations", headers=bearer(felipe)).json()
    assert [item["canTake"] for item in felipe_items["items"][:2]] == [True, True]

    answer = f"/api/v1/supervision/escalations/{ESC_CAMILA}/response"
    problem(
        client.post(answer, headers=bearer(lucia), json={"note": "  "}), 422, "validation_error"
    )
    answered = client.post(answer, headers=bearer(lucia), json={"note": "Sigue tú con ella."})
    assert answered.status_code == 200, answered.text
    assert valid(answered.json())["escalation"]["state"] == "answered"
    problem(
        client.post(answer, headers=bearer(lucia), json={"note": "Otra"}),
        409,
        "escalation_not_open",
    )

    take = f"/api/v1/supervision/escalations/{ESC_MARCELA}/take"
    problem(client.post(take, headers=bearer(lucia)), 422, "analyst_not_eligible")
    taken = client.post(take, headers=bearer(felipe))
    assert taken.status_code == 200, taken.text
    assert valid(taken.json())["case"]["assignedAnalystId"] == FELIPE_ID
    problem(
        client.post("/api/v1/supervision/escalations/ESC-nope/take", headers=bearer(felipe)),
        404,
        "not_found",
    )


def test_supervision_routes_are_for_supervision(client: TestClient, sign_in: SignIn) -> None:
    daniela, valeria = bearer(sign_in(ANALYST.email)), bearer(sign_in(ADMIN_ONLY.email))
    routes = (
        ("get", "/api/v1/supervision/escalations", None),
        ("get", "/api/v1/supervision/open-cases?language=es", None),
        ("post", f"/api/v1/supervision/escalations/{ESC_CAMILA}/response", {"note": "Hola"}),
        ("post", f"/api/v1/supervision/escalations/{ESC_CAMILA}/take", None),
    )
    for method, url, body in routes:
        for headers in (daniela, valeria):
            response = getattr(client, method)(
                url, headers=headers, **({"json": body} if body else {})
            )
            problem(response, 403, "forbidden")
        problem(getattr(client, method)(url), 401, "unauthenticated")


# ----------------------------------------------------------------------------- audit
def test_the_audit_never_shows_the_motive_or_the_answer(
    client: TestClient, sign_in: SignIn
) -> None:
    daniela, lucia = sign_in(ANALYST.email), bearer(sign_in(SUPERVISOR.email))
    escalate(client, daniela, PATRICIA, "Motivo muy privado")
    events = client.get(
        "/api/v1/audit/events",
        headers=lucia,
        params={"caseId": PATRICIA, "family": "escalation", "limit": 5},
    ).json()["items"]
    (opened,) = events
    assert (opened["type"], opened["description"], opened["actor"]["name"]) == (
        "escalation.opened",
        "Escaló el caso a supervisión",
        "Daniela Ríos",
    )
    assert (opened["family"], opened["changesState"]) == ("escalation", True)
    assert opened["redactedFields"] == ["motive"]
    assert opened["payload"] == {"analyst_id": DANIELA_ID, "motive_length": 18}
    assert "Motivo muy privado" not in str(events)
    answered = client.get(
        "/api/v1/audit/events",
        headers=lucia,
        params={"caseId": JOAQUIN, "family": "escalation"},
    ).json()["items"]
    texts = [(e["type"], e["description"], e["redactedFields"]) for e in answered]
    assert ("escalation.answered", "Respondió el escalamiento", ["note"]) in texts


# ----------------------------------------------------------------------------- realtime
def test_the_analyst_sees_the_answer_live_and_supervision_hears_it(
    client: TestClient, sign_in: SignIn
) -> None:
    julian, lucia = sign_in(JULIAN.email), sign_in(SUPERVISOR.email)
    with connect(client, julian) as analyst_ws, connect(client, lucia) as supervisor_ws:
        for ws in (analyst_ws, supervisor_ws):
            assert ws.receive_json()["type"] == "welcome"
        assert subscribe(analyst_ws, f"inbox:{JULIAN_ID}")["type"] == "subscribed"
        for topic in ("supervision:escalations", "supervision:team"):
            assert subscribe(supervisor_ws, topic)["type"] == "subscribed"

        answered = client.post(
            f"/api/v1/supervision/escalations/{ESC_CAMILA}/response",
            headers=bearer(lucia),
            json={"note": "Sigue tú con ella."},
        )
        assert answered.status_code == 200, answered.text

        analyst = until_pong(analyst_ws)
        (update,) = [e for e in analyst if e["type"] == "escalation.updated"]
        assert (update["data"]["payload"]["state"], update["data"]["payload"]["note"]) == (
            "answered",
            "Sigue tú con ella.",
        )
        assert update["data"]["actor"] == {"role": "supervisor", "id": LUCIA_ID}
        summaries = [e for e in analyst if e["type"] == "case.updated"]
        assert summaries
        assert summaries[-1]["data"]["payload"]["escalated"] is False
        assert_contract_payloads(analyst)

        supervision = until_pong(supervisor_ws)
        assert [
            e["data"]["payload"]["id"] for e in supervision if e["type"] == "escalation.updated"
        ] == [ESC_CAMILA]
        team = [e["data"]["payload"] for e in supervision if e["type"] == "team.updated"]
        assert {"staffIds": [JULIAN_ID]} in team


def test_only_supervision_subscribes_to_escalations(client: TestClient, sign_in: SignIn) -> None:
    with connect(client, sign_in(ANALYST.email)) as ws:
        ws.receive_json()
        reply = subscribe(ws, "supervision:escalations")
        assert (reply["type"], reply["data"]["code"]) == ("error", "forbidden")


# ----------------------------------------------------------------------------- "Colas"
def test_colas_lists_every_open_case_of_a_language(client: TestClient, sign_in: SignIn) -> None:
    lucia = bearer(sign_in(SUPERVISOR.email))
    response = client.get(
        "/api/v1/supervision/open-cases", headers=lucia, params={"language": "es"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert LanguageOpenCases.model_validate(body).model_dump(mode="json", by_alias=True) == body
    rows = body["cases"]
    assert (body["language"], body["label"]) == ("es", "Cola en español")
    assert [row["case"]["id"] for row in rows[:2]] == [ROSA, seed_case_id(112)]  # nobody's first
    assert [row["assigneeName"] for row in rows[:2]] == [None, None]
    assert {row["case"]["language"] for row in rows} == {"es"}
    assert {row["case"]["status"] for row in rows} <= {"queued", "assigned", "in_progress"}
    held = {row["case"]["id"]: row["assigneeName"] for row in rows[2:]}
    assert held[MARCELA] == "Daniela Ríos"
    assert held[CAMILA] == "Julián Ortega"
    assert {row["case"]["id"]: row["case"]["escalated"] for row in rows}[MARCELA] is True
    portuguese = client.get(
        "/api/v1/supervision/open-cases", headers=lucia, params={"language": "pt"}
    ).json()
    assert [row["case"]["id"] for row in portuguese["cases"]] == [GABRIELA, LARISSA]
    problem(
        client.get("/api/v1/supervision/open-cases", headers=lucia, params={"language": "en"}),
        422,
        "validation_error",
    )
    queues = client.get("/api/v1/supervision/queues", headers=lucia).json()["queues"]
    by_language = {q["language"]: q for q in queues}
    assert by_language["es"]["openCases"] == len(rows)
    assert by_language["pt"]["openCases"] == 2
    assert by_language["es"]["openAtRisk"] >= 1
