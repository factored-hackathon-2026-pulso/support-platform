"""WebSocket /api/v1/ws: auth, subscribe/unsubscribe/ping and event fan-out."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect, WebSocketState

from cc_platform.api.dependencies import API_CONTEXT_STATE
from cc_platform.api.routers.realtime import RealtimeSocketSession
from cc_platform.application.security import Actor
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.support import (
    ANALYST,
    DEV_MFA_CODE,
    PASSWORD,
    SUPERVISOR,
    bearer,
    emit,
    make_settings,
)

# Seeded cases: 101 is assigned to Daniela (ANALYST); supervisors may follow any case.
CASE_A = seed_case_id(101)
CASE_B = seed_case_id(102)
FOREIGN_TURN = "TRN-" + "9" * 26  # an event of a test-only class, never suppressed


@dataclass(frozen=True, kw_only=True, slots=True)
class TurnCreated(DomainEvent):
    event_type = "turn.created"
    entity = "turn"
    text: str


def publish_turn(client: TestClient, container: Container, case_id: str, text: str) -> None:
    event = TurnCreated(
        occurred_at=container.clock.now(),
        actor=ActorRef(ActorRole.CUSTOMER, "CUS-" + "0" * 25 + "1"),
        entity_id=FOREIGN_TURN,
        case_id=case_id,
        text=text,
    )
    client.portal.call(emit, container.uow, event)  # type: ignore[union-attr]


def subscribe(ws: Any, topic: str) -> dict[str, Any]:
    ws.send_json({"action": "subscribe", "topic": topic})
    reply: dict[str, Any] = ws.receive_json()
    return reply


def test_rejects_missing_or_invalid_token(client: TestClient) -> None:
    for url in ("/api/v1/ws", "/api/v1/ws?token=forged"):
        with client.websocket_connect(url) as ws:
            error = ws.receive_json()
            assert error["type"] == "error"
            assert error["data"]["code"] == "unauthenticated"
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 4401


def test_welcome_ping_and_envelope_shape(client: TestClient, sign_in: Callable[[str], str]) -> None:
    token = sign_in(ANALYST.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        welcome = ws.receive_json()
        assert welcome["type"] == "welcome"
        assert set(welcome) == {"type", "id", "occurredAt", "data"}
        assert welcome["data"]["staffId"] == "STF-00000000000000000000000001"
        assert welcome["data"]["connectionId"].startswith("CON-")
        ws.send_json({"action": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_fans_out_committed_events_to_case_subscribers_only(
    client: TestClient, container: Container, sign_in: Callable[[str], str]
) -> None:
    analyst = sign_in(ANALYST.email)
    supervisor = sign_in(SUPERVISOR.email)
    with (
        client.websocket_connect(f"/api/v1/ws?token={analyst}") as watcher,
        client.websocket_connect(f"/api/v1/ws?token={supervisor}") as other,
    ):
        watcher.receive_json()
        other.receive_json()
        assert subscribe(watcher, f"case:{CASE_A}")["data"] == {"topic": f"case:{CASE_A}"}
        assert subscribe(other, f"case:{CASE_B}")["type"] == "subscribed"

        publish_turn(client, container, CASE_A, "Hola, no reconozco un cargo")

        envelope = watcher.receive_json()
        assert envelope["type"] == "turn.created"
        assert envelope["id"].startswith("EVT-")
        assert envelope["occurredAt"].endswith("Z")
        assert envelope["data"]["caseId"] == CASE_A
        assert envelope["data"]["actor"] == {"role": "customer", "id": "CUS-" + "0" * 25 + "1"}
        assert envelope["data"]["payload"] == {"text": "Hola, no reconozco un cargo"}

        # The other socket got nothing: its next message is the reply to its own ping.
        other.send_json({"action": "ping"})
        assert other.receive_json()["type"] == "pong"

    # The event is also durable in the log (realtime only signals; the log is the record).
    async def read_log() -> list[str]:
        async with container.uow() as uow:
            page = await uow.event_log.page(case_id=CASE_A, entity_id=FOREIGN_TURN)
            return [e.event_type for e in page.items]

    assert client.portal.call(read_log) == ["turn.created"]  # type: ignore[union-attr]


def test_unsubscribe_stops_delivery(
    client: TestClient, container: Container, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(ANALYST.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()
        subscribe(ws, f"case:{CASE_A}")
        ws.send_json({"action": "unsubscribe", "topic": f"case:{CASE_A}"})
        reply = ws.receive_json()
        assert reply["type"] == "unsubscribed"
        assert reply["data"] == {"topic": f"case:{CASE_A}"}
        publish_turn(client, container, CASE_A, "¿Siguen ahí?")
        ws.send_json({"action": "ping"})
        assert ws.receive_json()["type"] == "pong"


@pytest.mark.parametrize(
    ("topic", "code"),
    [("approvals", "forbidden"), ("case:CASE-1", "invalid_topic"), ("chat:x", "invalid_topic")],
)
def test_rejects_forbidden_or_invalid_topics(
    client: TestClient, sign_in: Callable[[str], str], topic: str, code: str
) -> None:
    token = sign_in(ANALYST.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()
        reply = subscribe(ws, topic)
        assert reply["type"] == "error"
        assert reply["data"] == {"code": code, "detail": reply["data"]["detail"], "topic": topic}


def test_supervisor_can_follow_approvals_and_any_inbox(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(SUPERVISOR.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()
        assert subscribe(ws, "approvals")["data"] == {"topic": "approvals"}
        assert subscribe(ws, "inbox:STF-00000000000000000000000001")["type"] == "subscribed"


def test_invalid_messages_get_an_error_and_keep_the_socket(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(ANALYST.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()
        for raw in ("not json", '{"action":"dance"}', '{"action":"subscribe"}'):
            ws.send_text(raw)
            assert ws.receive_json()["data"]["code"] == "invalid_message"
        ws.send_json({"action": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_logout_closes_the_sessions_sockets(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(ANALYST.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()
        assert client.post("/api/v1/auth/logout", headers=bearer(token)).status_code == 204
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
        assert closed.value.reason == "session_ended"


def test_expired_session_is_closed_on_next_message(
    client: TestClient, clock: FixedClock, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(ANALYST.email)
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        ws.receive_json()
        clock.advance(timedelta(hours=9))
        ws.send_json({"action": "ping"})
        assert ws.receive_json()["data"]["code"] == "session_expired"
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401


def test_idle_socket_is_closed_when_the_session_expires(clock: FixedClock) -> None:
    """A subscribed client that never sends a frame must not outlive its session."""
    container = build_container(
        make_settings(realtime_expiry_check_seconds=0.01), clock=clock, ids=SequentialIdGenerator()
    )
    with TestClient(create_app(container=container)) as client:
        login = client.post(
            "/api/v1/auth/login", json={"email": ANALYST.email, "password": PASSWORD}
        )
        token = client.post(
            "/api/v1/auth/mfa",
            json={"challengeId": login.json()["challengeId"], "code": DEV_MFA_CODE},
        ).json()["token"]
        with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
            ws.receive_json()
            subscribe(ws, f"case:{CASE_A}")
            clock.advance(timedelta(hours=8))
            error = ws.receive_json()  # no client frame needed
            assert error["type"] == "error"
            assert error["data"]["code"] == "session_expired"
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 4401
            assert closed.value.reason == "session_expired"


def test_socket_is_closed_when_logout_lands_before_it_registers(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    """Logout between the token check and ``hub.connect`` finds no socket to close; the
    server re-checks the session after registering and closes it itself."""
    token = sign_in(ANALYST.email)
    api = getattr(client.app.state, API_CONTEXT_STATE)  # type: ignore[union-attr]
    people = api.use_cases.people
    checks = 0

    class LogoutBetweenChecks:
        async def execute(self, raw_token: str | None) -> Actor:
            nonlocal checks
            checks += 1
            actor = await people.authenticate.execute(raw_token)
            if checks == 1:
                await people.logout.execute(actor)
            return actor

    racing = replace(people, authenticate=LogoutBetweenChecks())
    setattr(
        client.app.state,  # type: ignore[union-attr]
        API_CONTEXT_STATE,
        replace(api, use_cases=replace(api.use_cases, people=racing)),
    )
    with client.websocket_connect(f"/api/v1/ws?token={token}") as ws:
        error = ws.receive_json()
        assert error["data"]["code"] == "unauthenticated"
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401
    assert checks == 2


def test_client_that_leaves_before_the_welcome_is_released(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    """A browser that closes right after the handshake (e.g. a React StrictMode remount in
    dev) makes the ``welcome`` send fail: the session ends quietly (no ASGI error) and the
    hub forgets the connection instead of leaking it."""
    token = sign_in(ANALYST.email)
    api = getattr(client.app.state, API_CONTEXT_STATE)  # type: ignore[union-attr]
    before = api.realtime_hub.connection_count

    class GoneSocket:
        client_state = WebSocketState.DISCONNECTED

        async def send_json(self, data: Any) -> None:
            raise WebSocketDisconnect(code=1006)

    session = RealtimeSocketSession(GoneSocket(), api, token)  # type: ignore[arg-type]
    client.portal.call(session.run)  # type: ignore[union-attr]
    assert api.realtime_hub.connection_count == before
