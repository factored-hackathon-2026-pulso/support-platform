"""Forwarded headers are believed only from trusted proxies (HTTP and WebSocket)."""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket

from cc_platform.api.proxy_headers import TrustedProxies, TrustedProxyMiddleware

FORWARDED = {
    "X-Forwarded-For": "203.0.113.7, 10.0.3.4",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Host": "support.example.org",
}


async def whoami(request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "client": request.client.host if request.client else None,
            "scheme": request.url.scheme,
            "host": request.headers["host"],
            "url": str(request.url),
        }
    )


async def moved(request: Request) -> RedirectResponse:
    return RedirectResponse(request.url_for("whoami"))


async def socket(websocket: WebSocket) -> None:
    await websocket.accept()
    client = websocket.client.host if websocket.client else None
    await websocket.send_json({"client": client, "scheme": websocket.url.scheme})
    await websocket.close()


def client_for(trusted: list[str]) -> TestClient:
    app = Starlette(
        routes=[
            Route("/whoami", whoami, name="whoami"),
            Route("/moved", moved),
            WebSocketRoute("/ws", socket),
        ]
    )
    # TestClient's peer is "testclient"; give it a real address for the trust check.
    return TestClient(
        TrustedProxyMiddleware(app, trusted=trusted),  # type: ignore[arg-type]
        client=("10.0.9.9", 50000),
    )


def test_a_trusted_proxy_sets_client_scheme_and_host() -> None:
    client = client_for(["10.0.0.0/16"])

    seen = client.get("/whoami", headers=FORWARDED).json()

    # 10.0.3.4 is a trusted hop (CloudFront's VPC origin): the viewer is the next one left.
    assert seen["client"] == "203.0.113.7"
    assert seen["scheme"] == "https"
    assert seen["host"] == "support.example.org"
    assert seen["url"] == "https://support.example.org/whoami"


def test_redirects_keep_the_public_scheme_and_host() -> None:
    client = client_for(["10.0.0.0/16"])
    response = client.get("/moved", headers=FORWARDED, follow_redirects=False)
    assert response.headers["location"] == "https://support.example.org/whoami"


def test_an_untrusted_peer_cannot_spoof_its_address() -> None:
    client = client_for(["192.168.0.1"])

    seen = client.get("/whoami", headers=FORWARDED).json()

    assert seen["client"] == "10.0.9.9"
    assert seen["scheme"] == "http"
    assert seen["host"] == "testserver"


def test_when_every_hop_is_trusted_the_left_most_is_the_client() -> None:
    client = client_for(["10.0.0.0/8", "203.0.113.0/24"])
    seen = client.get("/whoami", headers=FORWARDED).json()
    assert seen["client"] == "203.0.113.7"


def test_websockets_get_wss_behind_an_https_edge() -> None:
    client = client_for(["10.0.0.0/16"])
    with client.websocket_connect("/ws", headers=FORWARDED) as ws:
        assert ws.receive_json() == {"client": "203.0.113.7", "scheme": "wss"}


@pytest.mark.parametrize(
    ("entries", "host", "trusted"),
    [
        (["127.0.0.1"], "127.0.0.1", True),
        (["127.0.0.1"], "127.0.0.2", False),
        (["172.16.0.0/12"], "172.18.0.5", True),
        (["::1"], "::1", True),
        (["*"], "anything", True),
        (["10.0.0.0/8"], "testclient", False),
        ([], "127.0.0.1", False),
    ],
)
def test_trusted_proxies_match_ips_and_cidrs(entries: list[str], host: str, trusted: bool) -> None:
    assert (host in TrustedProxies(entries)) is trusted
