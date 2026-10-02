"""WebSocket ``/api/v1/ws``: authenticated topic subscriptions with typed envelopes.

Protocol (JSON text frames):

- client → server: ``{"action": "subscribe", "topic": "case:CASE-…"}``,
  ``{"action": "unsubscribe", "topic": …}``, ``{"action": "ping"}``.
- server → client: envelopes ``{"type", "id", "occurredAt", "data"}``. Domain envelopes use
  the event type (``turn.created``…); control envelopes are ``welcome``, ``subscribed``,
  ``unsubscribed``, ``pong`` and ``error`` (``data.code`` is a ``ProblemCode``).

Authentication: ``?token=<session token>`` (log output redacts it, see
``infrastructure.logging``). On failure the server sends an ``error`` envelope and closes
with code 4401. The socket is also closed with 4401 when the session ends (logout, reason
``session_ended``) or expires (reason ``session_expired``, even if the client stays silent),
and with 1013 when the client cannot keep up with its queue.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Annotated, Literal

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import Field, TypeAdapter, ValidationError
from starlette.websockets import WebSocketState

from cc_platform.api.context import ApiContext
from cc_platform.api.dependencies import get_api_context
from cc_platform.api.problems import ProblemCode, spec_for
from cc_platform.api.schemas.common import RequestModel
from cc_platform.application.errors import ApplicationError, InvalidTopicError
from cc_platform.application.ports.realtime import RealtimeConnection, RealtimeEnvelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.application.security import Actor
from cc_platform.domain.shared.errors import DomainError
from cc_platform.domain.shared.ids import IdPrefix
from cc_platform.domain.shared.json import JsonObject

router = APIRouter(tags=["realtime"])

CLOSE_UNAUTHENTICATED = 4401
CLOSE_TRY_AGAIN_LATER = 1013
SESSION_EXPIRED_DETAIL = "Tu sesión venció. Vuelve a ingresar."


class SubscribeMessage(RequestModel):
    action: Literal["subscribe"]
    topic: str = Field(max_length=128)


class UnsubscribeMessage(RequestModel):
    action: Literal["unsubscribe"]
    topic: str = Field(max_length=128)


class PingMessage(RequestModel):
    action: Literal["ping"]


ClientMessage = Annotated[
    SubscribeMessage | UnsubscribeMessage | PingMessage, Field(discriminator="action")
]
_client_message = TypeAdapter[SubscribeMessage | UnsubscribeMessage | PingMessage](ClientMessage)


class _SessionExpiredError(Exception):
    """Internal signal: the socket's session reached ``session_expires_at``."""


