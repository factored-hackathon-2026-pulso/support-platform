"""Assignment (contract §3): ``LanguageLeastLoadedStrategy``, ``AssignCase`` in the open's Unit
of Work, the queue and its drain (``DrainQueue`` + ``QueueDrainer``)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from cc_platform.application.cases.assignment import (
    AnalystCandidate,
    AssignmentRequest,
    LanguageLeastLoadedStrategy,
    QueueDrainer,
    RepositoryAnalystDirectory,
)
from cc_platform.application.cases.dto import PostTurnCommand
from cc_platform.application.events import EventRecord
from cc_platform.bootstrap.container import Container
from cc_platform.domain.cases import AssignmentReason, CaseStatus, TurnKind
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.events import StaffAvailabilityChanged
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import (
    ANALYST,
    SEBASTIAN,
    TOMAS,
    actor_for,
    customer_actor,
    memory_container,
)

ES, PT = Language.SPANISH, Language.PORTUGUESE
T = datetime(2026, 10, 2, 14, tzinfo=UTC)
CASE = "CASE-" + "0" * 25 + "1"
GABRIELA_QUEUED = seed_case_id(109)


def candidate(
    number: int, *languages: Language, load: int = 0, last: datetime | None = None
) -> AnalystCandidate:
    return AnalystCandidate(
        staff_id=seed_staff_id(number),
        name=f"Analista {number}",
        languages=frozenset(languages),
        open_case_count=load,
        last_assigned_at=last,
    )


def choose(language: Language, *candidates: AnalystCandidate) -> str | None:
    choice = LanguageLeastLoadedStrategy().choose(AssignmentRequest(CASE, language), candidates)
    return choice.candidate.staff_id if choice else None


def message(text: str = "Hola") -> PostTurnCommand:
    return PostTurnCommand(text=text, client_message_id=str(uuid.uuid4()))


async def set_availability(container: Container, number: int, status: AvailabilityStatus) -> None:
    seed = next(s for s in (ANALYST, SEBASTIAN, TOMAS) if s.number == number)
    await container.use_cases.people.set_availability.execute(actor_for(seed), status)


# ----------------------------------------------------------------------------- strategy
def test_portuguese_goes_only_to_a_portuguese_speaker_rule_3() -> None:
    strategy = LanguageLeastLoadedStrategy()
    spanish_idle = candidate(2, ES, load=0)
    bilingual_busy = candidate(1, ES, PT, load=7)
    choice = strategy.choose(AssignmentRequest(CASE, PT), [spanish_idle, bilingual_busy])
    assert choice is not None
    assert choice.candidate.staff_id == seed_staff_id(1)
    assert choice.policy_rule_id == "H1"
    assert choice.strategy == "language_least_loaded@1"
    spanish = strategy.choose(AssignmentRequest(CASE, ES), [spanish_idle])
    assert spanish is not None
    assert spanish.policy_rule_id is None  # a Spanish case carries no rule id


def test_nobody_who_speaks_the_language_means_queue() -> None:
    assert choose(PT, candidate(2, ES), candidate(3, ES)) is None
    assert choose(ES) is None  # nobody available at all


def test_least_loaded_then_longest_idle_then_staff_id() -> None:
    assert choose(ES, candidate(1, ES, load=3), candidate(2, ES, load=1)) == seed_staff_id(2)
    recent = candidate(1, ES, load=1, last=T)
    earlier = candidate(2, ES, load=1, last=T - timedelta(hours=1))
    assert choose(ES, recent, earlier) == seed_staff_id(2)
    never = candidate(3, ES, load=1, last=None)
    assert choose(ES, recent, earlier, never) == seed_staff_id(3)
    assert choose(ES, candidate(4, ES), candidate(3, ES)) == seed_staff_id(3)


async def test_directory_lists_only_available_analysts_with_their_open_load() -> None:
    container = await memory_container()  # Daniela available (5 open cases), others paused
    async with container.uow() as uow:
        candidates = await RepositoryAnalystDirectory().candidates(uow)
    assert [(c.name, c.open_case_count) for c in candidates] == [("Daniela Ríos", 5)]
    assert candidates[0].languages == frozenset({ES, PT})
    assert candidates[0].last_assigned_at is not None
    await set_availability(container, ANALYST.number, AvailabilityStatus.PAUSED)
    async with container.uow() as uow:
        assert await RepositoryAnalystDirectory().candidates(uow) == []  # paused: excluded


# ----------------------------------------------------------------------------- AssignCase
async def test_assign_case_runs_in_the_opens_unit_of_work() -> None:
    container = await memory_container()
    result = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(2004), message("Olá, não reconheço uma compra")
    )
    # No background job: the POST answer already says who attends.
    assert result.conversation.status.value == "with_agent"
    assert result.conversation.agent_name == "Daniela"
    assert container.background.pending == 0
    async with container.uow() as uow:
        case = await uow.cases.get(result.conversation.case_id)
        assert case is not None
        assignment = await uow.assignments.latest_for_case(case.id)
        turns = await uow.turns.page(case.id, limit=10)
        events = (await uow.event_log.page(case_id=case.id)).items
    assert case.status is CaseStatus.ASSIGNED
    assert assignment is not None
    assert (assignment.reason, assignment.policy_rule_id, assignment.waited_seconds) == (
        AssignmentReason.LANGUAGE_LEAST_LOADED,
        "H1",
        None,
    )
    assert [t.kind for t in turns] == [TurnKind.MESSAGE, TurnKind.NOTICE, TurnKind.ROUTING]
    assert turns[2].text == (
        "Asignado a Daniela Ríos porque está disponible y habla portugués (regla 3)."
    )
    assert [e.event_type for e in events] == [
        "case.opened",
        "turn.created",
        "turn.created",
        "case.assigned",
        "turn.created",
    ]


async def test_nobody_eligible_queues_once_with_the_banner() -> None:
    container = await memory_container()
    await set_availability(container, ANALYST.number, AvailabilityStatus.PAUSED)
    result = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(2001), message()
    )
    assert result.conversation.status.value == "waiting_agent"
    case_id = result.conversation.case_id
    # A drain that still finds nobody changes nothing (no second case.queued, no banner).
    assert await container.drain_queue.execute() == 0
    async with container.uow() as uow:
        case = await uow.cases.get(case_id)
        turns = await uow.turns.page(case_id, limit=10)
        events = [e.event_type for e in (await uow.event_log.page(case_id=case_id)).items]
    assert case is not None
    assert (case.status, case.queue_label) == (CaseStatus.QUEUED, "Cola en español")
    assert turns[-1].text == (
        "No hay personas disponibles que hablen español: el caso espera en la cola en español."
    )
    assert events.count("case.queued") == 1
    assert len(turns) == 3


async def test_queue_drains_oldest_first_with_the_wait() -> None:
    clock = FixedClock()
    container = await memory_container(clock=clock)
    await set_availability(container, ANALYST.number, AvailabilityStatus.PAUSED)
    rafael = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(2004), message("Olá")
    )
    clock.advance(timedelta(minutes=2, seconds=10))
    # Daniela back → the drainer spawns DrainQueue: the seeded 109 (oldest) then Rafael.
    await set_availability(container, ANALYST.number, AvailabilityStatus.AVAILABLE)
    await container.background.drain()
    async with container.uow() as uow:
        gabriela = await uow.cases.get(GABRIELA_QUEUED)
        mine = await uow.cases.get(rafael.conversation.case_id)
        first = await uow.assignments.latest_for_case(GABRIELA_QUEUED)
        second = await uow.assignments.latest_for_case(rafael.conversation.case_id)
        banner = (await uow.turns.page(rafael.conversation.case_id, limit=10))[-1]
    assert gabriela is not None
    assert mine is not None
    assert {gabriela.status, mine.status} == {CaseStatus.ASSIGNED}
    assert first is not None
    assert second is not None
    assert first.reason is AssignmentReason.QUEUE_DRAINED
    assert first.assigned_at == second.assigned_at
    assert first.id < second.id  # oldest opened_at first
    assert second.waited_seconds == 130
    assert first.waited_seconds == 6 * 60 + 130  # seeded 6 min before T
    assert banner.text == "Asignado a Daniela Ríos después de 3 min en la cola en portugués."
    detail = await container.use_cases.cases.detail.execute(
        actor_for(ANALYST), rafael.conversation.case_id
    )
    assert detail.assignment is not None
    assert (detail.assignment.queue_label, detail.assignment.waited_seconds) == (
        "Cola en portugués",
        130,
    )


async def test_least_loaded_bilingual_analyst_gets_the_queued_portuguese_case() -> None:
    container = await memory_container()
    await set_availability(container, TOMAS.number, AvailabilityStatus.AVAILABLE)
    await container.background.drain()
    async with container.uow() as uow:
        gabriela = await uow.cases.get(GABRIELA_QUEUED)
    assert gabriela is not None
    assert gabriela.assigned_analyst_id == seed_staff_id(TOMAS.number)  # 0 cases vs Daniela's 5


async def test_queue_drainer_reacts_only_to_becoming_available() -> None:
    spawned: list[str] = []

    class Tasks:
        def spawn(self, name: str, job: object) -> None:
            spawned.append(name)

    container = await memory_container(seed=False)
    drainer = QueueDrainer(Tasks(), container.drain_queue)  # type: ignore[arg-type]

    def record(to_status: str) -> EventRecord:
        event = StaffAvailabilityChanged(
            occurred_at=T,
            actor=ActorRef(ActorRole.ANALYST, seed_staff_id(1)),
            entity_id=seed_staff_id(1),
            from_status="paused" if to_status == "available" else "available",
            to_status=to_status,
        )
        return EventRecord(event_id="EVT-" + "0" * 25 + "1", event=event, ingested_at=T)

    await drainer(record("paused"))
    assert spawned == []
    await drainer(record("available"))
    assert spawned == ["drain_queue"]
