"""Realtime of slice 1: customer ↔ analyst fan-out, topic access, payload shapes."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.api.schemas.availability import Availability
from cc_platform.api.schemas.cases import CaseSummary, InboxCounts, Turn
from cc_platform.api.schemas.common import ApiModel
from cc_platform.api.schemas.customer import CustomerConversation, CustomerTurn
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import ANALYST, JULIAN, SUPERVISOR, bearer

DANIELA_ID = seed_staff_id(1)
IMPATIENT = seed_case_id(102)
BEATRIZ, NATALIA = 1002, 2001

PAYLOAD_SCHEMAS: dict[str, type[ApiModel]] = {
    "case.updated": CaseSummary,
    "case.assigned": CaseSummary,
    "inbox.counts": InboxCounts,
    "availability.updated": Availability,
    "conversation.updated": CustomerConversation,
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


def test_customer_message_reaches_the_analyst_inbox_and_case(
    client: TestClient, sign_in: Callable[[str], str], customer_session: Callable[..., str]
) -> None:
    customer = customer_session(BEATRIZ)
    with connect(client, sign_in(ANALYST.email)) as analyst:
        analyst.receive_json()
        assert subscribe(analyst, f"inbox:{DANIELA_ID}")["type"] == "subscribed"
        assert subscribe(analyst, f"case:{IMPATIENT}")["type"] == "subscribed"

        post_as_customer(client, customer, "¿¿Me van a contestar??")
        envelopes = until_pong(analyst)

    types = [e["type"] for e in envelopes]
    # Subscribed to both case: and inbox:, the socket still gets case.updated once.
    assert types == ["turn.created", "case.updated", "inbox.counts"]
    turn = envelopes[0]["data"]
    assert turn["caseId"] == IMPATIENT
    assert turn["actor"] == {"role": "customer", "id": seed_customer_id(BEATRIZ)}
    assert turn["payload"]["sequence"] == 7
    assert turn["payload"]["authorName"] == "Beatriz Salcedo Prieto"
    assert envelopes[1]["data"]["payload"]["unreadCount"] == 4
    assert envelopes[1]["id"] == envelopes[0]["id"]  # same source event, different type
    assert envelopes[2]["data"]["payload"]["toReply"] == 3
    assert_contract_payloads(envelopes)


@pytest.mark.parametrize(
    ("topic", "expected"),
    [
        (f"case:{IMPATIENT}", ["turn.created", "case.updated"]),
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


def test_analyst_reply_reaches_the_customer(
    client: TestClient, sign_in: Callable[[str], str], customer_session: Callable[..., str]
) -> None:
    daniela = bearer(sign_in(ANALYST.email))
    with connect(client, customer_session(BEATRIZ)) as customer:
        welcome = customer.receive_json()
        assert set(welcome["data"]) == {"connectionId", "customerId"}
        assert welcome["data"]["customerId"] == seed_customer_id(BEATRIZ)
        topic = f"customer:{seed_customer_id(BEATRIZ)}"
        assert subscribe(customer, topic)["data"] == {"topic": topic}

        cmid = str(uuid.uuid4())
        response = client.post(
            f"/api/v1/cases/{IMPATIENT}/turns",
            headers={**daniela, "Idempotency-Key": cmid},
            json={"text": "Hola, Beatriz. Ya reviso su caso.", "clientMessageId": cmid},
        )
        assert response.status_code == 201
        envelopes = until_pong(customer)

    types = [e["type"] for e in envelopes]
    assert types == ["turn.created"]  # already in progress: no conversation change
    reply = envelopes[0]["data"]
    assert reply["actor"] == {"role": "analyst", "id": None}  # no staff ids for customers
    assert reply["payload"]["authorRole"] == "analyst"
    assert reply["payload"]["authorName"] == "Daniela"
    assert reply["payload"]["clientMessageId"] is None
    assert reply["payload"]["text"] == "Hola, Beatriz. Ya reviso su caso."
    assert_contract_payloads(envelopes, customer=True)


def test_new_case_staff_only_turns_never_reach_the_customer(
    client: TestClient,
    sign_in: Callable[[str], str],
    customer_session: Callable[..., str],
    drain: Callable[[], None],
) -> None:
    token = customer_session(NATALIA)
    with (
        connect(client, token) as customer,
        connect(client, sign_in(ANALYST.email)) as analyst,
    ):
        customer.receive_json()
        analyst.receive_json()
        subscribe(customer, f"customer:{seed_customer_id(NATALIA)}")
        subscribe(analyst, f"inbox:{DANIELA_ID}")

        created = post_as_customer(client, token, "Hay un cargo que no reconozco")
        drain()
        to_customer = until_pong(customer)
        to_analyst = until_pong(analyst)

    case_id = created["conversation"]["caseId"]
    turns = [e["data"]["payload"] for e in to_customer if e["type"] == "turn.created"]
    assert [(t["sequence"], t["kind"]) for t in turns] == [(1, "message"), (2, "notice")]
    first = next(e for e in to_customer if e["type"] == "turn.created")
    assert first["data"]["actor"] == {"role": "customer", "id": seed_customer_id(NATALIA)}
    conversations = [
        e["data"]["payload"] for e in to_customer if e["type"] == "conversation.updated"
    ]
    assert conversations[-1]["status"] == "with_agent"
    assert conversations[-1]["agentName"] == "Daniela"
    assert all("Ningún nivel" not in str(e) for e in to_customer)  # the routing banner
    assert_contract_payloads(to_customer, customer=True)

    assigned = [e for e in to_analyst if e["type"] == "case.assigned"]
    assert [e["data"]["payload"]["id"] for e in assigned] == [case_id]
    assert assigned[0]["data"]["payload"]["inboxStatus"] == "new"
    counts = [e["data"]["payload"] for e in to_analyst if e["type"] == "inbox.counts"]
    assert counts[-1]["all"] == 8
    assert_contract_payloads(to_analyst)
    assert not {e["type"] for e in to_analyst} & {"case.opened", "routing_step.recorded"}


def test_availability_updates_reach_the_own_inbox(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
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
    "topic",
    [
        f"customer:{seed_customer_id(1001)}",  # someone else's conversation
        f"inbox:{DANIELA_ID}",
        f"case:{IMPATIENT}",
        "approvals",
    ],
)
def test_a_customer_may_only_follow_its_own_topic(
    client: TestClient, customer_session: Callable[..., str], topic: str
) -> None:
    with connect(client, customer_session(BEATRIZ)) as customer:
        customer.receive_json()
        reply = subscribe(customer, topic)
    assert reply["type"] == "error"
    assert reply["data"]["code"] == "forbidden"


def test_staff_topic_access_for_cases_and_customers(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    with (
        connect(client, sign_in(JULIAN.email)) as julian,
        connect(client, sign_in(SUPERVISOR.email)) as supervisor,
    ):
        julian.receive_json()
        supervisor.receive_json()
        assert subscribe(julian, f"case:{IMPATIENT}")["data"]["code"] == "forbidden"
        assert subscribe(julian, f"customer:{seed_customer_id(BEATRIZ)}")["data"]["code"] == (
            "forbidden"
        )
        assert subscribe(julian, f"case:{seed_case_id(999)}")["data"]["code"] == "forbidden"
        assert subscribe(supervisor, f"case:{IMPATIENT}")["type"] == "subscribed"
        assert subscribe(supervisor, f"customer:{seed_customer_id(BEATRIZ)}")["type"] == "error"
