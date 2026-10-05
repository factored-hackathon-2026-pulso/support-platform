"""The demo seed links three SYNTHETIC simulator customers, so `/customer` chats reach the
assistant out of the box (ADR 0003); the others, and a deployment that switches the links off, go
to people."""

from __future__ import annotations

from pathlib import Path

import pytest

from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import CaseStatus
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.seed.bank_links import SYNTHETIC_BANK_LINKS, seed_demo_bank_links
from tests.assistant_support import NATALIA, assistant_world, customer_id, settle, turn
from tests.unit.application.test_assistant import case_and_session, write


async def linked(world: Container, number: int) -> str | None:
    async with world.uow() as uow:
        return await uow.bank_links.get(customer_id(number))


@pytest.mark.parametrize("persistence", ["memory", "sqlalchemy"])
async def test_a_seeded_customer_reaches_the_assistant_without_any_links_file(
    persistence: str, tmp_path: Path
) -> None:
    runtime = InMemoryAgentRuntime()
    runtime.script.append(turn("Hola Natalia, cuéntame qué pasó."))
    async for world in assistant_world(
        persistence, tmp_path, runtime, link=False, seed_demo_bank_links=True
    ):
        assert await linked(world, NATALIA) == "SYNTHETIC-DEMO-BANK-2001"
        assert await linked(world, 2003) is None  # on purpose: the people-only path

        case_id = await write(world, NATALIA)
        await settle(world)
        case, session, _turns = await case_and_session(world, case_id)

        assert case.status is CaseStatus.WITH_ASSISTANT
        assert session is not None


async def test_the_links_are_synthetic_idempotent_and_can_be_switched_off(tmp_path: Path) -> None:
    assert all(bank.startswith("SYNTHETIC-DEMO-BANK-") for bank in SYNTHETIC_BANK_LINKS.values())
    runtime = InMemoryAgentRuntime()
    async for world in assistant_world("memory", tmp_path, runtime, link=False):
        assert await linked(world, NATALIA) is None  # off in the test settings, like a deployment
        assert await seed_demo_bank_links(world.uow) == len(SYNTHETIC_BANK_LINKS)
        assert await seed_demo_bank_links(world.uow) == 0  # a second run changes nothing
