"""The copilot's suggestions over HTTP (ADR 0005): ask, read the latest, dismiss the draft, and the
reply or escalation that derive what the analyst did. With a scripted agent-core."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.application.ai import AgentRuntimeUnavailableError
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.domain.ai.suggestion import (
    ActionSuggestion,
    EscalationSuggestion,
    ReplySuggestion,
    ToolSuggestion,
)
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import escalation
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer, make_settings

NATALIA = 2001
DANIELA = seed_staff_id(ANALYST.number)
DRAFT = "Natalia, ya radiqué la disputa y te confirmo por este chat."

FULL = (
    ReplySuggestion(text=DRAFT, citations=("f1",), language="es"),
    ToolSuggestion(tool="leer_movimientos@1", label="Movimientos", why="Ver los cargos"),
    ActionSuggestion(tool="radicar_pqr@1", summary="Radicar una disputa por 120 USD"),
    EscalationSuggestion(
        reason_code="policy:fraude",
        evidence=("Dice que le robaron la tarjeta",),
        motive_draft="Posible robo de tarjeta.",
    ),
)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(
    request: pytest.FixtureRequest,
    clock: FixedClock,
    tmp_path: Path,
    runtime: InMemoryAgentRuntime,
) -> Container:
    enabled = getattr(request, "param", True)
    links = tmp_path / "links.json"
    links.write_text(json.dumps({seed_customer_id(NATALIA): "bank-0001"}), encoding="utf-8")
    extra: dict[str, object] = {
        "copilot_suggestions_agent": "copiloto-sugerencias@prod",
        "copilot_suggestions_auto": False,  # these tests ask by hand
    }
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'suggestions-api.db'}",
        bank_customer_links_file=links,
        **(extra if enabled else {}),
    )
    return build_container(
        settings,
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(AgentSigningKeys.generate(suffix="t"), clock),
            runtime=runtime,
        ),
    )


@pytest.fixture
def assigned_case(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> str:
    """A case the assistant escalated to Daniela; the runtime's calls are cleared."""
    available(DANIELA)
    runtime.script.append(escalation())
    token = customer_session(NATALIA)
    key = str(uuid.uuid4())
    sent = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": key},
        json={"text": "no reconozco un cargo", "clientMessageId": key},
    )
    drain()
    runtime.calls.clear()
    case_id: str = sent.json()["conversation"]["caseId"]
    return case_id


def ask(
    client: TestClient, headers: dict[str, str], case_id: str, key: str = "key-00000001"
) -> Any:
    return client.post(
        f"/api/v1/cases/{case_id}/copilot/suggestions",
        headers={**headers, "Idempotency-Key": key},
        json={"trigger": "manual"},
    )


def latest(client: TestClient, headers: dict[str, str], case_id: str) -> Any:
    return client.get(f"/api/v1/cases/{case_id}/copilot/suggestions/latest", headers=headers)


def reply(
    client: TestClient, headers: dict[str, str], case_id: str, text: str, suggestion_id: str
) -> Any:
    key = str(uuid.uuid4())
    return client.post(
        f"/api/v1/cases/{case_id}/turns",
        headers={**headers, "Idempotency-Key": key},
        json={"text": text, "clientMessageId": key, "copilotSuggestionId": suggestion_id},
    )


def test_the_analyst_asks_for_a_suggestion_and_reads_it_back(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    empty = latest(client, analyst, assigned_case)
    assert empty.status_code == 200
    assert empty.json() == {"available": True, "suggestion": None}

    runtime.suggestion_script.append(FULL)
    response = ask(client, analyst, assigned_case)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["status"], body["trigger"], body["stale"]) == ("ready", "manual", False)
    assert body["replyDecision"] is None
    assert [s["type"] for s in body["suggestions"]] == ["reply", "tool", "action", "escalate"]
    assert body["suggestions"][0] == {
        "type": "reply",
        "text": DRAFT,
        "citations": ["f1"],
        "language": "es",
    }
    assert body["suggestions"][2]["executable"] is False  # information only
    assert body["suggestions"][3]["reasonCode"] == "policy:fraude"
    assert body["suggestions"][3]["motiveDraft"] == "Posible robo de tarjeta."
    read = latest(client, analyst, assigned_case).json()
    assert read["available"] is True
    assert read["suggestion"]["id"] == body["id"]


