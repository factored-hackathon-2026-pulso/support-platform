"""The agents the platform knows (ADR 0009): a name to show and what each one did.

``GetAgents`` (``GET /ai/agents``): one row per agent that serves a case type or has held an
assistant session, with the name Supervisión gave it and its results (sessions, how many it
resolved, how many it handed to people). The results are counted from the assistant sessions
(each one's last answering agent), not from a second source. ``RenameAgent``
(``PUT /supervision/ai/agents/{agentId}/name``) names the agent of a type, audited.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial

from cc_platform.application.ai.builder import AgentBuilder
from cc_platform.application.ai.errors import AssistantDisabledError
from cc_platform.application.ai.maturity import (
    CaseTypeStageView,
    _view,
    load_maturity,
    maturing_type,
    store_maturity,
)
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.platform.settings import AiSwitch
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.maturity import AgentStatus
from cc_platform.domain.ai.session import AssistantSession, AssistantState
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import NotFoundError


@dataclass(frozen=True, slots=True)
class AgentResults:
    sessions: int = 0
    active: int = 0
    resolved: int = 0
    handed_to_people: int = 0
    """Escalated, ended without a resolution, failed or taken by Supervisión."""


@dataclass(frozen=True, slots=True)
class AgentRow:
    agent_id: str
    display_name: str
    case_type: CaseType | None
    results: AgentResults
    paused: bool = False


@dataclass(frozen=True, slots=True)
class AgentsView:
    available: bool
    agents: tuple[AgentRow, ...]


def agent_id_of(session: AssistantSession) -> str:
    """The agent that answered last (``id@alias`` or ``id@version``): its id."""
    return (session.agent or session.entry_agent).split("@", 1)[0]


def humanize(agent_id: str) -> str:
    text = agent_id.replace("-", " ").replace("_", " ").replace("/", " ").strip()
    return text[:1].upper() + text[1:]


def count_results(sessions: list[AssistantSession]) -> dict[str, AgentResults]:
    tally: dict[str, list[int]] = {}
    for session in sessions:
        row = tally.setdefault(agent_id_of(session), [0, 0, 0, 0])
        row[0] += 1
        if session.state is AssistantState.ACTIVE:
            row[1] += 1
        elif session.state is AssistantState.RESOLVED:
            row[2] += 1
        else:
            row[3] += 1
    return {agent: AgentResults(*counts) for agent, counts in tally.items()}


@dataclass(frozen=True, slots=True)
class GetAgents:
    uow: UnitOfWorkFactory
    switch: AiSwitch

    async def execute(self, actor: Actor) -> AgentsView:
        ensure_any_role(actor, {StaffRole.ANALYST, StaffRole.SUPERVISOR})
        async with self.uow() as uow:
            if not await self.switch.is_on_in(uow):
                return AgentsView(available=False, agents=())
            results = count_results(await uow.assistant_sessions.list_all())
            serving = {
                m.agent_id: m
                for m in await uow.case_type_maturity.list()
                if m.agent is AgentStatus.ACTIVE and m.agent_id is not None
            }
        rows = [
            AgentRow(
                agent_id=agent_id,
                display_name=(
                    (serving[agent_id].agent_name or humanize(agent_id))
                    if agent_id in serving
                    else humanize(agent_id)
                ),
                case_type=serving[agent_id].case_type if agent_id in serving else None,
                paused=agent_id in serving and serving[agent_id].agent_paused,
                results=results.get(agent_id, AgentResults()),
            )
            for agent_id in sorted(set(results) | set(serving))
        ]
        return AgentsView(available=True, agents=tuple(rows))


@dataclass(frozen=True, slots=True)
class RenameAgent:
    """Supervisión names the agent that serves a type. 404 for a type without an
    agent; AI off: ``assistant_disabled``."""

    uow: UnitOfWorkFactory
    clock: Clock
    switch: AiSwitch

    async def execute(self, actor: Actor, case_type: str, *, name: str) -> CaseTypeStageView:
        ensure_any_role(actor, {StaffRole.SUPERVISOR})
        kind = maturing_type(case_type)
        return await retry_on_conflict(partial(self._rename, actor, kind, name))

    async def _rename(self, actor: Actor, kind: CaseType, name: str) -> CaseTypeStageView:
        async with self.uow() as uow:
            if not await self.switch.is_on_in(uow):
                raise AssistantDisabledError()
            maturity, new = await load_maturity(uow, kind)
            if maturity.agent_id is None:
                raise NotFoundError("Ese tipo de caso no tiene un agente.")
            if maturity.rename_agent(
                name, actor=actor.acting_as({StaffRole.SUPERVISOR}), at=self.clock.now()
            ):
                await store_maturity(uow, maturity, new=new)
                await uow.commit()
            return await _view(uow, maturity)


@dataclass(frozen=True, slots=True)
class SetAgentPaused:
    """Supervisión pauses (or resumes) the agent of a type, with her authenticator code (ADR 0009).

    agent-core takes the agent out of ``recepcion``'s directory (``prod`` untouched, open cases
    carry on); the type records it (``ai.agent_paused`` / ``ai.agent_resumed``, live on
    ``ai:stages``). The registry is called first: a refusal leaves the type as it was. Idempotent:
    pausing a paused agent answers with the type unchanged."""

    uow: UnitOfWorkFactory
    clock: Clock
    switch: AiSwitch
    builder: AgentBuilder | None

    async def execute(
        self, actor: Actor, case_type: str, *, paused: bool, reason: str, step_up_code: str
    ) -> CaseTypeStageView:
        ensure_any_role(actor, {StaffRole.SUPERVISOR})
        kind = maturing_type(case_type)
        if self.builder is None:
            raise AssistantDisabledError()
        async with self.uow() as uow:
            if not await self.switch.is_on_in(uow):
                raise AssistantDisabledError()
            maturity, _ = await load_maturity(uow, kind)
            if maturity.agent_id is None:
                raise NotFoundError("Ese tipo de caso no tiene un agente.")
            agent_id = maturity.agent_id
            if maturity.agent_paused == paused:
                return await _view(uow, maturity)
        await self.builder.set_paused(
            actor, agent_id, paused=paused, reason=reason, step_up_code=step_up_code
        )
        return await retry_on_conflict(partial(self._record, actor, kind, paused))

    async def _record(self, actor: Actor, kind: CaseType, paused: bool) -> CaseTypeStageView:
        async with self.uow() as uow:
            maturity, new = await load_maturity(uow, kind)
            if maturity.set_agent_paused(
                paused, actor=actor.acting_as({StaffRole.SUPERVISOR}), at=self.clock.now()
            ):
                await store_maturity(uow, maturity, new=new)
                await uow.commit()
            return await _view(uow, maturity)


@dataclass(frozen=True, slots=True)
class AgentCatalogUseCases:
    agents: GetAgents
    rename: RenameAgent
    pause: SetAgentPaused
