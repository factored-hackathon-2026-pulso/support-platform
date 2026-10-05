"""Helpers for the agent builder tests (ADR 0003, slice 16): a container wired to a registry
double that applies agent-core's own authorization to the credentials the platform signs, and
``ScriptedConstructor``, a runtime double that follows ``constructor-chat``'s flow."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from cc_platform.application.ai.credentials import AgentCredentials, BuilderIdentity
from cc_platform.application.ai.registry import (
    AgentRegistryError,
    EntityDraft,
    ProposalOrigin,
    VersionDocs,
)
from cc_platform.application.ai.runtime import (
    AgentAwaiting,
    AgentMessage,
    AgentOutcome,
    AgentRun,
    AgentRuntimeError,
    AgentTurn,
)
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.domain.ai.events import BUILDER_EVENTS
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys, read_jws
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


#: ``constructor-chat``'s templates (agent-core ``tests/fixtures/registry-e2e/templates/t``).
CONSTRUCTOR_TEXTS: dict[str, dict[str, str]] = {
    "es": {
        "pedir_agente": "¿Qué agente quieres modificar? (por ejemplo: disputas)",
        "pedir_objetivo": "Cuéntame qué cambio quieres en ese agente.",
        "propuesta_lista": "Dejé la propuesta en borrador. Revísala y apruébala en el registry.",
        "traspaso": "Te paso con un asesor.",
    },
    "pt": {
        "pedir_agente": "Qual agente você quer modificar? (por exemplo: disputas)",
        "pedir_objetivo": "Conte-me qual mudança você quer nesse agente.",
        "propuesta_lista": "Deixei a proposta em rascunho. Revise-a e aprove-a no registry.",
        "traspaso": "Vou te passar para um atendente.",
    },
}


@dataclass
class _ConstructorRun:
    run_id: str
    locale: str
    asking: Literal["agente", "objetivo"] | None = "agente"
    slots: dict[str, str] = field(default_factory=dict)
    turns: int = 0


@dataclass
class ScriptedConstructor:
    """A runtime double that follows ``constructor-chat``'s flow ``construir`` (agent-core,
    ``tests/fixtures/registry-e2e/flows/construir@1.0.0.yaml``), not a free script:

    - ``start_run`` starts the flow: its first turn asks for the agent (``awaiting: slot``);
    - each message answers the question asked, **verbatim** (a ``collect`` with no validator):
      first ``agente``, then ``objetivo``;
    - with both, it creates the proposal in the registry double as the builder's service identity
      (``agent_id = agente``, ``title = objetivo``, ``origin = builder_chat``), answers in the run's
      language without naming the proposal (``p/resumen_construccion``) and closes the run;
      if the registry refuses it (an agent id that is not one, a title over 200 characters), it
      hands over (``esc``) and the run ends escalated.

    The run's language is the ``lang`` of the run (``es`` or ``pt``; anything else is ``es``)."""

    registry: InMemoryAgentRegistry
    issuer: Ed25519AgentCredentialIssuer
    principal_kid: str | None = None
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    _runs: dict[str, _ConstructorRun] = field(default_factory=dict)

    def _check(self, credentials: AgentCredentials) -> None:
        if (
            self.principal_kid is not None
            and read_jws(credentials.authorization)[0].get("kid") != self.principal_kid
        ):
            raise AgentRuntimeError(status=401, code="credentials_invalid")

    def _turn(self, run: _ConstructorRun, *keys: str, closed: str | None = None) -> AgentTurn:
        run.turns += 1
        texts = CONSTRUCTOR_TEXTS[run.locale]
        return AgentTurn(
            run_id=run.run_id,
            turn_id=f"{run.run_id}-t{run.turns}",
            messages=tuple(AgentMessage("template", texts[k], run.locale) for k in keys),
            locale=run.locale,
            awaiting=AgentAwaiting.SLOT if closed is None else AgentAwaiting.NONE,
            status="open" if closed is None else closed,
            trace_id=f"trace-{run.run_id}-{run.turns}",
            outcome=None
            if closed is None
            else (AgentOutcome.RESOLVED if closed == "closed" else AgentOutcome.ESCALATED),
            agent="constructor-chat@1.0.0",
        )

    async def start_run(
        self,
        credentials: AgentCredentials,
        *,
        agent: str,
        idempotency_key: str,
        lang: str | None = None,
        input: Mapping[str, object] | None = None,
    ) -> AgentRun:
        self.calls.append(("start_run", {"agent": agent, "key": idempotency_key, "lang": lang}))
        self._check(credentials)
        session_id = f"ses-{idempotency_key}"
        run = self._runs.get(session_id)
        if run is None:  # idempotent on the key, like agent-core
            run = _ConstructorRun(
                run_id=f"run-{len(self._runs) + 1}", locale="pt" if lang == "pt" else "es"
            )
            self._runs[session_id] = run
        first = self._turn(run, "pedir_agente")
        return AgentRun(
            run_id=run.run_id,
            release="rel-constructor",
            status="open",
            trace_id=first.trace_id,
            session_id=session_id,
            first_turn=first,
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
        self.calls.append(("post_turn", {"session_id": session_id, "text": text, "lang": lang}))
        self._check(credentials)
        run = self._runs.get(session_id)
        if run is None or run.asking is None:
            raise AgentRuntimeError(status=409, code="run_closed")
        run.slots[run.asking] = text.strip()
        if run.asking == "agente":
            run.asking = "objetivo"
            return self._turn(run, "pedir_objetivo")
        run.asking = None
        bot = self.issuer.builder(BuilderIdentity(staff_id="constructor-bot", constructor=True))
        try:
            await self.registry.create_proposal(
                bot,
                agent_id=run.slots["agente"],
                title=run.slots["objetivo"],
                origin=ProposalOrigin.BUILDER_CHAT,
            )
        except AgentRegistryError:
            return self._turn(run, "traspaso", closed="escalated")
        return self._turn(run, "propuesta_lista", closed="closed")


@dataclass(slots=True)
class BuilderWorld:
    container: Container
    registry: InMemoryAgentRegistry
    runtime: InMemoryAgentRuntime
    constructor: ScriptedConstructor | None = None


async def builder_world(
    persistence: str,
    tmp_path: Path,
    *,
    with_registry: bool = True,
    scripted_constructor: bool = False,
) -> AsyncIterator[BuilderWorld]:
    overrides: dict[str, object] = {"persistence": persistence}
    if persistence == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'builder.db'}"
    clock = FixedClock()
    keys = AgentSigningKeys.generate(suffix="b")
    # like agent-core: the registry verifies against the staff keys, the runtime against the
    # identity keys
    registry = InMemoryAgentRegistry(clock=clock, staff_kid=keys.staff.kid)
    # a free script: the run opens without saying anything (``ScriptedConstructor`` asks first)
    runtime = InMemoryAgentRuntime(principal_kid=keys.principal.kid, greeting="")
    issuer = Ed25519AgentCredentialIssuer(keys, clock)
    constructor = (
        ScriptedConstructor(registry=registry, issuer=issuer, principal_kid=keys.principal.kid)
        if scripted_constructor
        else None
    )
    container = build_container(
        make_settings(**overrides),
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=issuer,
            runtime=constructor or runtime,
            registry=registry if with_registry else None,
        ),
    )
    await container.startup()
    try:
        yield BuilderWorld(container, registry, runtime, constructor)
    finally:
        await container.shutdown()


async def builder_events(container: Container) -> list[tuple[str, dict[str, object], str, str]]:
    """``(type, payload, actor role, entity id)`` of every ``builder.*`` event, oldest first."""
    types = frozenset(event.event_type for event in BUILDER_EVENTS)
    async with container.uow() as uow:
        found = await uow.event_log.search(AuditFilters(event_types=types), before=None, limit=500)
    return [(e.event_type, dict(e.payload), e.actor_role, e.entity_id) for e in reversed(found)]
