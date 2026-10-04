"""Realtime of the case lifecycle (contract §7): customer ↔ analyst fan-out, the first
response, close and reopen, topic access, payload shapes."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.api.schemas.availability import Availability
from cc_platform.api.schemas.cases import CaseSummary, Escalation, InboxCounts, Turn
from cc_platform.api.schemas.common import ApiModel
from cc_platform.api.schemas.customer import CustomerConversation, CustomerTurn
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer

DANIELA_ID = seed_staff_id(1)
MARCELA_CASE, BEATRIZ_CASE, PATRICIA_OLD = seed_case_id(101), seed_case_id(102), seed_case_id(110)
MARCELA, BEATRIZ, NATALIA = 1001, 1002, 2001

PAYLOAD_SCHEMAS: dict[str, type[ApiModel]] = {
    "case.updated": CaseSummary,
    "case.assigned": CaseSummary,
    "inbox.counts": InboxCounts,
    "availability.updated": Availability,
    "conversation.updated": CustomerConversation,
    "escalation.updated": Escalation,
}


def connect(client: TestClient, token: str) -> Any:
    return client.websocket_connect(f"/api/v1/ws?token={token}")


def subscribe(ws: Any, topic: str) -> dict[str, Any]:
    ws.send_json({"action": "subscribe", "topic": topic})
    reply: dict[str, Any] = ws.receive_json()
    return reply


def until_pong(ws: Any) -> list[dict[str, Any]]:
    """Everything delivered so far (the server answers the ping after queued envelopes)."""
    ws.send_json({"action": "ping"})
    received: list[dict[str, Any]] = []
    while (message := ws.receive_json())["type"] != "pong":
        received.append(message)
    return received


def assert_contract_payloads(envelopes: list[dict[str, Any]], *, customer: bool = False) -> None:
    """Every payload parses as the REST schema and serialises back to itself."""
    for envelope in envelopes:
        schema = PAYLOAD_SCHEMAS.get(envelope["type"])
        if envelope["type"] == "turn.created":
            schema = CustomerTurn if customer else Turn
        assert schema is not None, envelope["type"]
        payload = envelope["data"]["payload"]
        assert schema.model_validate(payload).model_dump(mode="json", by_alias=True) == payload
        assert set(envelope) == {"type", "id", "occurredAt", "data"}


def post_as_customer(client: TestClient, token: str, text: str) -> dict[str, Any]:
    cmid = str(uuid.uuid4())
    response = client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"text": text, "clientMessageId": cmid},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def reply_as(client: TestClient, headers: dict[str, str], case_id: str, text: str) -> None:
    cmid = str(uuid.uuid4())
    response = client.post(
        f"/api/v1/cases/{case_id}/turns",
        headers={**headers, "Idempotency-Key": cmid},
        json={"text": text, "clientMessageId": cmid},
    )
    assert response.status_code == 201, response.text


def close_case(client: TestClient, headers: dict[str, str], case_id: str) -> None:
    response = client.post(
        f"/api/v1/cases/{case_id}/close",
        headers=headers,
        json={"reason": "out_of_scope", "note": "Nota interna del equipo"},
    )
    assert response.status_code == 200, response.text


def test_customer_message_reaches_the_analyst_inbox_and_case(
    client: TestClient, sign_in: Callable[[str], str], customer_session: Callable[..., str]
) -> None:
    customer = customer_session(BEATRIZ)
    with connect(client, sign_in(ANALYST.email)) as analyst:
        analyst.receive_json()
        assert subscribe(analyst, f"inbox:{DANIELA_ID}")["type"] == "subscribed"
        assert subscribe(analyst, f"case:{BEATRIZ_CASE}")["type"] == "subscribed"

        post_as_customer(client, customer, "¿¿Me van a contestar??")
        envelopes = until_pong(analyst)

    # Subscribed to both case: and inbox:, the socket still gets case.updated once.
    assert [e["type"] for e in envelopes] == ["turn.created", "case.updated", "inbox.counts"]
    turn = envelopes[0]["data"]
    assert turn["caseId"] == BEATRIZ_CASE
    assert turn["actor"] == {"role": "customer", "id": seed_customer_id(BEATRIZ)}
    assert turn["payload"]["sequence"] == 7
    assert turn["payload"]["authorName"] == "Beatriz Salcedo Prieto"
    assert envelopes[1]["data"]["payload"]["unreadCount"] == 4
    assert envelopes[1]["id"] == envelopes[0]["id"]  # same source event, different type
    assert envelopes[2]["data"]["payload"]["toReply"] == 2
    assert envelopes[2]["data"]["payload"]["closed"] == 3
    assert_contract_payloads(envelopes)


@pytest.mark.parametrize(
    ("topic", "expected"),
    [
        (f"case:{BEATRIZ_CASE}", ["turn.created", "case.updated"]),
        (f"inbox:{DANIELA_ID}", ["case.updated", "inbox.counts"]),
    ],
)
def test_case_updated_reaches_each_topic_on_its_own(
    client: TestClient,
    sign_in: Callable[[str], str],
    customer_session: Callable[..., str],
    topic: str,
    expected: list[str],
) -> None:
    customer = customer_session(BEATRIZ)
    with connect(client, sign_in(ANALYST.email)) as analyst:
        analyst.receive_json()
        assert subscribe(analyst, topic)["type"] == "subscribed"
        post_as_customer(client, customer, "¿Hola?")
        envelopes = until_pong(analyst)
    assert [e["type"] for e in envelopes] == expected


def test_first_reply_reaches_the_customer_and_updates_the_card(
    client: TestClient, sign_in: Callable[[str], str], customer_session: Callable[..., str]
) -> None:
    daniela = bearer(sign_in(ANALYST.email))
    with (
        connect(client, customer_session(BEATRIZ)) as customer,
        connect(client, daniela["Authorization"].removeprefix("Bearer ")) as analyst,
    ):
        welcome = customer.receive_json()
        analyst.receive_json()
        assert set(welcome["data"]) == {"connectionId", "customerId"}
        topic = f"customer:{seed_customer_id(BEATRIZ)}"
        assert subscribe(customer, topic)["data"] == {"topic": topic}
        subscribe(analyst, f"inbox:{DANIELA_ID}")

        reply_as(client, daniela, BEATRIZ_CASE, "Hola, Beatriz. Ya reviso su caso.")
        to_customer = until_pong(customer)
        to_analyst = until_pong(analyst)

    assert [e["type"] for e in to_customer] == ["turn.created"]  # no conversation change
    reply = to_customer[0]["data"]
    assert reply["actor"] == {"role": "analyst", "id": None}  # no staff ids for customers
    assert (reply["payload"]["authorRole"], reply["payload"]["authorName"]) == (
        "analyst",
        "Daniela",
    )
    assert reply["payload"]["clientMessageId"] is None
    assert_contract_payloads(to_customer, customer=True)

    # The first answer stops the SLA: a case.updated follows case.first_responded.
    updates = [e for e in to_analyst if e["type"] == "case.updated"]
    assert updates[-1]["data"]["payload"]["firstResponseAt"] == "2026-10-02T14:00:00Z"
    assert updates[-1]["data"]["payload"]["inboxStatus"] == "waiting"
    sources = {e["data"]["entity"] for e in to_analyst}
    assert sources == {"turn", "case"}
    assert any(
        e["type"] == "case.updated"
        and e["data"]["entity"] == "case"
        and e["data"]["payload"]["firstResponseAt"] is not None
        and e["id"] not in {u["id"] for u in to_analyst if u["data"]["entity"] == "turn"}
        for e in to_analyst
    )
    assert_contract_payloads(to_analyst)


def test_close_notice_reaches_the_customer_never_the_reason(
    client: TestClient, sign_in: Callable[[str], str], customer_session: Callable[..., str]
) -> None:
    token = sign_in(ANALYST.email)
    with (
        connect(client, customer_session(MARCELA)) as customer,
        connect(client, token) as analyst,
    ):
        customer.receive_json()
        analyst.receive_json()
        subscribe(customer, f"customer:{seed_customer_id(MARCELA)}")
        subscribe(analyst, f"inbox:{DANIELA_ID}")

        close_case(client, bearer(token), MARCELA_CASE)
        to_customer = until_pong(customer)
        to_analyst = until_pong(analyst)

    assert [e["type"] for e in to_customer] == [
        "turn.created",
        "conversation.updated",
        "conversation.updated",
    ]
    notice = to_customer[0]["data"]["payload"]
    assert (notice["kind"], notice["authorRole"]) == ("notice", "system")
    assert notice["text"].startswith("La conversación terminó.")
    assert to_customer[-1]["data"]["payload"]["status"] == "closed"
    assert to_customer[-1]["data"]["payload"]["agentName"] == "Daniela"
    wire = str(to_customer)
    assert "out_of_scope" not in wire
    assert "Nota interna" not in wire
    assert_contract_payloads(to_customer, customer=True)

    # One close, two envelopes for the inbox: the card moves to Cerrados, fresh counts.
    summary = [e for e in to_analyst if e["type"] == "case.updated"][-1]["data"]["payload"]
    assert (summary["inboxStatus"], summary["closeReason"]) == ("closed", "out_of_scope")
    counts = [e for e in to_analyst if e["type"] == "inbox.counts"][-1]["data"]["payload"]
    assert (counts["all"], counts["toReply"], counts["closed"]) == (4, 1, 4)
    assert_contract_payloads(to_analyst)


def test_writing_after_a_close_switches_the_conversation_and_reaches_the_analyst(
    client: TestClient,
    sign_in: Callable[[str], str],
    customer_session: Callable[..., str],
    drain: Callable[[], None],
) -> None:
    token = sign_in(ANALYST.email)
    # Daniela switches to "Disponible": she takes the seeded queues, then new chats.
    client.put("/api/v1/me/availability", headers=bearer(token), json={"status": "available"})
    drain()
    close_case(client, bearer(token), MARCELA_CASE)
    customer_token = customer_session(MARCELA)
    with (
        connect(client, customer_token) as customer,
        connect(client, token) as analyst,
    ):
        customer.receive_json()
        analyst.receive_json()
        subscribe(customer, f"customer:{seed_customer_id(MARCELA)}")
        subscribe(analyst, f"inbox:{DANIELA_ID}")

        created = post_as_customer(client, customer_token, "Hola de nuevo")
        to_customer = until_pong(customer)
        to_analyst = until_pong(analyst)

    new_id = created["conversation"]["caseId"]
    conversations = [
        e["data"]["payload"] for e in to_customer if e["type"] == "conversation.updated"
    ]
    assert {c["caseId"] for c in conversations} == {new_id}  # a different caseId: a switch
    assert new_id != MARCELA_CASE
    assert conversations[-1]["previousCaseId"] == MARCELA_CASE
    assert conversations[-1]["status"] == "with_agent"
    turns = [e["data"]["payload"] for e in to_customer if e["type"] == "turn.created"]
    assert [(t["sequence"], t["kind"]) for t in turns] == [(1, "message"), (2, "notice")]
    assert "volvió a escribir" not in str(to_customer)  # staff-only banner
    assert "Asignado" not in str(to_customer)
    assert_contract_payloads(to_customer, customer=True)

    assigned = [e["data"]["payload"] for e in to_analyst if e["type"] == "case.assigned"]
    assert [(a["id"], a["previousCaseId"], a["inboxStatus"]) for a in assigned] == [
        (new_id, MARCELA_CASE, "new")
    ]
    counts = [e for e in to_analyst if e["type"] == "inbox.counts"][-1]["data"]["payload"]
    # 4 open + the 3 drained queued cases + the new one; 101 closed (4 in Cerrados).
    assert (counts["all"], counts["new"], counts["closed"]) == (8, 6, 4)
    assert not {e["type"] for e in to_analyst} & {"case.opened", "case.queued"}
    assert_contract_payloads(to_analyst)


def test_availability_updates_reach_the_own_inbox(
    client: TestClient, sign_in: Callable[[str], str], available: Callable[..., None]
) -> None:
    available(DANIELA_ID)  # so that pausing is a change
    token = sign_in(ANALYST.email)
    with connect(client, token) as analyst:
        analyst.receive_json()
        subscribe(analyst, f"inbox:{DANIELA_ID}")
        client.put("/api/v1/me/availability", headers=bearer(token), json={"status": "paused"})
        envelopes = until_pong(analyst)
    assert [e["type"] for e in envelopes] == ["availability.updated"]
    assert envelopes[0]["data"]["payload"]["status"] == "paused"
    assert_contract_payloads(envelopes)


@pytest.mark.parametrize(
    ("topic", "code"),
    [
        (f"customer:{seed_customer_id(1001)}", "forbidden"),  # someone else's conversation
        (f"inbox:{DANIELA_ID}", "forbidden"),
        (f"case:{BEATRIZ_CASE}", "forbidden"),
        ("approvals", "invalid_topic"),  # removed in slice 2
    ],
)
def test_a_customer_may_only_follow_its_own_topic(
    client: TestClient, customer_session: Callable[..., str], topic: str, code: str
) -> None:
    with connect(client, customer_session(BEATRIZ)) as customer:
        customer.receive_json()
        reply = subscribe(customer, topic)
    assert reply["type"] == "error"
    assert reply["data"]["code"] == code


def test_staff_topic_access_for_cases_and_customers(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    with (
        connect(client, sign_in(JULIAN.email)) as julian,
        connect(client, sign_in(SUPERVISOR.email)) as supervisor,
        connect(client, sign_in(ANALYST.email)) as daniela,
    ):
        for ws in (julian, supervisor, daniela):
            ws.receive_json()
        assert subscribe(julian, f"case:{BEATRIZ_CASE}")["data"]["code"] == "forbidden"
        assert subscribe(julian, f"customer:{seed_customer_id(BEATRIZ)}")["data"]["code"] == (
            "forbidden"
        )
        assert subscribe(julian, f"case:{seed_case_id(999)}")["data"]["code"] == "forbidden"
        assert subscribe(julian, "approvals")["data"]["code"] == "invalid_topic"
        assert subscribe(supervisor, f"case:{BEATRIZ_CASE}")["type"] == "subscribed"
        assert subscribe(supervisor, f"customer:{seed_customer_id(BEATRIZ)}")["type"] == "error"
        # History access is REST only: a closed history case has no live topic.
        assert subscribe(daniela, f"case:{PATRICIA_OLD}")["data"]["code"] == "forbidden"
