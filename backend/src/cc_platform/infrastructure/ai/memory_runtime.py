"""``InMemoryAgentRuntime``: a scripted agent-core for tests (no network).

It records every call (without credentials) and answers from queued scripts, so the use cases
of S14 can be tested end to end: a greeting, a clarification, a confirmation, an escalation.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

from cc_platform.application.ai.credentials import AgentCredentials
from cc_platform.application.ai.runtime import (
    AgentAwaiting,
    AgentMessage,
    AgentOutcome,
    AgentRun,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    AgentTurn,
    HandoffQuality,
    HandoffResolutionResult,
    SessionLineage,
)
from cc_platform.domain.ai.suggestion import Suggestion
from cc_platform.infrastructure.ai.keys import read_jws

#: Inputs a conversational run may carry (claimed slots in agent-core), e.g. the copilot's.
CONVERSATIONAL_INPUTS = frozenset({"assistant_session_id"})


@dataclass(frozen=True, slots=True)
class RecordedCall:
    """One call to the fake. ``credentials`` are kept so a test can decode what was signed
    (``repr`` hides them, like the real object)."""

    operation: str
    arguments: dict[str, object]
    credentials: AgentCredentials | None = None


@dataclass
class InMemoryAgentRuntime:
    calls: list[RecordedCall] = field(default_factory=list)
    #: Each queued item answers one ``post_turn``: a turn, or an exception to raise.
    script: list[AgentTurn | Exception] = field(default_factory=list)
    greeting: str = "Hola, ¿en qué te ayudo?"
    unavailable: bool = False
    principal_kid: str | None = None
    """When set, the credential must be signed with this key id: the runtime verifies
    principals against the **identity** keys, so another key is ``credentials_invalid``."""
    suggestion_script: list[tuple[Suggestion, ...] | Exception] = field(default_factory=list)
    """Each queued item answers one ``task`` run (a ``start_run`` with ``input``): what it
    proposes (``()`` = nothing to propose), or an exception to raise. Empty: nothing to propose."""
    handoffs: dict[str, dict[str, object]] = field(default_factory=dict)
    """Packets ``get_handoff`` answers by reference (default: just the reference)."""
    _runs: int = 0
    _resolved: set[str] = field(default_factory=set)

    def _record(self, operation: str, credentials: AgentCredentials, **arguments: object) -> None:
        self.calls.append(RecordedCall(operation, arguments, credentials))
        if (
            self.principal_kid is not None
            and read_jws(credentials.authorization)[0].get("kid") != self.principal_kid
        ):
            raise AgentRuntimeError(status=401, code="credentials_invalid")
        if self.unavailable:
            raise AgentRuntimeUnavailableError("scripted outage")

    async def start_run(
        self,
        credentials: AgentCredentials,
        *,
        agent: str,
        idempotency_key: str,
        lang: str | None = None,
        input: Mapping[str, object] | None = None,
    ) -> AgentRun:
        arguments: dict[str, object] = {
            "agent": agent,
            "idempotency_key": idempotency_key,
            "lang": lang,
        }
        if input is not None:
            arguments["input"] = dict(input)
        self._record("start_run", credentials, **arguments)
        self._runs += 1
        run_id = f"run-{self._runs}"
        # A task run carries its validated input; a conversational run may carry claimed inputs
        # (the copilot names the assistant's session), and still opens a session.
        if input is not None and set(input) - CONVERSATIONAL_INPUTS:
            # a task run: no session, no first turn, a list of suggestions
            answer = self.suggestion_script.pop(0) if self.suggestion_script else ()
            if isinstance(answer, Exception):
                raise answer
            return AgentRun(
                run_id=run_id,
                release="rel-1",
                status="closed",
                trace_id=f"trace-{self._runs}",
                outcome=AgentOutcome.COMPLETED,
                suggestions=answer,
            )
        turn = AgentTurn(
            run_id=run_id,
            turn_id=f"{run_id}-t0",
            messages=(AgentMessage("template", self.greeting, lang or "es"),),
            locale=lang or "es",
            awaiting=AgentAwaiting.INPUT,
            status="open",
            trace_id=f"trace-{self._runs}",
            agent=agent,
        )
        return AgentRun(
            run_id=run_id,
            release="rel-1",
            status="open",
            trace_id=turn.trace_id,
            session_id=f"ses-{self._runs}",
            first_turn=turn,
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
        self._record(
            "post_turn",
            credentials,
            session_id=session_id,
            client_turn_id=client_turn_id,
            channel=channel,
            text=text,
            confirm_token=confirm_token,
            confirm_answer=confirm_answer,
        )
        if not self.script:
            raise AgentRuntimeError(status=500, code="script_exhausted")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def get_lineage(
        self, credentials: AgentCredentials, *, session_id: str
    ) -> SessionLineage:
        self._record("get_lineage", credentials, session_id=session_id)
        return SessionLineage(session_id=session_id)

    async def get_handoff(
        self, credentials: AgentCredentials, *, handoff_ref: str
    ) -> dict[str, object]:
        self._record("get_handoff", credentials, handoff_ref=handoff_ref)
        return self.handoffs.get(handoff_ref, {"handoff_ref": handoff_ref})

    async def record_resolution(
        self,
        credentials: AgentCredentials,
        *,
        handoff_ref: str,
        resolution_code: str,
        handoff_quality: HandoffQuality,
        notes: str | None = None,
    ) -> HandoffResolutionResult:
        self._record(
            "record_resolution",
            credentials,
            handoff_ref=handoff_ref,
            resolution_code=resolution_code,
            handoff_quality=handoff_quality,
        )
        if handoff_ref in self._resolved:
            raise AgentRuntimeError(status=409, code="handoff_already_resolved")
        self._resolved.add(handoff_ref)
        return HandoffResolutionResult(handoff_ref, resolution_code, handoff_quality)


def escalated_turn(handoff_ref: str = "hnd-1") -> AgentTurn:
    """A ready-made scripted turn: the agent escalates and closes its run."""
    return AgentTurn(
        run_id="run-1",
        turn_id="run-1-t9",
        messages=(AgentMessage("template", "Te paso con una persona del equipo.", "es"),),
        locale="es",
        awaiting=AgentAwaiting.NONE,
        status="escalated",
        trace_id="trace-esc",
        outcome=AgentOutcome.ESCALATED,
        handoff_ref=handoff_ref,
    )
