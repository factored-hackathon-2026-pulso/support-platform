"""Forwarded headers from trusted proxies (pure ASGI, HTTP and WebSocket).

Behind CloudFront and the host reverse proxy the API sees the proxy as its peer. When (and
only when) the direct peer is in ``CC_TRUSTED_PROXIES``:

- ``X-Forwarded-Proto`` sets the scheme (``https`` → ``https``/``wss``), so absolute URLs the
  framework builds (e.g. a trailing-slash redirect) keep the public scheme;
- ``X-Forwarded-Host`` replaces the ``Host`` header, for the same reason;
- ``X-Forwarded-For`` sets the client address: the right-most address that is not itself a
  trusted proxy (the left-most one when every hop is trusted). The rate limits of the public
  onboarding links key on it.

An untrusted peer's forwarded headers are ignored: anyone can send them.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Iterable

from starlette.types import ASGIApp, Receive, Scope, Send

type _Network = ipaddress.IPv4Network | ipaddress.IPv6Network

_SECURE = {"http": "https", "websocket": "wss"}
_PLAIN = {"http": "http", "websocket": "ws"}


class TrustedProxies:
    """``*`` (anyone), IP addresses and CIDR blocks."""

    def __init__(self, entries: Iterable[str]) -> None:
        values = [entry.strip() for entry in entries if entry.strip()]
        self.any = "*" in values
        self._networks: list[_Network] = [
            ipaddress.ip_network(value, strict=False) for value in values if value != "*"
        ]

    def __contains__(self, host: object) -> bool:
        if self.any:
            return True
        if not isinstance(host, str):
            return False
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return False
        return any(address in network for network in self._networks)


class TrustedProxyMiddleware:
    def __init__(self, app: ASGIApp, *, trusted: Iterable[str]) -> None:
        self.app = app
        self.trusted = TrustedProxies(trusted)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            client = scope.get("client")
            peer = client[0] if client else None
            if peer is not None and peer in self.trusted:
                self._apply(scope)
        await self.app(scope, receive, send)

    def _apply(self, scope: Scope) -> None:
        headers: list[tuple[bytes, bytes]] = list(scope["headers"])
        values = {name.lower(): value.decode("latin-1") for name, value in headers}

        proto = _first(values.get(b"x-forwarded-proto"))
        if proto is not None:
            kind = scope["type"]
            if proto.lower() in ("https", "wss"):
                scope["scheme"] = _SECURE[kind]
            elif proto.lower() in ("http", "ws"):
                scope["scheme"] = _PLAIN[kind]

        host = _first(values.get(b"x-forwarded-host"))
        if host:
            scope["headers"] = [(n, v) for n, v in headers if n.lower() != b"host"] + [
                (b"host", host.encode("latin-1"))
            ]

        forwarded_for = values.get(b"x-forwarded-for")
        if forwarded_for:
            client = self._client_address(forwarded_for)
            if client is not None:
                port = scope["client"][1] if scope.get("client") else 0
                scope["client"] = (client, port)

    def _client_address(self, header: str) -> str | None:
        hops = [hop.strip() for hop in header.split(",") if hop.strip()]
        for hop in reversed(hops):
            if hop not in self.trusted:
                return hop
        return hops[0] if hops else None


def _first(value: str | None) -> str | None:
    """The first item of a comma-separated header (a proxy chain appends its own)."""
    if value is None:
        return None
    first = value.split(",")[0].strip()
    return first or None
