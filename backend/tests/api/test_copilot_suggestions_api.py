"""The copilot's suggestions over HTTP (ADR 0005): ask, read the latest, dismiss the draft, and the
reply or escalation that derive what the analyst did. With a scripted agent-core."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import anyio
import pytest
from fastapi.testclient import TestClient

from cc_platform.application.ai import AgentRuntimeUnavailableError
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.bootstrap.container import AgentCoreServices, Container, build_container
from cc_platform.domain.ai.suggestion import (
    ActionSuggestion,
    EscalationSuggestion,
    ReplySuggestion,
    ToolSuggestion,
)
from cc_platform.infrastructure.ai.ed25519_issuer import Ed25519AgentCredentialIssuer
from cc_platform.infrastructure.ai.keys import AgentSigningKeys
from cc_platform.infrastructure.ai.memory_runtime import InMemoryAgentRuntime
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.assistant_support import escalation
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer, make_settings

NATALIA = 2001
DANIELA = seed_staff_id(ANALYST.number)
DRAFT = "Natalia, ya radiqué la disputa y te confirmo por este chat."

FULL = (
    ReplySuggestion(text=DRAFT, citations=("f1",), language="es"),
    ToolSuggestion(tool="leer_movimientos@1", label="Movimientos", why="Ver los cargos"),
    EscalationSuggestion(
        reason_code="policy:fraude",
        evidence=("Dice que le robaron la tarjeta",),
        motive_draft="Posible robo de tarjeta.",
    ),
)


@pytest.fixture
def runtime() -> InMemoryAgentRuntime:
    return InMemoryAgentRuntime()


@pytest.fixture
def container(
    request: pytest.FixtureRequest,
    clock: FixedClock,
    tmp_path: Path,
    runtime: InMemoryAgentRuntime,
) -> Container:
    enabled = getattr(request, "param", True)
    links = tmp_path / "links.json"
    links.write_text(json.dumps({seed_customer_id(NATALIA): "bank-0001"}), encoding="utf-8")
    extra: dict[str, object] = {
        "copilot_suggestions_agent": "copiloto-sugerencias@prod",
        "copilot_suggestions_auto": False,  # these tests ask by hand
    }
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'suggestions-api.db'}",
        bank_customer_links_file=links,
        **(extra if enabled else {}),
    )
    return build_container(
        settings,
        clock=clock,
        ids=SequentialIdGenerator(),
        agent_core=AgentCoreServices(
            issuer=Ed25519AgentCredentialIssuer(AgentSigningKeys.generate(suffix="t"), clock),
            runtime=runtime,
        ),
    )


@pytest.fixture
def assigned_case(
    client: TestClient,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
    available: Callable[..., None],
    runtime: InMemoryAgentRuntime,
) -> str:
    """A case the assistant escalated to Daniela; the runtime's calls are cleared."""
    available(DANIELA)
    runtime.script.append(escalation())
    token = customer_session(NATALIA)
    key = str(uuid.uuid4())
    sent = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": key},
        json={"text": "no reconozco un cargo", "clientMessageId": key},
    )
    drain()
    runtime.calls.clear()
    case_id: str = sent.json()["conversation"]["caseId"]
    return case_id


def ask(
    client: TestClient, headers: dict[str, str], case_id: str, key: str = "key-00000001"
) -> Any:
    return client.post(
        f"/api/v1/cases/{case_id}/copilot/suggestions",
        headers={**headers, "Idempotency-Key": key},
        json={"trigger": "manual"},
    )


def latest(client: TestClient, headers: dict[str, str], case_id: str) -> Any:
    return client.get(f"/api/v1/cases/{case_id}/copilot/suggestions/latest", headers=headers)


def reply(
    client: TestClient, headers: dict[str, str], case_id: str, text: str, suggestion_id: str
) -> Any:
    key = str(uuid.uuid4())
    return client.post(
        f"/api/v1/cases/{case_id}/turns",
        headers={**headers, "Idempotency-Key": key},
        json={"text": text, "clientMessageId": key, "copilotSuggestionId": suggestion_id},
    )


