"""ADR 0007: the improvement engine announces a proposal (service token, no human session)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import anyio
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from cc_platform.application.ai.registry import ProposalOrigin
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.domain.shared.ids import IdPrefix, make_id
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_registry import InMemoryAgentRegistry
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.builder_support import builder_events
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, bearer, make_settings

TOKEN = "internal-secret-for-tests-0123456789"
URL = "/api/v1/internal/builder/proposals/announce"
NOTIFICATIONS = "/api/v1/me/notifications"
PROPOSALS = "/api/v1/builder/proposals"
CASE = make_id(IdPrefix.CASE, "0" * 26)


@pytest.fixture
def keys() -> AgentSigningKeys:
    return AgentSigningKeys.generate(suffix="t")


@pytest.fixture
def registry(clock: FixedClock, keys: AgentSigningKeys) -> InMemoryAgentRegistry:
    return InMemoryAgentRegistry(clock=clock, staff_kid=keys.staff.kid)


@pytest.fixture
def container(
    clock: FixedClock, tmp_path: Path, registry: InMemoryAgentRegistry, keys: AgentSigningKeys
) -> Container:
    return build_container(
        make_settings(
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'announce.db'}",
            internal_service_token=SecretStr(TOKEN),
        ),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(keys, clock),
            runtime=InMemoryAgentRuntime(principal_kid=keys.principal.kid),
            registry=registry,
        ),
    )


def detected(registry: InMemoryAgentRegistry, title: str = "Mejorar el resumen") -> str:
    return registry.seed_proposal(
        agent_id="disputas", title=title, created_by="engine", origin=ProposalOrigin.AUTO_DETECT
    )


def body(proposal_id: str, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "proposalId": proposal_id,
        "title": "Resumen más corto en disputas",
        "problem": "Los clientes escalan porque el resumen es largo.",
        "evidence": "12 casos escalados por el mismo paso faltante en 7 días.",
        "expectedEffect": "Menos escalaciones por este motivo.",
        "evidenceLinks": [CASE],
    }
    payload.update(overrides)
    return payload


def announce(client: TestClient, payload: dict[str, Any], token: str = TOKEN) -> Any:
    return client.post(URL, headers=bearer(token), json=payload)


def improvements(client: TestClient, token: str) -> list[dict[str, Any]]:
    found = client.get(NOTIFICATIONS, headers=bearer(token))
    assert found.status_code == 200, found.text
    return [n for n in found.json()["items"] if n["kind"] == "improvement_proposed"]


def test_it_needs_the_service_token(client: TestClient, registry: InMemoryAgentRegistry) -> None:
    proposal_id = detected(registry)
    missing = client.post(URL, json=body(proposal_id))
    wrong = announce(client, body(proposal_id), token="not-the-token")
    assert (missing.status_code, wrong.status_code) == (401, 401)


def test_a_staff_session_is_not_a_service_token(
    client: TestClient, sign_in: Callable[[str], str], registry: InMemoryAgentRegistry
) -> None:
    session = sign_in(SUPERVISOR.email)
    assert announce(client, body(detected(registry)), token=session).status_code == 401


def test_it_adopts_the_proposal_and_notifies_supervisors_once(
    client: TestClient, sign_in: Callable[[str], str], registry: InMemoryAgentRegistry
) -> None:
    supervisor, analyst = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    proposal_id = detected(registry)

    first = announce(client, body(proposal_id))
    again = announce(client, body(proposal_id))

    assert first.status_code == 200, first.text
    assert again.status_code == 200
    assert again.json() == first.json()
    assert first.json()["origin"] == "auto_detect"
    assert (first.json()["source"], first.json()["registeredBy"]) == ("engine", "engine")
    assert first.json()["state"] == "draft"  # nothing approved or published
    listed = client.get(PROPOSALS, headers=bearer(supervisor)).json()["items"]
    assert [p["proposalId"] for p in listed] == [proposal_id]
    (notice,) = improvements(client, supervisor)
    assert (notice["caseId"], notice["readAt"]) == (None, None)
    assert notice["improvement"] == {
        "proposalId": proposal_id,
        "agentId": "disputas",
        "title": "Resumen más corto en disputas",
        "problem": "Los clientes escalan porque el resumen es largo.",
        "evidence": "12 casos escalados por el mismo paso faltante en 7 días.",
        "expectedEffect": "Menos escalaciones por este motivo.",
        "evidenceLinks": [CASE],
    }
    assert improvements(client, analyst) == []  # supervisors only
    assert improvements(client, sign_in(ADMIN_ONLY.email)) == []


def test_it_is_audited_once_as_the_engine_and_never_approves(
    client: TestClient, container: Container, registry: InMemoryAgentRegistry
) -> None:
    proposal_id = detected(registry)
    announce(client, body(proposal_id))
    announce(client, body(proposal_id))

    events = anyio.run(builder_events, container)
    assert [(e[0], e[2], e[3]) for e in events] == [
        ("builder.proposal_tracked", "system", proposal_id)
    ]
    assert {c.operation for c in registry.calls} == {"get_proposal"}  # read-only


def test_only_a_proposal_the_engine_detected_can_be_announced(
    client: TestClient, registry: InMemoryAgentRegistry
) -> None:
    by_hand = registry.seed_proposal(agent_id="disputas", title="Del chat")
    assert announce(client, body(by_hand)).status_code == 422
    assert announce(client, body("PRP-unknown")).status_code == 404


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"title": "x" * 121},
        {"problem": "x" * 601},
        {"evidence": "x" * 601},
        {"expectedEffect": "x" * 401},
        {"evidenceLinks": [CASE] * 9},
        {"evidenceLinks": ["https://example.com/leak"]},
        {"evidenceLinks": [CASE, CASE]},
        {"proposalId": "x" * 65},
        {"unknown": "field"},
    ],
)
def test_a_bad_or_oversized_payload_is_422(
    client: TestClient,
    sign_in: Callable[[str], str],
    registry: InMemoryAgentRegistry,
    overrides: dict[str, Any],
) -> None:
    proposal_id = detected(registry)
    assert announce(client, body(proposal_id, **overrides)).status_code == 422
    supervisor = sign_in(SUPERVISOR.email)
    # nothing adopted: the platform's index (the cached list) is empty
    assert client.get(f"{PROPOSALS}?refresh=false", headers=bearer(supervisor)).json() == {
        "items": [],
        "registryListed": False,
    }
    assert improvements(client, supervisor) == []


@pytest.mark.parametrize(
    "text",
    [
        "Escribir a ana.perez@example.com sobre el cargo",
        "El cliente con tarjeta 4111 1111 1111 1111 reclamó",
        "Llamar al 3001234567",
    ],
)
def test_personal_data_in_free_text_is_refused_and_nothing_is_adopted(
    client: TestClient,
    sign_in: Callable[[str], str],
    registry: InMemoryAgentRegistry,
    text: str,
) -> None:
    proposal_id = detected(registry)
    supervisor = sign_in(SUPERVISOR.email)
    assert announce(client, body(proposal_id, problem=text)).status_code == 422
    # nothing adopted: the platform's index (the cached list) is empty
    assert client.get(f"{PROPOSALS}?refresh=false", headers=bearer(supervisor)).json() == {
        "items": [],
        "registryListed": False,
    }
    assert improvements(client, supervisor) == []
