"""The HTTP agent-core runtime: wire mapping, headers, errors (ADR 0003, M9 contract)."""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from cc_platform.application.ai import (
    AgentAwaiting,
    AgentCredentials,
    AgentOutcome,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
)
from cc_platform.infrastructure.ai.http_runtime import HttpAgentRuntime
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime, escalated_turn

CUSTOMER = AgentCredentials("customer.jws.sig")
ADVISOR = AgentCredentials("advisor.jws.sig", "grant.jws.sig")

TURN = {
    "run_id": "run-1",
    "turn_id": "t-1",
    "messages": [{"kind": "generated", "text": "Hola", "locale": "es"}],
    "locale": "es",
    "awaiting": "confirmation",
    "confirmation": {
        "action_summary": "Radicar una disputa por 120 USD",
        "token": "tok-1",
        "expires_at": "2026-10-04T15:10:00Z",
    },
    "step_up": {"required_level": "step_up", "reason": "monto", "simulated": True},
    "status": "open",
    "outcome": None,
    "handoff_ref": None,
    "agent": {"id": "disputas", "version": "1.0.0"},
    "trace_id": "trace-1",
}


def runtime(handler: Callable[[httpx.Request], httpx.Response]) -> HttpAgentRuntime:
    client = httpx.AsyncClient(
        base_url="http://agent-core.test", transport=httpx.MockTransport(handler)
    )
    return HttpAgentRuntime(client)


async def test_start_run_sends_the_idempotency_key_and_bearer_and_maps_the_first_turn() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            201,
            json={
                "run_id": "run-1",
                "session_id": "ses-1",
                "release": "rel-1",
                "status": "open",
                "trace_id": "trace-1",
                "first_turn": TURN,
            },
        )

    run = await runtime(handler).start_run(
        CUSTOMER, agent="recepcion@prod", idempotency_key="key-1", lang="es"
    )

    request = seen[0]
    assert request.method == "POST"
    assert request.url.path == "/v1/runs"
    assert request.headers["authorization"] == "Bearer customer.jws.sig"
    assert request.headers["idempotency-key"] == "key-1"
    assert "x-on-behalf-of" not in request.headers
    assert json.loads(request.content) == {"agent": "recepcion@prod", "lang": "es"}
    assert run.session_id == "ses-1"
    assert run.first_turn is not None
    assert run.first_turn.awaiting is AgentAwaiting.CONFIRMATION
    assert run.first_turn.confirmation is not None
    assert run.first_turn.confirmation.token == "tok-1"
    assert run.first_turn.step_up is not None
    assert run.first_turn.step_up.simulated is True
    assert run.first_turn.agent == "disputas@1.0.0"


async def test_post_turn_carries_confirmation_and_the_advisor_delegation() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=TURN | {"awaiting": "none", "confirmation": None})

    turn = await runtime(handler).post_turn(
        ADVISOR,
        session_id="ses-1",
        client_turn_id="msg-1",
        channel="app_chat",
        confirm_token="tok-1",
        confirm_answer="yes",
    )

    request = seen[0]
    assert request.url.path == "/v1/sessions/ses-1/turns"
    assert request.headers["x-on-behalf-of"] == "grant.jws.sig"
    assert json.loads(request.content) == {
        "channel": "app_chat",
        "client_turn_id": "msg-1",
        "text": "",
        "confirm": {"token": "tok-1", "answer": "yes"},
    }
    assert turn.awaiting is AgentAwaiting.NONE


async def test_an_escalated_turn_exposes_its_handoff() -> None:
    body = TURN | {"awaiting": "none", "outcome": "escalated", "handoff_ref": "hnd-9"}

    turn = await runtime(lambda _: httpx.Response(200, json=body)).post_turn(
        CUSTOMER, session_id="ses-1", client_turn_id="m", channel="web_chat", text="hola"
    )

    assert turn.outcome is AgentOutcome.ESCALATED
    assert turn.escalated
    assert turn.handoff_ref == "hnd-9"


async def test_problem_json_becomes_a_runtime_error_with_its_code() -> None:
    problem = {
        "type": "urn:agentcore:problem:run_closed",
        "title": "x",
        "status": 410,
        "code": "run_closed",
        "detail": "d",
        "trace_id": "trace-7",
    }

    with pytest.raises(AgentRuntimeError) as error:
        await runtime(lambda _: httpx.Response(410, json=problem)).post_turn(
            CUSTOMER, session_id="s", client_turn_id="m", channel="web_chat", text="hola"
        )

    assert (error.value.status, error.value.code, error.value.trace_id) == (
        410,
        "run_closed",
        "trace-7",
    )
    assert "customer.jws.sig" not in str(error.value)


async def test_a_server_failure_or_a_timeout_is_unavailable_not_a_domain_error() -> None:
    def broken(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"code": "internal_error", "trace_id": "t"})

    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    for handler in (broken, timeout):
        with pytest.raises(AgentRuntimeUnavailableError):
            await runtime(handler).get_lineage(CUSTOMER, session_id="ses-1")


async def test_lineage_and_resolution_map_their_bodies() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/lineage"):
            return httpx.Response(
                200,
                json={
                    "session_id": "ses-1",
                    "trace_id": "t",
                    "runs": [
                        {
                            "run_id": "r1",
                            "agent": "recepcion@1.0.0",
                            "release": "rel",
                            "status": "closed",
                            "outcome": "transferred",
                            "origin": None,
                        },
                        {
                            "run_id": "r2",
                            "agent": "disputas@1.0.0",
                            "release": "rel",
                            "status": "open",
                            "outcome": None,
                            "origin": {"from_agent": "recepcion@1.0.0"},
                        },
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "handoff_ref": "hnd-1",
                "resolution_code": "resolved",
                "handoff_quality": "useful",
                "trace_id": "t",
            },
        )

    api = runtime(handler)
    lineage = await api.get_lineage(CUSTOMER, session_id="ses-1")
    resolution = await api.record_resolution(
        ADVISOR, handoff_ref="hnd-1", resolution_code="resolved", handoff_quality="useful"
    )

    assert [run.agent for run in lineage.runs] == ["recepcion@1.0.0", "disputas@1.0.0"]
    assert lineage.runs[0].outcome is AgentOutcome.TRANSFERRED
    assert lineage.runs[1].from_agent == "recepcion@1.0.0"
    assert resolution.handoff_quality == "useful"


async def test_the_in_memory_fake_follows_the_same_port() -> None:
    fake = InMemoryAgentRuntime(script=[escalated_turn("hnd-1")])

    run = await fake.start_run(CUSTOMER, agent="recepcion", idempotency_key="k")
    assert run.session_id is not None
    turn = await fake.post_turn(
        CUSTOMER, session_id=run.session_id, client_turn_id="m1", channel="web_chat", text="hola"
    )
    await fake.record_resolution(
        ADVISOR, handoff_ref="hnd-1", resolution_code="resolved", handoff_quality="useful"
    )
    with pytest.raises(AgentRuntimeError, match="handoff_already_resolved"):
        await fake.record_resolution(
            ADVISOR, handoff_ref="hnd-1", resolution_code="resolved", handoff_quality="useful"
        )

    assert turn.escalated
    assert [call.operation for call in fake.calls[:2]] == ["start_run", "post_turn"]
