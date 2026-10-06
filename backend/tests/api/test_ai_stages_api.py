"""The AI stages over the API (slice 21): who reads them, Supervisión moves a type back (audit,
live ``ai.stage_updated`` on ``ai:stages``), the tool feedback route, and the AI switch."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.api.schemas.ai_stages import AiStages, MoveStageBackResult
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.api.test_cases_realtime import connect, subscribe, until_pong
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, bearer

SignIn = Callable[[str], str]
STAGES = "/api/v1/ai/stages"


def move_back(client: TestClient, token: str, case_type: str, body: Any) -> Any:
    return client.post(
        f"/api/v1/supervision/ai/stages/{case_type}/move-back", headers=bearer(token), json=body
    )


def problem(response: Any, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["code"] == code


def test_analysts_and_supervision_read_every_type(client: TestClient, sign_in: SignIn) -> None:
    for email in (ANALYST.email, SUPERVISOR.email):
        response = client.get(STAGES, headers=bearer(sign_in(email)))
        assert response.status_code == 200, response.text
        body = response.json()
        assert AiStages.model_validate(body).model_dump(mode="json", by_alias=True) == body
    assert body["available"] is True
    assert body["rule"] == {
        "resolvedCasesToAsk": 10,
        "askedCasesToProposeTools": 20,
        "toolUsePercentToShadow": 70,
        "toolCasesMinimum": 10,
        "draftWindow": 100,
        "draftAsIsPercentForAgent": 80,
        "minorEditPermille": 150,
    }
    by_type = {t["caseType"]: t for t in body["types"]}
    assert "none" not in by_type
    assert {k: (t["stage"], t["agent"], t["copilotMode"]) for k, t in by_type.items()} == {
        "unrecognized_charge": (3, "active", "drafts"),
        "undue_charge": (3, "ready", "drafts"),
        "app_issue": (2, "none", "tools"),
        "branch_service": (1, "none", "answer"),
        "service_quality": (1, "none", "answer"),
        "virtual_card": (0, "none", None),
    }
    undue = by_type["undue_charge"]
    assert undue["signals"]["drafts"] == 100
    assert undue["signals"]["draftsAsIs"] == 84
    assert [r["stage"] for r in undue["reached"]] == [1, 2, 3]
    assert undue["lastChange"]["kind"] == "agent_ready"
    assert undue["lastChange"]["byName"] is None  # the system, by the rule
    problem(client.get(STAGES, headers=bearer(sign_in(ADMIN_ONLY.email))), 403, "forbidden")
    assert client.get(STAGES).status_code == 401


def test_supervision_moves_a_type_back_audited_and_live(
    client: TestClient, sign_in: SignIn
) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    with connect(client, daniela) as ws:
        assert ws.receive_json()["type"] == "welcome"
        assert subscribe(ws, "ai:stages")["type"] == "subscribed"

        response = move_back(client, lucia, "app_issue", {"toStage": 1})
        assert response.status_code == 200, response.text
        body = response.json()
        assert MoveStageBackResult.model_validate(body).model_dump(mode="json", by_alias=True) == (
            body
        )
        assert body["changed"] is True
        assert (body["type"]["stage"], body["type"]["copilotMode"]) == (1, "answer")
        assert body["type"]["lastChange"]["byName"] == SUPERVISOR.name

        updates = [e for e in until_pong(ws) if e["type"] == "ai.stage_updated"]
        assert [e["data"]["payload"] for e in updates] == [{"caseType": "app_issue"}]

        again = move_back(client, lucia, "app_issue", {"toStage": 1})
        assert again.json()["changed"] is False
        assert [e for e in until_pong(ws) if e["type"] == "ai.stage_updated"] == []

    audit = client.get("/api/v1/audit/events?family=agents&limit=50", headers=bearer(lucia)).json()[
        "items"
    ]
    row = next(e for e in audit if e["type"] == "ai.stage_moved_back")
    assert row["description"] == "Devolvió Problema con app a la etapa 1: el copiloto responde"
    assert row["changesState"] is True


def test_moving_back_follows_the_rules(client: TestClient, sign_in: SignIn) -> None:
    lucia = sign_in(SUPERVISOR.email)
    problem(move_back(client, lucia, "virtual_card", {"toStage": 1}), 409, "invalid_transition")
    problem(
        move_back(client, lucia, "unrecognized_charge", {"toStage": 2}), 409, "invalid_transition"
    )
    problem(move_back(client, lucia, "none", {"toStage": 0}), 404, "not_found")
    problem(move_back(client, lucia, "app_issue", {"toStage": 4}), 422, "validation_error")
    daniela = sign_in(ANALYST.email)
    problem(move_back(client, daniela, "app_issue", {"toStage": 0}), 403, "forbidden")


def test_the_tool_feedback_needs_her_suggestion(client: TestClient, sign_in: SignIn) -> None:
    daniela = sign_in(ANALYST.email)
    url = f"/api/v1/cases/{seed_case_id(101)}/copilot/suggestions/CPS-{'0' * 26}/tools"
    response = client.post(url, headers=bearer(daniela), json={"tool": "leer_movimientos@1"})
    problem(response, 404, "not_found")
    response = client.post(
        url, headers=bearer(daniela), json={"tool": "x@1", "decision": "dismissed"}
    )
    problem(response, 422, "validation_error")
    lucia = sign_in(SUPERVISOR.email)
    problem(client.post(url, headers=bearer(lucia), json={"tool": "x@1"}), 403, "forbidden")


def test_ai_off_hides_the_stages(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    client.put("/api/v1/admin/platform/ai", headers=bearer(admin), json={"enabled": False})
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    body = client.get(STAGES, headers=bearer(daniela)).json()
    assert (body["available"], body["types"]) == (False, [])
    problem(move_back(client, lucia, "app_issue", {"toStage": 1}), 404, "assistant_disabled")
    url = f"/api/v1/cases/{seed_case_id(101)}/copilot/suggestions/CPS-{'0' * 26}/tools"
    response = client.post(url, headers=bearer(daniela), json={"tool": "x@1"})
    problem(response, 404, "assistant_disabled")


def test_customers_never_follow_the_stages(
    client: TestClient, customer_session: Callable[..., str]
) -> None:
    with connect(client, customer_session(2001)) as ws:
        assert ws.receive_json()["type"] == "welcome"
        assert subscribe(ws, "ai:stages")["type"] == "error"


AGENTS = "/api/v1/ai/agents"


def served_type(client: TestClient, token: str) -> str:
    types = client.get(STAGES, headers=bearer(token)).json()["types"]
    return next(t["caseType"] for t in types if t["agentId"] == "disputas")


def test_the_agents_list_names_and_counts_what_each_one_did(
    client: TestClient, sign_in: SignIn
) -> None:
    daniela = sign_in(ANALYST.email)

    body = client.get(AGENTS, headers=bearer(daniela)).json()

    assert body["available"] is True
    disputas = next(a for a in body["agents"] if a["agentId"] == "disputas")
    assert disputas["displayName"] == "Disputas"  # no name given: the id, humanized
    assert disputas["caseType"] == served_type(client, daniela)
    assert set(disputas["results"]) == {"sessions", "active", "resolved", "handedToPeople"}


def test_supervision_names_the_agent_audited_and_it_shows_in_the_list(
    client: TestClient, sign_in: SignIn
) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    kind = served_type(client, lucia)
    url = f"/api/v1/supervision/ai/stages/{kind}/agent/name"

    renamed = client.put(url, headers=bearer(lucia), json={"name": "  Cobros   indebidos "})

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["agentName"] == "Cobros indebidos"
    agents = client.get(AGENTS, headers=bearer(daniela)).json()["agents"]
    assert (
        next(a for a in agents if a["agentId"] == "disputas")["displayName"] == "Cobros indebidos"
    )
    audit = client.get(
        "/api/v1/audit/events", params={"family": "agents", "limit": 50}, headers=bearer(lucia)
    ).json()["items"]
    row = next(e for e in audit if e["type"] == "ai.agent_renamed")
    assert "Cobros indebidos" not in str(row)  # the name is free text: not in the audit
    again = client.put(url, headers=bearer(lucia), json={"name": "Cobros indebidos"})
    assert again.status_code == 200  # the same name: nothing changes


def test_naming_needs_supervision_an_agent_and_a_valid_name(
    client: TestClient, sign_in: SignIn
) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    kind = served_type(client, lucia)
    served = f"/api/v1/supervision/ai/stages/{kind}/agent/name"
    problem(client.put(served, headers=bearer(daniela), json={"name": "X"}), 403, "forbidden")
    problem(client.put(served, headers=bearer(lucia), json={"name": ""}), 422, "validation_error")
    problem(
        client.put(served, headers=bearer(lucia), json={"name": "x" * 81}), 422, "validation_error"
    )
    none = "/api/v1/supervision/ai/stages/none/agent/name"
    problem(client.put(none, headers=bearer(lucia), json={"name": "X"}), 404, "not_found")
    other = next(
        t["caseType"]
        for t in client.get(STAGES, headers=bearer(lucia)).json()["types"]
        if t["agentId"] is None
    )
    unserved = f"/api/v1/supervision/ai/stages/{other}/agent/name"
    problem(client.put(unserved, headers=bearer(lucia), json={"name": "X"}), 404, "not_found")


def test_ai_off_hides_the_agents(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    client.put("/api/v1/admin/platform/ai", headers=bearer(admin), json={"enabled": False})
    daniela, lucia = sign_in(ANALYST.email), sign_in(SUPERVISOR.email)
    body = client.get(AGENTS, headers=bearer(daniela)).json()
    assert (body["available"], body["agents"]) == (False, [])
    kind = "undue_charge"
    url = f"/api/v1/supervision/ai/stages/{kind}/agent/name"
    problem(client.put(url, headers=bearer(lucia), json={"name": "X"}), 404, "assistant_disabled")


def test_supervision_picks_the_agent_photo_audited_and_listed(
    client: TestClient, sign_in: SignIn
) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    kind = served_type(client, lucia)
    url = f"/api/v1/supervision/ai/stages/{kind}/agent/avatar"

    problem(client.put(url, headers=bearer(daniela), json={"avatar": "star"}), 403, "forbidden")
    problem(client.put(url, headers=bearer(lucia), json={"avatar": "dog"}), 422, "validation_error")
    picked = client.put(url, headers=bearer(lucia), json={"avatar": "star"})

    assert picked.status_code == 200, picked.text
    assert picked.json()["agentAvatar"] == "star"
    agents = client.get(AGENTS, headers=bearer(daniela)).json()["agents"]
    assert next(a for a in agents if a["agentId"] == "disputas")["avatar"] == "star"
    audit = client.get(
        "/api/v1/audit/events", params={"family": "agents", "limit": 50}, headers=bearer(lucia)
    ).json()["items"]
    assert any(e["type"] == "ai.agent_avatar_set" for e in audit)
    assert client.put(url, headers=bearer(lucia), json={"avatar": "star"}).status_code == 200


def test_supervision_picks_the_photo_of_an_agent_before_it_serves_a_type(
    client: TestClient, sign_in: SignIn
) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    url = "/api/v1/supervision/ai/agents/cobros"

    assert client.get(url, headers=bearer(lucia)).json() == {"agentId": "cobros", "avatar": None}
    problem(
        client.put(f"{url}/avatar", headers=bearer(daniela), json={"avatar": "star"}),
        403,
        "forbidden",
    )
    problem(
        client.put(f"{url}/avatar", headers=bearer(lucia), json={"avatar": "dog"}),
        422,
        "validation_error",
    )
    picked = client.put(f"{url}/avatar", headers=bearer(lucia), json={"avatar": "flame"})

    assert picked.status_code == 200, picked.text
    assert picked.json() == {"agentId": "cobros", "avatar": "flame"}
    assert client.get(url, headers=bearer(lucia)).json()["avatar"] == "flame"
    agents = client.get(AGENTS, headers=bearer(daniela)).json()["agents"]
    assert (
        next((a for a in agents if a["agentId"] == "cobros"), {"avatar": "flame"})["avatar"]
        == "flame"
    )
    audit = client.get(
        "/api/v1/audit/events", params={"family": "agents", "limit": 50}, headers=bearer(lucia)
    ).json()["items"]
    assert any(e["type"] == "ai.agent_avatar_chosen" for e in audit)


def test_the_photo_of_an_agent_that_serves_a_type_shows_on_the_type(
    client: TestClient, sign_in: SignIn
) -> None:
    lucia = sign_in(SUPERVISOR.email)
    kind = served_type(client, lucia)
    picked = client.put(
        "/api/v1/supervision/ai/agents/disputas/avatar",
        headers=bearer(lucia),
        json={"avatar": "cloud"},
    )

    assert picked.status_code == 200, picked.text
    types = client.get(STAGES, headers=bearer(lucia)).json()["types"]
    assert next(t for t in types if t["caseType"] == kind)["agentAvatar"] == "cloud"
    audit = client.get(
        "/api/v1/audit/events", params={"family": "agents", "limit": 50}, headers=bearer(lucia)
    ).json()["items"]
    assert any(e["type"] == "ai.agent_avatar_set" for e in audit)
    assert not any(e["type"] == "ai.agent_avatar_chosen" for e in audit)
