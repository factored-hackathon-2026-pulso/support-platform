"""The service-to-service routes (ADR 0003, S17): agent-core's ``grant_active`` check."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import escalation
from tests.support import ANALYST, bearer, make_settings

NATALIA = 2001
DANIELA = seed_staff_id(ANALYST.number)
TOKEN = "internal-secret-for-tests-0123456789"


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(clock: FixedClock, tmp_path: Path, runtime: InMemoryAgentRuntime) -> Container:
    links = tmp_path / "links.json"
    links.write_text(json.dumps({seed_customer_id(NATALIA): "bank-0001"}), encoding="utf-8")
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'internal.db'}",
        bank_customer_links_file=links,
        internal_service_token=SecretStr(TOKEN),
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


def test_agent_core_asks_whether_a_grant_is_still_active(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> None:
    available(DANIELA)
    runtime.script.append(escalation())
    token = customer_session(NATALIA)
    sent = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": "msg-00000001"},
        json={"text": "no reconozco un cargo", "clientMessageId": "msg-00000001"},
    )
    drain()
    case_id = sent.json()["conversation"]["caseId"]
    service = bearer(TOKEN)

    mine = client.get(f"/api/v1/internal/grants/{case_id}:{DANIELA}", headers=service)
    assert (mine.status_code, mine.json()) == (200, {"active": True})
    other = client.get(f"/api/v1/internal/grants/{case_id}:{seed_staff_id(2)}", headers=service)
    assert other.json() == {"active": False}
    junk = client.get("/api/v1/internal/grants/not-a-grant", headers=service)
    assert junk.json() == {"active": False}


def test_the_secret_is_required_and_the_route_is_not_in_the_public_contract(
    client: TestClient,
) -> None:
    assert client.get("/api/v1/internal/grants/x:y").status_code == 401
    assert client.get("/api/v1/internal/grants/x:y", headers=bearer("wrong")).status_code == 401
    assert "/api/v1/internal/grants/{grantRef}" not in client.get("/api/v1/openapi.json").text


def test_without_the_secret_the_route_does_not_exist(tmp_path: Path, clock: FixedClock) -> None:
    plain = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'plain.db'}"),
        clock=clock,
        ids=SequentialIdGenerator(),
    )
    with TestClient(create_app(container=plain)) as client:
        response = client.get("/api/v1/internal/grants/x:y", headers=bearer(TOKEN))
        assert response.status_code == 404