def test_the_analyst_asks_for_a_suggestion_and_reads_it_back(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    empty = latest(client, analyst, assigned_case)
    assert empty.status_code == 200
    assert empty.json() == {"available": True, "suggestion": None}

    runtime.suggestion_script.append(FULL)
    response = ask(client, analyst, assigned_case)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["status"], body["trigger"], body["stale"]) == ("ready", "manual", False)
    assert body["replyDecision"] is None
    assert [s["type"] for s in body["suggestions"]] == ["reply", "tool", "escalate"]
    assert body["truncated"] is False
    assert body["suggestions"][0] == {
        "type": "reply",
        "text": DRAFT,
        "citations": ["f1"],
        "language": "es",
    }
    assert body["suggestions"][1]["label"] == "Movimientos"  # the platform's catalog
    assert body["suggestions"][2]["reasonCode"] == "policy:fraude"
    assert body["suggestions"][2]["motiveDraft"] == "Posible robo de tarjeta."
    read = latest(client, analyst, assigned_case).json()
    assert read["available"] is True
    assert read["suggestion"]["id"] == body["id"]


def test_an_action_is_information_and_a_cut_list_says_so(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(
        (
            ActionSuggestion(tool="radicar_pqr@1", summary="Radicar una disputa por 120 USD"),
            ReplySuggestion(text=DRAFT),
            ReplySuggestion(text="otro borrador"),
        )
    )

    body = ask(client, analyst, assigned_case).json()

    assert [s["type"] for s in body["suggestions"]] == ["action", "reply"]
    assert body["suggestions"][0]["executable"] is False  # information only
    assert body["truncated"] is True  # the second reply was left out, and it says so
    read = latest(client, analyst, assigned_case).json()
    assert read["suggestion"]["truncated"] is True


def test_nothing_to_propose_is_a_normal_answer(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(())

    response = ask(client, analyst, assigned_case)

    assert response.status_code == 201
    assert (response.json()["status"], response.json()["suggestions"]) == ("none", [])


def test_a_retry_with_the_same_key_is_a_replay_and_asks_nothing(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    first = ask(client, analyst, assigned_case)

    again = ask(client, analyst, assigned_case)

    assert again.status_code == 200
    assert again.headers["Idempotent-Replayed"] == "true"
    assert again.json()["id"] == first.json()["id"]
    assert [c.operation for c in runtime.calls] == ["start_run"]


def test_a_failed_call_answers_503_and_the_same_key_asks_again(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(AgentRuntimeUnavailableError("down"))

    failed = ask(client, analyst, assigned_case)
    assert (failed.status_code, failed.json()["code"]) == (503, "agent_core_unavailable")
    seen = latest(client, analyst, assigned_case).json()["suggestion"]
    assert (seen["status"], seen["failureCode"]) == ("failed", "agent_core_unavailable")

    runtime.suggestion_script.append(FULL)
    ok = ask(client, analyst, assigned_case)
    assert ok.status_code == 201
    assert ok.json()["id"] == seen["id"]


def test_the_idempotency_key_is_required(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    response = client.post(f"/api/v1/cases/{assigned_case}/copilot/suggestions", headers=analyst)

    assert response.status_code == 422


def test_dismissing_the_draft_keeps_the_rest(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    response = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/{made['id']}/feedback",
        headers=analyst,
        json={"decision": "discarded"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["replyDecision"] == "discarded"
    assert [s["type"] for s in body["suggestions"]] == ["tool", "escalate"]
    bad = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/{made['id']}/feedback",
        headers=analyst,
        json={"decision": "used"},
    )
    assert bad.status_code == 422
    unknown = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/CPS-{'0' * 26}/feedback",
        headers=analyst,
        json={"decision": "ignored"},
    )
    assert unknown.status_code == 404


def test_replying_with_the_suggestion_id_marks_it_used_or_edited(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    clock: FixedClock,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.extend([FULL, FULL])
    first = ask(client, analyst, assigned_case, "key-00000001").json()

    sent = reply(client, analyst, assigned_case, DRAFT, first["id"])

    assert sent.status_code == 201, sent.text
    after = latest(client, analyst, assigned_case).json()["suggestion"]
    assert after["replyDecision"] == "used"
    assert "reply" not in [s["type"] for s in after["suggestions"]]

    clock.advance(timedelta(minutes=1))
    second = ask(client, analyst, assigned_case, "key-00000002").json()
    edited = reply(client, analyst, assigned_case, "Natalia, ya lo estoy viendo.", second["id"])

    assert edited.status_code == 201
    assert latest(client, analyst, assigned_case).json()["suggestion"]["replyDecision"] == "edited"


def test_a_wrong_suggestion_id_never_fails_the_reply(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    sent = reply(client, analyst, assigned_case, "Hola, Natalia.", "CPS-" + "9" * 26)

    assert sent.status_code == 201


def test_escalating_with_the_recommendation_records_it_as_accepted(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    escalated = client.post(
        f"/api/v1/cases/{assigned_case}/escalations",
        headers={**analyst, "Idempotency-Key": "esc-key-00001"},
        json={"motive": "Posible robo de tarjeta.", "copilotSuggestionId": made["id"]},
    )

    assert escalated.status_code == 201, escalated.text
    assert latest(client, analyst, assigned_case).json()["suggestion"]["escalationAccepted"]


def test_only_the_assignee_analyst_reaches_the_suggestions(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    other = bearer(sign_in(JULIAN.email))
    supervisor = bearer(sign_in(SUPERVISOR.email))

    assert latest(client, other, assigned_case).status_code == 403
    assert ask(client, other, assigned_case).status_code == 403
    assert latest(client, supervisor, assigned_case).status_code == 403
    assert ask(client, supervisor, assigned_case).status_code == 403
    assert latest(client, {}, assigned_case).status_code == 401


@pytest.mark.parametrize("container", [False], indirect=True)
def test_without_a_suggestions_agent_the_panel_hides(
    client: TestClient, sign_in: Callable[[str], str], assigned_case: str
) -> None:
    analyst = bearer(sign_in(ANALYST.email))

    read = latest(client, analyst, assigned_case)
    asked = ask(client, analyst, assigned_case)

    assert read.status_code == 200
    assert read.json() == {"available": False, "suggestion": None}
    assert (asked.status_code, asked.json()["code"]) == (404, "assistant_disabled")


def test_the_events_reach_the_audit_without_any_text(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    ask(client, analyst, assigned_case)
    supervisor = bearer(sign_in(SUPERVISOR.email))

    audit = client.get(
        "/api/v1/audit/events", params={"family": "conversation", "limit": 100}, headers=supervisor
    )

    assert audit.status_code == 200, audit.text
    events = audit.json()["items"]
    types = {e["type"] for e in events}
    assert {"copilot.suggestion_requested", "copilot.suggestion_ready"} <= types
    descriptions = {e["description"] for e in events}
    assert "El copiloto preparó una sugerencia" in descriptions
    dumped = json.dumps(events, ensure_ascii=False)
    for secret in (DRAFT, "Radicar una disputa", "Posible robo", "Ver los cargos"):
        assert secret not in dumped


def logged(container: Container, *types: str) -> list[dict[str, Any]]:
    """Payloads of the logged events of these types, oldest first."""

    async def read() -> list[dict[str, Any]]:
        async with container.uow() as uow:
            found = await uow.event_log.search(
                AuditFilters(event_types=frozenset(types)), before=None, limit=500
            )
        return [dict(e.payload) for e in reversed(found)]

    return anyio.run(read)


def test_the_engine_signals_carry_the_release_and_the_turn_that_was_sent(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    sent = reply(client, analyst, assigned_case, "Natalia, ya lo estoy viendo.", made["id"])

    (ready,) = logged(container, "copilot.suggestion_ready")
    (decided,) = logged(container, "copilot.suggestion_decided")
    assert ready["release"] == "rel-1"
    assert decided["decision"] == "edited"
    assert decided["turn_id"] == sent.json()["turn"]["id"]
    assert (decided["agent"], decided["release"]) == ("copiloto-sugerencias@prod", "rel-1")
    assert "Natalia" not in json.dumps([ready, decided])  # ids, enums and counters only


def test_the_assistant_turns_are_attributed_to_the_release_that_answered(
    assigned_case: str, container: Container
) -> None:
    answered = logged(container, "assistant.turn_answered")

    assert answered
    assert {p["release"] for p in answered} == {"rel-1"}


# ------------------------------------------------------------- event catalog 1.3.0 (engine signals)
def shown(client: TestClient, headers: dict[str, str], case_id: str, suggestion_id: str) -> Any:
    return client.post(
        f"/api/v1/cases/{case_id}/copilot/suggestions/{suggestion_id}/shown", headers=headers
    )


def feedback(
    client: TestClient, headers: dict[str, str], case_id: str, suggestion_id: str, **body: str
) -> Any:
    return client.post(
        f"/api/v1/cases/{case_id}/copilot/suggestions/{suggestion_id}/feedback",
        headers=headers,
        json=body,
    )


def test_a_suggestion_on_screen_is_recorded_as_shown_once(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    first = shown(client, analyst, assigned_case, made["id"])
    again = shown(client, analyst, assigned_case, made["id"])

    assert (first.status_code, again.status_code) == (204, 204)
    (event,) = logged(container, "copilot.suggestion_shown")
    assert event == {
        "analyst_id": DANIELA,
        "agent": "copiloto-sugerencias@prod",
        "kinds": ["reply", "tool", "escalate"],
        "count": 3,
        "stale": False,
        "release": "rel-1",
        "schema_version": 1,
    }
    other = bearer(sign_in(JULIAN.email))
    assert shown(client, other, assigned_case, made["id"]).status_code == 403
    assert shown(client, analyst, assigned_case, "CPS-" + "9" * 26).status_code == 404


def test_ahora_no_dismisses_the_recommendation_with_its_reason_code(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    wrong = feedback(client, analyst, assigned_case, made["id"], decision="dismissed")
    dismissed = feedback(
        client, analyst, assigned_case, made["id"], subject="escalation", decision="dismissed"
    )

    assert wrong.status_code == 422  # `dismissed` is for the escalation only
    assert dismissed.status_code == 200, dismissed.text
    kinds = [item["type"] for item in dismissed.json()["suggestions"]]
    assert kinds == ["reply", "tool"]  # the recommendation left; the draft stays
    (decided,) = logged(container, "copilot.suggestion_decided")
    assert decided == {
        "subject": "escalation",
        "decision": "dismissed",
        "edit_distance_permille": None,
        "turn_id": None,
        "agent": "copiloto-sugerencias@prod",
        "release": "rel-1",
        "reason_code": "policy:fraude",
        "schema_version": 1,
    }
    again = feedback(
        client, analyst, assigned_case, made["id"], subject="escalation", decision="dismissed"
    )
    assert again.status_code == 200
    assert len(logged(container, "copilot.suggestion_decided")) == 1


def test_an_accepted_recommendation_carries_its_reason_code(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    made = ask(client, analyst, assigned_case).json()

    client.post(
        f"/api/v1/cases/{assigned_case}/escalations",
        headers={**analyst, "Idempotency-Key": "esc-key-00002"},
        json={"motive": "Posible robo de tarjeta.", "copilotSuggestionId": made["id"]},
    )

    (decided,) = logged(container, "copilot.suggestion_decided")
    assert (decided["subject"], decided["decision"]) == ("escalation", "accepted")
    assert decided["reason_code"] == "policy:fraude"


def test_a_replaced_suggestion_nobody_used_is_recorded_as_ignored(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.extend([FULL, FULL])
    first = ask(client, analyst, assigned_case, key="key-00000001").json()
    shown(client, analyst, assigned_case, first["id"])

    ask(client, analyst, assigned_case, key="key-00000002")

    (ignored,) = logged(container, "copilot.suggestion_ignored")
    assert ignored == {
        "analyst_id": DANIELA,
        "agent": "copiloto-sugerencias@prod",
        "cause": "replaced",
        "kinds": ["reply", "tool", "escalate"],
        "shown": True,
        "release": "rel-1",
        "schema_version": 1,
    }
    (decided,) = logged(container, "copilot.suggestion_decided")
    assert decided["decision"] == "ignored"  # the draft, as before 1.3.0


def test_a_suggestion_that_was_used_is_never_ignored(
    client: TestClient,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.extend([FULL, FULL, FULL])
    discarded = ask(client, analyst, assigned_case, key="key-00000001").json()
    feedback(client, analyst, assigned_case, discarded["id"], decision="discarded")
    with_tool = ask(client, analyst, assigned_case, key="key-00000002").json()
    used = client.post(
        f"/api/v1/cases/{assigned_case}/copilot/suggestions/{with_tool['id']}/tools",
        headers=analyst,
        json={"tool": "leer_movimientos@1", "decision": "used"},
    )
    assert used.status_code == 204, used.text

    ask(client, analyst, assigned_case, key="key-00000003")

    assert logged(container, "copilot.suggestion_ignored") == []


def test_closing_the_case_ends_its_suggestion_and_rates_the_handoff(
    client: TestClient,
    *,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
    drain: Callable[[], None],
) -> None:
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.append(FULL)
    ask(client, analyst, assigned_case)

    wrong = client.post(
        f"/api/v1/cases/{assigned_case}/close",
        headers=analyst,
        json={
            "reason": "resolved",
            "note": None,
            "handoffQuality": "useful",
            "handoffReasked": ["amount"],
        },
    )
    unknown = client.post(
        f"/api/v1/cases/{assigned_case}/close",
        headers=analyst,
        json={
            "reason": "resolved",
            "note": None,
            "handoffQuality": "incomplete",
            "handoffReasked": ["el monto exacto"],
        },
    )
    closed = client.post(
        f"/api/v1/cases/{assigned_case}/close",
        headers=analyst,
        json={
            "reason": "resolved",
            "note": "Le pregunté el monto y el comercio otra vez.",
            "handoffQuality": "incomplete",
            "handoffReasked": ["merchant", "amount", "merchant"],
        },
    )
    drain()

    assert (wrong.status_code, unknown.status_code) == (422, 422)
    assert closed.status_code == 200, closed.text
    (rated,) = logged(container, "case.handoff_rated")
    assert rated == {
        "handoff_ref": "hnd-7",
        "quality": "incomplete",
        "reasked": ["amount", "merchant"],
        "release": "rel-1",
        "schema_version": 1,
    }
    (ignored,) = logged(container, "copilot.suggestion_ignored")
    assert (ignored["cause"], ignored["shown"]) == ("case_closed", False)
    (ended,) = logged(container, "assistant.ended")
    assert ended["release"] == "rel-1"
    sent = [c for c in runtime.calls if c.operation == "record_resolution"]
    assert [c.arguments["handoff_quality"] for c in sent] == ["incomplete"]  # unchanged call
    assert "reasked" not in json.dumps([c.arguments for c in sent])


def test_the_engine_signals_never_carry_a_text(
    client: TestClient,
    *,
    sign_in: Callable[[str], str],
    assigned_case: str,
    runtime: InMemoryAgentRuntime,
    container: Container,
    drain: Callable[[], None],
) -> None:
    """Every word the customer, the analyst or the copilot wrote stays out of the signals."""
    analyst = bearer(sign_in(ANALYST.email))
    runtime.suggestion_script.extend([FULL, FULL])
    first = ask(client, analyst, assigned_case, key="key-00000001").json()
    shown(client, analyst, assigned_case, first["id"])
    feedback(
        client, analyst, assigned_case, first["id"], subject="escalation", decision="dismissed"
    )
    reply(client, analyst, assigned_case, "Natalia, ya lo estoy viendo.", first["id"])
    second = ask(client, analyst, assigned_case, key="key-00000002").json()
    shown(client, analyst, assigned_case, second["id"])
    client.post(
        f"/api/v1/cases/{assigned_case}/close",
        headers=analyst,
        json={
            "reason": "resolved",
            "note": "Nota interna SECRETA",
            "handoffQuality": "incomplete",
            "handoffReasked": ["identity"],
        },
    )
    drain()

    signals = logged(
        container,
        "copilot.suggestion_ready",
        "copilot.suggestion_shown",
        "copilot.suggestion_decided",
        "copilot.suggestion_ignored",
        "copilot.tool_used",
        "copilot.answered",
        "assistant.ended",
        "case.handoff_rated",
    )
    dumped = json.dumps(signals, ensure_ascii=False)
    assert len(signals) >= 6
    for text in (DRAFT, "Natalia", "Posible robo", "Ver los cargos", "SECRETA", "no reconozco"):
        assert text not in dumped
