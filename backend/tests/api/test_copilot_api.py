"""The copilot over HTTP (ADR 0003, slice 15): the analyst's panel, with a scripted agent-core."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.application.ai import AgentRuntimeUnavailableError
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import escalation, turn
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer, make_settings

NATALIA = 2001
DANIELA = seed_staff_id(ANALYST.number)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(clock: FixedClock, tmp_path: Path, runtime: InMemoryAgentRuntime) -> Container:
    links = tmp_path / "links.json"
    links.write_text(json.dumps({seed_customer_id(NATALIA): "bank-0001"}), encoding="utf-8")
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'copilot-api.db'}",
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


def ask(client: TestClient, headers: dict[str, str], case_id: str, text: str, key: str) -> Any:
    return client.post(
        f"/api/v1/cases/{case_id}/copilot/messages",
        headers={**headers, "Idempotency-Key": key},
        json={"text": text, "clientMessageId": key},
    )


def test_the_analyst_asks_and_reads_the_thread(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    empty = client.get(f"/api/v1/cases/{assigned_case}/copilot", headers=analyst)
    assert empty.status_code == 200
    assert empty.json() == {"caseId": assigned_case, "available": True, "messages": []}

    runtime.script.append(turn("Debe 1.342,80 USD en la tarjeta."))
    response = ask(client, analyst, assigned_case, "¿Cuánto debe en la tarjeta?", "msg-00000001")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["replayed"] is False
    assert body["question"]["role"] == "analyst"
    assert [a["text"] for a in body["answers"]] == ["Debe 1.342,80 USD en la tarjeta."]
    assert body["answers"][0]["answers"] == body["question"]["id"]
    thread = client.get(f"/api/v1/cases/{assigned_case}/copilot", headers=analyst).json()
    assert [m["role"] for m in thread["messages"]] == ["analyst", "copilot"]

    again = ask(client, analyst, assigned_case, "¿Cuánto debe en la tarjeta?", "msg-00000001")
    assert again.status_code == 200
    assert again.headers["Idempotent-Replayed"] == "true"
    assert again.json()["replayed"] is True


def test_a_failed_call_answers_503_and_a_retry_works(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.script.append(AgentRuntimeUnavailableError("down"))

    failed = ask(client, analyst, assigned_case, "uno", "msg-00000002")
    assert (failed.status_code, failed.json()["code"]) == (503, "agent_core_unavailable")

    runtime.script.append(turn("ahora sí"))
    ok = ask(client, analyst, assigned_case, "uno", "msg-00000002")
    assert ok.status_code == 201
    assert ok.json()["answers"][0]["text"] == "ahora sí"


def test_only_the_assignee_analyst_reaches_the_copilot(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    other = bearer(sign_in(JULIAN.email))
    supervisor = bearer(sign_in(SUPERVISOR.email))

    assert client.get(f"/api/v1/cases/{assigned_case}/copilot", headers=other).status_code == 403
    assert ask(client, other, assigned_case, "hola", "msg-00000003").status_code == 403
    assert (
        client.get(f"/api/v1/cases/{assigned_case}/copilot", headers=supervisor).status_code == 403
    )
    assert ask(client, supervisor, assigned_case, "hola", "msg-00000004").status_code == 403


def test_the_question_is_validated(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    blank = ask(client, analyst, assigned_case, "   ", "msg-00000005")
    assert blank.status_code == 422


def test_without_agent_core_the_panel_just_says_it_is_not_available(
    tmp_path: Path, clock: FixedClock
) -> None:
    people_only = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'plain.db'}"),
        clock=clock,
        ids=SequentialIdGenerator(),
    )
    with TestClient(create_app(container=people_only)) as client:
        login = client.post(
            "/api/v1/auth/login", json={"email": ANALYST.email, "password": "demo1234"}
        )
        mfa = client.post(
            "/api/v1/auth/mfa",
            json={"challengeId": login.json()["challengeId"], "code": "000000"},
        )
        analyst = bearer(mfa.json()["token"])
        case_id = "CASE-00000000000000000000000101"

        thread = client.get(f"/api/v1/cases/{case_id}/copilot", headers=analyst)
        assert thread.status_code == 200
        assert thread.json()["available"] is False
        asked = ask(client, analyst, case_id, "hola", "msg-00000006")
        assert (asked.status_code, asked.json()["code"]) == (404, "assistant_disabled")
