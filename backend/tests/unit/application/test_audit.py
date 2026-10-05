"""Audit (slice 3 contract §5): the catalog, the PII policy, every filter and the cursor
pagination, on both persistence adapters."""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest

import cc_platform
from cc_platform.application.audit.catalog import (
    CHANGES_STATE,
    FAMILY,
    AuditFamily,
    AuditNames,
    describe,
    fallback_description,
    family_of,
)
from cc_platform.application.audit.queries import (
    AuditActorKind,
    AuditEventView,
    AuditQuery,
    GetAuditEvent,
    ListAuditEvents,
    redact,
)
from cc_platform.application.cases.dto import CloseCaseCommand, PostTurnCommand
from cc_platform.application.cases.escalations import EscalateCommand
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.errors import InvalidCredentialsError
from cc_platform.application.events import StoredEvent
from cc_platform.application.people.admin.dto import CreateUserCommand, UpdateUserCommand
from cc_platform.application.people.dto import LoginCommand, VerifyMfaCommand
from cc_platform.application.people.onboarding.dto import SetPasswordCommand
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.events import (
    ASSISTANT_EVENTS,
    BUILDER_EVENTS,
    COPILOT_EVENTS,
    BuilderProposalCreated,
)
from cc_platform.domain.cases import CloseReason
from cc_platform.domain.people.availability import AvailabilityStatus
from cc_platform.domain.people.errors import AccountLockedError
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.events import DomainEvent
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.events.in_process_bus import InProcessEventBus
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.persistence.memory.store import InMemoryStore
from cc_platform.infrastructure.persistence.memory.unit_of_work import InMemoryUnitOfWork
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.persistence.sqlalchemy.unit_of_work import SqlAlchemyUnitOfWork
from cc_platform.infrastructure.seed.cases import (
    seed_case_id,
    seed_demo_cases,
    seed_escalation_id,
)
from cc_platform.infrastructure.seed.customers import seed_customer_id, seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    seed_demo_admin_story,
    seed_demo_availability,
    seed_demo_sessions,
    seed_demo_staff,
    seed_staff_id,
    seed_team_id,
)
from tests.support import (
    ADMIN_ONLY,
    ANALYST,
    PASSWORD,
    SEBASTIAN,
    SUPERVISOR,
    TEAM_LEAD,
    PlainHasher,
    activate_invited,
    actor_for,
    latest_link,
    make_available_quietly,
    memory_container,
)

DANIELA_ID, JULIAN_ID, LUCIA_ID = seed_staff_id(1), seed_staff_id(2), seed_staff_id(5)
T = datetime(2026, 10, 2, 14, tzinfo=UTC)  # FixedClock's start


@dataclass(frozen=True, kw_only=True, slots=True)
class _Unknown(DomainEvent):
    """An event type the catalog does not name (family ``other``)."""

    event_type = "test.unknown"
    entity = "case"


def stored(
    event_type: str, payload: dict[str, object], *, case_id: str | None = None
) -> StoredEvent:
    return StoredEvent(
        sequence=1,
        event_id="EVT-" + "0" * 25 + "1",
        event_type=event_type,
        entity="case",
        entity_id=case_id or "x",
        case_id=case_id,
        actor_role="system",
        actor_id="cc-platform",
        event_time=T,
        ingested_at=T,
        payload=payload,  # type: ignore[arg-type]
    )


# ----------------------------------------------------------------------------- catalog
def test_every_platform_event_type_is_in_the_catalog() -> None:
    for module in pkgutil.walk_packages(cc_platform.__path__, prefix="cc_platform."):
        if ".scripts." not in module.name:
            importlib.import_module(module.name)
    pending, types = [DomainEvent], set()
    while pending:
        for sub in pending.pop().__subclasses__():
            pending.append(sub)
            if sub.__module__.startswith("cc_platform."):
                types.add(sub.event_type)
    assert types == set(FAMILY)
    assert set(FAMILY) >= CHANGES_STATE
    for event_type in types:
        assert describe(stored(event_type, {}), AuditNames()) != fallback_description(event_type)


