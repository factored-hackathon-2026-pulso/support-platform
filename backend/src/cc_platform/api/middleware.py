"""ASGI middleware (pure ASGI, so it also covers WebSockets).

``RequestContextMiddleware`` (outermost):

- Reads ``X-Request-ID`` / ``X-Correlation-ID`` from the client (if well formed) or creates
  them, stores them in ``request.state`` and binds them to structlog contextvars so every
  log line of the request carries them.
- Echoes both headers on the response.
- Carries the W3C trace (deploy brief P4): a valid incoming ``traceparent`` (and its
  ``tracestate``) is kept, otherwise a new trace starts; its id is bound as ``trace_id`` on every
  log line of the request, and the calls to the Core send it on (``application/tracing.py``).
- Writes one structured access-log line per HTTP request.

``UnhandledErrorMiddleware`` (innermost, *inside* CORS): turns an unexpected exception into
a 500 problem+json. Starlette's own catch-all runs outside every user middleware, so its
500 would lack CORS headers and the browser would report a network error instead of the
problem (and its ``requestId``).
"""

from __future__ import annotations

import re
import time
import uuid

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from cc_platform.api.errors import internal_error_response
from cc_platform.application.tracing import (
    TRACEPARENT,
    TRACESTATE,
    new_trace,
    parse_trace,
    use_trace,
)

REQUEST_ID_HEADER = "X-Request-ID"
CORRELATION_ID_HEADER = "X-Correlation-ID"
_VALID_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

_log = structlog.get_logger("cc_platform.access")
_error_log = structlog.get_logger("cc_platform.api.errors")


def _accept(value: str | None) -> str | None:
    return value if value is not None and _VALID_ID.match(value) else None


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = _accept(headers.get(REQUEST_ID_HEADER)) or uuid.uuid4().hex
        correlation_id = _accept(headers.get(CORRELATION_ID_HEADER)) or request_id
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        state["correlation_id"] = correlation_id
        trace = parse_trace(headers.get(TRACEPARENT), headers.get(TRACESTATE)) or new_trace()

        status_code = 500
        started = time.perf_counter()

        async def send_with_ids(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_headers = MutableHeaders(scope=message)
                response_headers[REQUEST_ID_HEADER] = request_id
                response_headers[CORRELATION_ID_HEADER] = correlation_id
            await send(message)

        with (
            use_trace(trace),
            structlog.contextvars.bound_contextvars(
                request_id=request_id, correlation_id=correlation_id, trace_id=trace.trace_id
            ),
        ):
            try:
                await self.app(scope, receive, send_with_ids)
            finally:
                if scope["type"] == "http":
                    _log.info(
                        "http_request",
                        method=scope.get("method"),
                        path=scope.get("path"),
                        status=status_code,
                        duration_ms=round((time.perf_counter() - started) * 1000, 2),
                    )


class UnhandledErrorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as exc:
            if response_started:  # too late for a problem body; let the server log it
                raise
            request = Request(scope)
            _error_log.exception(
                "unhandled_error",
                request_id=getattr(request.state, "request_id", None),
                path=scope.get("path"),
                error_type=type(exc).__name__,
            )
            await internal_error_response(request)(scope, receive, send)
