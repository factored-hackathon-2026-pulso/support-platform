"""Slice 22, "Activar": Supervisión points an agent's ``prod`` alias at the release she published
and the case type records that the agent serves it. Over the real composition, both adapters, with
the registry double that applies agent-core's authorization (step-up included)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.ai.errors import AssistantDisabledError, BuilderStepUpInvalidError
from cc_platform.application.ai.maturity import ActivateTypeAgent
from cc_platform.application.errors import ForbiddenError
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.application.security import Actor
from cc_platform.domain.ai.maturity import AgentStatus, StageChange
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.shared.errors import InvalidTransitionError, NotFoundError
from tests.builder_support import BuilderWorld, builder_world, draft
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, actor_for

CODE = "000000"  # the development code of the seeded accounts
NEW_AGENT = "cobros"


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[BuilderWorld]:
    async for built in builder_world(str(request.param), tmp_path):
        yield built


def activation(world: BuilderWorld) -> ActivateTypeAgent:
    return world.container.use_cases.maturity.activate_agent


async def published_release(world: BuilderWorld, who: Actor, agent_id: str = NEW_AGENT) -> str:
    """A proposal for a new agent taken to a publication (``staging`` points at it)."""
    assert world.container.use_cases.assistant is not None
    assert world.container.use_cases.assistant.builder is not None
    api = world.container.use_cases.assistant.builder.registry
    proposal = await api.create_proposal(who, agent_id=agent_id, title="Agente para Cobro indebido")
    await api.save_draft(who, proposal.proposal_id, expected_rev=0, changes=[draft()])
    candidate = await api.freeze(who, proposal.proposal_id)
    await api.evaluate(who, proposal.proposal_id, suite_id="suite-cobros", suite_version=None)
    await api.approve(
        who,
        proposal.proposal_id,
        candidate_hash=candidate.candidate_hash,
        accept_yardstick_loosened=False,
        step_up_code=CODE,
    )
    release = await api.publish(
        who, proposal.proposal_id, idempotency_key=f"publish-{agent_id}", step_up_code=CODE
    )
    return release.release_id


async def event_types(world: BuilderWorld, *types: str) -> list[tuple[str, dict[str, object]]]:
    async with world.container.uow() as uow:
        found = await uow.event_log.search(
            AuditFilters(event_types=frozenset(types)), before=None, limit=50
        )
    return [(e.event_type, dict(e.payload)) for e in reversed(found)]


async def test_activating_promotes_prod_and_the_type_records_its_agent(world: BuilderWorld) -> None:
    lucia = actor_for(SUPERVISOR)
    release_id = await published_release(world, lucia)

    result = await activation(world).execute(
        lucia,
        CaseType.UNDUE_CHARGE.value,
        agent_id=NEW_AGENT,
        release_id=release_id,
        step_up_code=CODE,
    )

    assert result.changed is True
    assert result.alias is not None
    assert (result.alias.alias, result.alias.after) == ("prod", release_id)
    m = result.type.maturity
    assert (m.agent, m.agent_id, m.last_change) == (
        AgentStatus.ACTIVE,
        NEW_AGENT,
        StageChange.AGENT_ACTIVE,
    )
    assert result.type.changed_by_name == SUPERVISOR.name
    promotes = [c for c in world.registry.calls if c.operation == "promote"]
    assert [c.principal["auth"]["level"] for c in promotes] == ["step_up"]
    recorded = await event_types(world, "builder.alias_promoted", "ai.agent_activated")
    assert [t for t, _ in recorded][-2:] == ["builder.alias_promoted", "ai.agent_activated"]
    assert recorded[-1][1]["agent_id"] == NEW_AGENT

    stages = await world.container.use_cases.maturity.stages.execute(lucia)
    undue = next(t for t in stages.types if t.maturity.case_type is CaseType.UNDUE_CHARGE)
    assert (undue.maturity.agent, undue.maturity.agent_id) == (AgentStatus.ACTIVE, NEW_AGENT)


async def test_activating_again_is_a_no_op_without_a_new_promotion(world: BuilderWorld) -> None:
    lucia = actor_for(SUPERVISOR)
    release_id = await published_release(world, lucia)
    use_case = activation(world)
    await use_case.execute(
        lucia, "undue_charge", agent_id=NEW_AGENT, release_id=release_id, step_up_code=CODE
    )
    again = await use_case.execute(
        lucia, "undue_charge", agent_id=NEW_AGENT, release_id=release_id, step_up_code=CODE
    )
    assert (again.changed, again.alias) == (False, None)
    assert len([c for c in world.registry.calls if c.operation == "promote"]) == 1


async def test_a_type_that_cannot_take_the_agent_is_refused_before_anything_is_promoted(
    world: BuilderWorld,
) -> None:
    lucia = actor_for(SUPERVISOR)
    release_id = await published_release(world, lucia)
    use_case = activation(world)
    for case_type in ("app_issue", "unrecognized_charge"):  # stage 2; served by another agent
        with pytest.raises(InvalidTransitionError):
            await use_case.execute(
                lucia, case_type, agent_id=NEW_AGENT, release_id=release_id, step_up_code=CODE
            )
    with pytest.raises(NotFoundError):
        await use_case.execute(
            lucia, "none", agent_id=NEW_AGENT, release_id=release_id, step_up_code=CODE
        )
    assert [c for c in world.registry.calls if c.operation == "promote"] == []


async def test_a_wrong_code_promotes_nothing_and_leaves_the_type_ready(world: BuilderWorld) -> None:
    lucia = actor_for(SUPERVISOR)
    release_id = await published_release(world, lucia)
    with pytest.raises(BuilderStepUpInvalidError):
        await activation(world).execute(
            lucia, "undue_charge", agent_id=NEW_AGENT, release_id=release_id, step_up_code="123456"
        )
    stages = await world.container.use_cases.maturity.stages.execute(lucia)
    undue = next(t for t in stages.types if t.maturity.case_type is CaseType.UNDUE_CHARGE)
    assert undue.maturity.agent is AgentStatus.READY


async def test_only_supervision_activates_and_only_with_ai_on(world: BuilderWorld) -> None:
    with pytest.raises(ForbiddenError):
        await activation(world).execute(
            actor_for(ANALYST),
            "undue_charge",
            agent_id=NEW_AGENT,
            release_id="r",
            step_up_code=CODE,
        )
    lucia = actor_for(SUPERVISOR)
    await world.container.use_cases.platform.set_ai_enabled.execute(actor_for(ADMIN_ONLY), False)
    with pytest.raises(AssistantDisabledError):
        await activation(world).execute(
            lucia, "undue_charge", agent_id=NEW_AGENT, release_id="r", step_up_code=CODE
        )


async def test_without_the_registry_there_is_nothing_to_activate(tmp_path: Path) -> None:
    async for built in builder_world("memory", tmp_path, with_registry=False):
        with pytest.raises(AssistantDisabledError):
            await activation(built).execute(
                actor_for(SUPERVISOR),
                "undue_charge",
                agent_id=NEW_AGENT,
                release_id="r",
                step_up_code=CODE,
            )
