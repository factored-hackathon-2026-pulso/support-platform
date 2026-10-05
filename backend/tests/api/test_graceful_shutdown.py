"""Graceful shutdown and socket keepalive: sockets close with 1012, background jobs get a
bounded grace period, idle sockets get heartbeats, and a real ``cc-api`` process stops cleanly
on SIGTERM."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from cc_platform.api.routers.realtime import CLOSE_SERVICE_RESTART
from cc_platform.application.ports.realtime import SERVER_SHUTDOWN
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.background import AsyncioBackgroundTasks
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.support import make_settings


async def test_drain_or_cancel_waits_for_quick_jobs() -> None:
    tasks = AsyncioBackgroundTasks()
    done: list[str] = []

    async def quick() -> None:
        await asyncio.sleep(0.01)
        done.append("quick")

    tasks.spawn("quick", quick)
    assert await tasks.drain_or_cancel(5) == 0
    assert done == ["quick"]
    assert tasks.pending == 0


async def test_drain_or_cancel_cancels_what_outlives_the_grace_period() -> None:
    tasks = AsyncioBackgroundTasks()
    finished: list[str] = []

    async def stuck() -> None:
        await asyncio.sleep(60)
        finished.append("stuck")

    tasks.spawn("stuck", stuck)
    started = time.monotonic()
    assert await tasks.drain_or_cancel(0.05) == 1
    assert time.monotonic() - started < 5
    assert finished == []
    assert tasks.pending == 0


async def test_container_shutdown_closes_every_socket_for_a_restart() -> None:
    container = build_container(
        make_settings(persistence="memory", seed_demo_data=False), ids=SequentialIdGenerator()
    )
    connection = container.realtime_hub.connect(
        connection_id="CON-1", principal_id="STF-1", session_id="SES-1"
    )

    await container.shutdown()

    assert await connection.next_envelope() is None
    assert connection.close_reason == SERVER_SHUTDOWN


def test_a_server_shutdown_closes_the_socket_with_1012(
    client: TestClient, container: Container, sign_in: Callable[[str], str]
) -> None:
    token = sign_in("daniela.rios@latambank.example")
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        assert ws.receive_json()["type"] == "welcome"

        client.portal.call(container.realtime_hub.close_all, SERVER_SHUTDOWN)  # type: ignore[union-attr]

        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == CLOSE_SERVICE_RESTART == 1012
    assert closed.value.reason == SERVER_SHUTDOWN


@pytest.fixture
def heartbeat_client(tmp_path: Path) -> Iterator[TestClient]:
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'hb.db'}", realtime_heartbeat_seconds=0.05
    )
    container = build_container(settings, ids=SequentialIdGenerator())
    with TestClient(create_app(container=container)) as client:
        yield client


def test_an_idle_socket_gets_heartbeats(heartbeat_client: TestClient) -> None:
    login = heartbeat_client.post(
        "/api/v1/customer/sessions", json={"customerId": _first_seed_customer()}
    )
    token = login.json()["token"]
    with heartbeat_client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        assert ws.receive_json()["type"] == "welcome"
        first, second = ws.receive_json(), ws.receive_json()

    for beat in (first, second):
        assert beat["type"] == "heartbeat"
        assert beat["data"] == {"intervalSeconds": 0.05}
        assert set(beat) == {"type", "id", "occurredAt", "data"}


def _first_seed_customer() -> str:
    from cc_platform.infrastructure.seed.customers import seed_customer_id

    return seed_customer_id(1001)


# ── a real process ──────────────────────────────────────────────────────────


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


def _wait_ready(base: str, process: subprocess.Popen[bytes], deadline: float) -> None:
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError("cc-api exited during startup")
        try:
            with urllib.request.urlopen(f"{base}/readyz", timeout=1) as response:  # noqa: S310
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.2)
    raise AssertionError("cc-api did not become ready")


def test_cc_api_stops_on_sigterm_and_closes_sockets_with_1012(tmp_path: Path) -> None:
    """``cc-api`` under uvicorn: SIGTERM → sockets closed with 1012 → a clean exit."""
    import websockets.sync.client as ws_client

    port = _free_port()
    env = {
        **{key: value for key, value in os.environ.items() if not key.startswith("CC_")},
        "CC_ENV": "test",
        "CC_PORT": str(port),
        "CC_DATABASE_URL": f"sqlite+aiosqlite:///{tmp_path / 'proc.db'}",
        "CC_ARGON2_TIME_COST": "1",
        "CC_ARGON2_MEMORY_COST": "1024",
        "CC_ARGON2_PARALLELISM": "1",
        "CC_NOTIFICATION_SWEEP_SECONDS": "0",
        "CC_ASSISTANT_SWEEP_SECONDS": "0",
        "CC_SHUTDOWN_TIMEOUT_SECONDS": "3",
        "CC_LOG_LEVEL": "INFO",
    }
    process = subprocess.Popen(
        [sys.executable, "-c", "from cc_platform.bootstrap.server import main; main()"],
        cwd=tmp_path,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_ready(base, process, time.monotonic() + 60)
        request = urllib.request.Request(  # noqa: S310
            f"{base}/api/v1/customer/sessions",
            data=json.dumps({"customerId": _first_seed_customer()}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310
            token = json.loads(response.read())["token"]

        with ws_client.connect(f"ws://127.0.0.1:{port}/api/v1/ws?token={token}") as ws:
            assert json.loads(ws.recv(timeout=5))["type"] == "welcome"
            process.send_signal(signal.SIGTERM)
            with pytest.raises(websockets_closed()) as closed:
                ws.recv(timeout=10)
        assert closed.value.rcvd is not None
        assert closed.value.rcvd.code == 1012

        # uvicorn re-raises the signal once it has shut down cleanly (so supervisors see it).
        assert process.wait(timeout=20) in (0, -signal.SIGTERM)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        assert process.stderr is not None
        stderr = process.stderr.read().decode()
    assert "Traceback" not in stderr, stderr
    assert "Application shutdown complete" in stderr
    assert '"event": "shutdown"' in stderr
    assert token not in stderr  # the socket URL carries it; the log redacts it


def websockets_closed() -> type[Exception]:
    from websockets.exceptions import ConnectionClosed

    return ConnectionClosed
