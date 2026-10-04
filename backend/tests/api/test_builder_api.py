"""The agent builder over HTTP (ADR 0003 §7, slice 16): proposals, evaluation, approval with a fresh
second factor, publication, aliases, the chat, and the audit. With a registry double that applies
agent-core's own authorization to the credentials the platform signs."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.application.ai.registry import Violation
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_registry import InMemoryAgentRegistry
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.assistant_support import turn
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, bearer, make_settings

CODE = "000000"
API = "/api/v1/builder"
DRAFT = {
    "kind": "template",
    "content": {"id": "t/resumen", "version": "1.1.0", "text": "corto"},
    "docs": {
        "description": "Acorta el resumen",
        "rationale": "Se lee mejor",
        "changelog": "Máximo 3 líneas",
    },
}


@pytest.fixture
def registry(clock: FixedClock) -> InMemoryAgentRegistry:
    return InMemoryAgentRegistry(clock=clock)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(
    clock: FixedClock,
    tmp_path: Path,
    registry: InMemoryAgentRegistry,
    runtime: InMemoryAgentRuntime,
) -> Container:
    return build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'builder-api.db'}"),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(AgentSigningKeys.generate(suffix="t"), clock),
            runtime=runtime,
            registry=registry,
        ),
    )


@pytest.fixture
def supervisor(client: TestClient, sign_in: Callable[[str], str]) -> dict[str, str]:
    return bearer(sign_in(SUPERVISOR.email))


def start(client: TestClient, headers: dict[str, str], title: str = "Resumen más corto") -> str:
    created = client.post(
        f"{API}/proposals", headers=headers, json={"agentId": "disputas", "title": title}
    )
    assert created.status_code == 201, created.text
    proposal_id: str = created.json()["proposalId"]
    return proposal_id


def evaluated(client: TestClient, headers: dict[str, str]) -> tuple[str, str]:
    proposal_id = start(client, headers)
    base = f"{API}/proposals/{proposal_id}"
    assert (
        client.put(
            f"{base}/draft", headers=headers, json={"expectedRev": 0, "changes": [DRAFT]}
        ).status_code
        == 200
    )
    frozen = client.post(f"{base}/freeze", headers=headers)
    assert frozen.status_code == 200, frozen.text
    assert (
        client.post(
            f"{base}/evaluate", headers=headers, json={"suiteId": "suite-disputas"}
        ).status_code
        == 200
    )
    candidate_hash: str = frozen.json()["candidateHash"]
    return proposal_id, candidate_hash


# ----------------------------------------------------------------------------- the whole flow
def test_a_supervisor_takes_a_proposal_from_draft_to_prod(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    status = client.get(f"{API}/status", headers=supervisor).json()
    assert status == {
        "available": True,
        "canApprove": True,
        "canRevoke": False,
        "stepUpMethod": "authenticator",
        "stepUpDigits": 6,
    }
    proposal_id = start(client, supervisor)
    base = f"{API}/proposals/{proposal_id}"

    saved = client.put(
        f"{base}/draft", headers=supervisor, json={"expectedRev": 0, "changes": [DRAFT]}
    )
    assert saved.status_code == 200
    assert saved.json()["rev"] == 1
    assert client.post(f"{base}/validate", headers=supervisor).json() == {
        "violations": [],
        "candidateHash": registry._hash(proposal_id),
        "autoBumped": [],
    }
    frozen = client.post(f"{base}/freeze", headers=supervisor).json()
    assert frozen["releaseIdPreview"].startswith("rel-")
    report = client.post(f"{base}/evaluate", headers=supervisor, json={"suiteId": "suite-disputas"})
    assert report.status_code == 200
    assert report.json()["verdict"] == "pass"
    assert report.json()["items"][0]["metricId"] == "resolution_rate"

    approved = client.post(
        f"{base}/approve",
        headers=supervisor,
        json={"candidateHash": frozen["candidateHash"], "stepUpCode": CODE},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["decision"] == "approved"
    published = client.post(
        f"{base}/publish",
        headers={**supervisor, "Idempotency-Key": "publish-0001"},
        json={"stepUpCode": CODE},
    )
    assert published.status_code == 201, published.text
    release = published.json()
    assert release["status"] == "active"
    assert release["entities"][0]["ref"] == {
        "kind": "template",
        "id": "t/resumen",
        "version": "1.1.0",
    }

    promoted = client.post(
        f"{API}/aliases/disputas/prod/promote",
        headers=supervisor,
        json={"releaseId": release["releaseId"], "reason": "Probado", "stepUpCode": CODE},
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["after"] == release["releaseId"]
    alias = client.get(f"{API}/aliases/disputas/prod", headers=supervisor).json()
    assert alias == {
        "agentId": "disputas",
        "alias": "prod",
        "releaseId": release["releaseId"],
        "status": "active",
    }
    assert (
        client.get(f"{API}/releases/{release['releaseId']}", headers=supervisor).status_code == 200
    )
    listed = client.get(f"{API}/proposals", headers=supervisor).json()["items"]
    assert [(p["proposalId"], p["state"], p["live"]) for p in listed] == [
        (proposal_id, "published", True)
    ]
    detail = client.get(f"{API}/proposals/{proposal_id}", headers=supervisor).json()
    assert detail["proposal"]["state"] == "published"
    assert detail["changes"][0]["docs"]["rationale"] == "Se lee mejor"


def test_the_second_factor_is_asked_by_each_decision(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id, candidate_hash = evaluated(client, supervisor)
    base = f"{API}/proposals/{proposal_id}"

    missing = client.post(
        f"{base}/approve", headers=supervisor, json={"candidateHash": candidate_hash}
    )
    wrong = client.post(
        f"{base}/approve",
        headers=supervisor,
        json={"candidateHash": candidate_hash, "stepUpCode": "123456"},
    )

    assert (missing.status_code, missing.json()["code"]) == (422, "validation_error")
    assert (wrong.status_code, wrong.json()["code"]) == (422, "builder_step_up_invalid")
    assert wrong.json()["remainingAttempts"] == 4
    assert [c.operation for c in registry.calls if c.operation == "approve"] == []


def test_registry_refusals_are_problem_json_with_their_structure(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id = start(client, supervisor)
    base = f"{API}/proposals/{proposal_id}"
    client.put(f"{base}/draft", headers=supervisor, json={"expectedRev": 0, "changes": [DRAFT]})
    registry.violations.append(Violation("G0-05", "disputa", "n1", "nodes/n1", "falta confirm"))

    invalid = client.post(f"{base}/freeze", headers=supervisor)

    assert invalid.status_code == 422
    body = invalid.json()
    assert body["code"] == "registry_validation_failed"
    assert body["registryCode"] == "validation_failed"
    assert body["violations"] == [
        {
            "rule": "G0-05",
            "flow": "disputa",
            "nodeId": "n1",
            "path": "nodes/n1",
            "message": "falta confirm",
        }
    ]

    registry.violations.clear()
    stale = client.put(
        f"{base}/draft", headers=supervisor, json={"expectedRev": 0, "changes": [DRAFT]}
    )
    assert (stale.status_code, stale.json()["code"]) == (409, "registry_conflict")
    assert stale.json()["registryCode"] == "proposal_stale"

    missing = client.get(
        f"{API}/proposals/00000000-0000-7000-8000-999999999999", headers=supervisor
    )
    assert (missing.status_code, missing.json()["code"]) == (404, "registry_not_found")


def test_a_failed_gate_answers_409_with_the_report(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id = start(client, supervisor)
    base = f"{API}/proposals/{proposal_id}"
    client.put(f"{base}/draft", headers=supervisor, json={"expectedRev": 0, "changes": [DRAFT]})
    client.post(f"{base}/freeze", headers=supervisor)
    registry.verdicts.append("fail")

    failed = client.post(f"{base}/evaluate", headers=supervisor, json={"suiteId": "suite"})

    assert failed.status_code == 409
    body = failed.json()
    assert body["code"] == "registry_gate_failed"
    assert body["report"]["verdict"] == "fail"
    assert body["report"]["items"][0]["passed"] is False
    assert body["report"]["yardstickChanges"] == []
    assert body["evalRunId"].startswith("evr-")
    assert client.get(f"{base}", headers=supervisor).json()["proposal"]["state"] == "draft"


def test_publish_needs_an_idempotency_key_and_replays_with_it(
    client: TestClient, supervisor: dict[str, str]
) -> None:
    proposal_id, candidate_hash = evaluated(client, supervisor)
    base = f"{API}/proposals/{proposal_id}"
    client.post(
        f"{base}/approve",
        headers=supervisor,
        json={"candidateHash": candidate_hash, "stepUpCode": CODE},
    )

    no_key = client.post(f"{base}/publish", headers=supervisor, json={"stepUpCode": CODE})
    first = client.post(
        f"{base}/publish",
        headers={**supervisor, "Idempotency-Key": "publish-0002"},
        json={"stepUpCode": CODE},
    )
    again = client.post(
        f"{base}/publish",
        headers={**supervisor, "Idempotency-Key": "publish-0002"},
        json={"stepUpCode": CODE},
    )

    assert no_key.status_code == 422
    assert first.json()["releaseId"] == again.json()["releaseId"]


def test_reject_sends_the_proposal_back_to_draft(
    client: TestClient, supervisor: dict[str, str]
) -> None:
    proposal_id, _ = evaluated(client, supervisor)

    rejected = client.post(
        f"{API}/proposals/{proposal_id}/reject",
        headers=supervisor,
        json={"reason": "No cumple el tono", "stepUpCode": CODE},
    )

    assert rejected.status_code == 200
    assert rejected.json()["state"] == "draft"
    reopened = client.post(f"{API}/proposals/{proposal_id}/reopen", headers=supervisor)
    assert reopened.status_code == 409  # already in draft: nothing to reopen


def test_a_proposal_made_elsewhere_is_tracked_by_id(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    proposal_id = registry.seed_proposal(agent_id="disputas", title="Del chat")
    assert client.get(f"{API}/proposals", headers=supervisor).json() == {"items": []}

    tracked = client.post(
        f"{API}/proposals/track", headers=supervisor, json={"proposalId": proposal_id}
    )

    assert tracked.status_code == 200
    assert (tracked.json()["source"], tracked.json()["createdBy"]) == ("tracked", "constructor-bot")
    assert [
        p["proposalId"] for p in client.get(f"{API}/proposals", headers=supervisor).json()["items"]
    ] == [proposal_id]
    assert client.get(f"{API}/proposals?state=published", headers=supervisor).json() == {
        "items": []
    }


def test_versions_and_entities_pass_through_with_slashes_in_the_id(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    from cc_platform.application.ai.registry import (
        EntityVersion,
        VersionDocs,
        VersionRef,
    )

    registry.seed_entity(
        EntityVersion(
            ref=VersionRef("template", "t/resumen", "1.0.0"),
            content={"id": "t/resumen", "version": "1.0.0", "text": "largo"},
            content_hash="h1",
            docs=VersionDocs("d", "r", "c"),
            created_by="STF-1",
            created_at=registry.clock.now(),
        )
    )

    versions = client.get(f"{API}/versions/template/t/resumen", headers=supervisor)
    entity = client.get(f"{API}/entities/template/t/resumen?version=1.0.0", headers=supervisor)
    absent = client.get(f"{API}/entities/template/t/resumen?version=9.9.9", headers=supervisor)

    assert versions.json()["items"][0]["ref"]["version"] == "1.0.0"
    assert entity.json()["content"] == {"id": "t/resumen", "version": "1.0.0", "text": "largo"}
    assert absent.status_code == 404


# ----------------------------------------------------------------------------- who may
def test_only_supervision_and_administration_build_agents(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    assert client.get(f"{API}/status", headers=analyst).status_code == 403
    assert client.get(f"{API}/proposals", headers=analyst).status_code == 403
    assert client.post(f"{API}/chat/messages", headers=analyst, json={}).status_code in (403, 422)
    assert client.get(f"{API}/proposals").status_code == 401


def test_only_administration_revokes(
    client: TestClient, sign_in: Callable[[str], str], supervisor: dict[str, str]
) -> None:
    proposal_id, candidate_hash = evaluated(client, supervisor)
    base = f"{API}/proposals/{proposal_id}"
    client.post(
        f"{base}/approve",
        headers=supervisor,
        json={"candidateHash": candidate_hash, "stepUpCode": CODE},
    )
    release = client.post(
        f"{base}/publish",
        headers={**supervisor, "Idempotency-Key": "publish-0003"},
        json={"stepUpCode": CODE},
    ).json()
    revoke = {"reason": "Error de contenido", "stepUpCode": CODE}

    refused = client.post(
        f"{API}/releases/{release['releaseId']}/revoke", headers=supervisor, json=revoke
    )
    admin = bearer(sign_in(ADMIN_ONLY.email))
    done = client.post(f"{API}/releases/{release['releaseId']}/revoke", headers=admin, json=revoke)

    assert refused.status_code == 403
    assert done.status_code == 200
    assert done.json()["status"] == "revoked"
    assert client.get(f"{API}/status", headers=admin).json()["canRevoke"] is True


def test_an_outage_answers_503(
    client: TestClient, supervisor: dict[str, str], registry: InMemoryAgentRegistry
) -> None:
    registry.unavailable = True

    down = client.post(
        f"{API}/proposals", headers=supervisor, json={"agentId": "disputas", "title": "x"}
    )

    assert (down.status_code, down.json()["code"]) == (503, "agent_core_unavailable")


# ----------------------------------------------------------------------------- the chat
def chat(client: TestClient, headers: dict[str, str], text: str, key: str) -> Any:
    return client.post(
        f"{API}/chat/messages",
        headers={**headers, "Idempotency-Key": key},
        json={"text": text, "clientMessageId": key},
    )


def test_the_chat_with_the_builder_agent(
    client: TestClient,
    supervisor: dict[str, str],
    registry: InMemoryAgentRegistry,
    runtime: InMemoryAgentRuntime,
) -> None:
    made = registry.seed_proposal(agent_id="disputas", title="Del chat")
    assert client.get(f"{API}/chat", headers=supervisor).json() == {
        "available": True,
        "messages": [],
    }
    runtime.script.append(turn(f"Creé la propuesta {made} con el borrador."))

    sent = chat(client, supervisor, "Acorta el resumen de disputas", "msg-00000001")

    assert sent.status_code == 201, sent.text
    body = sent.json()
    assert body["replayed"] is False
    assert body["message"]["role"] == "person"
    assert body["answers"][0]["answers"] == body["message"]["id"]
    assert [p["proposalId"] for p in body["proposals"]] == [made]
    thread = client.get(f"{API}/chat", headers=supervisor).json()
    assert [m["role"] for m in thread["messages"]] == ["person", "agent"]
    assert [
        p["proposalId"] for p in client.get(f"{API}/proposals", headers=supervisor).json()["items"]
    ] == [made]

    again = chat(client, supervisor, "Acorta el resumen de disputas", "msg-00000001")
    assert again.status_code == 200
    assert again.headers["Idempotent-Replayed"] == "true"
    other = chat(client, supervisor, "Otra cosa", "msg-00000001")
    assert (other.status_code, other.json()["code"]) == (409, "idempotency_conflict")
    mismatch = client.post(
        f"{API}/chat/messages",
        headers={**supervisor, "Idempotency-Key": "msg-00000002"},
        json={"text": "hola", "clientMessageId": "msg-00000003"},
    )
    assert mismatch.status_code == 422


def test_a_failed_chat_call_keeps_the_message_and_a_retry_works(
    client: TestClient, supervisor: dict[str, str], runtime: InMemoryAgentRuntime
) -> None:
    from cc_platform.application.ai import AgentRuntimeUnavailableError

    runtime.script.append(AgentRuntimeUnavailableError("down"))
    key = str(uuid.uuid4())

    failed = chat(client, supervisor, "uno", key)
    runtime.script.append(turn("ahora sí"))
    ok = chat(client, supervisor, "uno", key)

    assert (failed.status_code, failed.json()["code"]) == (503, "agent_core_unavailable")
    assert ok.status_code == 201
    assert ok.json()["answers"][0]["text"] == "ahora sí"


# ----------------------------------------------------------------------------- the audit
def test_the_audit_shows_who_did_what_without_the_content(
    client: TestClient, supervisor: dict[str, str]
) -> None:
    proposal_id, candidate_hash = evaluated(client, supervisor)
    client.post(
        f"{API}/proposals/{proposal_id}/approve",
        headers=supervisor,
        json={"candidateHash": candidate_hash, "stepUpCode": CODE},
    )

    audit = client.get("/api/v1/audit/events?family=agents&limit=100", headers=supervisor)

    assert audit.status_code == 200, audit.text
    events = audit.json()["items"]
    assert {e["type"] for e in events} >= {
        "builder.proposal_created",
        "builder.draft_saved",
        "builder.proposal_frozen",
        "builder.proposal_evaluated",
        "builder.proposal_approved",
    }
    assert all(e["family"] == "agents" and e["actor"]["role"] == "supervisor" for e in events)
    approved = next(e for e in events if e["type"] == "builder.proposal_approved")
    assert approved["description"] == "Aprobó la propuesta"
    assert approved["changesState"] is True
    assert "corto" not in str(events)  # no draft content
    assert "Resumen" not in str(events)  # no titles


# ----------------------------------------------------------------------------- without agent-core
def test_without_agent_core_the_builder_is_off(tmp_path: Path, clock: FixedClock) -> None:
    people_only = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'plain.db'}"),
        clock=clock,
        ids=SequentialIdGenerator(),
    )
    with TestClient(create_app(container=people_only)) as client:
        login = client.post(
            "/api/v1/auth/login", json={"email": SUPERVISOR.email, "password": "demo1234"}
        )
        mfa = client.post(
            "/api/v1/auth/mfa", json={"challengeId": login.json()["challengeId"], "code": CODE}
        )
        headers = bearer(mfa.json()["token"])

        assert client.get(f"{API}/status", headers=headers).json()["available"] is False
        assert client.get(f"{API}/chat", headers=headers).json() == {
            "available": False,
            "messages": [],
        }
        for response in (
            client.get(f"{API}/proposals", headers=headers),
            client.post(f"{API}/proposals", headers=headers, json={"agentId": "x", "title": "y"}),
            chat(client, headers, "hola", "msg-00000009"),
        ):
            assert (response.status_code, response.json()["code"]) == (404, "assistant_disabled")
