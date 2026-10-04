"""``HttpAgentRuntime`` against agent-core's published OpenAPI (ADR 0003 §1).

``agent-core-openapi.json`` is a copy of ``agent-core/contracts/openapi.json`` (version in
``agent-core-contract-version.txt``). Refresh both when agent-core's contract changes: this test
then fails if the adapter sends a path, header or body field the new contract does not know.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from cc_platform.application.ai import AgentCredentials
from cc_platform.infrastructure.ai.http_runtime import HttpAgentRuntime

HERE = Path(__file__).parent
SPEC: dict[str, Any] = json.loads((HERE / "agent-core-openapi.json").read_text(encoding="utf-8"))
ADVISOR = AgentCredentials("a.b.c", "d.e.f")


def schema_of(operation: dict[str, Any]) -> dict[str, Any] | None:
    content = operation.get("requestBody", {}).get("content", {}).get("application/json")
    if content is None:
        return None
    name = content["schema"]["$ref"].rsplit("/", 1)[-1]
    return SPEC["components"]["schemas"][name]


def matching_operation(method: str, path: str) -> dict[str, Any]:
    """The spec operation for a concrete path (``/v1/runs/{id}`` style templates)."""
    parts = path.strip("/").split("/")
    for template, operations in SPEC["paths"].items():
        candidate = template.strip("/").split("/")
        if len(candidate) == len(parts) and all(
            c.startswith("{") or c == p for c, p in zip(candidate, parts, strict=True)
        ):
            assert method.lower() in operations, f"{method} {template} is not in the contract"
            return operations[method.lower()]
    raise AssertionError(f"{path} is not in agent-core's contract")


def check_request(request: httpx.Request) -> None:
    operation = matching_operation(request.method, request.url.path)
    declared = {p["name"].lower() for p in operation.get("parameters", []) if p["in"] == "header"}
    for header in ("authorization", "x-on-behalf-of", "idempotency-key"):
        if header in request.headers:
            assert header in declared, f"header {header} is not declared by the contract"
    schema = schema_of(operation)
    if request.content:
        assert schema is not None, "the contract declares no body for this call"
        body = json.loads(request.content)
        assert set(body) <= set(schema["properties"]), set(body) - set(schema["properties"])
        assert set(schema.get("required", [])) <= set(body)
        if "confirm" in body:
            confirm = SPEC["components"]["schemas"]["ConfirmAnswer"]
            assert set(body["confirm"]) == set(confirm["properties"])


async def test_every_call_of_the_adapter_matches_the_published_contract() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        turn = {
            "run_id": "r",
            "turn_id": "t",
            "messages": [],
            "locale": "es",
            "awaiting": "none",
            "status": "open",
            "trace_id": "x",
        }
        if request.url.path == "/v1/runs":
            return httpx.Response(
                201,
                json={"run_id": "r", "release": "rel", "status": "open", "trace_id": "x"},
            )
        if request.url.path.endswith("/lineage"):
            return httpx.Response(200, json={"session_id": "s", "runs": []})
        if request.url.path.endswith("/resolution"):
            return httpx.Response(
                200,
                json={"handoff_ref": "h", "resolution_code": "c", "handoff_quality": "useful"},
            )
        if "/handoffs/" in request.url.path:
            return httpx.Response(200, json={"handoff_ref": "h"})
        return httpx.Response(200, json=turn)

    api = HttpAgentRuntime(
        httpx.AsyncClient(base_url="http://agent-core.test", transport=httpx.MockTransport(handler))
    )
    await api.start_run(ADVISOR, agent="recepcion@prod", idempotency_key="k", lang="es")
    await api.post_turn(
        ADVISOR, session_id="s", client_turn_id="m", channel="web_chat", text="hola"
    )
    await api.post_turn(
        ADVISOR,
        session_id="s",
        client_turn_id="m2",
        channel="web_chat",
        confirm_token="tok",
        confirm_answer="yes",
    )
    await api.get_lineage(ADVISOR, session_id="s")
    await api.get_handoff(ADVISOR, handoff_ref="h")
    await api.record_resolution(
        ADVISOR, handoff_ref="h", resolution_code="c", handoff_quality="useful", notes="n"
    )

    assert len(seen) == 6
    for request in seen:
        check_request(request)


def test_the_copied_contract_is_the_version_the_adapter_was_written_for() -> None:
    version = (HERE / "agent-core-contract-version.txt").read_text(encoding="utf-8").strip()

    assert version == "1.3.0"
    assert SPEC["info"]["version"] == "1.3.0"
