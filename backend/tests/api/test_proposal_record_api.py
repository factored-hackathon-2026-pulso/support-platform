"""``GET /builder/proposals/{id}/record`` (slice 22): the improvement engine's dossier with its
evidence cases resolved, and the history of the decisions taken on the platform. Local reads:
the registry double is only there to make the proposals and the decisions."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

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
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import ANALYST, SUPERVISOR, bearer, make_settings

TOKEN = "internal-secret-for-tests-0123456789"
ANNOUNCE = "/api/v1/internal/builder/proposals/announce"
API = "/api/v1/builder"
CODE = "000000"
KNOWN = seed_case_id(101)
GONE = make_id(IdPrefix.CASE, "0" * 26)
DRAFT = {
    "kind": "template",
    "content": {"id": "t/resumen", "version": "1.1.0", "text": "corto"},
    "docs": {"description": "Acorta el resumen", "rationale": "Se lee mejor", "changelog": "-"},
}


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
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'record.db'}",
            internal_service_token=SecretStr(TOKEN),
        ),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(keys, clock),
            runtime=InMemoryAgentRuntime(principal_kid=keys.principal.kid, greeting=""),
            registry=registry,
        ),
    )


@pytest.fixture
def supervisor(client: TestClient, sign_in: Callable[[str], str]) -> dict[str, str]:
    return bearer(sign_in(SUPERVISOR.email))


def record(client: TestClient, headers: dict[str, str], proposal_id: str) -> Any:
    found = client.get(f"{API}/proposals/{proposal_id}/record", headers=headers)
    assert found.status_code == 200, found.text
    return found.json()


def announced(client: TestClient, registry: InMemoryAgentRegistry, links: list[str]) -> str:
    proposal_id = registry.seed_proposal(
        agent_id="disputas", title="Resumen", created_by="engine", origin=ProposalOrigin.AUTO_DETECT
    )
    body = {
        "proposalId": proposal_id,
        "title": "Resumen más corto en disputas",
        "problem": "Los clientes escalan porque el resumen es largo.\nSobre todo por chat.",
        "evidence": "12 casos escalados por el mismo paso faltante en 7 días.",
        "expectedEffect": "Menos escalaciones por este motivo.",
        "evidenceLinks": links,
    }
    answer = client.post(ANNOUNCE, headers=bearer(TOKEN), json=body)
    assert answer.status_code == 200, answer.text
    return proposal_id


def test_the_engine_dossier_comes_with_its_evidence_cases_resolved(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id = announced(client, registry, [KNOWN, GONE])

    found = record(client, supervisor, proposal_id)

    improvement = found["improvement"]
    assert improvement["title"] == "Resumen más corto en disputas"
    assert improvement["problem"].endswith("\nSobre todo por chat.")  # plain text, as sent
    assert improvement["expectedEffect"] == "Menos escalaciones por este motivo."
    assert improvement["language"] == "es"
    assert improvement["announcedAt"]
    known, gone = improvement["evidenceCases"]
    assert (known["caseId"], known["available"]) == (KNOWN, True)
    assert all(known[fact] for fact in ("status", "caseType", "channel", "language", "openedAt"))
    assert gone == {
        "caseId": GONE,
        "available": False,
        "status": None,
        "caseType": None,
        "channel": None,
        "language": None,
        "openedAt": None,
    }
    (tracked,) = found["history"]
    assert (tracked["kind"], tracked["source"], tracked["actorId"]) == ("tracked", "engine", None)


def test_a_proposal_the_engine_did_not_announce_has_no_dossier(
    client: TestClient, supervisor: dict[str, str]
) -> None:
    created = client.post(
        f"{API}/proposals", headers=supervisor, json={"agentId": "disputas", "title": "A mano"}
    )
    proposal_id = created.json()["proposalId"]

    found = record(client, supervisor, proposal_id)

    assert found["improvement"] is None
    assert [step["kind"] for step in found["history"]] == ["created"]
    assert found["history"][0]["actorName"] == SUPERVISOR.name


def test_an_unknown_id_is_an_empty_record(client: TestClient, supervisor: dict[str, str]) -> None:
    assert record(client, supervisor, "no-such-proposal") == {"improvement": None, "history": []}


def test_the_history_tells_the_verdicts_the_decisions_and_the_way_to_prod(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id = announced(client, registry, [])
    base = f"{API}/proposals/{proposal_id}"

    def step(path: str, body: dict[str, Any] | None = None, **headers: str) -> Any:
        answer = client.post(f"{base}/{path}", headers={**supervisor, **headers}, json=body)
        assert answer.status_code in (200, 201), answer.text
        return answer.json()

    def evaluate() -> None:
        put = client.put(
            f"{base}/draft",
            headers=supervisor,
            json={
                "expectedRev": client.get(base, headers=supervisor).json()["proposal"]["rev"],
                "changes": [DRAFT],
            },
        )
        assert put.status_code == 200, put.text
        step("freeze")
        step("evaluate", {"suiteId": "suite-disputas"})

    registry.verdicts.extend(["fail", "pass", "pass"])
    put = client.put(
        f"{base}/draft", headers=supervisor, json={"expectedRev": 0, "changes": [DRAFT]}
    )
    assert put.status_code == 200, put.text
    step("freeze")
    failed = client.post(f"{base}/evaluate", headers=supervisor, json={"suiteId": "suite-disputas"})
    assert failed.status_code == 409  # the gate refused: back to draft
    evaluate()
    step("reject", {"reason": "Ya hay otra", "stepUpCode": CODE, "reasonCode": "duplicate"})
    evaluate()
    candidate = client.get(base, headers=supervisor).json()["proposal"]["candidateHash"]
    step("approve", {"candidateHash": candidate, "stepUpCode": CODE})
    release = step("publish", {"stepUpCode": CODE}, **{"Idempotency-Key": "publish-0001"})
    promoted = client.post(
        f"{API}/aliases/disputas/prod/promote",
        headers=supervisor,
        json={"releaseId": release["releaseId"], "stepUpCode": CODE},
    )
    assert promoted.status_code == 200, promoted.text

    history = record(client, supervisor, proposal_id)["history"]

    kinds = [entry["kind"] for entry in history]
    assert kinds == [
        "tracked",
        "frozen",
        "evaluated",
        "frozen",
        "evaluated",
        "rejected",
        "frozen",
        "evaluated",
        "approved",
        "published",
        "promoted",
    ]
    verdicts = [
        (e["verdict"], e["items"], e["itemsFailed"]) for e in history if e["kind"] == "evaluated"
    ]
    assert [v[0] for v in verdicts] == ["fail", "pass", "pass"]
    assert (verdicts[0][2] or 0) > 0
    rejected = next(e for e in history if e["kind"] == "rejected")
    assert (rejected["reasonCode"], rejected["actorName"]) == ("duplicate", SUPERVISOR.name)
    assert "Ya hay otra" not in str(history)  # the free text never comes back
    published = next(e for e in history if e["kind"] == "published")
    last = history[-1]
    assert (last["alias"], last["releaseId"]) == ("prod", published["releaseId"])


def test_only_supervision_and_administration_read_it(
    client: TestClient, sign_in: Callable[[str], str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id = announced(client, registry, [KNOWN])
    analyst = bearer(sign_in(ANALYST.email))

    assert client.get(f"{API}/proposals/{proposal_id}/record", headers=analyst).status_code == 403
    assert client.get(f"{API}/proposals/{proposal_id}/record").status_code == 401
