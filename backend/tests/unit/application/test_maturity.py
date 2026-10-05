"""The AI stages per case type (slice 21) over the real composition, both adapters: the seeded
story, the signals a closed case and a decided draft add, advancing by the rule, moving back,
the tool feedback, the gate on automatic suggestions and the AI switch."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cc_platform.application.ai.errors import AssistantDisabledError
from cc_platform.application.ai.maturity import WhileTypeProposes, case_copilot_facts
from cc_platform.application.cases.case_type import ChangeCaseTypeCommand
from cc_platform.application.cases.dto import CloseCaseCommand
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.domain.ai.events import (
    CopilotQueryAsked,
    CopilotSuggestionDecided,
    CopilotSuggestionReady,
)
from cc_platform.domain.ai.maturity import (
    AgentStatus,
    CopilotMode,
    MaturityStage,
    StageChange,
)
from cc_platform.domain.ai.maturity_events import CopilotToolUsed
from cc_platform.domain.ai.suggestion import CopilotSuggestion, SuggestionTrigger, ToolSuggestion
from cc_platform.domain.cases.events import TurnCreated
from cc_platform.domain.cases.values import CaseType, CloseReason
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, NotFoundError
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import ADMIN_ONLY, ANALYST, SUPERVISOR, actor_for, emit, make_settings

CASE = seed_case_id(108)  # Daniela's, untyped
DANIELA = seed_staff_id(ANALYST.number)


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[Container]:
    overrides: dict[str, object] = {
        "persistence": request.param,
        # small thresholds so one case moves a type
        "stage_asked_cases_to_propose_tools": 8,
        "stage_resolved_cases_to_ask": 3,
    }
    if request.param == "sqlalchemy":
        overrides["database_url"] = f"sqlite+aiosqlite:///{tmp_path / 'stages.db'}"
    container = build_container(
        make_settings(**overrides), clock=FixedClock(), ids=SequentialIdGenerator()
    )
    await container.startup()
    try:
        yield container
    finally:
        await container.shutdown()


async def stages(world: Container) -> dict[CaseType, object]:
    view = await world.use_cases.maturity.stages.execute(actor_for(ANALYST))
    return {t.maturity.case_type: t for t in view.types}


async def maturity(world: Container, case_type: CaseType):  # type: ignore[no-untyped-def]
    async with world.uow() as uow:
        return await uow.case_type_maturity.get(case_type)


async def classify(world: Container, case_type: CaseType) -> None:
    async with world.uow() as uow:
        case = await uow.cases.get(CASE)
        assert case is not None
        version = case.version
    await world.use_cases.cases.change_type.execute(
        actor_for(ANALYST),
        CASE,
        ChangeCaseTypeCommand(case_type=case_type, expected_version=version),
    )


async def close(world: Container, reason: CloseReason = CloseReason.RESOLVED) -> None:
    await world.use_cases.cases.close.execute(actor_for(ANALYST), CASE, CloseCaseCommand(reason))


def asked(world: Container) -> CopilotQueryAsked:
    return CopilotQueryAsked(
        occurred_at=world.clock.now(),
        actor=ActorRef(ActorRole.ANALYST, DANIELA),
        entity_id="CTH-" + "0" * 25 + "1",
        case_id=CASE,
        question_id="Q-1",
        question_length=12,
    )


async def test_the_seed_tells_the_story_of_every_type(world: Container) -> None:
    view = await world.use_cases.maturity.stages.execute(actor_for(SUPERVISOR))
    assert view.available
    by_type = {t.maturity.case_type: t.maturity for t in view.types}
    assert list(by_type) == [t for t in CaseType if t is not CaseType.NONE]
    assert {t: (int(m.stage), m.agent.value) for t, m in by_type.items()} == {
        CaseType.UNRECOGNIZED_CHARGE: (3, "active"),
        CaseType.UNDUE_CHARGE: (3, "ready"),
        CaseType.APP_ISSUE: (2, "none"),
        CaseType.BRANCH_SERVICE: (1, "none"),
        CaseType.SERVICE_QUALITY: (1, "none"),
        CaseType.VIRTUAL_CARD: (0, "none"),
    }
    undue = by_type[CaseType.UNDUE_CHARGE]
    assert (undue.signals.drafts_as_is, len(undue.signals.recent_drafts)) == (84, 100)
    assert sorted(undue.stage_since) == [1, 2, 3]
    assert by_type[CaseType.VIRTUAL_CARD].copilot_mode is None
    assert by_type[CaseType.SERVICE_QUALITY].copilot_mode is CopilotMode.ANSWER
    agent = next(t for t in view.types if t.maturity.case_type is CaseType.UNRECOGNIZED_CHARGE)
    assert agent.changed_by_name == SUPERVISOR.name  # Lucía activated it


async def test_a_closed_case_with_questions_moves_its_type_up(world: Container) -> None:
    await classify(world, CaseType.SERVICE_QUALITY)  # seeded: 7 cases with questions
    await emit(world.uow, asked(world))
    await close(world)
    m = await maturity(world, CaseType.SERVICE_QUALITY)
    assert m is not None
    assert m.stage is MaturityStage.PROPOSES_TOOLS  # 8 with the rule of this world
    assert m.signals.closed_cases == 0  # earned: the next stage starts from zero
    assert m.last_change is StageChange.ADVANCED
    async with world.uow() as uow:
        rows = await uow.event_log.search(
            AuditFilters(event_types=frozenset({"ai.stage_advanced"})), before=None, limit=50
        )
    newest = rows[0]
    assert (newest.entity, newest.entity_id, newest.actor_role) == (
        "case_type",
        "service_quality",
        "system",
    )
    assert newest.payload == {"case_type": "service_quality", "from_stage": 1, "to_stage": 2}


async def test_a_case_without_a_type_counts_for_nothing(world: Container) -> None:
    await close(world)
    async with world.uow() as uow:
        assert await uow.case_type_maturity.get(CaseType.NONE) is None


async def test_resolved_cases_count_only_with_the_reason_resolved(world: Container) -> None:
    await classify(world, CaseType.VIRTUAL_CARD)  # seeded: 2 resolved
    await close(world, CloseReason.CUSTOMER_UNRESPONSIVE)
    m = await maturity(world, CaseType.VIRTUAL_CARD)
    assert m is not None
    assert (m.stage, m.signals.closed_cases, m.signals.resolved_cases) == (0, 3, 2)


async def test_the_case_facts_come_from_the_event_log(world: Container) -> None:
    now = world.clock.now()
    ready = CopilotSuggestionReady(
        occurred_at=now,
        actor=ActorRef.system(),
        entity_id="CPS-" + "0" * 25 + "1",
        case_id=CASE,
        analyst_id=DANIELA,
        agent="copiloto-sugerencias@prod",
        kinds=("reply", "tool"),
        count=2,
        truncated=False,
        run_id=None,
        trace_id="t",
    )
    async with world.uow() as uow:
        before = await case_copilot_facts(uow, CASE)
    assert (before.asked, before.tools_proposed, before.tool_used) == (False, False, False)
    used = CopilotToolUsed(
        occurred_at=now,
        actor=ActorRef(ActorRole.ANALYST, DANIELA),
        entity_id=ready.entity_id,
        case_id=CASE,
        tool="leer_movimientos@1",
    )
    await emit(world.uow, ready, used, asked(world))
    async with world.uow() as uow:
        after = await case_copilot_facts(uow, CASE)
    assert (after.asked, after.tools_proposed, after.tool_used) == (True, True, True)


async def test_decided_drafts_fill_the_window(world: Container) -> None:
    await classify(world, CaseType.APP_ISSUE)
    async with world.uow() as uow:  # drafts are a stage 3 signal: put the type there
        stored = await uow.case_type_maturity.get(CaseType.APP_ISSUE)
        assert stored is not None
        stored.stage = MaturityStage.SHADOWS
        await uow.case_type_maturity.save(stored)
        await uow.commit()

    def decided(decision: str, distance: int | None = None) -> CopilotSuggestionDecided:
        return CopilotSuggestionDecided(
            occurred_at=world.clock.now(),
            actor=ActorRef(ActorRole.ANALYST, DANIELA),
            entity_id="CPS-" + "0" * 25 + "2",
            case_id=CASE,
            subject="reply",
            decision=decision,
            edit_distance_permille=distance,
        )

    await emit(
        world.uow,
        decided("used", 0),
        decided("edited", 40),
        decided("edited", 600),
        decided("discarded"),
        decided("ignored"),
    )
    after = await maturity(world, CaseType.APP_ISSUE)
    assert after is not None
    assert after.signals.recent_drafts == "aaed"


async def test_supervision_moves_a_type_back(world: Container) -> None:
    lucia = actor_for(SUPERVISOR)
    result = await world.use_cases.maturity.move_back.execute(lucia, "undue_charge", to_stage=3)
    assert result.changed
    assert result.type.maturity.agent is AgentStatus.NONE  # the proposal withdrawn
    assert result.type.changed_by_name == SUPERVISOR.name
    again = await world.use_cases.maturity.move_back.execute(lucia, "undue_charge", to_stage=3)
    assert not again.changed
    with pytest.raises(InvalidTransitionError):
        await world.use_cases.maturity.move_back.execute(lucia, "unrecognized_charge", to_stage=1)
    with pytest.raises(InvalidTransitionError):
        await world.use_cases.maturity.move_back.execute(lucia, "virtual_card", to_stage=1)
    for unknown in ("none", "nope"):
        with pytest.raises(NotFoundError):
            await world.use_cases.maturity.move_back.execute(lucia, unknown, to_stage=0)


async def stored_suggestion(world: Container, tools: tuple[str, ...]) -> str:
    suggestion = CopilotSuggestion.request(
        suggestion_id="CPS-" + "0" * 25 + "7",
        case_id=CASE,
        analyst_id=DANIELA,
        agent="copiloto-sugerencias@prod",
        trigger=SuggestionTrigger.MANUAL,
        based_on_sequence=1,
        request_key=None,
        at=world.clock.now(),
    )
    suggestion.record_answer(
        raw=[ToolSuggestion(tool=t, label=t) for t in tools],
        run_id=None,
        trace_id="t",
        at=world.clock.now(),
    )
    async with world.uow() as uow:
        await uow.copilot_suggestions.add(suggestion)
        await uow.commit()
    return suggestion.id


async def test_the_analyst_records_a_tool_she_used(world: Container) -> None:
    suggestion_id = await stored_suggestion(world, ("leer_movimientos@1",))
    tool_used = world.use_cases.maturity.tool_used
    await tool_used.execute(actor_for(ANALYST), CASE, suggestion_id, tool="leer_movimientos@1")
    async with world.uow() as uow:
        facts = await case_copilot_facts(uow, CASE)
    assert facts.tool_used
    assert facts.tools_proposed
    with pytest.raises(NotFoundError):
        await tool_used.execute(actor_for(ANALYST), CASE, suggestion_id, tool="otra@1")
    with pytest.raises(NotFoundError):
        await tool_used.execute(actor_for(ANALYST), CASE, "CPS-" + "9" * 26, tool="x@1")


async def test_ai_off_hides_the_stages_and_refuses_the_writes(world: Container) -> None:
    await world.use_cases.platform.set_ai_enabled.execute(actor_for(ADMIN_ONLY), False)
    view = await world.use_cases.maturity.stages.execute(actor_for(ANALYST))
    assert (view.available, view.types) == (False, ())
    with pytest.raises(AssistantDisabledError):
        await world.use_cases.maturity.move_back.execute(
            actor_for(SUPERVISOR), "app_issue", to_stage=1
        )
    await classify(world, CaseType.SERVICE_QUALITY)
    await emit(world.uow, asked(world))
    await close(world)  # nothing counts while AI is off
    m = await maturity(world, CaseType.SERVICE_QUALITY)
    assert m is not None
    assert (m.stage, m.signals.asked_cases) == (MaturityStage.ANALYST_ASKS, 7)


async def test_automatic_suggestions_wait_for_stage_two(world: Container) -> None:
    seen: list[str] = []

    async def subscriber(record: EventRecord) -> None:
        seen.append(record.event_id)

    gate = WhileTypeProposes(world.uow, subscriber)

    def record(n: int) -> EventRecord:
        event = TurnCreated.__new__(TurnCreated)  # only ``case_id`` is read
        object.__setattr__(event, "case_id", CASE)
        return EventRecord(event_id=f"EVT-{n}", event=event, ingested_at=world.clock.now())

    await gate(record(1))  # untyped: stage 0
    await classify(world, CaseType.SERVICE_QUALITY)
    await gate(record(2))  # stage 1: answers only
    await classify(world, CaseType.APP_ISSUE)
    await gate(record(3))  # stage 2: proposes
    await classify(world, CaseType.UNDUE_CHARGE)
    await gate(record(4))  # stage 3
    assert seen == ["EVT-3", "EVT-4"]