def test_a_priority_change_names_the_new_level() -> None:
    """Slice 8: the log shows the actor next to it ("Daniela Ríos · Cambió la prioridad a
    Alta"); the family is the case's lifecycle and it changes something."""
    names = AuditNames()
    expected = {
        "low": "Cambió la prioridad a Baja",
        "medium": "Cambió la prioridad a Media",
        "high": "Cambió la prioridad a Alta",
        "critical": "Cambió la prioridad a Crítica",
        "none": "Quitó la prioridad",
    }
    for to, text in expected.items():
        event = stored("case.priority_changed", {"from": "medium", "to": to})
        assert describe(event, names) == text
    assert describe(stored("case.priority_changed", {}), names) == "Cambió la prioridad"
    assert family_of("case.priority_changed") is AuditFamily.LIFECYCLE
    assert "case.priority_changed" in CHANGES_STATE


async def emit_everything(container: Container) -> None:
    """Drive every kind of event the platform emits through the real use cases."""
    people, cases = container.use_cases.people, container.use_cases.cases
    await make_available_quietly(container.uow, DANIELA_ID)  # the reassignment target
    for _ in range(4):  # Paula: 4 wrong passwords, then the 5th locks the account
        with pytest.raises(InvalidCredentialsError):
            await people.login.execute(
                LoginCommand(email="paula.medina@latambank.example", password="x")
            )
    with pytest.raises(AccountLockedError):
        await people.login.execute(
            LoginCommand(email="paula.medina@latambank.example", password="x")
        )
    login = await people.login.execute(LoginCommand(email=SEBASTIAN.email, password=PASSWORD))
    with pytest.raises(Exception):  # noqa: B017, PT011 - wrong MFA code (mfa_invalid)
        await people.verify_mfa.execute(
            VerifyMfaCommand(challenge_id=login.challenge_id, code="111111")
        )
    grant = await people.verify_mfa.execute(
        VerifyMfaCommand(challenge_id=login.challenge_id, code="000000")
    )
    await people.logout.execute(await people.authenticate.execute(grant.token))
    await container.use_cases.customers.start_session.execute(seed_customer_id(2001), None)
    lucia, daniela = actor_for(SUPERVISOR), actor_for(ANALYST)
    await cases.detail.execute(lucia, seed_case_id(101))  # case.viewed
    await cases.set_assignee.execute(
        lucia,
        seed_case_id(109),
        SetAssigneeCommand(seed_staff_id(4), None, confirm_paused=True),
    )
    await cases.set_assignee.execute(
        lucia, seed_case_id(113), SetAssigneeCommand(DANIELA_ID, JULIAN_ID)
    )
    await cases.post_analyst_turn.execute(
        daniela,
        seed_case_id(102),
        PostTurnCommand(text="Hola, Beatriz", client_message_id="c-0001aa"),
    )
    # Slice 9: every escalation outcome (the seed opened, answered and reassigned some).
    await cases.acknowledge_escalation.execute(daniela, seed_case_id(107), seed_escalation_id(107))
    await cases.withdraw_escalation.execute(daniela, seed_case_id(101), seed_escalation_id(101))
    taken = await cases.escalate.execute(
        daniela, seed_case_id(108), EscalateCommand("Pide hablar con supervisión.", "esc-key-01")
    )
    await cases.take_escalated_case.execute(actor_for(TEAM_LEAD), taken.escalation.id)
    await cases.escalate.execute(
        daniela, seed_case_id(102), EscalateCommand("No sé cómo seguir.", "esc-key-02")
    )
    await cases.close.execute(daniela, seed_case_id(102), CloseCaseCommand(CloseReason.RESOLVED))
    await cases.close.execute(daniela, seed_case_id(107), CloseCaseCommand(CloseReason.DUPLICATE))
    await people.set_availability.execute(daniela, AvailabilityStatus.PAUSED)
    await people.set_availability.execute(daniela, AvailabilityStatus.AVAILABLE)
    await container.background.drain()  # the drain assigns what is left in the queues
    await emit_administration(container)


