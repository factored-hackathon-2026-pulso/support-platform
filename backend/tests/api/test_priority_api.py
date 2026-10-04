"""Case priority over the API (slice 8 contract §3–§6): ``PUT /cases/{caseId}/priority``, its
problems and RBAC, the audit row and the realtime fan-out (inbox, case and supervision)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.cases import CasePriorityResult, CaseSummary
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


def put_priority(client: TestClient, token: str | None, case_id: str, body: dict[str, Any]) -> Any:
    headers = bearer(token) if token else {}
    return client.put(f"/api/v1/cases/{case_id}/priority", headers=headers, json=body)


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
    response = put_priority(
        client, daniela, PATRICIA, {"priority": "high", "expectedVersion": version}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert CasePriorityResult.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["changed"] is True
    assert (body["case"]["priority"], body["case"]["version"]) == ("high", version + 1)
    again = put_priority(client, daniela, PATRICIA, {"priority": "high", "expectedVersion": 0})
    assert again.status_code == 200
    assert again.json() == {**body, "changed": False}
    inbox = client.get("/api/v1/cases/inbox", headers=bearer(daniela)).json()["items"]
    assert {item["id"]: item["priority"] for item in inbox}[PATRICIA] == "high"
    detail = client.get(f"/api/v1/cases/{PATRICIA}", headers=bearer(daniela)).json()
    assert detail["case"]["priority"] == "high"
    assert detail["capabilities"]["canChangePriority"] is True


def test_a_stale_version_answers_the_case_now(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    version = version_of(client, daniela, MARCELA)
    stale = put_priority(
        client, daniela, MARCELA, {"priority": "low", "expectedVersion": version - 1}
    )
    body = problem(stale, 409, "version_conflict")
    assert body["currentVersion"] == version
    current = body["current"]
    assert CaseSummary.model_validate(current).model_dump(mode="json", by_alias=True) == current
    assert (current["id"], current["priority"]) == (MARCELA, "critical")


def test_supervision_changes_any_open_case(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    for case_id, priority in ((CAMILA, "critical"), (ROSA, "low")):
        response = put_priority(
            client,
            lucia,
            case_id,
            {"priority": priority, "expectedVersion": version_of(client, lucia, case_id)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["case"]["priority"] == priority
    felipe = sign_in(TEAM_LEAD.email)  # Analista + Supervisión, not the assignee
    response = put_priority(
        client,
        felipe,
        CAMILA,
        {"priority": "none", "expectedVersion": version_of(client, felipe, CAMILA)},
    )
    assert response.status_code == 200, response.text


def test_who_may_not_change_it(client: TestClient, sign_in: SignIn) -> None:
    julian, daniela = sign_in(JULIAN.email), sign_in(ANALYST.email)
    body = {"priority": "high", "expectedVersion": 1}
    problem(put_priority(client, julian, MARCELA, body), 403, "case_not_assigned")
    problem(put_priority(client, daniela, CAMILA, body), 403, "case_not_assigned")
    problem(put_priority(client, julian, PATRICIA, body), 403, "case_not_assigned")  # history
    forbidden = problem(
        put_priority(client, sign_in(ADMIN_ONLY.email), MARCELA, body), 403, "forbidden"
    )
    assert sorted(forbidden["requiredRoles"]) == ["analyst", "supervisor"]
    problem(put_priority(client, None, MARCELA, body), 401, "unauthenticated")


def test_a_closed_case_and_bad_requests(client: TestClient, sign_in: SignIn) -> None:
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    body = {"priority": "high", "expectedVersion": 1}
    for token in (daniela, lucia):
        closed = problem(put_priority(client, token, CLAUDIA_CLOSED, body), 409, "case_closed")
        assert closed["currentStatus"] == "closed"
    problem(put_priority(client, lucia, seed_case_id(999), body), 404, "not_found")
    for bad in (
        {"priority": "urgent", "expectedVersion": 1},
        {"priority": "high"},
        {"priority": "high", "expectedVersion": -1},
        {"priority": "high", "expectedVersion": 1, "extra": True},
    ):
        problem(put_priority(client, daniela, MARCELA, bad), 422, "validation_error")


def test_the_audit_says_who_changed_it_and_to_what(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    version = version_of(client, daniela, PATRICIA)
    put_priority(client, daniela, PATRICIA, {"priority": "high", "expectedVersion": version})
    lucia = bearer(sign_in(SUPERVISOR.email))
    page = client.get(
        "/api/v1/audit/events", headers=lucia, params={"caseId": PATRICIA, "limit": 5}
    ).json()
    event = page["items"][0]
    assert event["type"] == "case.priority_changed"
    # The log shows the actor next to it: "Daniela Ríos · Cambió la prioridad a Alta".
    assert (event["actor"]["name"], event["description"]) == (
        "Daniela Ríos",
        "Cambió la prioridad a Alta",
    )
    assert (event["family"], event["changesState"]) == ("lifecycle", True)
    assert event["payload"] == {"from": "none", "to": "high"}
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
        changed = put_priority(
            client, lucia, PATRICIA, {"priority": "critical", "expectedVersion": version}
        )
        assert changed.status_code == 200, changed.text

        analyst = until_pong(analyst_ws)
        updated = [e for e in analyst if e["type"] == "case.updated"]
        # One envelope for both topics (inbox + case): the socket gets it once.
        assert [e["data"]["payload"]["priority"] for e in updated] == ["critical"]
        assert updated[0]["data"]["actor"] == {
            "role": "supervisor",
            "id": seed_staff_id(SUPERVISOR.number),
        }
        assert_contract_payloads(analyst)

        team = [e for e in until_pong(supervisor_ws) if e["type"] == "team.updated"]
        assert [e["data"]["payload"] for e in team] == [{"staffIds": [DANIELA_ID]}]

        # A queued case: supervision's queue row changes.
        version = version_of(client, lucia, ROSA)
        put_priority(client, lucia, ROSA, {"priority": "high", "expectedVersion": version})
        queues = [e for e in until_pong(supervisor_ws) if e["type"] == "queue.updated"]
        assert len(queues) == 1
        # The analyst saw nothing of a case in no inbox.
        assert [e for e in until_pong(analyst_ws) if e["type"] == "case.updated"] == []
