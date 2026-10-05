"""The Core's resilience layer over HTTP (deploy brief P4), with agent-core's HTTP client talking
to a mocked transport: the W3C trace reaches the Core, the readiness check, and the builder's
"agents service unavailable" state."""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.http_registry import HttpAgentRegistry
from cc_platform.infrastructure.ai.http_runtime import HttpAgentRuntime
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.core.http import CoreHealth, core_http_client
from cc_platform.infrastructure.core.resilience import (
    BreakerState,
    CircuitBreaker,
    CoreGuard,
    CoreTimeouts,
    RetryPolicy,
)
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from tests.support import SUPERVISOR, bearer, make_settings

NATALIA = 2001
TRACE = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT = "00f067aa0ba902b7"


class FakeCore:
    """agent-core's runtime API, as a mocked transport: records each request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.down = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("connection refused", request=request)
        path = request.url.path
        if path == "/healthz":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/v1/runs":
            return httpx.Response(
                201,
                json={
                    "run_id": "run-1",
                    "release": "rel-1",
                    "status": "open",
                    "trace_id": TRACE,
                    "session_id": "ses-1",
                },
            )
        if path.endswith("/turns"):
            return httpx.Response(
                200,
                json={
                    "run_id": "run-1",
                    "turn_id": "t-1",
                    "messages": [{"kind": "generated", "text": "Hola Natalia.", "locale": "es"}],
                    "locale": "es",
                    "awaiting": "input",
                    "status": "open",
                    "trace_id": TRACE,
                },
            )
        return httpx.Response(404, json={"code": "not_found"})

    def to(self, path: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path == path or r.url.path.endswith(path)]


@pytest.fixture
def core() -> FakeCore:
    return FakeCore()


@pytest.fixture
def guard() -> CoreGuard:
    return CoreGuard(
        timeouts=CoreTimeouts(),
        retry=RetryPolicy(attempts=0),
        breaker=CircuitBreaker(failure_threshold=2, reset_seconds=30),
    )


@pytest.fixture
def container(
    clock: FixedClock, tmp_path: Path, core: FakeCore, guard: CoreGuard
) -> Iterator[Container]:
    links = tmp_path / "links.json"
    links.write_text(json.dumps({seed_customer_id(NATALIA): "bank-0001"}), encoding="utf-8")
    client = core_http_client(
        "http://agent-core.test",
        timeouts=guard.timeouts,
        connect_timeout=1.0,
        transport=httpx.MockTransport(core),
    )
    keys = AgentSigningKeys.generate(suffix="t")
    return build_container(
        make_settings(
            database_url=f"sqlite+aiosqlite:///{tmp_path / 'core-api.db'}",
            bank_customer_links_file=links,
        ),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(keys, clock),
            runtime=HttpAgentRuntime(client),
            http_client=client,
            registry=HttpAgentRegistry(client),
            guard=guard,
            core_status=CoreHealth(client, guard),
        ),
    )


def write(client: TestClient, token: str, headers: dict[str, str] | None = None) -> Any:
    key = str(uuid.uuid4())
    response = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": key, **(headers or {})},
        json={"text": "No reconozco un cargo", "clientMessageId": key},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ----------------------------------------------------------------------------- traceparent
def test_an_incoming_trace_reaches_the_core_on_the_assistant_s_calls(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    core: FakeCore,
) -> None:
    write(
        client,
        customer_session(NATALIA),
        {"traceparent": f"00-{TRACE}-{PARENT}-01", "tracestate": "vendor=abc"},
    )
    drain()

    calls = core.to("/v1/runs") + core.to("/turns")
    assert len(calls) == 2
    for request in calls:
        version, trace_id, parent_id, flags = request.headers["traceparent"].split("-")
        assert (version, trace_id, flags) == ("00", TRACE, "01")
        assert parent_id != PARENT  # each call is a new span of the caller's trace
        assert request.headers["tracestate"] == "vendor=abc"
    assert calls[0].headers["traceparent"] != calls[1].headers["traceparent"]


def test_without_an_incoming_trace_the_request_starts_one(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    core: FakeCore,
) -> None:
    write(client, customer_session(NATALIA), {"traceparent": "not-a-trace"})
    drain()

    calls = core.to("/v1/runs") + core.to("/turns")
    trace_ids = {r.headers["traceparent"].split("-")[1] for r in calls}
    assert len(calls) == 2
    assert len(trace_ids) == 1
    assert trace_ids != {TRACE}
    assert all("tracestate" not in r.headers for r in calls)


# ----------------------------------------------------------------------------- readiness
async def test_the_readiness_check_probes_the_core_and_feeds_the_breaker(
    container: Container, core: FakeCore, guard: CoreGuard
) -> None:
    status = container.api_context().core_status

    assert await status() == "ok"
    assert core.to("/healthz")

    core.down = True
    assert await status() == "degraded"
    assert await status() == "degraded"
    assert guard.breaker.state is BreakerState.OPEN  # readiness polls noticed it first

    probes = len(core.to("/healthz"))
    assert await status() == "degraded"
    assert len(core.to("/healthz")) == probes  # open: no call at all
    await container.shutdown()


async def test_a_core_answering_4xx_on_its_health_route_is_up(
    container: Container, core: FakeCore
) -> None:
    def no_health(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "not_found"})

    client = httpx.AsyncClient(base_url="http://x", transport=httpx.MockTransport(no_health))
    check = CoreHealth(client, CoreGuard())

    assert await check() == "ok"
    await client.aclose()
    await container.shutdown()


# ----------------------------------------------------------------------------- the builder
@pytest.fixture
def supervisor(client: TestClient, sign_in: Callable[[str], str]) -> dict[str, str]:
    return bearer(sign_in(SUPERVISOR.email))


def test_the_builder_says_when_the_agents_service_is_down(
    client: TestClient, supervisor: dict[str, str], core: FakeCore
) -> None:
    up = client.get("/api/v1/builder/status", headers=supervisor)
    assert up.json()["available"] is True
    assert up.json()["reachable"] is True

    core.down = True
    down = client.get("/api/v1/builder/status", headers=supervisor)

    assert down.status_code == 200
    assert (down.json()["available"], down.json()["reachable"]) == (True, False)
    created = client.post(
        "/api/v1/builder/proposals",
        headers=supervisor,
        json={"agentId": "disputas", "title": "x"},
    )
    assert (created.status_code, created.json()["code"]) == (503, "agent_core_unavailable")
    # the rest of the platform keeps working
    assert client.get("/api/v1/supervision/queues", headers=supervisor).status_code == 200


@pytest.fixture
def restore_logging() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers, root.level = handlers, level


@pytest.mark.usefixtures("restore_logging")
def test_the_request_s_log_lines_carry_its_trace_id(
    container: Container, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = container.settings.model_copy(update={"log_level": "INFO"})
    with TestClient(create_app(settings, container=container)) as client:
        capsys.readouterr()  # drop the startup lines
        client.get("/api/v1/meta", headers={"traceparent": f"00-{TRACE}-{PARENT}-01"})
    output = capsys.readouterr().err

    access = [line for line in output.splitlines() if "http_request" in line]
    assert access
    assert all(json.loads(line)["trace_id"] == TRACE for line in access)