async def emit_administration(container: Container) -> None:
    """Every administration event (slice 4 §2.4) through the real use cases."""
    admin = container.use_cases.administration
    valeria = actor_for(ADMIN_ONLY)
    team = await admin.create_team.execute(valeria, "Equipo Sur")
    created = await admin.create_user.execute(
        valeria,
        CreateUserCommand(
            name="Ana Gil",
            email="ana.gil@latambank.example",
            roles=(StaffRole.ANALYST,),
            languages=(Language.PORTUGUESE,),
            team_id=team.team.id,
        ),
    )
    ana = created.user
    # Part 4: a new link, then she activates her account (password + authenticator).
    await admin.resend_invitation.execute(valeria, ana.id)
    await activate_invited(container, "ana.gil@latambank.example")
    ana = await admin.get_user.execute(valeria, ana.id)
    changed = await admin.update_user.execute(
        valeria,
        ana.id,
        UpdateUserCommand(
            expected_version=ana.version,
            name="Ana María Gil",
            roles=(StaffRole.ANALYST, StaffRole.SUPERVISOR),
            languages=(Language.SPANISH, Language.PORTUGUESE),
            team_id=seed_team_id(1),
        ),
    )
    current = await admin.get_team.execute(valeria, team.team.id)  # moves in/out touched it
    renamed = await admin.rename_team.execute(
        valeria, team.team.id, current.team.version, "Equipo Austral"
    )
    deactivated = await admin.deactivate_team.execute(valeria, team.team.id, renamed.team.version)
    await admin.reactivate_team.execute(valeria, team.team.id, deactivated.team.version)
    await admin.unlock_user.execute(valeria, seed_staff_id(3))  # Paula, locked above
    await admin.reset_password.execute(valeria, ana.id)
    await container.use_cases.onboarding.complete_password_reset.execute(
        SetPasswordCommand(
            token=await latest_link(container, "ana.gil@latambank.example"),
            password="Nueva-Clave-del-Lago-27",
        ),
        client="test",
    )
    await admin.cancel_invitation.execute(valeria, seed_staff_id(15))  # Bruna (seeded)
    off = await admin.deactivate_user.execute(valeria, ana.id, changed.user.version)
    await admin.reactivate_user.execute(valeria, ana.id, off.user.version)


async def all_events(uow_factory: UnitOfWorkFactory) -> list[AuditEventView]:
    page = await ListAuditEvents(uow_factory).execute(AuditQuery(limit=100))
    items = list(page.items)
    while page.next_cursor:
        page = await ListAuditEvents(uow_factory).execute(
            AuditQuery(limit=100, cursor=page.next_cursor)
        )
        items.extend(page.items)
    return items


async def test_every_emitted_event_has_a_description() -> None:
    container = await memory_container()
    await emit_everything(container)
    events = await all_events(container.uow)
    emitted = {e.type for e in events}
    # The people-only seed tells no assistant story (ADR 0003); ``test_assistant.py`` emits
    # those events and checks that each one has a description; ``test_builder.py`` does the
    # same for the agent builder (slice 16).
    assistant_types = {
        "case.assistant_started",
        "case.assistant_released",
        *(event.event_type for event in (*ASSISTANT_EVENTS, *COPILOT_EVENTS, *BUILDER_EVENTS)),
    }
    assert emitted == set(FAMILY) - assistant_types
    assert not [e for e in events if e.description == fallback_description(e.type)]
    descriptions = {e.description for e in events}
    assert {
        "Reasignó el caso de Paula Medina a Julián Ortega",
        "Reasignó el caso de Julián Ortega a Daniela Ríos",
        "Asignó el caso a Sebastián Cárdenas desde la cola en portugués (Sebastián Cárdenas "
        "estaba en pausa)",
        "Asignó el caso a Daniela Ríos: estaba disponible y habla portugués (regla 3)",
        "Dejó el caso en la cola en español: nadie disponible habla español",
        "El caso volvió a «sin abrir» por la reasignación",
        "Abrió la conversación en modo supervisión (solo lectura)",
        "Volvió a escribir y abrió un caso nuevo por chat en la app",
        "Abrió un caso nuevo por chat web",
        "Cerró el caso · Duplicado",
        "El caso pasó a cerrado",
        "Abrió el caso por primera vez",
        "Primera respuesta en 9 min · SLA cumplido",  # Marcela (101), seeded
        "Pasó a En pausa",
        "Pasó a Disponible",
        "Abrió el chat (app)",
        "Ingresó la contraseña correcta",
        "Se le pidió el código de verificación",
        "Intento de ingreso fallido (contraseña) · quedan 4",
        "Código de verificación incorrecto · quedan 2",
        "La cuenta quedó bloqueada por 15 min tras 5 intentos",
        "Inició sesión",
        "Cerró sesión",
        "Escribió un mensaje",
        "Respondió al cliente",
        "La plataforma le envió un aviso al cliente",
        "Dejó una nota de asignación para el equipo",
        "Escaló el caso a supervisión",
        "Retiró el escalamiento",
        "Respondió el escalamiento",
        "Tomó el caso escalado de Daniela Ríos",
        "Reasignó el caso escalado de Julián Ortega a Daniela Ríos",
        "El escalamiento terminó porque se cerró el caso",
        "Leyó lo que hizo supervisión con su escalamiento",
    } <= descriptions
    assert any(
        d.startswith("Asignó el caso a Daniela Ríos desde la cola en español después de ")
        for d in descriptions
    )