class RealtimeSocketSession:
    """Runs one socket: a reader loop (client commands), a pump (hub → client) and an expiry
    watch (closes the socket when the session expires, even if the client stays silent)."""

    def __init__(self, websocket: WebSocket, api: ApiContext, token: str | None) -> None:
        self._ws = websocket
        self._api = api
        self._token = token
        self._hub = api.realtime_hub

    async def run(self) -> None:
        try:
            actor = await self._authenticate()
        except (ApplicationError, DomainError) as exc:
            await self._reject(exc)
            return
        connection = self._hub.connect(
            connection_id=self._api.ids.new_id(IdPrefix.CONNECTION),
            staff_id=actor.staff_id,
            session_id=actor.session_id,
        )
        try:
            # Re-check after registering: a logout committed between the first check and
            # ``connect`` found no socket to close, so it must be caught here.
            await self._authenticate()
        except (ApplicationError, DomainError) as exc:
            self._hub.disconnect(connection.id)
            await self._reject(exc)
            return
        await self._serve(connection, actor)

    async def _serve(self, connection: RealtimeConnection, actor: Actor) -> None:
        await self._send_control(
            "welcome", {"connectionId": connection.id, "staffId": actor.staff_id}
        )
        reader = asyncio.create_task(self._read_loop(connection, actor))
        pump = asyncio.create_task(self._pump(connection))
        expiry = asyncio.create_task(self._watch_expiry(actor))
        tasks = (reader, pump, expiry)
        try:
            done, _pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(
                    asyncio.CancelledError, WebSocketDisconnect, _SessionExpiredError
                ):
                    await task
            self._hub.disconnect(connection.id)

        if self._ws.client_state is not WebSocketState.CONNECTED:
            return
        if expiry in done or (reader in done and _raised(reader, _SessionExpiredError)):
            await self._send_error(ProblemCode.SESSION_EXPIRED, SESSION_EXPIRED_DETAIL)
            await self._ws.close(code=CLOSE_UNAUTHENTICATED, reason=ProblemCode.SESSION_EXPIRED)
        elif pump in done:
            reason = connection.close_reason or "closed"
            code = CLOSE_TRY_AGAIN_LATER if reason == "slow_consumer" else CLOSE_UNAUTHENTICATED
            await self._ws.close(code=code, reason=reason)

    async def _authenticate(self) -> Actor:
        return await self._api.use_cases.people.authenticate.execute(self._token)

    async def _reject(self, exc: ApplicationError | DomainError) -> None:
        await self._send_error(exc.code, exc.message)
        await self._ws.close(code=CLOSE_UNAUTHENTICATED, reason=exc.code)

    async def _pump(self, connection: RealtimeConnection) -> None:
        while (envelope := await connection.next_envelope()) is not None:
            await self._ws.send_json(envelope.to_wire())

    async def _watch_expiry(self, actor: Actor) -> None:
        """Return once the session is expired by the ``Clock``.

        Sleeps until the expiry instant, but at most ``expiry_check_interval`` at a time, so
        a clock that does not follow wall time (tests, clock skew) is re-read regularly.
        """
        interval = self._api.realtime.expiry_check_interval.total_seconds()
        while True:
            remaining = self._seconds_left(actor)
            if remaining <= 0:
                return
            await asyncio.sleep(min(remaining, interval))

    async def _read_loop(self, connection: RealtimeConnection, actor: Actor) -> None:
        while True:
            raw = await self._ws.receive_text()
            if self._seconds_left(actor) <= 0:
                raise _SessionExpiredError
            try:
                message = _client_message.validate_json(raw)
            except ValidationError:
                await self._send_error(ProblemCode.INVALID_MESSAGE)
                continue
            await self._handle(connection, actor, message)

    def _seconds_left(self, actor: Actor) -> float:
        return (actor.session_expires_at - self._api.clock.now()).total_seconds()

    async def _handle(
        self,
        connection: RealtimeConnection,
        actor: Actor,
        message: SubscribeMessage | UnsubscribeMessage | PingMessage,
    ) -> None:
        match message:
            case PingMessage():
                await self._send_control("pong", {})
            case SubscribeMessage(topic=raw_topic):
                try:
                    topic = Topic.parse(raw_topic)
                except InvalidTopicError as exc:
                    await self._send_error(exc.code, exc.message, topic=raw_topic)
                    return
                if not self._api.topic_access.can_subscribe(actor, topic):
                    await self._send_error(
                        ProblemCode.FORBIDDEN, "No puedes suscribirte a ese tema.", topic=raw_topic
                    )
                    return
                self._hub.subscribe(connection.id, str(topic))
                await self._send_control("subscribed", {"topic": str(topic)})
            case UnsubscribeMessage(topic=raw_topic):
                self._hub.unsubscribe(connection.id, raw_topic)
                await self._send_control("unsubscribed", {"topic": raw_topic})

    async def _send_control(self, kind: str, data: JsonObject) -> None:
        envelope = RealtimeEnvelope(
            type=kind,
            id=self._api.ids.new_id(IdPrefix.MESSAGE),
            occurred_at=self._api.clock.now(),
            data=data,
        )
        await self._ws.send_json(envelope.to_wire())

    async def _send_error(
        self, code: str, detail: str | None = None, *, topic: str | None = None
    ) -> None:
        if detail is None:
            detail = spec_for(ProblemCode(code)).detail or ""
        data: JsonObject = {"code": str(code), "detail": detail}
        if topic is not None:
            data["topic"] = topic
        await self._send_control("error", data)


def _raised(task: asyncio.Task[None], error: type[BaseException]) -> bool:
    return not task.cancelled() and isinstance(task.exception(), error)


@router.websocket("/ws", name="realtime")
async def realtime_socket(
    websocket: WebSocket,
    token: Annotated[str | None, Query(description="Session token")] = None,
) -> None:
    await websocket.accept()
    await RealtimeSocketSession(websocket, get_api_context(websocket), token).run()
