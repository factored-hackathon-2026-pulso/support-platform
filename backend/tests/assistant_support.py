"""Helpers for the assistant tests (ADR 0003): a container wired to a scripted agent-core."""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from cc_platform.application.ai import (
    AgentAwaiting,
    AgentConfirmation,
    AgentMessage,
    AgentOutcome,
    AgentStepUp,
    AgentTurn,
)
from cc_platform.application.ai.staff import LinkBankCustomers
from cc_platform.application.cases.dto import PostTurnCommand
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS
from tests.support import make_settings

#: Natalia (es-CO) and Ximena (es-MX): Spanish simulator customers without a case in the seed.
NATALIA, XIMENA = 2001, 2002
#: Rafael (pt-BR): linked too, to prove the assistant serves Portuguese (policy ``H1``).
RAFAEL = 2004
BANK_ID = {NATALIA: "bank-0001", XIMENA: "bank-0002", RAFAEL: "bank-0004"}


def customer_id(number: int) -> str:
    return next(c.id for c in DEMO_CUSTOMERS if c.number == number)


def say(text: str = "Hola, no reconozco un cargo") -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=str(uuid.uuid4()))


def turn(
    *messages: str,
    awaiting: AgentAwaiting = AgentAwaiting.INPUT,
    status: str = "open",
    outcome: AgentOutcome | None = None,
    handoff_ref: str | None = None,
    confirmation: AgentConfirmation | None = None,
    step_up: AgentStepUp | None = None,
    agent: str = "recepcion@1.0.0",
    trace: str = "trace-1",
) -> AgentTurn:
    """A scripted answer of agent-core."""
    return AgentTurn(
        run_id="run-1",
        turn_id=f"turn-{uuid.uuid4().hex[:8]}",
        messages=tuple(AgentMessage("generated", text, "es") for text in messages),
        locale="es",
        awaiting=awaiting,
        status=status,
        trace_id=trace,
        outcome=outcome,
        handoff_ref=handoff_ref,
        confirmation=confirmation,
        step_up=step_up,
        agent=agent,
    )


def escalation(handoff_ref: str = "hnd-7") -> AgentTurn:
    return turn(
        "Te paso con una persona del equipo.",
        awaiting=AgentAwaiting.NONE,
        status="closed",
        outcome=AgentOutcome.ESCALATED,
        handoff_ref=handoff_ref,
        agent="disputas@1.0.0",
    )


def resolution() -> AgentTurn:
    return turn(
        "Listo, radicamos tu disputa.",
        awaiting=AgentAwaiting.NONE,
        status="closed",
        outcome=AgentOutcome.RESOLVED,
        agent="disputas@1.0.0",
    )


def decode(token: str) -> dict[str, Any]:
    """The payload of a compact JWS (to check what the platform signed)."""
    body = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


def last_credentials_payload(runtime: InMemoryAgentRuntime, operation: str) -> dict[str, Any]:
    call = next(c for c in reversed(runtime.calls) if c.operation == operation)
    assert call.credentials is not None
    return decode(call.credentials.authorization)


async def assistant_world(
    persistence: str,
    tmp_path: Path,
    runtime: InMemoryAgentRuntime,
    *,
    link: bool = True,
    **settings: object,
) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": persistence, **settings}
    if persistence == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'assistant.db'}"
    clock = FixedClock()
    keys = AgentSigningKeys.generate(suffix="test")
    container = build_container(
        make_settings(**overrides),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(keys, clock), runtime=runtime
        ),
    )
    await container.startup()
    if link:
        await LinkBankCustomers(container.uow).execute(
            {customer_id(number): bank for number, bank in BANK_ID.items()}
        )
    try:
        yield container
    finally:
        await container.shutdown()


async def settle(container: Container) -> None:
    """Wait for the background jobs the last commit spawned (the assistant's answers)."""
    await container.background.drain()
