"""The assistant (ADR 0003): a case opens in agent-core's hands, answers arrive as turns, and the
case goes to people when the agent escalates, ends, fails or the customer asks. Over the real
composition and both persistence adapters, with a scripted agent-core (no network)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest

from cc_platform.application.ai import (
    AgentConfirmation,
    AgentRuntimeError,
    AgentStepUp,
    AgentTurn,
)
from cc_platform.application.audit.catalog import AuditNames, describe, fallback_description
from cc_platform.application.cases.dto import (
    CloseCaseCommand,
    CustomerEmailCommand,
    RateConversationCommand,
)
from cc_platform.application.cases.errors import CaseNotAssignedError
from cc_platform.application.errors import ForbiddenError
from cc_platform.bootstrap.container import Container
from cc_platform.domain.ai.errors import (
    AssistantActiveError,
    AssistantNotActiveError,
    ConfirmationExpiredError,
    ConfirmationNotPendingError,
    HandoffUnavailableError,
    InvalidStepUpCodeError,
)
from cc_platform.domain.ai.session import AssistantState
from cc_platform.domain.cases import (
    AssignmentReason,
    CasePriority,
    CaseStatus,
    CloseReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import (
    BANK_ID,
    NATALIA,
    RAFAEL,
    XIMENA,
    assistant_world,
    customer_id,
    decode,
    escalation,
    last_credentials_payload,
    resolution,
    say,
    settle,
    turn,
)
from tests.support import (
    ANALYST,
    JULIAN,
    SUPERVISOR,
    actor_for,
    customer_actor,
    make_available_quietly,
)

DANIELA = seed_staff_id(ANALYST.number)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture(params=["memory", "sqlalchemy"])
async def world(
    request: pytest.FixtureRequest, tmp_path: Path, runtime: InMemoryAgentRuntime
) -> AsyncIterator[Container]:
    async for container in assistant_world(str(request.param), tmp_path, runtime):
        yield container


async def write(world: Container, number: int, text: str | None = None) -> str:
    """The customer writes; returns the case id."""
    result = await world.use_cases.cases.post_customer_turn.execute(
        customer_actor(number), say(text) if text else say()
    )
    return result.conversation.case_id


async def case_and_session(world: Container, case_id: str):  # type: ignore[no-untyped-def]
    async with world.uow() as uow:
        case = await uow.cases.get(case_id)
        session = await uow.assistant_sessions.get_by_case(case_id)
        turns = await uow.turns.page(case_id, limit=50)
    assert case is not None
    return case, session, turns


def post_turns(runtime: InMemoryAgentRuntime) -> list[dict[str, object]]:
    return [c.arguments for c in runtime.calls if c.operation == "post_turn"]


# ----------------------------------------------------------------------------- opening
async def test_a_linked_spanish_customer_opens_a_case_in_the_assistants_hands(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola Natalia, cuéntame qué pasó."))

    result = await world.use_cases.cases.post_customer_turn.execute(customer_actor(NATALIA), say())
    assert result.conversation.status.value == "with_assistant"
    assert result.conversation.agent_name == "Asistente virtual"
    await settle(world)
    case, session, turns = await case_and_session(world, result.conversation.case_id)

    assert case.status is CaseStatus.WITH_ASSISTANT
    assert case.assigned_analyst_id is None
    assert case.queued_at is None
    assert not case.queue_label
    assert case.first_response_at is None  # the assistant is never a first response
    assert session is not None
    assert session.is_active
    assert session.agent_session_id == "ses-1"
    assert session.processed_sequence == 1
    assert [t.author_role for t in turns] == [TurnAuthorRole.CUSTOMER, TurnAuthorRole.ASSISTANT]
    assert turns[1].author_id == "recepcion@1.0.0"
    assert turns[1].audience is TurnAudience.EVERYONE

    assert [c.operation for c in runtime.calls] == ["start_run", "post_turn"]
    assert runtime.calls[0].arguments["idempotency_key"] == session.id
    assert post_turns(runtime)[0]["client_turn_id"] == turns[0].id
    assert post_turns(runtime)[0]["text"] == turns[0].text
    principal = last_credentials_payload(runtime, "post_turn")
    assert (principal["type"], principal["id"]) == ("customer", BANK_ID[NATALIA])
    assert principal["auth"]["level"] == "session"  # type: ignore[index]


async def test_the_customer_view_shows_the_assistants_answer_and_no_internal_ids(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola, ¿qué cargo no reconoces?"))
    await write(world, NATALIA)
    await settle(world)

    view = await world.use_cases.cases.customer_conversation.execute(customer_actor(NATALIA))

    assert view.conversation is not None
    assert view.conversation.assistant is not None
    assert view.conversation.assistant.working is False
    reply = view.turns[-1]
    assert (reply.author_role.value, reply.author_name) == ("assistant", "Asistente virtual")
    assert "recepcion" not in repr(view)  # the agent's id never reaches the customer


@pytest.mark.parametrize(("number", "why"), [(RAFAEL, "portuguese"), (2003, "not linked")])
async def test_portuguese_and_unlinked_customers_go_straight_to_people(
    world: Container, runtime: InMemoryAgentRuntime, number: int, why: str
) -> None:
    case_id = await write(world, number)
    await settle(world)

    case, session, _turns = await case_and_session(world, case_id)

    assert session is None, why
    assert case.status is CaseStatus.QUEUED  # nobody available: the language queue, as before
    assert runtime.calls == []


async def test_a_call_or_an_email_cannot_join_a_conversation_the_assistant_handles(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola"))
    await write(world, NATALIA)
    await settle(world)

    with pytest.raises(AssistantActiveError):
        await world.use_cases.channels.send_customer_email.execute(
            customer_actor(NATALIA),
            CustomerEmailCommand(subject="Mi cargo", body="Hola", client_message_id="email-1234"),
        )


# ----------------------------------------------------------------------------- escalation
async def test_an_escalation_places_the_case_like_an_arrival_rule_3(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation("hnd-7"))

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, turns = await case_and_session(world, case_id)

    assert case.status is CaseStatus.ASSIGNED
    assert case.assigned_analyst_id == DANIELA
    assert session is not None
    assert (session.state, session.handoff_ref) == (AssistantState.ESCALATED, "hnd-7")
    assert case.sla_due_at == world.clock.now() + timedelta(minutes=15)  # starts now, for people
    async with world.uow() as uow:
        assignment = await uow.assignments.latest_for_case(case_id)
    assert assignment is not None
    assert assignment.reason is AssignmentReason.ASSISTANT_HANDOFF
    public = [t.text for t in turns if t.audience is TurnAudience.EVERYONE]
    assert public == ["Hola, no reconozco un cargo", "Te paso con una persona del equipo."]
    banners = [t.text for t in turns if t.kind is TurnKind.ROUTING]
    assert banners[0] == "El asistente escaló el caso a una persona (traspaso hnd-7)."
    assert banners[1].startswith("Asignado a Daniela Ríos tras el traspaso del asistente")
    # the customer's message is waiting for the analyst (unread), the agent's reply is not
    assert case.unread_count == 1


async def test_an_escalation_takes_the_priority_the_agent_saw(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.handoffs["hnd-7"] = {"handoff_ref": "hnd-7", "priority": "critical"}
    runtime.script.append(escalation("hnd-7"))

    case_id = await write(world, NATALIA)
    await settle(world)
    case, _session, _turns = await case_and_session(world, case_id)

    assert case.priority is CasePriority.CRITICAL
    read = next(c for c in runtime.calls if c.operation == "get_handoff")
    assert read.credentials is not None
    assert decode(read.credentials.authorization)["type"] == "customer"  # not an analyst's


async def test_an_unknown_or_missing_priority_leaves_the_case_alone(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.handoffs["hnd-7"] = {"handoff_ref": "hnd-7", "priority": "whenever"}
    runtime.script.append(escalation("hnd-7"))

    case_id = await write(world, NATALIA)
    await settle(world)
    case, _session, _turns = await case_and_session(world, case_id)

    assert case.priority is CasePriority.NONE


async def test_an_escalation_with_nobody_available_waits_in_the_language_queue(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(escalation())

    case_id = await write(world, NATALIA)
    await settle(world)
    case, _session, _turns = await case_and_session(world, case_id)
    queues = await world.use_cases.cases.queue_overview.execute()

    assert case.status is CaseStatus.QUEUED
    assert case.is_waiting_in_queue
    assert case_id in {c.id for q in queues.queues for c in q.cases}


async def test_every_event_of_an_assistant_case_has_an_audit_description(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation())
    case_id = await write(world, NATALIA)
    await settle(world)

    async with world.uow() as uow:
        events = (await uow.event_log.page(case_id=case_id, limit=500)).items

    types = {e.event_type for e in events}
    assert {
        "case.assistant_started",
        "assistant.session_started",
        "assistant.turn_answered",
    } <= types
    assert {"case.assistant_released", "assistant.ended", "case.assigned"} <= types
    for event in events:
        assert describe(event, AuditNames()) != fallback_description(event.event_type)


# ----------------------------------------------------------------------------- failures
async def test_agent_core_down_hands_the_case_to_people_with_a_notice(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.unavailable = True

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, turns = await case_and_session(world, case_id)

    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert session.state is AssistantState.FAILED
    assert session.failure_code == "unavailable"
    texts = {t.text for t in turns}
    assert "Te paso con una persona del equipo para que siga con tu caso." in texts
    assert any("no pudo seguir atendiendo (unavailable)" in t.text for t in turns)


async def test_agent_core_refusing_hands_the_case_to_people_with_its_code(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(AgentRuntimeError(status=403, code="agent_forbidden"))

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, _turns = await case_and_session(world, case_id)

    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert session.failure_code == "agent_forbidden"


async def test_a_run_that_ends_without_resolving_goes_to_people(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    from cc_platform.application.ai import AgentAwaiting, AgentOutcome

    runtime.script.append(
        turn(
            "No pude ayudarte con eso.",
            awaiting=AgentAwaiting.NONE,
            status="closed",
            outcome=AgentOutcome.ABSTAINED,
        )
    )

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, _turns = await case_and_session(world, case_id)

    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert (session.state, session.failure_code) == (AssistantState.ENDED, "abstained")


# ----------------------------------------------------------------------------- resolving
async def test_a_resolved_conversation_closes_the_case_and_the_customer_can_rate_it(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([resolution(), turn("Hola de nuevo")])
    customer = customer_actor(NATALIA)

    case_id = await write(world, NATALIA)
    await settle(world)
    case, session, turns = await case_and_session(world, case_id)

    assert case.status is CaseStatus.CLOSED
    assert case.closure is not None
    assert case.closure.closed_by_role is ActorRole.ASSISTANT
    assert case.closure.reason is CloseReason.RESOLVED
    assert session is not None
    assert session.state is AssistantState.RESOLVED
    assert turns[-1].kind is TurnKind.NOTICE  # the "conversation ended" notice
    async with world.uow() as uow:
        slot = await uow.case_slots.get(customer_id(NATALIA))
    assert slot is not None
    assert slot.open_case_id is None

    rated = await world.use_cases.cases.rate_conversation.execute(
        customer,
        case_id,
        RateConversationCommand(score=4, comment=None, idempotency_key="rate-0001"),
    )
    assert rated.conversation.rating is not None

    again = await write(world, NATALIA)  # their next message opens a new, linked case
    await settle(world)
    newer, _session, _turns = await case_and_session(world, again)
    assert newer.previous_case_id == case_id
    assert newer.status is CaseStatus.WITH_ASSISTANT


# ----------------------------------------------------------------------------- confirmation
def confirmation_turn(world: Container, token: str = "tok-1", minutes: int = 5) -> AgentTurn:  # noqa: S107
    from cc_platform.application.ai import AgentAwaiting

    return turn(
        "Voy a radicar una disputa por 120 USD. ¿Confirmas?",
        awaiting=AgentAwaiting.CONFIRMATION,
        confirmation=AgentConfirmation(
            action_summary="Radicar una disputa por 120 USD",
            token=token,
            expires_at=world.clock.now() + timedelta(minutes=minutes),
        ),
    )


async def test_the_customer_confirms_and_the_assistant_carries_on(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([confirmation_turn(world), turn("Listo, radiqué tu disputa.")])
    customer = customer_actor(NATALIA)
    case_id = await write(world, NATALIA)
    await settle(world)

    pending = (await world.use_cases.cases.customer_conversation.execute(customer)).conversation
    assert pending is not None
    assert pending.assistant is not None
    assert pending.assistant.confirmation is not None
    assert pending.assistant.confirmation.token == "tok-1"
    assert pending.assistant.confirmation.summary == "Radicar una disputa por 120 USD"
    with pytest.raises(ConfirmationNotPendingError):
        await world.use_cases.assistant.confirm.execute(customer, token="other", answer="yes")  # type: ignore[union-attr]

    working = await world.use_cases.assistant.confirm.execute(customer, token="tok-1", answer="yes")  # type: ignore[union-attr]
    assert working.assistant is not None
    assert working.assistant.working is True
    assert working.assistant.confirmation is None
    await settle(world)

    sent = post_turns(runtime)[-1]
    assert (sent["confirm_token"], sent["confirm_answer"], sent["text"]) == ("tok-1", "yes", "")
    _case, session, turns = await case_and_session(world, case_id)
    assert session is not None
    assert session.confirmation is None
    assert [t.text for t in turns][-2:] == ["Confirmaste la acción.", "Listo, radiqué tu disputa."]
    with pytest.raises(ConfirmationNotPendingError):  # a token answers once
        await world.use_cases.assistant.confirm.execute(customer, token="tok-1", answer="yes")  # type: ignore[union-attr]


async def test_a_confirmation_without_a_message_is_still_in_the_transcript(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    ask = confirmation_turn(world)
    runtime.script.append(replace(ask, messages=()))  # agent-core sent only the confirmation
    case_id = await write(world, NATALIA)
    await settle(world)

    _case, _session, turns = await case_and_session(world, case_id)

    assert [t.text for t in turns][-1] == "Radicar una disputa por 120 USD"
    assert turns[-1].author_role is TurnAuthorRole.ASSISTANT


async def test_an_expired_confirmation_is_refused(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(confirmation_turn(world, minutes=5))
    await write(world, NATALIA)
    await settle(world)
    world.clock.advance(timedelta(minutes=6))  # type: ignore[attr-defined]

    with pytest.raises(ConfirmationExpiredError):
        await world.use_cases.assistant.confirm.execute(  # type: ignore[union-attr]
            customer_actor(NATALIA), token="tok-1", answer="yes"
        )


# ----------------------------------------------------------------------------- step-up
def step_up_turn() -> AgentTurn:
    from cc_platform.application.ai import AgentAwaiting

    return turn(
        "Necesito verificar tu identidad para seguir.",
        awaiting=AgentAwaiting.STEP_UP,
        step_up=AgentStepUp(required_level="step_up", reason="monto alto", simulated=True),
    )


async def test_the_second_factor_unblocks_the_input_with_an_elevated_credential(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([step_up_turn(), turn("Verificado. Sigo con tu disputa.")])
    customer = customer_actor(NATALIA)
    case_id = await write(world, NATALIA, "Quiero disputar el cargo de 640 dólares")
    await settle(world)
    pending = (await world.use_cases.cases.customer_conversation.execute(customer)).conversation
    assert pending is not None
    assert pending.assistant is not None
    assert pending.assistant.step_up is not None
    assert (pending.assistant.step_up.reason, pending.assistant.step_up.simulated) == (
        "monto alto",
        True,
    )
    first = post_turns(runtime)[0]

    with pytest.raises(InvalidStepUpCodeError) as wrong:
        await world.use_cases.assistant.verify_step_up.execute(customer, code="111111")  # type: ignore[union-attr]
    assert wrong.value.details["remainingAttempts"] == 2

    await world.use_cases.assistant.verify_step_up.execute(customer, code="000000")  # type: ignore[union-attr]
    await settle(world)

    assert len(post_turns(runtime)) == 2
    resent = post_turns(runtime)[1]
    assert resent["text"] == "Quiero disputar el cargo de 640 dólares"  # the same input again
    assert resent["client_turn_id"] == f"{first['client_turn_id']}.1"  # new id: not a dedupe hit
    level = last_credentials_payload(runtime, "post_turn")["auth"]
    assert (level["level"], level["simulated"]) == ("step_up", True)
    assert decode(runtime.calls[1].credentials.authorization)["auth"]["level"] == "session"  # type: ignore[union-attr]
    _case, session, _turns = await case_and_session(world, case_id)
    assert session is not None
    assert session.step_up is None
    assert session.blocked is None


async def test_three_wrong_codes_hand_the_case_to_people(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(step_up_turn())
    customer = customer_actor(NATALIA)
    case_id = await write(world, NATALIA)
    await settle(world)

    for expected in (2, 1, 0):
        with pytest.raises(InvalidStepUpCodeError) as wrong:
            await world.use_cases.assistant.verify_step_up.execute(customer, code="999999")  # type: ignore[union-attr]
        assert wrong.value.details["remainingAttempts"] == expected

    case, session, _turns = await case_and_session(world, case_id)
    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert session.failure_code == "step_up_failed"


# ----------------------------------------------------------------------------- handing over
async def test_the_customer_can_ask_for_a_person(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola"))
    customer = customer_actor(NATALIA)
    case_id = await write(world, NATALIA)
    await settle(world)

    view = await world.use_cases.assistant.request_person.execute(customer)  # type: ignore[union-attr]
    await settle(world)

    assert view.status.value == "waiting_agent"
    case, session, turns = await case_and_session(world, case_id)
    assert case.status is CaseStatus.QUEUED
    assert session is not None
    assert session.state is AssistantState.RELEASED
    assert any("pidió hablar con una persona" in t.text for t in turns)
    with pytest.raises(AssistantNotActiveError):  # people have it now
        await world.use_cases.assistant.request_person.execute(customer)  # type: ignore[union-attr]
    assert len(post_turns(runtime)) == 1  # nothing more went to the agent


async def test_supervision_can_take_a_case_from_the_assistant(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola"))
    case_id = await write(world, NATALIA)
    await settle(world)

    with pytest.raises(ForbiddenError):
        await world.use_cases.assistant.release.execute(actor_for(ANALYST), case_id)  # type: ignore[union-attr]
    summary = await world.use_cases.assistant.release.execute(actor_for(SUPERVISOR), case_id)  # type: ignore[union-attr]

    assert summary.status is CaseStatus.QUEUED
    _case, session, turns = await case_and_session(world, case_id)
    assert session is not None
    assert session.state is AssistantState.RELEASED
    assert any(t.text == "Lucía Herrera tomó el caso del asistente." for t in turns)
    with pytest.raises(AssistantNotActiveError):
        await world.use_cases.assistant.release.execute(actor_for(SUPERVISOR), case_id)  # type: ignore[union-attr]


async def test_supervision_sees_the_assistants_cases_in_colas(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.append(turn("Hola"))
    case_id = await write(world, NATALIA)
    await settle(world)

    colas = await world.use_cases.cases.language_open_cases.execute(Language.SPANISH)

    row = next(r for r in colas.cases if r.case.id == case_id)
    assert row.case.status is CaseStatus.WITH_ASSISTANT
    assert row.assignee_name is None
    queues = await world.use_cases.cases.queue_overview.execute()
    assert case_id not in {c.id for q in queues.queues for c in q.cases}  # not waiting for people
    waiting = await write(world, 2003)  # people's queue: nobody is available
    await settle(world)
    colas = await world.use_cases.cases.language_open_cases.execute(Language.SPANISH)
    ids = [r.case.id for r in colas.cases]
    assert ids.index(waiting) < ids.index(case_id)  # the assistant's cases come last


# ----------------------------------------------------------------------------- the analyst
async def test_the_assignee_reads_the_handoff_with_her_own_delegation(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation("hnd-7"))
    case_id = await write(world, NATALIA)
    await settle(world)

    packet = await world.use_cases.assistant.handoff.execute(actor_for(ANALYST), case_id)  # type: ignore[union-attr]

    assert packet == {"handoff_ref": "hnd-7"}
    call = runtime.calls[-1]
    assert call.operation == "get_handoff"
    assert call.credentials is not None
    assert call.credentials.on_behalf_of is not None
    principal, delegation = (
        decode(call.credentials.authorization),
        decode(call.credentials.on_behalf_of),
    )
    assert (principal["type"], principal["id"]) == ("advisor", DANIELA)
    assert delegation["grantee"] == {"type": "advisor", "id": DANIELA}
    assert delegation["subject"] == {"kind": "customer", "ref": BANK_ID[NATALIA]}
    with pytest.raises(CaseNotAssignedError):  # not hers
        await world.use_cases.assistant.handoff.execute(actor_for(JULIAN), case_id)  # type: ignore[union-attr]


async def test_a_case_that_never_came_from_the_assistant_has_no_handoff(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    case_id = await write(world, 2003)  # not linked: people from the start
    await settle(world)

    with pytest.raises(HandoffUnavailableError):
        await world.use_cases.assistant.handoff.execute(actor_for(ANALYST), case_id)  # type: ignore[union-attr]


async def test_closing_with_a_handoff_quality_tells_agent_core_once(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation("hnd-7"))
    case_id = await write(world, NATALIA)
    await settle(world)
    analyst = actor_for(ANALYST)

    with pytest.raises(InvalidValueError):
        await world.use_cases.cases.close.execute(
            analyst, case_id, CloseCaseCommand(reason=CloseReason.RESOLVED, handoff_quality="great")
        )
    await world.use_cases.cases.close.execute(
        analyst, case_id, CloseCaseCommand(reason=CloseReason.RESOLVED, handoff_quality="useful")
    )
    await settle(world)

    sent = [c for c in runtime.calls if c.operation == "record_resolution"]
    assert [c.arguments for c in sent] == [
        {"handoff_ref": "hnd-7", "resolution_code": "resolved", "handoff_quality": "useful"}
    ]
    _case, session, _turns = await case_and_session(world, case_id)
    assert session is not None
    assert session.handoff_resolved_at is not None


async def test_closing_without_a_label_sends_nothing(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    await make_available_quietly(world.uow, DANIELA)
    runtime.script.append(escalation("hnd-7"))
    case_id = await write(world, NATALIA)
    await settle(world)

    await world.use_cases.cases.close.execute(
        actor_for(ANALYST), case_id, CloseCaseCommand(reason=CloseReason.RESOLVED)
    )
    await settle(world)

    assert not [c for c in runtime.calls if c.operation == "record_resolution"]


# ----------------------------------------------------------------------------- concurrency
async def test_messages_in_a_burst_reach_the_agent_in_order_one_at_a_time(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([turn("r1"), turn("r2"), turn("r3")])
    await write(world, XIMENA, "primero")
    await write(world, XIMENA, "segundo")
    await write(world, XIMENA, "tercero")
    await settle(world)

    assert [p["text"] for p in post_turns(runtime)] == ["primero", "segundo", "tercero"]
    case_id = (
        await world.use_cases.cases.customer_conversation.execute(customer_actor(XIMENA))
    ).conversation.case_id  # type: ignore[union-attr]
    _case, session, turns = await case_and_session(world, case_id)
    assert session is not None
    assert session.claim is None
    assert [t.text for t in turns if t.author_role is TurnAuthorRole.ASSISTANT] == [
        "r1",
        "r2",
        "r3",
    ]


async def test_two_jobs_on_the_same_case_never_send_the_same_input_twice(
    world: Container, runtime: InMemoryAgentRuntime
) -> None:
    runtime.script.extend([turn("r1"), turn("r2")])
    case_id = await write(world, NATALIA, "hola")

    assert world.assistant_engine is not None
    await asyncio.gather(
        world.assistant_engine.run_case(case_id), world.assistant_engine.run_case(case_id)
    )
    await settle(world)

    assert [p["text"] for p in post_turns(runtime)] == ["hola"]


async def test_the_platform_stays_people_only_without_agent_core(tmp_path: Path) -> None:
    from tests.support import memory_container

    container = await memory_container()  # no agent-core configured
    result = await container.use_cases.cases.post_customer_turn.execute(
        customer_actor(NATALIA), say()
    )
    assert container.use_cases.assistant is None
    assert result.conversation.status.value in {"waiting_agent", "with_agent"}
    assert result.conversation.assistant is None
