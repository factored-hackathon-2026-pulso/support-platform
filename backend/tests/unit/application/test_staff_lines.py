"""Slice 23c: staff-only transcript lines keep their facts next to the stored Spanish text,
so each viewer's UI writes them in her language (``application/cases/staff_lines.py``)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from cc_platform.application.audit.queries import redact
from cc_platform.application.cases import copy, staff_lines
from cc_platform.application.cases.manual_assignment import SetAssigneeCommand
from cc_platform.application.cases.realtime import turn_from_event
from cc_platform.domain.cases import StaffLine, StaffLineKind, TurnAudience, TurnKind
from cc_platform.domain.cases.events import TurnCreated
from cc_platform.domain.cases.values import CaseChannel, CloseReason, TurnAuthorRole
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import SUPERVISOR, actor_for, memory_container

CLOSED_AT = datetime(2026, 10, 1, 14, 5, tzinfo=UTC)


def test_every_builder_keeps_the_spanish_text_and_adds_its_facts() -> None:
    pt, es = Language.PORTUGUESE, Language.SPANISH
    cases = [
        (
            staff_lines.assigned_on_arrival("Daniela Ríos", pt),
            copy.assigned_on_arrival("Daniela Ríos", pt),
            StaffLineKind.ASSIGNED_ON_ARRIVAL,
            {"analyst": "Daniela Ríos", "language": "pt"},
        ),
        (
            staff_lines.assigned_from_assistant("Daniela Ríos", es),
            copy.assigned_from_assistant("Daniela Ríos", es),
            StaffLineKind.ASSIGNED_FROM_ASSISTANT,
            {"analyst": "Daniela Ríos", "language": "es"},
        ),
        (
            staff_lines.queued(es, "Cola en español"),
            copy.queued(es, "Cola en español"),
            StaffLineKind.QUEUED,
            {"language": "es"},
        ),
        (
            staff_lines.assigned_from_queue("Julián Ortega", 4, "Cola en portugués", pt),
            copy.assigned_from_queue("Julián Ortega", 4, "Cola en portugués"),
            StaffLineKind.ASSIGNED_FROM_QUEUE,
            {"analyst": "Julián Ortega", "minutes": 4, "language": "pt"},
        ),
        (
            staff_lines.wrote_again(
                "Patricia", CLOSED_AT, CloseReason.RESOLVED, CaseChannel.PHONE_INBOUND
            ),
            copy.wrote_again(
                "Patricia", CLOSED_AT, CloseReason.RESOLVED, CaseChannel.PHONE_INBOUND
            ),
            StaffLineKind.WROTE_AGAIN,
            {
                "customer": "Patricia",
                "closedAt": "2026-10-01T14:05:00Z",
                "closeReason": "resolved",
                "channel": "phone_inbound",
            },
        ),
        (
            staff_lines.manually_assigned_from_queue(
                "Lucía Herrera", "Tomás Arango", 3, "Cola en español", es, paused_first_name="Tomás"
            ),
            copy.manually_assigned_from_queue(
                "Lucía Herrera", "Tomás Arango", 3, "Cola en español", paused_first_name="Tomás"
            ),
            StaffLineKind.ASSIGNED_BY_SUPERVISION,
            {
                "supervisor": "Lucía Herrera",
                "analyst": "Tomás Arango",
                "minutes": 3,
                "language": "es",
                "paused": "Tomás",
            },
        ),
        (
            staff_lines.reassigned("Lucía Herrera", "Paula Medina", "Julián Ortega"),
            copy.reassigned("Lucía Herrera", "Paula Medina", "Julián Ortega"),
            StaffLineKind.REASSIGNED,
            {"supervisor": "Lucía Herrera", "previous": "Paula Medina", "analyst": "Julián Ortega"},
        ),
        (
            staff_lines.escalated("Daniela Ríos"),
            copy.escalated("Daniela Ríos"),
            StaffLineKind.ESCALATED,
            {"analyst": "Daniela Ríos"},
        ),
        (
            staff_lines.escalation_withdrawn("Daniela Ríos"),
            copy.escalation_withdrawn("Daniela Ríos"),
            StaffLineKind.ESCALATION_WITHDRAWN,
            {"analyst": "Daniela Ríos"},
        ),
        (
            staff_lines.escalation_answered("Lucía Herrera"),
            copy.escalation_answered("Lucía Herrera"),
            StaffLineKind.ESCALATION_ANSWERED,
            {"supervisor": "Lucía Herrera"},
        ),
        (
            staff_lines.escalation_taken("Felipe Echeverri", "Daniela Ríos"),
            copy.escalation_taken("Felipe Echeverri", "Daniela Ríos"),
            StaffLineKind.ESCALATION_TAKEN,
            {"supervisor": "Felipe Echeverri", "previous": "Daniela Ríos"},
        ),
        (
            staff_lines.assistant_released("escalated", ref="HND-1"),
            copy.assistant_released("escalated", ref="HND-1"),
            StaffLineKind.ASSISTANT_RELEASED,
            {"reason": "escalated", "ref": "HND-1"},
        ),
        (
            staff_lines.follow_up_call("Daniela Ríos", "Claudia"),
            copy.follow_up_call("Daniela Ríos", "Claudia"),
            StaffLineKind.FOLLOW_UP_CALL,
            {"analyst": "Daniela Ríos", "customer": "Claudia"},
        ),
    ]
    assert {kind for _, _, kind, _ in cases} == set(StaffLineKind)
    for banner, text, kind, params in cases:
        assert banner.text == text
        assert (banner.line.kind, dict(banner.line.params)) == (kind, params)


def test_stored_facts_are_read_leniently() -> None:
    line = StaffLine(StaffLineKind.ESCALATED, {"analyst": "Daniela Ríos"})
    assert StaffLine.from_json(line.to_json()) == line
    assert StaffLine.from_json(None) is None
    assert StaffLine.from_json({"kind": "unknown", "params": {}}) is None
    assert StaffLine.from_json({"kind": "escalated"}) is None
    kept = StaffLine.from_json({"kind": "escalated", "params": {"analyst": "A", "bad": [1]}})
    assert kept == StaffLine(StaffLineKind.ESCALATED, {"analyst": "A"})
    with pytest.raises(InvalidValueError):
        StaffLine(StaffLineKind.ESCALATED, {"analyst": True})


def test_the_event_carries_the_facts_to_the_socket_and_the_audit_hides_them() -> None:
    line = StaffLine(StaffLineKind.QUEUED, {"language": "pt"})
    event = TurnCreated(
        occurred_at=CLOSED_AT,
        actor=ActorRef.system(),
        entity_id="TRN-" + "0" * 26,
        case_id=seed_case_id(101),
        sequence=3,
        kind=TurnKind.ROUTING.value,
        audience=TurnAudience.STAFF.value,
        author_role=TurnAuthorRole.SYSTEM.value,
        author_id=None,
        text=copy.queued(Language.PORTUGUESE, "Cola en portugués"),
        language="pt",
        client_message_id=None,
        staff_line=line.to_json(),
    )
    assert turn_from_event(event).staff_line == line
    payload, fields = redact("turn.created", event.payload())
    assert fields == ("text", "staff_line")
    assert "staff_line" not in payload
    assert "staff_line_length" not in payload
    assert "staff_line" not in replace(event, staff_line=None).payload()


async def test_new_and_seeded_lines_have_facts() -> None:
    container = await memory_container()
    async with container.uow() as uow:
        seeded = await uow.turns.page(seed_case_id(101), limit=50)
    routing = [t for t in seeded if t.kind is TurnKind.ROUTING]
    assert routing
    assert all(t.staff_line is not None for t in routing)
    arrival = next(
        t.staff_line
        for t in routing
        if t.staff_line and t.staff_line.kind is StaffLineKind.ASSIGNED_ON_ARRIVAL
    )
    assert arrival is not None
    assert arrival.params["analyst"] == "Daniela Ríos"
    assert all(t.staff_line is None for t in seeded if t.kind is not TurnKind.ROUTING)

    lucia = actor_for(SUPERVISOR)
    await container.use_cases.cases.set_assignee.execute(
        lucia,
        seed_case_id(113),
        SetAssigneeCommand(seed_staff_id(1), seed_staff_id(2), confirm_paused=True),
    )
    async with container.uow() as uow:
        turns = await uow.turns.page(seed_case_id(113), limit=100)
    last = [t for t in turns if t.kind is TurnKind.ROUTING][-1]
    assert last.staff_line is not None
    assert last.staff_line.kind is StaffLineKind.REASSIGNED
    assert dict(last.staff_line.params) == {
        "supervisor": "Lucía Herrera",
        "previous": "Julián Ortega",
        "analyst": "Daniela Ríos",
        "paused": "Daniela",
    }
    assert last.text == (
        "Lucía Herrera pasó el caso de Julián Ortega a Daniela Ríos (Daniela estaba en pausa)."
    )
