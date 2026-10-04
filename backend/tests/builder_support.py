"""Helpers for the agent builder tests (ADR 0003, slice 16): a container wired to a registry
double that applies agent-core's own authorization to the credentials the platform signs."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from cc_platform.application.ai.registry import EntityDraft, VersionDocs
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.domain.ai.events import BUILDER_EVENTS
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_registry import InMemoryAgentRegistry
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.support import make_settings

AGENT = "disputas"
DOCS = VersionDocs(
    description="Acorta el resumen que se le da al cliente",
    rationale="Los clientes no leen resúmenes largos",
    changelog="Resumen de máximo 3 líneas",
)


def draft(version: str = "1.1.0", kind: str = "template") -> EntityDraft:
    return EntityDraft(
        kind=kind, content={"id": "t/resumen", "version": version, "text": "corto"}, docs=DOCS
    )


@dataclass(slots=True)
class BuilderWorld:
    container: Container
    registry: InMemoryAgentRegistry
    runtime: InMemoryAgentRuntime


async def builder_world(
    persistence: str, tmp_path: Path, *, with_registry: bool = True
) -> AsyncIterator[BuilderWorld]:
    overrides: dict[str, object] = {"persistence": persistence}
    if persistence == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'builder.db'}"
    clock = FixedClock()
    registry = InMemoryAgentRegistry(clock=clock)
    runtime = InMemoryAgentRuntime()
    container = build_container(
        make_settings(**overrides),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(AgentSigningKeys.generate(suffix="b"), clock),
            runtime=runtime,
            registry=registry if with_registry else None,
        ),
    )
    await container.startup()
    try:
        yield BuilderWorld(container, registry, runtime)
    finally:
        await container.shutdown()


async def builder_events(container: Container) -> list[tuple[str, dict[str, object], str, str]]:
    """``(type, payload, actor role, entity id)`` of every ``builder.*`` event, oldest first."""
    types = frozenset(event.event_type for event in BUILDER_EVENTS)
    async with container.uow() as uow:
        found = await uow.event_log.search(AuditFilters(event_types=types), before=None, limit=500)
    return [(e.event_type, dict(e.payload), e.actor_role, e.entity_id) for e in reversed(found)]