def test_descriptions_without_a_live_flow() -> None:
    names = AuditNames(people={DANIELA_ID: "Daniela Ríos"})
    assert describe(stored("auth.session_ended", {"reason": "revoked"}), names) == (
        "Su sesión se revocó"
    )
    assert describe(stored("case.status_changed", {"reason": "other"}), names) == (
        "Cambió el estado del caso"
    )
    assert describe(stored("case.read", {"read_sequence": 7}), names) == (
        "Leyó la conversación hasta el mensaje 7"
    )
    drained = stored(
        "case.assigned",
        {
            "reason": "queue_drained",
            "assigned_analyst_id": DANIELA_ID,
            "waited_seconds": 61,
            "policy_rule_id": "H1",
        },
    )
    assert describe(drained, names) == (
        "Asignó el caso a Daniela Ríos desde la cola en portugués después de 2 min"
    )
    assert describe(stored("test.unknown", {}), names) == "Evento test.unknown"


def test_message_text_is_redacted() -> None:
    payload = {"sequence": 4, "kind": "message", "text": "mi número es 123", "author_id": "x"}
    redacted, fields = redact("turn.created", payload)
    assert fields == ("text",)
    assert "text" not in redacted
    assert redacted["text_length"] == len("mi número es 123")
    assert redacted["sequence"] == 4
    note = {"reason": "resolved", "note": "Nota interna"}
    assert redact("case.closed", note) == (note, ())  # internal staff note: kept


# ----------------------------------------------------------------------------- filters
@dataclass
class Harness:
    uow: UnitOfWorkFactory
    events: list[AuditEventView]


@pytest.fixture(params=["memory", "sqlite"])
async def harness(request: pytest.FixtureRequest) -> AsyncIterator[Harness]:
    clock, ids, bus = FixedClock(), SequentialIdGenerator(), InProcessEventBus()
    database: Database | None = None
    if request.param == "memory":
        store = InMemoryStore()

        def factory() -> UnitOfWork:
            return InMemoryUnitOfWork(store, bus=bus, ids=ids, clock=clock)

    else:
        database = Database("sqlite+aiosqlite:///:memory:")
        await database.create_schema()
        session_factory = database.session_factory

        def factory() -> UnitOfWork:
            return SqlAlchemyUnitOfWork(session_factory, bus=bus, ids=ids, clock=clock)

    await seed_demo_staff(factory, PlainHasher())
    await seed_demo_customers(factory)
    await seed_demo_sessions(factory, clock, ttl=timedelta(hours=8))
    await seed_demo_availability(factory, clock)
    await seed_demo_cases(factory, ids, clock)
    await seed_demo_admin_story(factory, clock)
    async with factory() as uow:  # an event type the catalog does not know
        uow.record(_Unknown(occurred_at=T, actor=ActorRef.system(), entity_id="x_100%"))
        await uow.commit()
    async with factory() as uow:  # slice 16: a supervisor started a proposal (family ``agents``)
        uow.record(
            BuilderProposalCreated(
                occurred_at=T,
                actor=ActorRef.system(),  # no staff actor: the person filters stay as they were
                entity_id="00000000-0000-7000-8000-000000000001",
                agent_id="disputas",
                origin="manual",
                base_release_id=None,
            )
        )
        await uow.commit()
    yield Harness(factory, await all_events(factory))
    if database is not None:
        await database.dispose()