def test_nothing_to_propose_is_a_normal_answer(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(())

    response = ask(client, analyst, assigned_case)

    assert response.status_code == 201
    assert (response.json()["status"], response.json()["suggestions"]) == ("none", [])


def test_a_retry_with_the_same_key_is_a_replay_and_asks_nothing(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    first = ask(client, analyst, assigned_case)

    again = ask(client, analyst, assigned_case)

    assert again.status_code == 200
    assert again.headers["Idempotent-Replayed"] == "true"
    assert again.json()["id"] == first.json()["id"]
    assert [c.operation for c in runtime.calls] == ["start_run"]


def test_a_failed_call_answers_503_and_the_same_key_asks_again(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(AgentRuntimeUnavailableError("down"))

    failed = ask(client, analyst, assigned_case)
    assert (failed.status_code, failed.json()["code"]) == (503, "agent_core_unavailable")
    seen = latest(client, analyst, assigned_case).json()["suggestion"]
    assert (seen["status"], seen["failureCode"]) == ("failed", "agent_core_unavailable")

    runtime.suggestion_script.append(FULL)
    ok = ask(client, analyst, assigned_case)
    assert ok.status_code == 201
    assert ok.json()["id"] == seen["id"]


def test_the_idempotency_key_is_required(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    response = client.post(f"/api/v1/cases/{assigned_case}/copilot/suggestions", headers=analyst)

    assert response.status_code == 422


def test_dismissing_the_draft_keeps_the_rest(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    response = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/{made['id']}/feedback",
        headers=analyst,
        json={"decision": "discarded"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["replyDecision"] == "discarded"
    assert [s["type"] for s in body["suggestions"]] == ["tool", "action", "escalate"]
    bad = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/{made['id']}/feedback",
        headers=analyst,
        json={"decision": "used"},
    )
    assert bad.status_code == 422
    unknown = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/CPS-{'0' * 26}/feedback",
        headers=analyst,
        json={"decision": "ignored"},
    )
    assert unknown.status_code == 404


def test_replying_with_the_suggestion_id_marks_it_used_or_edited(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    clock: FixedClock,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.extend([FULL, FULL])
    first = ask(client, analyst, assigned_case, "key-00000001").json()

    sent = reply(client, analyst, assigned_case, DRAFT, first["id"])

    assert sent.status_code == 201, sent.text
    after = latest(client, analyst, assigned_case).json()["suggestion"]
    assert after["replyDecision"] == "used"
    assert "reply" not in [s["type"] for s in after["suggestions"]]

    clock.advance(timedelta(minutes=1))
    second = ask(client, analyst, assigned_case, "key-00000002").json()
    edited = reply(client, analyst, assigned_case, "Natalia, ya lo estoy viendo.", second["id"])

    assert edited.status_code == 201
    assert latest(client, analyst, assigned_case).json()["suggestion"]["replyDecision"] == "edited"


def test_a_wrong_suggestion_id_never_fails_the_reply(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    sent = reply(client, analyst, assigned_case, "Hola, Natalia.", "CPS-" + "9" * 26)

    assert sent.status_code == 201


def test_escalating_with_the_recommendation_records_it_as_accepted(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    escalated = client.post(
        f"/api/v1/cases/{assigned_case}/escalations",
        headers={**analyst, "Idempotency-Key": "esc-key-00001"},
        json={"motive": "Posible robo de tarjeta.", "copilotSuggestionId": made["id"]},
    )

    assert escalated.status_code == 201, escalated.text
    assert latest(client, analyst, assigned_case).json()["suggestion"]["escalationAccepted"]


def test_only_the_assignee_analyst_reaches_the_suggestions(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    other = bearer(sign_in(JULIAN.email))
    supervisor = bearer(sign_in(SUPERVISOR.email))

    assert latest(client, other, assigned_case).status_code == 403
    assert ask(client, other, assigned_case).status_code == 403
    assert latest(client, supervisor, assigned_case).status_code == 403
    assert ask(client, supervisor, assigned_case).status_code == 403
    assert latest(client, {}, assigned_case).status_code == 401


@pytest.mark.parametrize("container", [False], indirect=True)
def test_without_a_suggestions_agent_the_panel_hides(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    read = latest(client, analyst, assigned_case)
    asked = ask(client, analyst, assigned_case)

    assert read.status_code == 200
    assert read.json() == {"available": False, "suggestion": None}
    assert (asked.status_code, asked.json()["code"]) == (404, "assistant_disabled")


def test_the_events_reach_the_audit_without_any_text(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    ask(client, analyst, assigned_case)
    supervisor = bearer(sign_in(SUPERVISOR.email))

    audit = client.get(
        "/api/v1/audit/events", params={"family": "conversation", "limit": 100}, headers=supervisor
    )

    assert audit.status_code == 200, audit.text
    events = audit.json()["items"]
    types = {e["type"] for e in events}
    assert {"copilot.suggestion_requested", "copilot.suggestion_ready"} <= types
    descriptions = {e["description"] for e in events}
    assert "El copiloto preparó una sugerencia" in descriptions
    dumped = json.dumps(events, ensure_ascii=False)
    for secret in (DRAFT, "Radicar una disputa", "Posible robo", "Ver los cargos"):
        assert secret not in dumped
