"""Supervision and audit over HTTP (slice 3 contract §3.6–§3.8, §4, §5, §6): RBAC on every
endpoint, the manual-assignment problems with their extensions, the audited supervisor
view and the audit API."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.api.schemas.supervision import AssignmentResult, QueueOverview, TeamOverview
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import (
    ADMIN,
    ANALYST,
    JULIAN,
    SUPERVISOR,
    TEAM_LEAD,
    bearer,
)

DANIELA_ID, JULIAN_ID, SEBASTIAN_ID = seed_staff_id(1), seed_staff_id(2), seed_staff_id(4)
LUCIA_ID = seed_staff_id(5)
MARCELA, LARISSA_PT, REFUND, GABRIELA_PT = (
    seed_case_id(101),
    seed_case_id(103),
    seed_case_id(104),
    seed_case_id(109),
)
PATRICIA_OLD, ROSA_ES, CAMILA = seed_case_id(110), seed_case_id(111), seed_case_id(113)
PROBLEM = "application/problem+json"

SignIn = Callable[[str], str]


def assignee(client: TestClient, token: str, case_id: str, body: dict[str, Any]) -> Any:
    return client.put(
        f"/api/v1/supervision/cases/{case_id}/assignee", headers=bearer(token), json=body
    )


def problem(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith(PROBLEM)
    body: dict[str, Any] = response.json()
    assert body["code"] == code
    return body


def audit(client: TestClient, token: str, **params: Any) -> Any:
    return client.get("/api/v1/audit/events", headers=bearer(token), params=params)


# ----------------------------------------------------------------------------- RBAC
ENDPOINTS = [
    ("get", "/api/v1/supervision/team", None),
    ("get", "/api/v1/supervision/queues", None),
    (
        "put",
        f"/api/v1/supervision/cases/{ROSA_ES}/assignee",
        {"analystId": DANIELA_ID, "expectedAnalystId": None, "confirmPaused": True},
    ),
    ("get", "/api/v1/audit/events", None),
]


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_every_endpoint_needs_a_session(
    client: TestClient, method: str, path: str, body: dict[str, Any] | None
) -> None:
    response = client.request(method, path, json=body)
    problem(response, 401, "unauthenticated")


@pytest.mark.parametrize(("method", "path", "body"), ENDPOINTS)
def test_roles_per_endpoint(
    client: TestClient, sign_in: SignIn, method: str, path: str, body: dict[str, Any] | None
) -> None:
    is_audit = "/audit/" in path
    analyst = client.request(method, path, json=body, headers=bearer(sign_in(ANALYST.email)))
    forbidden = problem(analyst, 403, "forbidden")
    expected_roles = ["admin", "supervisor"] if is_audit else ["supervisor"]
    assert forbidden["requiredRoles"] == expected_roles
    admin = client.request(method, path, json=body, headers=bearer(sign_in(ADMIN.email)))
    if is_audit:
        assert admin.status_code == 200, admin.text
    else:
        problem(admin, 403, "forbidden")
    supervisor = client.request(method, path, json=body, headers=bearer(sign_in(SUPERVISOR.email)))
    assert supervisor.status_code == 200, supervisor.text
    # The team lead (Analista + Supervisión) acts as a supervisor here.
    lead = client.request(method, path, json=body, headers=bearer(sign_in(TEAM_LEAD.email)))
    assert lead.status_code == 200, lead.text


def test_one_audit_event_needs_supervisor_or_admin(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    event_id = audit(client, lucia, limit=1).json()["items"][0]["id"]
    path = f"/api/v1/audit/events/{event_id}"
    problem(client.get(path), 401, "unauthenticated")
    problem(client.get(path, headers=bearer(sign_in(ANALYST.email))), 403, "forbidden")
    assert client.get(path, headers=bearer(sign_in(ADMIN.email))).status_code == 200
    assert client.get(path, headers=bearer(lucia)).json()["id"] == event_id
    missing = client.get(f"/api/v1/audit/events/EVT-{'9' * 26}", headers=bearer(lucia))
    problem(missing, 404, "not_found")


# ----------------------------------------------------------------------------- team and queues
def test_team_and_queues(client: TestClient, sign_in: SignIn) -> None:
    lucia = bearer(sign_in(SUPERVISOR.email))
    team = client.get("/api/v1/supervision/team", headers=lucia).json()
    assert TeamOverview.model_validate(team).model_dump(mode="json", by_alias=True) == team
    rows = {a["name"]: a for a in team["analysts"]}
    assert (rows["Julián Ortega"]["activity"], rows["Julián Ortega"]["signedIn"]) == (
        "paused",
        True,
    )
    # Nobody starts available (seed): the queued cases wait because nobody could take them.
    assert (rows["Daniela Ríos"]["activity"], rows["Daniela Ríos"]["signedIn"]) == (
        "offline",
        False,
    )
    assert rows["Daniela Ríos"]["counts"] == {"open": 6, "new": 2, "toReply": 3, "waiting": 1}
    assert rows["Daniela Ríos"]["openCases"][0]["customer"]["displayName"]
    assert [(t["id"], t["name"]) for t in team["teams"]] == [
        ("TEAM-00000000000000000000000001", "Equipo Andes"),
        ("TEAM-00000000000000000000000002", "Equipo Pacífico"),
    ]
    assert rows["Daniela Ríos"]["team"] == {
        "id": "TEAM-00000000000000000000000001",
        "name": "Equipo Andes",
    }
    # Signing in as an analyst moves her from Desconectada to En pausa.
    sign_in(JULIAN.email)
    queues = client.get("/api/v1/supervision/queues", headers=lucia).json()
    assert QueueOverview.model_validate(queues).model_dump(mode="json", by_alias=True) == queues
    assert [(q["language"], q["waiting"], q["availableSpeakers"]) for q in queues["queues"]] == [
        ("es", 2, 0),
        ("pt", 1, 0),
    ]
    assert queues["counts"]["total"] == 3
    assert queues["queues"][0]["cases"][0]["id"] == ROSA_ES


# ----------------------------------------------------------------------------- assignment
def test_assign_from_the_queue(
    client: TestClient, sign_in: SignIn, available: Callable[..., None]
) -> None:
    available(DANIELA_ID)
    lucia = sign_in(SUPERVISOR.email)
    response = assignee(
        client, lucia, ROSA_ES, {"analystId": DANIELA_ID, "expectedAnalystId": None}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert AssignmentResult.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["changed"] is True
    assert (body["case"]["status"], body["case"]["assignedAnalystId"]) == ("assigned", DANIELA_ID)
    assert {k: body["assignment"][k] for k in (
        "reason", "assignedByRole", "assignedByName", "previousAnalystId", "previousAnalystName",
        "queueLabel", "waitedSeconds",
    )} == {
        "reason": "manual", "assignedByRole": "supervisor", "assignedByName": "Lucía Herrera",
        "previousAnalystId": None, "previousAnalystName": None,
        "queueLabel": "Cola en español", "waitedSeconds": 660,
    }  # fmt: skip
    again = assignee(client, lucia, ROSA_ES, {"analystId": DANIELA_ID, "expectedAnalystId": None})
    assert (again.status_code, again.json()["changed"]) == (200, False)  # retry: no-op
    detail = client.get(f"/api/v1/cases/{ROSA_ES}", headers=bearer(sign_in(ANALYST.email))).json()
    assert detail["assignment"]["assignedByName"] == "Lucía Herrera"
    assert detail["case"]["inboxStatus"] == "new"


def test_assignment_problems(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    missing = assignee(
        client, lucia, seed_case_id(999), {"analystId": DANIELA_ID, "expectedAnalystId": None}
    )
    problem(missing, 404, "not_found")
    closed = assignee(client, lucia, REFUND, {"analystId": DANIELA_ID, "expectedAnalystId": None})
    assert problem(closed, 409, "case_closed")["currentStatus"] == "closed"
    not_eligible = assignee(
        client, lucia, ROSA_ES, {"analystId": LUCIA_ID, "expectedAnalystId": None}
    )
    body = problem(not_eligible, 422, "analyst_not_eligible")
    assert (body["analystId"], body["detail"]) == (LUCIA_ID, "Esa persona no puede recibir casos.")
    mismatch = assignee(
        client, lucia, GABRIELA_PT, {"analystId": JULIAN_ID, "expectedAnalystId": None}
    )
    body = problem(mismatch, 422, "language_mismatch")
    assert (body["policyRuleId"], body["caseLanguage"], body["analystId"]) == (
        "H1",
        "pt",
        JULIAN_ID,
    )
    assert body["detail"] == "Ese caso necesita a alguien que hable su idioma (regla 3)."
    changed = assignee(client, lucia, CAMILA, {"analystId": DANIELA_ID, "expectedAnalystId": None})
    assert problem(changed, 409, "assignment_changed")["currentAnalystId"] == JULIAN_ID
    from_queue = assignee(
        client, lucia, ROSA_ES, {"analystId": DANIELA_ID, "expectedAnalystId": JULIAN_ID}
    )
    body = problem(from_queue, 409, "assignment_changed")
    assert "currentAnalystId" in body
    assert body["currentAnalystId"] is None
    paused = assignee(
        client, lucia, GABRIELA_PT, {"analystId": SEBASTIAN_ID, "expectedAnalystId": None}
    )
    body = problem(paused, 409, "analyst_paused")
    assert body["analystId"] == SEBASTIAN_ID
    confirmed = assignee(
        client,
        lucia,
        GABRIELA_PT,
        {"analystId": SEBASTIAN_ID, "expectedAnalystId": None, "confirmPaused": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    # Request validation: expectedAnalystId is required (nullable); no unknown members.
    problem(assignee(client, lucia, ROSA_ES, {"analystId": DANIELA_ID}), 422, "validation_error")
    extra = {"analystId": DANIELA_ID, "expectedAnalystId": None, "force": True}
    problem(assignee(client, lucia, ROSA_ES, extra), 422, "validation_error")


def test_reassignment_keeps_the_previous_analyst_reading(
    client: TestClient, sign_in: SignIn, available: Callable[..., None]
) -> None:
    available(DANIELA_ID)
    lucia, julian = sign_in(SUPERVISOR.email), bearer(sign_in(JULIAN.email))
    response = assignee(
        client, lucia, CAMILA, {"analystId": DANIELA_ID, "expectedAnalystId": JULIAN_ID}
    )
    assert response.json()["assignment"]["previousAnalystName"] == "Julián Ortega"
    detail = client.get(f"/api/v1/cases/{CAMILA}", headers=julian)
    assert detail.status_code == 200
    assert detail.json()["capabilities"] == {
        "canReply": False,
        "replyBlockedReason": "not_assignee",
        "canClose": False,
        "canAssign": False,
        "canChangePriority": False,
        "canEscalate": False,
        "canCall": False,
        "canEmail": False,
        "canAddNote": False,
    }
    cmid = str(uuid.uuid4())
    write = client.post(
        f"/api/v1/cases/{CAMILA}/turns",
        headers={**julian, "Idempotency-Key": cmid},
        json={"text": "Hola, Camila", "clientMessageId": cmid},
    )
    problem(write, 403, "case_not_assigned")
    read = client.post(f"/api/v1/cases/{CAMILA}/read", headers=julian, json={"upToSequence": 4})
    problem(read, 403, "case_not_assigned")
    inbox = client.get("/api/v1/cases/inbox", headers=julian).json()
    assert CAMILA not in {item["id"] for item in inbox["items"]}


def test_can_assign_per_role_and_status(client: TestClient, sign_in: SignIn) -> None:
    lucia, daniela = bearer(sign_in(SUPERVISOR.email)), bearer(sign_in(ANALYST.email))
    lead = bearer(sign_in(TEAM_LEAD.email))

    def caps(headers: dict[str, str], case_id: str) -> dict[str, Any]:
        result: dict[str, Any] = client.get(f"/api/v1/cases/{case_id}", headers=headers).json()
        return result["capabilities"]  # type: ignore[no-any-return]

    assert caps(lucia, MARCELA)["canAssign"] is True
    assert caps(lucia, ROSA_ES)["canAssign"] is True
    assert caps(lucia, REFUND)["canAssign"] is False  # closed
    assert caps(daniela, MARCELA)["canAssign"] is False
    assert caps(lead, MARCELA)["canAssign"] is True
    assert caps(lead, MARCELA)["canReply"] is False  # never writes in someone else's case


# ----------------------------------------------------------------------------- audited view
def viewed(client: TestClient, token: str, case_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = audit(
        client, token, caseId=case_id, family="access", limit=100
    ).json()["items"]
    return [e for e in items if e["type"] == "case.viewed"]


def test_a_supervisor_read_is_audited_once_per_window(
    client: TestClient, sign_in: SignIn, clock: FixedClock
) -> None:
    lucia = sign_in(SUPERVISOR.email)
    assert viewed(client, lucia, MARCELA) == []
    for _ in range(2):
        assert client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(lucia)).status_code == 200
    client.get(f"/api/v1/cases/{MARCELA}/turns", headers=bearer(lucia))  # turns: not audited
    client.get(f"/api/v1/cases/{MARCELA}/history", headers=bearer(lucia))  # history: neither
    (event,) = viewed(client, lucia, MARCELA)
    assert event["actor"] == {"role": "supervisor", "id": LUCIA_ID, "name": "Lucía Herrera"}
    assert event["payload"] == {
        "viewer_id": LUCIA_ID,
        "access": "supervisor",
        "case_status": "in_progress",
        "assigned_analyst_id": DANIELA_ID,
    }
    assert (event["changesState"], event["family"]) == (False, "access")
    clock.advance(timedelta(minutes=14))
    client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(lucia))
    assert len(viewed(client, lucia, MARCELA)) == 1
    clock.advance(timedelta(minutes=2))  # 16 min after the first view
    client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(lucia))
    assert len(viewed(client, lucia, MARCELA)) == 2


def test_assignee_and_history_reads_are_not_audited(client: TestClient, sign_in: SignIn) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), bearer(sign_in(ANALYST.email))
    client.get(f"/api/v1/cases/{MARCELA}", headers=daniela)  # her own case
    client.get(f"/api/v1/cases/{PATRICIA_OLD}", headers=daniela)  # history access
    lead = bearer(sign_in(TEAM_LEAD.email))
    assert viewed(client, lucia, MARCELA) == []
    assert viewed(client, lucia, PATRICIA_OLD) == []
    client.get(f"/api/v1/cases/{LARISSA_PT}", headers=lead)  # Felipe as a supervisor: audited
    assert [e["actor"]["id"] for e in viewed(client, lucia, LARISSA_PT)] == [seed_staff_id(11)]


# ----------------------------------------------------------------------------- audit API
def test_audit_api_filters_and_pagination(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    first = audit(client, lucia, limit=5).json()
    assert len(first["items"]) == 5
    assert first["nextCursor"] is not None
    second = audit(client, lucia, limit=5, cursor=first["nextCursor"]).json()
    assert not {e["id"] for e in first["items"]} & {e["id"] for e in second["items"]}
    staff = audit(client, lucia, actorKind="staff", family="access", changesOnly="false").json()
    assert {e["actor"]["role"] for e in staff["items"]} <= {"analyst", "supervisor", "admin"}
    changes = audit(client, lucia, changesOnly="true", limit=100).json()["items"]
    assert all(e["changesState"] for e in changes)
    window = audit(
        client, lucia, **{"from": "2026-10-02T13:30:00Z", "to": "2026-10-02T13:40:00Z"}
    ).json()["items"]
    assert window
    assert all("2026-10-02T13:30:00Z" <= e["occurredAt"] < "2026-10-02T13:40:00Z" for e in window)
    naive = audit(client, lucia, **{"from": "2026-10-02T13:30:00", "to": "2026-10-02T13:40:00"})
    assert [e["id"] for e in naive.json()["items"]] == [e["id"] for e in window]  # UTC
    message = next(
        e for e in audit(client, lucia, limit=100).json()["items"] if e["type"] == "turn.created"
    )
    assert message["redactedFields"] == ["text"]
    assert "text" not in message["payload"]
    assert set(message) == {
        "id", "type", "family", "changesState", "description", "occurredAt", "ingestedAt",
        "actor", "entity", "entityId", "caseRef", "payload", "redactedFields",
    }  # fmt: skip
    by_q = audit(client, lucia, q=CAMILA[2:].lower(), limit=100).json()["items"]  # contains
    assert by_q
    assert {e["caseRef"]["id"] for e in by_q} == {CAMILA}


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-10-02T14:00:00Z", "to": "2026-10-02T14:00:00Z"},
        {"from": "2026-10-02T15:00:00Z", "to": "2026-10-02T14:00:00Z"},
        {"cursor": "abc"},
        {"cursor": "0"},
        {"cursor": "²"},  # str.isdigit() accepts it, int() does not
        {"cursor": "٣"},  # an Arabic-Indic digit: int() would read it as 3
        {"cursor": "9223372036854775808"},  # 2**63: no SQLite INTEGER holds it
        {"cursor": "9" * 32},
        {"actorKind": "bot"},
        {"family": "approvals"},
        {"limit": 101},
        {"q": ""},
        {"q": "x" * 81},
    ],
)
def test_audit_api_rejects_bad_queries(
    client: TestClient, sign_in: SignIn, params: dict[str, str]
) -> None:
    response = audit(client, sign_in(SUPERVISOR.email), **params)
    assert response.status_code == 422, response.text
    assert response.json()["code"] in {"validation_error", "invalid_value"}
