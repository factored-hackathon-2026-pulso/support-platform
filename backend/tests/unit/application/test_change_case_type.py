"""``ChangeCaseType`` (slice 18 contract §3) over the real composition and both persistence
adapters, mirroring the priority (slice 8): who may change it, closed cases, the no-op, the
stale ``expectedVersion``, and races on an in-memory Unit of Work that yields before commit."""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.cases.case_type import ChangeCaseType, ChangeCaseTypeCommand
from cc_platform.application.cases.dto import CaseSummaryView
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.errors import VersionConflictError
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.cases import CaseClosedError, CaseType
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.seed.cases import seed_case_id, seed_demo_cases
from cc_platform.infrastructure.seed.customers import seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    StaffSeed,
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
)
from tests.support import (
    ANALYST,
    JULIAN,
    SUPERVISOR,
    TEAM_LEAD,
    PlainHasher,
    actor_for,
    make_settings,
)

#: Daniela's open 108 (none) and 101 (Cargo no reconocido), Julián's open 113 (Problema con
#: app), Rosa's queued 111 (none),
#: Claudia's closed 105, Julián's closed 110 (Daniela reads it through history access).
PATRICIA, MARCELA, CAMILA, ROSA, CLAUDIA_CLOSED, PATRICIA_OLD = (
    seed_case_id(108),
    seed_case_id(101),
    seed_case_id(113),
    seed_case_id(111),
    seed_case_id(105),
    seed_case_id(110),
)
DANIELA_ID, LUCIA_ID = seed_staff_id(ANALYST.number), seed_staff_id(SUPERVISOR.number)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {"persistence": request.param}
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'case_type.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    yield container
    await container.shutdown()


async def version_of(container: Container, case_id: str) -> int:
    async with container.uow() as uow:
        case = await uow.cases.get(case_id)
    assert case is not None
    return case.version


async def type_events(container: Container, case_id: str) -> list[tuple[str, object]]:
    async with container.uow() as uow:
        page = await uow.event_log.page(case_id=case_id, limit=500)
    return [
        (e.actor_role, dict(e.payload)) for e in page.items if e.event_type == "case.type_changed"
    ]


def change(case_type: CaseType, version: int) -> ChangeCaseTypeCommand:
    return ChangeCaseTypeCommand(case_type=case_type, expected_version=version)


# ----------------------------------------------------------------------------- the rules
async def test_the_assignee_sets_the_type(world: Container) -> None:
    use_case = world.use_cases.cases.change_type
    version = await version_of(world, PATRICIA)
    result = await use_case.execute(
        actor_for(ANALYST), PATRICIA, change(CaseType.UNDUE_CHARGE, version)
    )
    assert result.changed is True
    assert result.case.case_type is CaseType.UNDUE_CHARGE
    assert result.case.version == version + 1
    assert await type_events(world, PATRICIA) == [
        ("analyst", {"from": "none", "to": "undue_charge", "schema_version": 1})
    ]
    detail = await world.use_cases.cases.detail.execute(actor_for(ANALYST), PATRICIA)
    assert detail.case.case_type is CaseType.UNDUE_CHARGE
    assert detail.case.sla_due_at == result.case.sla_due_at  # the SLA never moves


async def test_the_same_type_is_a_no_op_whatever_the_version(world: Container) -> None:
    use_case = world.use_cases.cases.change_type
    version = await version_of(world, MARCELA)
    result = await use_case.execute(
        actor_for(ANALYST), MARCELA, change(CaseType.UNRECOGNIZED_CHARGE, version - 3)
    )
    assert (result.changed, result.case.version) == (False, version)
    assert len(await type_events(world, MARCELA)) == 1  # only the seeded one


async def test_a_stale_version_is_a_conflict_with_the_case_now(world: Container) -> None:
    use_case = world.use_cases.cases.change_type
    version = await version_of(world, MARCELA)
    with pytest.raises(VersionConflictError) as raised:
        await use_case.execute(actor_for(ANALYST), MARCELA, change(CaseType.APP_ISSUE, version - 1))
    assert raised.value.code == "version_conflict"
    assert raised.value.current_version == version
    current = raised.value.current_view
    assert isinstance(current, CaseSummaryView)
    assert (current.id, current.case_type) == (MARCELA, CaseType.UNRECOGNIZED_CHARGE)
    assert await version_of(world, MARCELA) == version


async def test_supervision_changes_any_open_case_even_a_queued_one(world: Container) -> None:
    use_case = world.use_cases.cases.change_type
    lucia = actor_for(SUPERVISOR)
    for case_id, case_type in (
        (CAMILA, CaseType.SERVICE_QUALITY),
        (ROSA, CaseType.VIRTUAL_CARD),
    ):
        version = await version_of(world, case_id)
        result = await use_case.execute(lucia, case_id, change(case_type, version))
        assert result.changed is True
        assert result.case.case_type is case_type
    assert await type_events(world, ROSA) == [
        ("supervisor", {"from": "none", "to": "virtual_card", "schema_version": 1})
    ]
    assert (await type_events(world, CAMILA))[-1] == (
        "supervisor",
        {"from": "app_issue", "to": "service_quality", "schema_version": 1},
    )