async def search(h: Harness, **filters: object) -> list[AuditEventView]:
    """Every page of a filtered search (the seed has more than 100 events since slice 12)."""
    page = await ListAuditEvents(h.uow).execute(AuditQuery(limit=100, **filters))  # type: ignore[arg-type]
    items = list(page.items)
    while page.next_cursor:
        query = AuditQuery(limit=100, cursor=page.next_cursor, **filters)  # type: ignore[arg-type]
        page = await ListAuditEvents(h.uow).execute(query)
        items.extend(page.items)
    return items


def ids(events: list[AuditEventView]) -> list[str]:
    return [e.id for e in events]


async def test_the_log_is_newest_first_and_paginates_without_gaps(harness: Harness) -> None:
    every = harness.events
    assert len(every) > 100
    stamps = [int(e.id.removeprefix("EVT-")) for e in every]  # sequential ids = sequence order
    assert stamps == sorted(stamps, reverse=True)
    walked: list[str] = []
    cursor: str | None = None
    while True:
        page = await ListAuditEvents(harness.uow).execute(AuditQuery(limit=7, cursor=cursor))
        assert 0 < len(page.items) <= 7
        walked.extend(e.id for e in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break
    assert walked == ids(every)  # no gaps, no duplicates
    assert len(set(walked)) == len(walked)


async def test_filter_by_actor_kind_and_person(harness: Harness) -> None:
    every = harness.events
    staff = await search(harness, actor_kind=AuditActorKind.STAFF)
    customers = await search(harness, actor_kind=AuditActorKind.CUSTOMER)
    system = await search(harness, actor_kind=AuditActorKind.SYSTEM)
    assert {e.actor.role.value for e in staff} == {"analyst", "supervisor", "admin"}
    assert {e.actor.role.value for e in customers} == {"customer"}
    assert {e.actor.role.value for e in system} == {"system"}
    assert len(staff) + len(customers) + len(system) == len(every)
    lucia = await search(harness, actor_id=LUCIA_ID)
    assert [e.description for e in lucia] == [
        "Cambió el tipo de caso a Cobro indebido",  # Mauricio's queued case (slice 18)
        "Cambió la prioridad a Alta",  # Mauricio's queued case (slice 8)
        "Abrió la conversación en modo supervisión (solo lectura)",
        "Reasignó el caso escalado de Paula Medina a Julián Ortega",  # slice 9
        "Reasignó el caso de Paula Medina a Julián Ortega",
        "Respondió el escalamiento",  # Daniela's 107 (slice 9)
    ]
    assert {e.actor.name for e in lucia} == {"Lucía Herrera"}
    assert await search(harness, actor_id=LUCIA_ID, actor_kind=AuditActorKind.CUSTOMER) == []


async def test_filter_by_case_family_and_changes(harness: Harness) -> None:
    case = await search(harness, case_id=seed_case_id(114))
    assert {e.case_ref.id for e in case if e.case_ref} == {seed_case_id(114)}
    assert {e.case_ref.customer_name for e in case if e.case_ref} == {"Esteban Morales Quiroga"}
    # incl. Julián's case.priority_changed (slice 8), his case.type_changed (slice 18) and
    # Paula's escalation, its banner and its end by the reassignment (slice 9)
    assert len(case) == 17
    for family in AuditFamily:
        found = await search(harness, family=family)
        assert found, family
        assert {e.family for e in found} == {family}
    other = await search(harness, family=AuditFamily.OTHER)
    assert [(e.type, e.description) for e in other] == [("test.unknown", "Evento test.unknown")]
    changes = await search(harness, changes_only=True)
    assert changes
    assert all(e.changes_state for e in changes)
    assert {e.type for e in changes} <= CHANGES_STATE
    assignments = await search(harness, family=AuditFamily.ASSIGNMENT, changes_only=True)
    assert {e.type for e in assignments} == {"case.assigned", "case.queued"}
    assert await search(harness, family=AuditFamily.OTHER, changes_only=True) == []
    access = await search(harness, family=AuditFamily.ACCESS, case_id=seed_case_id(113))
    assert [e.type for e in access] == ["case.viewed"]


async def test_filter_by_time_bounds(harness: Harness) -> None:
    every = harness.events
    start = T - timedelta(minutes=12)
    end = T - timedelta(minutes=4)
    found = await search(harness, occurred_from=start, occurred_to=end)
    assert found
    assert all(start <= e.occurred_at < end for e in found)
    expected = [e.id for e in every if start <= e.occurred_at < end]
    assert ids(found) == expected
    at_start = [e for e in every if e.occurred_at == start]
    at_end = [e for e in every if e.occurred_at == end]
    assert at_start
    assert at_end  # the bounds are hit exactly: from inclusive, to exclusive
    assert set(ids(at_start)) <= set(ids(found))
    assert not set(ids(at_end)) & set(ids(found))
    with pytest.raises(InvalidValueError):
        await search(harness, occurred_from=end, occurred_to=end)
    with pytest.raises(InvalidValueError):
        await search(harness, occurred_from=end, occurred_to=start)


async def test_free_text_matches_ids_only(harness: Harness) -> None:
    every = harness.events
    one = every[10]
    assert ids(await search(harness, text=one.id.lower())) == [one.id]  # event id
    turn = next(e for e in every if e.type == "turn.created")
    assert turn.id in ids(await search(harness, text=turn.entity_id))  # entity id (turn)
    by_case = await search(harness, text=seed_case_id(114)[2:].lower())  # case id, contains
    assert {e.case_ref.id for e in by_case if e.case_ref} == {seed_case_id(114)}
    by_actor = await search(harness, text=LUCIA_ID.lower())  # actor id
    assert {e.actor.id for e in by_actor} == {LUCIA_ID}
    assert await search(harness, text="Lucía") == []  # names are not searched
    assert await search(harness, text="cobro") == []  # nor message text
    wildcard = await search(harness, text="_100%")  # LIKE wildcards are literal
    assert [e.type for e in wildcard] == ["test.unknown"]
    assert await search(harness, text="%") == list(wildcard)
    combined = await search(
        harness,
        text=seed_case_id(114)[2:],
        actor_kind=AuditActorKind.SYSTEM,
        family=AuditFamily.CONVERSATION,
    )
    assert combined
    assert {(e.actor.role.value, e.family) for e in combined} == {
        ("system", AuditFamily.CONVERSATION)
    }


async def test_rows_carry_names_case_refs_and_redaction(harness: Harness) -> None:
    every = harness.events
    message = next(e for e in every if e.type == "turn.created")
    assert message.redacted_fields == ("text",)
    assert "text" not in message.payload
    assert isinstance(message.payload["text_length"], int)
    system = next(e for e in every if e.actor.role.value == "system")
    assert system.actor.name is None
    customer = next(e for e in every if e.actor.role.value == "customer")
    assert customer.actor.name is not None
    assert customer.case_ref is not None
    assert customer.case_ref.customer_name == customer.actor.name
    session = next(e for e in every if e.type == "auth.session_started")
    assert (session.case_ref, session.actor.name, session.entity) == (
        None,
        "Julián Ortega",
        "staff_session",
    )


async def test_get_one_event_and_bad_cursors(harness: Harness) -> None:
    one = harness.events[3]
    assert await GetAuditEvent(harness.uow).execute(one.id) == one
    with pytest.raises(NotFoundError):
        await GetAuditEvent(harness.uow).execute("EVT-" + "9" * 26)
    for cursor in ("x", "0", "-1"):
        with pytest.raises(InvalidValueError):
            await ListAuditEvents(harness.uow).execute(AuditQuery(cursor=cursor))
