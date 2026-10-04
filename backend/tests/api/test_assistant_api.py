"""The assistant over HTTP and WebSocket (ADR 0003): what the customer's app and the staff
screens call, with a scripted agent-core (no network). This is the contract the frontend wires."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.application.ai import AgentAwaiting, AgentConfirmation, AgentStepUp
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import escalation, resolution, turn
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer, make_settings

NATALIA = 2001
DANIELA = seed_staff_id(ANALYST.number)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(clock: FixedClock, tmp_path: Path, runtime: InMemoryAgentRuntime) -> Container:
    """agent-core wired to the scripted runtime, and the dataset links read from a private
    file at startup (the way a deployment fills them)."""
    links = tmp_path / "links.json"
    links.write_text(json.dumps({seed_customer_id(NATALIA): "bank-0001"}), encoding="utf-8")
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'assistant-api.db'}",
        bank_customer_links_file=links,
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


def write(client: TestClient, token: str, text: str = "No reconozco un cargo") -> dict[str, Any]:
    key = str(uuid.uuid4())
    response = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": key},
        json={"text": text, "clientMessageId": key},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def conversation(client: TestClient, token: str) -> dict[str, Any]:
    response = client.get("/api/v1/customer/conversation", headers=bearer(token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def post(client: TestClient, token: str, path: str, body: dict[str, Any] | None = None) -> Any:
    return client.post(f"/api/v1/customer/conversation/{path}", headers=bearer(token), json=body)


# ----------------------------------------------------------------------------- the customer
def test_the_customer_round_trip_with_the_assistant(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.append(turn("Hola Natalia, cuéntame qué cargo no reconoces."))
    token = customer_session(NATALIA)

    sent = write(client, token)
    assert sent["caseCreated"] is True
    assert sent["conversation"]["status"] == "with_assistant"
    assert sent["conversation"]["agentName"] == "Asistente virtual"
    drain()

    seen = conversation(client, token)
    assert [t["authorRole"] for t in seen["turns"]] == ["customer", "assistant"]
    assert seen["turns"][1]["authorName"] == "Asistente virtual"
    assert seen["turns"][1]["text"] == "Hola Natalia, cuéntame qué cargo no reconoces."
    assert seen["conversation"]["assistant"] == {
        "working": False,
        "confirmation": None,
        "stepUp": None,
    }
    # the platform signed a customer credential for the dataset customer, never ours
    assert runtime.calls[0].operation == "start_run"


def test_confirmation_over_http(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
    clock: FixedClock,
) -> None:
    runtime.script.extend(
        [
            turn(
                "Voy a radicar la disputa. ¿Confirmas?",
                awaiting=AgentAwaiting.CONFIRMATION,
                confirmation=AgentConfirmation(
                    "Radicar una disputa por 120 USD", "tok-1", clock.now() + timedelta(minutes=5)
                ),
            ),
            turn("Listo, radiqué tu disputa."),
        ]
    )
    token = customer_session(NATALIA)
    write(client, token)
    drain()

    pending = conversation(client, token)["conversation"]["assistant"]["confirmation"]
    assert pending["summary"] == "Radicar una disputa por 120 USD"
    assert pending["token"] == "tok-1"
    wrong = post(client, token, "confirmation", {"token": "nope", "answer": "yes"})
    assert (wrong.status_code, wrong.json()["code"]) == (409, "confirmation_not_pending")

    ok = post(client, token, "confirmation", {"token": "tok-1", "answer": "yes"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["assistant"]["working"] is True
    drain()
    texts = [t["text"] for t in conversation(client, token)["turns"]]
    assert texts[-2:] == ["Confirmaste la acción.", "Listo, radiqué tu disputa."]


def test_step_up_over_http(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.extend(
        [
            turn(
                "Necesito verificar tu identidad.",
                awaiting=AgentAwaiting.STEP_UP,
                step_up=AgentStepUp("step_up", "monto alto", True),
            ),
            turn("Verificado."),
        ]
    )
    token = customer_session(NATALIA)
    write(client, token)
    drain()
    step_up = conversation(client, token)["conversation"]["assistant"]["stepUp"]
    assert step_up == {"reason": "monto alto", "simulated": True}

    wrong = post(client, token, "step-up", {"code": "123456"})
    assert wrong.status_code == 422
    assert (wrong.json()["code"], wrong.json()["remainingAttempts"]) == ("invalid_step_up_code", 2)
    ok = post(client, token, "step-up", {"code": "000000"})
    assert ok.status_code == 200, ok.text
    drain()
    assert conversation(client, token)["turns"][-1]["text"] == "Verificado."
    again = post(client, token, "step-up", {"code": "000000"})
    assert (again.status_code, again.json()["code"]) == (409, "step_up_not_pending")


def test_the_customer_can_ask_for_a_person(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.append(turn("Hola"))
    token = customer_session(NATALIA)
    write(client, token)
    drain()

    response = post(client, token, "human")

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "waiting_agent"
    again = post(client, token, "human")
    assert (again.status_code, again.json()["code"]) == (409, "assistant_not_active")


def test_a_call_cannot_join_a_conversation_the_assistant_handles(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.append(turn("Hola"))
    token = customer_session(NATALIA)
    write(client, token)
    drain()

    response = client.post(
        "/api/v1/customer/calls",
        headers={**bearer(token), "Idempotency-Key": str(uuid.uuid4())},
    )

    assert (response.status_code, response.json()["code"]) == (409, "assistant_active")


def test_the_assistant_routes_answer_disabled_without_agent_core(
    tmp_path: Path, clock: FixedClock
) -> None:
    people_only = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'plain.db'}"),
        clock=clock,
        ids=SequentialIdGenerator(),
    )
    with TestClient(create_app(container=people_only)) as client:
        session = client.post(
            "/api/v1/customer/sessions", json={"customerId": seed_customer_id(NATALIA)}
        )
        token = session.json()["token"]
        response = post(client, token, "human")
        assert (response.status_code, response.json()["code"]) == (404, "assistant_disabled")
        sent = write(client, token)  # and the chat still works, with people
        assert sent["conversation"]["status"] in {"waiting_agent", "with_agent"}
        assert sent["conversation"]["assistant"] is None


# ----------------------------------------------------------------------------- the staff
def test_the_analyst_reads_the_handoff_and_labels_it_when_she_closes(
    client: TestClient,
    *,
    sign_in: Callable[[str], str],
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> None:
    available(DANIELA)
    runtime.script.append(escalation("hnd-7"))
    token = customer_session(NATALIA)
    case_id = write(client, token)["conversation"]["caseId"]
    drain()
    analyst = bearer(sign_in(ANALYST.email))

    detail = client.get(f"/api/v1/cases/{case_id}", headers=analyst)
    assert detail.status_code == 200
    assert detail.json()["case"]["status"] == "assigned"
    assert detail.json()["assignment"]["reason"] == "assistant_handoff"
    handoff = client.get(f"/api/v1/cases/{case_id}/handoff", headers=analyst)
    assert handoff.status_code == 200, handoff.text
    assert handoff.json() == {"packet": {"handoff_ref": "hnd-7"}}

    other = bearer(sign_in(JULIAN.email))
    assert client.get(f"/api/v1/cases/{case_id}/handoff", headers=other).status_code == 403
    supervisor = bearer(sign_in(SUPERVISOR.email))
    assert client.get(f"/api/v1/cases/{case_id}/handoff", headers=supervisor).status_code == 403

    bad = client.post(
        f"/api/v1/cases/{case_id}/close",
        headers=analyst,
        json={"reason": "resolved", "note": None, "handoffQuality": "great"},
    )
    assert bad.status_code == 422
    closed = client.post(
        f"/api/v1/cases/{case_id}/close",
        headers=analyst,
        json={"reason": "resolved", "note": None, "handoffQuality": "useful"},
    )
    assert closed.status_code == 200, closed.text
    drain()
    sent = [c for c in runtime.calls if c.operation == "record_resolution"]
    assert [c.arguments["handoff_quality"] for c in sent] == ["useful"]


def test_a_case_without_a_handoff_answers_handoff_unavailable(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    response = client.get("/api/v1/cases/CASE-00000000000000000000000101/handoff", headers=analyst)
    assert response.status_code in {403, 404}  # not hers or unknown; never a packet


def test_supervision_takes_a_case_from_the_assistant(
    client: TestClient,
    sign_in: Callable[[str], str],
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.append(turn("Hola"))
    token = customer_session(NATALIA)
    case_id = write(client, token)["conversation"]["caseId"]
    drain()
    supervisor = bearer(sign_in(SUPERVISOR.email))

    colas = client.get("/api/v1/supervision/open-cases?language=es", headers=supervisor).json()
    row = next(r for r in colas["cases"] if r["case"]["id"] == case_id)
    assert row["case"]["status"] == "with_assistant"
    assert row["assigneeName"] is None

    analyst = bearer(sign_in(ANALYST.email))
    forbidden = client.post(
        f"/api/v1/supervision/cases/{case_id}/assistant/release", headers=analyst
    )
    assert forbidden.status_code == 403
    released = client.post(
        f"/api/v1/supervision/cases/{case_id}/assistant/release", headers=supervisor
    )
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "queued"
    again = client.post(
        f"/api/v1/supervision/cases/{case_id}/assistant/release", headers=supervisor
    )
    assert (again.status_code, again.json()["code"]) == (409, "assistant_not_active")


def test_a_resolved_conversation_is_closed_and_rateable(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.append(resolution())
    token = customer_session(NATALIA)
    case_id = write(client, token)["conversation"]["caseId"]
    drain()

    seen = conversation(client, token)["conversation"]
    assert (seen["status"], seen["assistant"]) == ("closed", None)
    rated = client.post(
        f"/api/v1/customer/conversations/{case_id}/rating",
        headers={**bearer(token), "Idempotency-Key": "rating-key-0001"},
        json={"score": 4},
    )
    assert rated.status_code == 201, rated.text


# ----------------------------------------------------------------------------- realtime
def test_the_customer_socket_carries_the_answer_and_the_pending_action(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    runtime: InMemoryAgentRuntime,
    clock: FixedClock,
) -> None:
    runtime.script.append(
        turn(
            "¿Confirmas la disputa?",
            awaiting=AgentAwaiting.CONFIRMATION,
            confirmation=AgentConfirmation("Radicar", "tok-1", clock.now() + timedelta(minutes=5)),
        )
    )
    token = customer_session(NATALIA)
    topic = f"customer:{seed_customer_id(NATALIA)}"
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()  # welcome
        ws.send_json({"action": "subscribe", "topic": topic})
        assert ws.receive_json()["type"] == "subscribed"
        write(client, token)
        drain()
        ws.send_json({"action": "ping"})
        received: list[dict[str, Any]] = []
        while (message := ws.receive_json())["type"] != "pong":
            received.append(message)

    answers = [
        m
        for m in received
        if m["type"] == "turn.created" and m["data"]["payload"]["authorRole"] == "assistant"
    ]
    assert [a["data"]["payload"]["text"] for a in answers] == ["¿Confirmas la disputa?"]
    states = [m for m in received if m["type"] == "conversation.updated"]
    last = states[-1]["data"]["payload"]
    assert last["status"] == "with_assistant"
    assert last["assistant"]["confirmation"]["token"] == "tok-1"
    # the agent's internal id never reaches a customer socket
    assert all("recepcion" not in json.dumps(m) for m in received)