async def test_an_analyst_and_supervisor_acts_as_supervision_on_someone_elses_case(
    world: Container,
) -> None:
    version = await version_of(world, CAMILA)
    await world.use_cases.cases.change_type.execute(
        actor_for(TEAM_LEAD), CAMILA, change(CaseType.UNDUE_CHARGE, version)
    )
    assert (await type_events(world, CAMILA))[-1][0] == "supervisor"


@pytest.mark.parametrize(
    ("who", "case_number"),
    [("julian", 101), ("julian", 108), ("daniela", 113), ("daniela", 111)],
    ids=["another-analysts-case", "history-access-only", "julians-case", "queued-case"],
)
async def test_other_analysts_may_not_change_it(
    world: Container, who: str, case_number: int
) -> None:
    actor = actor_for(JULIAN if who == "julian" else ANALYST)
    case_id = seed_case_id(case_number)
    version = await version_of(world, case_id)
    with pytest.raises(CaseNotAssignedError):
        await world.use_cases.cases.change_type.execute(
            actor, case_id, change(CaseType.APP_ISSUE, version)
        )
    assert await version_of(world, case_id) == version


async def test_a_closed_case_is_read_only_for_everyone(world: Container) -> None:
    version = await version_of(world, CLAUDIA_CLOSED)
    for actor in (actor_for(ANALYST), actor_for(SUPERVISOR)):
        with pytest.raises(CaseClosedError):
            await world.use_cases.cases.change_type.execute(
                actor, CLAUDIA_CLOSED, change(CaseType.UNDUE_CHARGE, version)
            )
    # Daniela only reads Julián's closed 110: not hers comes first.
    with pytest.raises(CaseNotAssignedError):
        await world.use_cases.cases.change_type.execute(
            actor_for(ANALYST), PATRICIA_OLD, change(CaseType.UNDUE_CHARGE, 1)
        )


async def test_an_unknown_case_is_not_found(world: Container) -> None:
    for case_id in (seed_case_id(999), "nope"):
        with pytest.raises(NotFoundError):
            await world.use_cases.cases.change_type.execute(
                actor_for(SUPERVISOR), case_id, change(CaseType.UNDUE_CHARGE, 1)
            )


async def test_the_capability_follows_the_same_rule(world: Container) -> None:
    detail = world.use_cases.cases.detail

    async def can(seed: StaffSeed, case_id: str) -> bool:
        view = await detail.execute(actor_for(seed), case_id)
        return view.capabilities.can_change_type

    assert await can(ANALYST, MARCELA) is True
    assert await can(ANALYST, CLAUDIA_CLOSED) is False
    assert await can(ANALYST, PATRICIA_OLD) is False  # history access, and closed
    assert await can(SUPERVISOR, CAMILA) is True
    assert await can(SUPERVISOR, ROSA) is True
    assert await can(SUPERVISOR, CLAUDIA_CLOSED) is False


# ----------------------------------------------------------------------------- races
class YieldingUnitOfWork(InMemoryUnitOfWork):
    async def commit(self) -> None:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await super().commit()


async def racing_kit() -> tuple[InMemoryStore, ChangeCaseType]:
    clock, ids, bus, store = (
        FixedClock(),
        SequentialIdGenerator(),
        InProcessEventBus(),
        InMemoryStore(),
    )

    def uow() -> UnitOfWork:
        return YieldingUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(uow, PlainHasher())
    await seed_demo_customers(uow)
    await seed_demo_availability(uow, clock)
    await seed_demo_cases(uow, ids, clock)
    return store, ChangeCaseType(uow, clock)


def changes_of(store: InMemoryStore, case_id: str) -> int:
    return sum(
        1 for e in store.events if e.event_type == "case.type_changed" and e.case_id == case_id
    )


async def test_two_people_choosing_different_types_never_overwrite_each_other() -> None:
    store, use_case = await racing_kit()
    version = store.cases[PATRICIA].version
    daniela, lucia = actor_for(ANALYST), actor_for(SUPERVISOR)
    results = await asyncio.gather(
        use_case.execute(daniela, PATRICIA, change(CaseType.UNDUE_CHARGE, version)),
        use_case.execute(lucia, PATRICIA, change(CaseType.APP_ISSUE, version)),
        return_exceptions=True,
    )
    winners = [r for r in results if not isinstance(r, BaseException)]
    losers = [r for r in results if isinstance(r, BaseException)]
    assert len(winners) == 1
    assert len(losers) == 1
    assert isinstance(losers[0], VersionConflictError)
    current = losers[0].current_view
    assert isinstance(current, CaseSummaryView)
    assert current.case_type is winners[0].case.case_type  # the loser sees what won
    assert store.cases[PATRICIA].case_type is winners[0].case.case_type
    assert changes_of(store, PATRICIA) == 1


async def test_a_double_submit_changes_once() -> None:
    store, use_case = await racing_kit()
    version = store.cases[PATRICIA].version
    daniela = actor_for(ANALYST)
    results = await asyncio.gather(
        *(
            use_case.execute(daniela, PATRICIA, change(CaseType.UNDUE_CHARGE, version))
            for _ in range(4)
        )
    )
    assert Counter(r.changed for r in results) == {True: 1, False: 3}
    assert {r.case.version for r in results} == {version + 1}
    assert changes_of(store, PATRICIA) == 1
