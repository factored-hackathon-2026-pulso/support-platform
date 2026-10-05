"""``GET /healthz`` (liveness) and ``GET /readyz`` (readiness): every state, no secrets."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from cc_platform.api.context import ReadinessOptions
from cc_platform.api.dependencies import API_CONTEXT_STATE
from cc_platform.application.ports.health import ReadinessProbe
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.ai.core_readiness import CoreReadinessProbe
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.readiness import (
    DatabaseReadinessProbe,
    schema_is_current,
)
from tests.support import make_settings


def test_healthz_is_ok_without_credentials(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"


def test_readyz_is_ready_with_the_database_migrated_and_no_core(client: TestClient) -> None:
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"database": "ok", "core": "disabled"},
    }
    assert response.headers["cache-control"] == "no-store"


def test_probes_stay_out_of_the_openapi_contract(client: TestClient) -> None:
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert "/healthz" not in paths
    assert "/readyz" not in paths


def test_readyz_is_503_when_the_schema_is_not_migrated(
    client: TestClient, container: Container
) -> None:
    assert container.database is not None
    engine = container.database.engine

    async def drop_a_table() -> None:
        async with engine.begin() as connection:
            await connection.execute(text("PRAGMA foreign_keys=OFF"))
            await connection.execute(text("DROP TABLE copilot_suggestions"))

    client.portal.call(drop_a_table)  # type: ignore[union-attr]

    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["checks"]["database"] == "not_migrated"
    assert client.get("/healthz").status_code == 200  # liveness never depends on the DB


def test_readyz_is_503_and_healthz_200_when_the_database_is_down(
    client: TestClient, container: Container, tmp_path: Path
) -> None:
    down = DatabaseReadinessProbe(_unreachable_database(tmp_path))
    _use_probes(client, (down, *container.readiness_probes[1:]))

    ready = client.get("/readyz")
    assert ready.status_code == 503
    assert ready.json() == {
        "status": "not_ready",
        "checks": {"database": "unreachable", "core": "disabled"},
    }
    assert str(tmp_path) not in ready.text  # never the error text
    assert client.get("/healthz").status_code == 200


def test_a_slow_probe_counts_as_down_after_the_timeout(client: TestClient) -> None:
    class Hanging:
        name = "database"
        critical = True

        async def state(self) -> str:
            await asyncio.sleep(30)
            return "ok"

    _use_probes(client, (Hanging(),), timeout_seconds=0.05)
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": "unreachable"}


def test_a_failing_probe_never_leaks_its_error(client: TestClient) -> None:
    class Broken:
        name = "database"
        critical = True

        async def state(self) -> str:
            raise RuntimeError("postgresql://app:hunter2@db/cc refused")

    _use_probes(client, (Broken(),))
    response = client.get("/readyz")
    assert response.status_code == 503
    assert "hunter2" not in response.text


@pytest.fixture
def core_app() -> list[httpx.Response | Exception]:
    """Answers of a fake Core ``/readyz``, consumed in order."""
    return []


def _core_probe(answers: list[httpx.Response | Exception]) -> CoreReadinessProbe:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/readyz"
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    client = httpx.AsyncClient(base_url="http://core.test", transport=httpx.MockTransport(handler))
    return CoreReadinessProbe(client, timeout_seconds=1)


def test_readyz_reports_the_core_degraded_but_stays_ready(
    client: TestClient, container: Container, core_app: list[httpx.Response | Exception]
) -> None:
    database = container.readiness_probes[0]
    _use_probes(client, (database, _core_probe(core_app)))

    core_app.append(httpx.Response(200, json={"status": "ready"}))
    assert client.get("/readyz").json() == {
        "status": "ready",
        "checks": {"database": "ok", "core": "ok"},
    }

    core_app.append(httpx.ConnectError("connection refused"))
    unreachable = client.get("/readyz")
    assert unreachable.status_code == 200
    assert unreachable.json()["checks"]["core"] == "degraded"

    core_app.append(httpx.Response(503, json={"status": "unavailable", "failed": ["postgres"]}))
    not_ready = client.get("/readyz")
    assert not_ready.status_code == 200
    assert not_ready.json() == {
        "status": "ready",
        "checks": {"database": "ok", "core": "degraded"},
    }


def test_the_container_wires_the_core_probe_when_the_core_is_configured(
    tmp_path: Path,
) -> None:
    keys = tmp_path / "keys.json"
    keys.write_text(json.dumps(AgentSigningKeys.generate(suffix="t").private_document()))
    container = build_container(
        make_settings(agent_core_url="http://core.test", agent_keys_file=keys),
        ids=SequentialIdGenerator(),
    )
    names = [(probe.name, probe.critical) for probe in container.readiness_probes]
    assert names == [("database", True), ("core", False)]
    assert isinstance(container.readiness_probes[1], CoreReadinessProbe)


async def test_schema_is_current_is_false_for_an_empty_database(tmp_path: Path) -> None:
    container = build_container(
        make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'empty.db'}"),
        ids=SequentialIdGenerator(),
    )
    assert container.database is not None
    async with container.database.engine.connect() as connection:
        assert not await connection.run_sync(schema_is_current)
    assert await DatabaseReadinessProbe(container.database).state() == "not_migrated"
    await container.database.create_schema()
    assert await DatabaseReadinessProbe(container.database).state() == "ok"
    await container.shutdown()


def _unreachable_database(tmp_path: Path) -> Database:
    """A SQLite "file" that is a directory: every connection attempt fails."""
    return Database(f"sqlite+aiosqlite:///{tmp_path}")


def _use_probes(
    client: TestClient, probes: Sequence[ReadinessProbe], timeout_seconds: float = 2
) -> None:
    state = client.app.state  # type: ignore[attr-defined]
    context = getattr(state, API_CONTEXT_STATE)
    readiness = ReadinessOptions(probes=probes, timeout_seconds=timeout_seconds)
    setattr(state, API_CONTEXT_STATE, replace(context, readiness=readiness))
