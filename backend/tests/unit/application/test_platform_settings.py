"""The AI switch use cases (slice 18 contract §2) over both persistence adapters: the deployment
default until the first change, ``SetAiEnabled`` (no-op, event, who), ``AiSwitch``, the assistant
gate, and a race on the singleton's first insert."""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.platform.settings import (
    AiSwitch,
    PlatformDefaults,
    SetAiEnabled,
)
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.seed.people import seed_demo_staff
from tests.support import ADMIN_ONLY, PlainHasher, actor_for, make_settings


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'platform.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


async def toggles(container: Container) -> list[tuple[str, dict[str, object]]]:
    async with container.uow() as uow:
        page = await uow.event_log.page(limit=500)
    return [
        (e.actor_role, dict(e.payload)) for e in page.items if e.event_type == "platform.ai_toggled"
    ]


async def test_the_default_applies_until_someone_changes_it(world: Container) -> None:
    platform = world.use_cases.platform
    view = await platform.settings.execute()
    assert (view.ai_enabled, view.version, view.updated_by_name) == (True, 0, None)
    assert view.agent_core_configured is False
    assert await platform.ai_switch.is_on() is True
    async with world.uow() as uow:
        assert await uow.platform_settings.get() is None  # nothing stored yet


async def test_administration_turns_it_off_once(world: Container) -> None:
    platform = world.use_cases.platform
    admin = actor_for(ADMIN_ONLY)
    off = await platform.set_ai_enabled.execute(admin, False)
    assert off.changed is True
    assert (off.settings.ai_enabled, off.settings.version) == (False, 1)
    assert off.settings.updated_by_name == ADMIN_ONLY.name
    again = await platform.set_ai_enabled.execute(admin, False)
    assert (again.changed, again.settings.version) == (False, 1)
    assert await platform.ai_switch.is_on() is False
    on = await platform.set_ai_enabled.execute(admin, True)
    assert (on.changed, on.settings.version) == (True, 2)
    assert await toggles(world) == [("admin", {"enabled": False}), ("admin", {"enabled": True})]


async def test_the_stored_value_wins_over_the_default(tmp_path: Path) -> None:
    store = InMemoryStore()
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()

    def uow() -> UnitOfWork:
        return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(uow, PlainHasher())
    off_by_default = PlatformDefaults(ai_enabled=False)
    assert await AiSwitch(uow, off_by_default).is_on() is False
    await SetAiEnabled(uow, clock, off_by_default).execute(actor_for(ADMIN_ONLY), True)
    assert await AiSwitch(uow, off_by_default).is_on() is True
    assert await AiSwitch(uow, PlatformDefaults(ai_enabled=False)).is_on() is True


class YieldingUnitOfWork(InMemoryUnitOfWork):
    async def commit(self) -> None:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await super().commit()


async def test_racing_first_changes_store_one_singleton() -> None:
    store = InMemoryStore()
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()

    def uow() -> UnitOfWork:
        return YieldingUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(uow, PlainHasher())
    use_case = SetAiEnabled(uow, clock, PlatformDefaults(ai_enabled=True))
    admin = actor_for(ADMIN_ONLY)
    results = await asyncio.gather(*(use_case.execute(admin, False) for _ in range(4)))
    assert Counter(r.changed for r in results) == {True: 1, False: 3}
    assert len(store.platform_settings) == 1
    assert sum(1 for e in store.events if e.event_type == "platform.ai_toggled") == 1
