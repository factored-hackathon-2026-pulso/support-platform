"""The AI switch with agent-core wired (slice 18 contract §2): off, the platform is the
people-only one (new chats go to people, no copilot, no builder); on, the assistant starts
again. A conversation the assistant already holds is not interrupted."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_registry import InMemoryAgentRegistry
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import escalation, turn
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, bearer, make_settings

NATALIA, XIMENA = 2001, 2002
DANIELA = seed_staff_id(ANALYST.number)
SignIn = Callable[[str], str]


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(clock: FixedClock, tmp_path: Path, runtime: InMemoryAgentRuntime) -> Container:
    links = tmp_path / "links.json"
    links.write_text(
        json.dumps({seed_customer_id(NATALIA): "bank-0001", seed_customer_id(XIMENA): "b-2"}),
        encoding="utf-8",
    )
    keys = AgentSigningKeys.generate(suffix="s")
    return build_container(
        make_settings(
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'switch.db'}",
            bank_customer_links_file=links,
        ),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(keys, clock),
            runtime=runtime,
            registry=InMemoryAgentRegistry(clock=clock, staff_kid=keys.staff.kid),
        ),
    )


def write(client: TestClient, token: str, text: str = "no reconozco un cargo") -> dict[str, Any]:
    key = str(uuid.uuid4())
    sent = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": key},
        json={"text": text, "clientMessageId": key},
    )
    assert sent.status_code in {200, 201}, sent.text
    conversation: dict[str, Any] = sent.json()["conversation"]
    return conversation


def set_ai(client: TestClient, sign_in: SignIn, enabled: bool) -> None:
    admin = bearer(sign_in(ADMIN_ONLY.email))
    response = client.put("/api/v1/admin/platform/ai", headers=admin, json={"enabled": enabled})
    assert response.status_code == 200, response.text


def test_administration_sees_that_agent_core_is_wired(client: TestClient, sign_in: SignIn) -> None:
    admin = bearer(sign_in(ADMIN_ONLY.email))
    body = client.get("/api/v1/admin/platform", headers=admin).json()
    assert (body["aiEnabled"], body["agentCoreConfigured"]) == (True, True)


def test_off_new_chats_go_to_people_and_on_they_start_with_the_assistant(
    *,
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> None:
    available(DANIELA)
    set_ai(client, sign_in, False)
    people = write(client, customer_session(NATALIA))
    drain()
    assert people["status"] == "with_agent"
    assert people["assistant"] is None
    assert runtime.calls == []

    set_ai(client, sign_in, True)
    runtime.script.append(turn("Hola, soy el asistente virtual."))
    assistant = write(client, customer_session(XIMENA))
    drain()
    assert assistant["status"] == "with_assistant"


def test_off_the_copilot_is_not_available(
    *,
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> None:
    available(DANIELA)
    runtime.script.append(escalation())
    case_id = write(client, customer_session(NATALIA))["caseId"]
    drain()
    analyst = bearer(sign_in(ANALYST.email))
    on = client.get(f"/api/v1/cases/{case_id}/copilot", headers=analyst).json()
    assert on["available"] is True

    set_ai(client, sign_in, False)
    off = client.get(f"/api/v1/cases/{case_id}/copilot", headers=analyst)
    assert off.status_code == 200
    assert off.json() == {"caseId": case_id, "available": False, "messages": []}
    key = "msg-00000010"
    asked = client.post(
        f"/api/v1/cases/{case_id}/copilot/messages",
        headers={**analyst, "Idempotency-Key": key},
        json={"text": "¿Cuánto debe?", "clientMessageId": key},
    )
    assert (asked.status_code, asked.json()["code"]) == (404, "assistant_disabled")


def test_off_the_builder_is_unavailable(client: TestClient, sign_in: SignIn) -> None:
    lucia = bearer(sign_in(SUPERVISOR.email))
    assert client.get("/api/v1/builder/status", headers=lucia).json()["available"] is True
    set_ai(client, sign_in, False)
    status = client.get("/api/v1/builder/status", headers=lucia)
    assert status.status_code == 200
    assert status.json()["available"] is False
    assert client.get("/api/v1/builder/chat", headers=lucia).json() == {
        "available": False,
        "messages": [],
    }
    listed = client.get("/api/v1/builder/proposals", headers=lucia)
    assert (listed.status_code, listed.json()["code"]) == (404, "assistant_disabled")


def test_off_a_conversation_the_assistant_holds_can_still_reach_a_person(
    *,
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> None:
    runtime.script.append(turn("Hola, ¿en qué te ayudo?"))
    token = customer_session(NATALIA)
    assert write(client, token)["status"] == "with_assistant"
    drain()
    set_ai(client, sign_in, False)
    available(DANIELA)
    person = client.post("/api/v1/customer/conversation/human", headers=bearer(token))
    assert person.status_code == 200, person.text
    drain()
    assert person.json()["status"] in {"waiting_agent", "with_agent"}
