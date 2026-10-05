"""Case type over the API (slice 18 contract §3–§6): ``PUT /cases/{caseId}/type``, its problems
and RBAC (the priority's, slice 8), the audit row and the realtime fan-out (inbox, case and
supervision)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.cases import CaseSummary, CaseTypeResult
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.api.test_cases_realtime import assert_contract_payloads, connect, subscribe, until_pong
from tests.support import ADMIN_ONLY, ANALYST, JULIAN, SUPERVISOR, TEAM_LEAD, bearer

SignIn = Callable[[str], str]
CustomerSession = Callable[..., str]

PATRICIA, MARCELA, CAMILA, ROSA, CLAUDIA_CLOSED = (
    seed_case_id(108),
    seed_case_id(101),
    seed_case_id(113),
    seed_case_id(111),
    seed_case_id(105),
)
DANIELA_ID, JULIAN_ID = seed_staff_id(ANALYST.number), seed_staff_id(JULIAN.number)


def put_type(client: TestClient, token: str | None, case_id: str, body: dict[str, Any]) -> Any:
    headers = bearer(token) if token else {}
    return client.put(f"/api/v1/cases/{case_id}/type", headers=headers, json=body)


def version_of(client: TestClient, token: str, case_id: str) -> int:
    version: int = client.get(f"/api/v1/cases/{case_id}", headers=bearer(token)).json()["case"][
        "version"
    ]
    return version


def problem(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body: dict[str, Any] = response.json()
    assert body["code"] == code
    return body


def test_the_assignee_sets_it_and_a_repeat_is_a_no_op(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    version = version_of(client, daniela, PATRICIA)
    response = put_type(
        client, daniela, PATRICIA, {"caseType": "undue_charge", "expectedVersion": version}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert CaseTypeResult.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["changed"] is True
    assert (body["case"]["caseType"], body["case"]["version"]) == ("undue_charge", version + 1)
    again = put_type(client, daniela, PATRICIA, {"caseType": "undue_charge", "expectedVersion": 0})
    assert again.status_code == 200
    assert again.json() == {**body, "changed": False}
    inbox = client.get("/api/v1/cases/inbox", headers=bearer(daniela)).json()["items"]
    assert {item["id"]: item["caseType"] for item in inbox}[PATRICIA] == "undue_charge"
    detail = client.get(f"/api/v1/cases/{PATRICIA}", headers=bearer(daniela)).json()
    assert detail["case"]["caseType"] == "undue_charge"
    assert detail["capabilities"]["canChangeType"] is True


def test_a_stale_version_answers_the_case_now(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    version = version_of(client, daniela, MARCELA)
    stale = put_type(
        client, daniela, MARCELA, {"caseType": "app_issue", "expectedVersion": version - 1}
    )
    body = problem(stale, 409, "version_conflict")
    assert body["currentVersion"] == version
    current = body["current"]
    assert CaseSummary.model_validate(current).model_dump(mode="json", by_alias=True) == current
    assert (current["id"], current["caseType"]) == (MARCELA, "unrecognized_charge")


def test_supervision_changes_any_open_case(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    for case_id, case_type in ((CAMILA, "service_quality"), (ROSA, "virtual_card")):
        response = put_type(
            client,
            lucia,
            case_id,
            {"caseType": case_type, "expectedVersion": version_of(client, lucia, case_id)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["case"]["caseType"] == case_type
    felipe = sign_in(TEAM_LEAD.email)  # Analista + Supervisión, not the assignee
    response = put_type(
        client,
        felipe,
        CAMILA,
        {"caseType": "none", "expectedVersion": version_of(client, felipe, CAMILA)},
    )
    assert response.status_code == 200, response.text


def test_who_may_not_change_it(client: TestClient, sign_in: SignIn) -> None:
    julian, daniela = sign_in(JULIAN.email), sign_in(ANALYST.email)
    body = {"caseType": "app_issue", "expectedVersion": 1}
    problem(put_type(client, julian, MARCELA, body), 403, "case_not_assigned")
    problem(put_type(client, daniela, CAMILA, body), 403, "case_not_assigned")
    problem(put_type(client, julian, PATRICIA, body), 403, "case_not_assigned")  # history
    forbidden = problem(
        put_type(client, sign_in(ADMIN_ONLY.email), MARCELA, body), 403, "forbidden"
    )
    assert sorted(forbidden["requiredRoles"]) == ["analyst", "supervisor"]
    problem(put_type(client, None, MARCELA, body), 401, "unauthenticated")


def test_a_closed_case_and_bad_requests(client: TestClient, sign_in: SignIn) -> None:
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    body = {"caseType": "app_issue", "expectedVersion": 1}
    for token in (daniela, lucia):
        closed = problem(put_type(client, token, CLAUDIA_CLOSED, body), 409, "case_closed")
        assert closed["currentStatus"] == "closed"
    problem(put_type(client, lucia, seed_case_id(999), body), 404, "not_found")
    for bad in (
        {"caseType": "fraud", "expectedVersion": 1},
        {"caseType": "Cobro indebido", "expectedVersion": 1},
        {"caseType": "app_issue"},
        {"caseType": "app_issue", "expectedVersion": -1},
        {"caseType": "app_issue", "expectedVersion": 1, "extra": True},
        {"priority": "high", "expectedVersion": 1},
    ):
        problem(put_type(client, daniela, MARCELA, bad), 422, "validation_error")


def test_the_audit_says_who_changed_it_and_to_what(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    version = version_of(client, daniela, PATRICIA)
    put_type(client, daniela, PATRICIA, {"caseType": "undue_charge", "expectedVersion": version})
    lucia = bearer(sign_in(SUPERVISOR.email))
    page = client.get(
        "/api/v1/audit/events", headers=lucia, params={"caseId": PATRICIA, "limit": 5}
    ).json()
    event = page["items"][0]
    assert event["type"] == "case.type_changed"
    # The log shows the actor next to it: "Daniela Ríos · Cambió el tipo de caso a …".
    assert (event["actor"]["name"], event["description"]) == (
        "Daniela Ríos",
        "Cambió el tipo de caso a Cobro indebido",
    )
    assert (event["family"], event["changesState"]) == ("lifecycle", True)
    assert event["payload"] == {"from": "none", "to": "undue_charge"}
    lifecycle = client.get(
        "/api/v1/audit/events",
        headers=lucia,
        params={"caseId": PATRICIA, "family": "lifecycle", "limit": 5},
    ).json()["items"]
    assert lifecycle[0]["id"] == event["id"]


def test_a_change_reaches_the_inbox_the_case_and_supervision(
    client: TestClient, sign_in: SignIn
) -> None:
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    with connect(client, daniela) as analyst_ws, connect(client, lucia) as supervisor_ws:
        for ws in (analyst_ws, supervisor_ws):
            assert ws.receive_json()["type"] == "welcome"
        assert subscribe(analyst_ws, f"inbox:{DANIELA_ID}")["type"] == "subscribed"
        assert subscribe(analyst_ws, f"case:{PATRICIA}")["type"] == "subscribed"
        for topic in ("supervision:team", "supervision:queues"):
            assert subscribe(supervisor_ws, topic)["type"] == "subscribed"

        version = version_of(client, lucia, PATRICIA)
        changed = put_type(
            client, lucia, PATRICIA, {"caseType": "branch_service", "expectedVersion": version}
        )
        assert changed.status_code == 200, changed.text

        analyst = until_pong(analyst_ws)
        updated = [e for e in analyst if e["type"] == "case.updated"]
        # One envelope for both topics (inbox + case): the socket gets it once.
        assert [e["data"]["payload"]["caseType"] for e in updated] == ["branch_service"]
        assert updated[0]["data"]["actor"] == {
            "role": "supervisor",
            "id": seed_staff_id(SUPERVISOR.number),
        }
        assert_contract_payloads(analyst)

        team = [e for e in until_pong(supervisor_ws) if e["type"] == "team.updated"]
        assert [e["data"]["payload"] for e in team] == [{"staffIds": [DANIELA_ID]}]

        # A queued case: supervision's queue row changes.
        version = version_of(client, lucia, ROSA)
        put_type(client, lucia, ROSA, {"caseType": "undue_charge", "expectedVersion": version})
        queues = [e for e in until_pong(supervisor_ws) if e["type"] == "queue.updated"]
        assert len(queues) == 1
        # The analyst saw nothing of a case in no inbox.
        assert [e for e in until_pong(analyst_ws) if e["type"] == "case.updated"] == []


def test_the_type_does_not_depend_on_the_ai_switch(client: TestClient, sign_in: SignIn) -> None:
    """Slice 18 §2: the type is data about the case; the switch only hides it in the SPA."""
    admin = bearer(sign_in(ADMIN_ONLY.email))
    off = client.put("/api/v1/admin/platform/ai", headers=admin, json={"enabled": False})
    assert off.status_code == 200, off.text
    daniela = sign_in(ANALYST.email)
    version = version_of(client, daniela, PATRICIA)
    response = put_type(
        client, daniela, PATRICIA, {"caseType": "app_issue", "expectedVersion": version}
    )
    assert response.status_code == 200, response.text
    assert response.json()["case"]["caseType"] == "app_issue"
