"""The chat against a builder that follows ``constructor-chat``'s real flow (``construir``).

agent-core's ``construir`` (``tests/fixtures/registry-e2e/flows/construir@1.0.0.yaml``) starts when
the run starts: it asks which agent, takes the next message **verbatim** as the agent id, asks
what to change, takes the next message verbatim as the goal (which becomes the proposal's title,
1-200 characters), then drafts and creates the proposal as its service identity and answers
without naming it. ``ScriptedConstructor`` (``tests/builder_support.py``) follows that flow, so
these tests show what the platform must send, in which order, and what the person sees.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.ai.builder_chat import BuilderExchangeView
from cc_platform.application.ai.use_cases import BuilderUseCases
from cc_platform.domain.people.preferences import UiLanguage
from tests.builder_support import (
    CONSTRUCTOR_TEXTS,
    BuilderWorld,
    ScriptedConstructor,
    builder_world,
)
from tests.support import SUPERVISOR, actor_for

ES, PT = CONSTRUCTOR_TEXTS["es"], CONSTRUCTOR_TEXTS["pt"]
GOAL = (
    'Atender los chats de "Cobro indebido" como lo hace el equipo y pasar a una persona lo que '
    "no pueda resolver."
)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[BuilderWorld]:
    async for built in builder_world(str(request.param), tmp_path, scripted_constructor=True):
        yield built


def use_cases(world: BuilderWorld) -> BuilderUseCases:
    assert world.container.use_cases.assistant is not None
    assert world.container.use_cases.assistant.builder is not None
    return world.container.use_cases.assistant.builder


def constructor(world: BuilderWorld) -> ScriptedConstructor:
    assert world.constructor is not None
    return world.constructor


async def say(world: BuilderWorld, text: str) -> BuilderExchangeView:
    return await use_cases(world).ask.execute(
        actor_for(SUPERVISOR), text=text, client_message_id=str(uuid.uuid4())
    )


async def thread(world: BuilderWorld) -> list[tuple[str, str]]:
    view = await use_cases(world).thread.execute(actor_for(SUPERVISOR))
    return [(m.role, m.text) for m in view.messages]


async def test_the_agent_id_then_the_goal_make_a_proposal(world: BuilderWorld) -> None:
    opened = await use_cases(world).restart.execute(actor_for(SUPERVISOR))
    assert [(m.role, m.text, m.answers) for m in opened.messages] == [
        ("agent", ES["pedir_agente"], None)
    ]
    assert opened.awaiting == "slot"

    agent = await say(world, "cobros")
    assert [a.text for a in agent.answers] == [ES["pedir_objetivo"]]
    assert agent.awaiting == "slot"  # it asks for the goal: the platform sends it next

    goal = await say(world, GOAL)
    assert [a.text for a in goal.answers] == [ES["propuesta_lista"]]
    assert goal.awaiting == "none"
    assert goal.proposals == ()  # the answer names no id (``p/resumen_construccion``)...

    # ...but agent-core's list has it, so the proposals list shows it
    listing = await use_cases(world).registry.list_proposals(actor_for(SUPERVISOR))
    [made] = listing.items
    assert (made.agent_id, made.title, made.origin) == ("cobros", GOAL, "builder_chat")
    assert (made.source, made.created_by, made.state) == ("registry", "constructor-bot", "draft")
    # the person sees the whole exchange, in order
    assert await thread(world) == [
        ("agent", ES["pedir_agente"]),
        ("person", "cobros"),
        ("agent", ES["pedir_objetivo"]),
        ("person", GOAL),
        ("agent", ES["propuesta_lista"]),
    ]
    # one run, started by the restart; both messages answered it
    assert [c[0] for c in constructor(world).calls] == ["start_run", "post_turn", "post_turn"]


async def test_one_message_with_everything_is_taken_whole_as_the_agent(
    world: BuilderWorld,
) -> None:
    """Why the platform no longer sends "Agente: cobros. Objetivo: …" in one message."""
    await use_cases(world).restart.execute(actor_for(SUPERVISOR))

    swallowed = await say(world, f"Agente: cobros. Objetivo: {GOAL}")
    handed_over = await say(world, "Que pase a una persona lo que no pueda resolver.")

    assert [a.text for a in swallowed.answers] == [ES["pedir_objetivo"]]
    assert [a.text for a in handed_over.answers] == [ES["traspaso"]]  # not a valid agent id
    assert handed_over.awaiting == "none"
    assert (await use_cases(world).registry.list_proposals(actor_for(SUPERVISOR))).items == ()


async def test_a_goal_over_200_characters_is_refused_by_the_registry(world: BuilderWorld) -> None:
    await use_cases(world).restart.execute(actor_for(SUPERVISOR))
    await say(world, "cobros")

    too_long = await say(world, "x" * 201)

    assert [a.text for a in too_long.answers] == [ES["traspaso"]]
    assert (await use_cases(world).registry.list_proposals(actor_for(SUPERVISOR))).items == ()


async def test_the_builder_speaks_portuguese_to_a_person_who_reads_portuguese(
    world: BuilderWorld,
) -> None:
    await world.container.use_cases.people.set_preferences.execute(
        actor_for(SUPERVISOR), UiLanguage.PORTUGUESE_BRAZIL
    )

    opened = await use_cases(world).restart.execute(actor_for(SUPERVISOR))
    agent = await say(world, "cobros")
    goal = await say(world, 'Atender os chats de "Cobrança indevida" como a equipe faz.')

    assert [m.text for m in opened.messages] == [PT["pedir_agente"]]
    assert [a.text for a in agent.answers] == [PT["pedir_objetivo"]]
    assert [a.text for a in goal.answers] == [PT["propuesta_lista"]]
    calls = constructor(world).calls
    assert {c[1]["lang"] for c in calls} == {"pt"}


async def test_a_message_that_starts_the_run_answers_its_question(world: BuilderWorld) -> None:
    """No restart (or agent-core did not answer it): the first message starts the run, and the
    answer carries the run's question first, so the person sees what her message answered."""
    first = await say(world, "cobros")

    assert [a.text for a in first.answers] == [ES["pedir_agente"], ES["pedir_objetivo"]]
    assert all(a.answers == first.message.id for a in first.answers)
    assert first.awaiting == "slot"


async def test_after_a_proposal_the_next_message_starts_another_run(world: BuilderWorld) -> None:
    await use_cases(world).restart.execute(actor_for(SUPERVISOR))
    await say(world, "cobros")
    await say(world, GOAL)

    again = await say(world, "disputas")

    assert [a.text for a in again.answers] == [ES["pedir_agente"], ES["pedir_objetivo"]]
    assert [c[0] for c in constructor(world).calls].count("start_run") == 2


async def test_a_restart_that_agent_core_refuses_leaves_an_empty_thread(
    world: BuilderWorld,
) -> None:
    constructor(world).principal_kid = "another-key"  # agent-core refuses the credential

    opened = await use_cases(world).restart.execute(actor_for(SUPERVISOR))

    assert (opened.messages, opened.awaiting) == ((), None)
    assert await thread(world) == []
