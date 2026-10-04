"""``HttpAgentRuntime``: the HTTP client of agent-core's runtime API (M9).

Speaks ``agent-core/contracts/openapi.json`` (snake_case JSON). Credentials travel only in the
``Authorization`` and ``X-On-Behalf-Of`` headers; neither they nor message text are ever logged
or put in an exception. A timeout or a network failure is ``AgentRuntimeUnavailableError`` (the
caller falls back to a person); an ``application/problem+json`` answer is ``AgentRuntimeError``
with its stable ``code``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, cast

import httpx

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.application.ai.runtime import (
    AgentAwaiting,
    AgentConfirmation,
    AgentMessage,
    AgentOutcome,
    AgentRun,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    AgentStepUp,
    AgentTurn,
    HandoffQuality,
    HandoffResolutionResult,
    SessionLineage,
    SessionLineageRun,
)

DEFAULT_TIMEOUT_SECONDS = 60.0


def _headers(credentials: AgentCredentials) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {credentials.authorization}"}
    if credentials.on_behalf_of is not None:
        headers["X-On-Behalf-Of"] = credentials.on_behalf_of
    return headers


def _outcome(value: object) -> AgentOutcome | None:
    return AgentOutcome(str(value)) if value is not None else None


def _ref(value: object) -> str | None:
    """An entity reference as ``id@version`` (agent-core sends text or ``{id, version}``)."""
    if value is None:
        return None
    if isinstance(value, dict):
        return f"{value['id']}@{value['version']}"
    return str(value)


def _turn(data: dict[str, Any]) -> AgentTurn:
    confirmation = data.get("confirmation")
    step_up = data.get("step_up")
    return AgentTurn(
        run_id=str(data["run_id"]),
        turn_id=str(data["turn_id"]),
        messages=tuple(
            AgentMessage(
                kind=cast("Literal['template', 'generated']", m["kind"]),
                text=str(m["text"]),
                locale=str(m["locale"]),
            )
            for m in data.get("messages", [])
        ),
        locale=str(data["locale"]),
        awaiting=AgentAwaiting(str(data["awaiting"])),
        status=str(data["status"]),
        trace_id=str(data["trace_id"]),
        outcome=_outcome(data.get("outcome")),
        handoff_ref=data.get("handoff_ref"),
        confirmation=None
        if confirmation is None
        else AgentConfirmation(
            action_summary=str(confirmation["action_summary"]),
            token=str(confirmation["token"]),
            expires_at=datetime.fromisoformat(str(confirmation["expires_at"])),
        ),
        step_up=None
        if step_up is None
        else AgentStepUp(
            required_level=cast(
                "Literal['anonymous', 'session', 'step_up']", step_up["required_level"]
            ),
            reason=str(step_up["reason"]),
            simulated=bool(step_up["simulated"]),
        ),
        agent=_ref(data.get("agent")),
    )


class HttpAgentRuntime:
    def __init__(self, client: httpx.AsyncClient) -> None:
        """``client`` carries the ``base_url`` and the timeout; the caller owns its lifetime."""
        self._client = client

    async def _call(
        self,
        method: str,
        path: str,
        credentials: AgentCredentials,
        *,
        json: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        headers = _headers(credentials) | (extra_headers or {})
        try:
            response = await self._client.request(method, path, headers=headers, json=json)
        except httpx.HTTPError:
            raise AgentRuntimeUnavailableError("agent-core did not answer") from None
        if response.status_code >= 400:
            raise self._error(response)
        body = response.json()
        if not isinstance(body, dict):
            raise AgentRuntimeUnavailableError("agent-core answered an unexpected body")
        return cast("dict[str, Any]", body)

    @staticmethod
    def _error(response: httpx.Response) -> Exception:
        code, trace_id = "unknown", None
        try:
            problem = response.json()
            if isinstance(problem, dict):
                code = str(problem.get("code", code))
                trace_id = problem.get("trace_id")
        except ValueError:
            pass
        if response.status_code >= 500 and code in {"unknown", "internal_error"}:
            return AgentRuntimeUnavailableError(f"agent-core failed ({response.status_code})")
        return AgentRuntimeError(status=response.status_code, code=code, trace_id=trace_id)

    async def start_run(
        self,
        credentials: AgentCredentials,
        *,
        agent: str,
        idempotency_key: str,
        lang: str | None = None,
    ) -> AgentRun:
        body: dict[str, Any] = {"agent": agent}
        if lang is not None:
            body["lang"] = lang
        data = await self._call(
            "POST",
            "/v1/runs",
            credentials,
            json=body,
            extra_headers={"Idempotency-Key": idempotency_key},
        )
        first_turn = data.get("first_turn")
        return AgentRun(
            run_id=str(data["run_id"]),
            release=str(data["release"]),
            status=str(data["status"]),
            trace_id=str(data["trace_id"]),
            session_id=data.get("session_id"),
            outcome=_outcome(data.get("outcome")),
            handoff_ref=data.get("handoff_ref"),
            first_turn=_turn(first_turn) if isinstance(first_turn, dict) else None,
        )

    async def post_turn(
        self,
        credentials: AgentCredentials,
        *,
        session_id: str,
        client_turn_id: str,
        channel: str,
        text: str = "",
        confirm_token: str | None = None,
        confirm_answer: Literal["yes", "no"] | None = None,
        lang: str | None = None,
    ) -> AgentTurn:
        body: dict[str, Any] = {"channel": channel, "client_turn_id": client_turn_id, "text": text}
        if lang is not None:
            body["lang"] = lang
        if confirm_token is not None and confirm_answer is not None:
            body["confirm"] = {"token": confirm_token, "answer": confirm_answer}
        data = await self._call("POST", f"/v1/sessions/{session_id}/turns", credentials, json=body)
        return _turn(data)

    async def get_lineage(
        self, credentials: AgentCredentials, *, session_id: str
    ) -> SessionLineage:
        data = await self._call("GET", f"/v1/sessions/{session_id}/lineage", credentials)
        return SessionLineage(
            session_id=str(data["session_id"]),
            runs=tuple(
                SessionLineageRun(
                    run_id=str(run["run_id"]),
                    agent=str(run["agent"]),
                    release=str(run["release"]),
                    status=str(run["status"]),
                    outcome=_outcome(run.get("outcome")),
                    from_agent=(run.get("origin") or {}).get("from_agent"),
                )
                for run in data.get("runs", [])
            ),
        )

    async def get_handoff(
        self, credentials: AgentCredentials, *, handoff_ref: str
    ) -> dict[str, object]:
        return await self._call("GET", f"/v1/handoffs/{handoff_ref}", credentials)

    async def record_resolution(
        self,
        credentials: AgentCredentials,
        *,
        handoff_ref: str,
        resolution_code: str,
        handoff_quality: HandoffQuality,
        notes: str | None = None,
    ) -> HandoffResolutionResult:
        body: dict[str, Any] = {
            "resolution_code": resolution_code,
            "handoff_quality": handoff_quality,
        }
        if notes is not None:
            body["notes"] = notes
        data = await self._call(
            "POST", f"/v1/handoffs/{handoff_ref}/resolution", credentials, json=body
        )
        return HandoffResolutionResult(
            handoff_ref=str(data["handoff_ref"]),
            resolution_code=str(data["resolution_code"]),
            handoff_quality=cast("HandoffQuality", data["handoff_quality"]),
        )
