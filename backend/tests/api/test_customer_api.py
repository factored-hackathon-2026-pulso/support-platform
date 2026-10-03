"""Customer chat simulator API: picker, sessions, conversations, past conversations and the
live round trip (assignment in the same request, queue and drain, close and reopen)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import ANALYST, SEBASTIAN, bearer

NATALIA, RAFAEL, MARCELA, PATRICIA, CLAUDIA = 2001, 2004, 1001, 1004, 1005
PATRICIA_REFUND, PATRICIA_AGAIN, PATRICIA_OLD = (seed_case_id(n) for n in (104, 108, 110))


def write(client: TestClient, token: str, text: str, cmid: str | None = None) -> Any:
    cmid = cmid or str(uuid.uuid4())
    return client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"text": text, "clientMessageId": cmid},
    )


def availability(client: TestClient, token: str, status: str) -> None:
    response = client.put("/api/v1/me/availability", headers=bearer(token), json={"status": status})
    assert response.status_code == 200, response.text


def test_demo_customers_simulator_first_then_everyone_by_name(client: TestClient) -> None:
    items = client.get("/api/v1/customer/demo-customers").json()["items"]
    names = [item["displayName"].split()[0] for item in items]
    assert names == [
        "Natalia", "Ximena", "Lucas", "Rafael", "Andrés",  # simulator customers (by id)
        "Beatriz", "Camila", "Claudia", "Esteban", "Gabriela", "Héctor", "Joaquín", "Larissa",
        "Marcela", "Mauricio", "Patricia", "Rosa",
    ]  # fmt: skip
    first = items[0]
    assert set(first) == {
        "id", "displayName", "locale", "language", "country", "city", "suggestions",
        "openConversation", "closedConversationCount",
    }  # fmt: skip
    assert (first["openConversation"], first["closedConversationCount"]) == (None, 0)
    by_name = {item["displayName"].split()[0]: item for item in items}
    assert by_name["Patricia"]["openConversation"] == {
        "caseId": PATRICIA_AGAIN,
        "channel": "app_chat",
        "status": "with_agent",
    }
    assert by_name["Patricia"]["closedConversationCount"] == 2
    assert by_name["Claudia"]["openConversation"] is None  # closed cases never fill it
    assert by_name["Claudia"]["closedConversationCount"] == 1
    assert by_name["Gabriela"]["openConversation"]["status"] == "waiting_agent"


def test_sessions(client: TestClient) -> None:
    created = client.post(
        "/api/v1/customer/sessions",
        json={"customerId": seed_customer_id(NATALIA), "channel": "web_chat"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["channel"] == "web_chat"
    assert body["customer"] == {
        "id": seed_customer_id(NATALIA),
        "displayName": "Natalia Guzmán Rincón",
        "locale": "es-CO",
        "language": "es",
    }
    # An open case decides the channel; every seeded customer may chat.
    marcela = client.post(
        "/api/v1/customer/sessions", json={"customerId": seed_customer_id(MARCELA)}
    )
    assert marcela.json()["channel"] == "web_chat"
    patricia = client.post(
        "/api/v1/customer/sessions", json={"customerId": seed_customer_id(PATRICIA)}
    )
    assert (patricia.status_code, patricia.json()["channel"]) == (201, "app_chat")
    for unknown in (seed_customer_id(9999), "nope"):
        missing = client.post("/api/v1/customer/sessions", json={"customerId": unknown})
        assert (missing.status_code, missing.json()["code"]) == (404, "not_found")
    phone = client.post(
        "/api/v1/customer/sessions",
        json={"customerId": seed_customer_id(NATALIA), "channel": "phone"},
    )
    assert phone.status_code == 422


def test_tokens_do_not_cross_audiences(
    client: TestClient, customer_session: Callable[..., str], sign_in: Callable[[str], str]
) -> None:
    customer = customer_session(NATALIA)
    staff = sign_in(ANALYST.email)
    on_staff_route = client.get("/api/v1/cases/inbox", headers=bearer(customer))
    assert (on_staff_route.status_code, on_staff_route.json()["code"]) == (401, "unauthenticated")
    for path in ("/api/v1/customer/conversation", "/api/v1/customer/conversations"):
        on_customer_route = client.get(path, headers=bearer(staff))
        assert (on_customer_route.status_code, on_customer_route.json()["code"]) == (
            401,
            "unauthenticated",
        )
        assert client.get(path).status_code == 401
    assert client.get(f"/api/v1/customer/conversations/{PATRICIA_OLD}").status_code == 401


def test_a_customer_only_ever_sees_their_own_conversations(
    client: TestClient, customer_session: Callable[..., str]
) -> None:
    marcela = customer_session(MARCELA)
    natalia = customer_session(NATALIA)
    mine = client.get("/api/v1/customer/conversation", headers=bearer(marcela)).json()
    assert mine["conversation"]["caseId"] == seed_case_id(101)
    assert mine["pastConversationCount"] == 0
    assert {turn["kind"] for turn in mine["turns"]} == {"message", "notice"}
    assert "Asignado" not in " ".join(turn["text"] for turn in mine["turns"])  # staff banner
    theirs = client.get("/api/v1/customer/conversation", headers=bearer(natalia)).json()
    assert theirs == {"conversation": None, "turns": [], "pastConversationCount": 0}
    foreign = client.get(
        f"/api/v1/customer/conversations/{seed_case_id(101)}", headers=bearer(natalia)
    )
    assert (foreign.status_code, foreign.json()["code"]) == (404, "not_found")
    created = write(client, natalia, "Hola").json()
    assert created["caseCreated"]
    assert created["conversation"]["caseId"] != seed_case_id(101)


def test_past_conversations(client: TestClient, customer_session: Callable[..., str]) -> None:
    token = customer_session(PATRICIA)
    current = client.get("/api/v1/customer/conversation", headers=bearer(token)).json()
    assert current["conversation"]["caseId"] == PATRICIA_AGAIN
    assert current["conversation"]["previousCaseId"] == PATRICIA_REFUND
    assert current["pastConversationCount"] == 2
    past = client.get("/api/v1/customer/conversations", headers=bearer(token)).json()
    assert [item["caseId"] for item in past["items"]] == [PATRICIA_REFUND, PATRICIA_OLD]
    assert past["items"][1] == {
        "caseId": PATRICIA_OLD,
        "status": "closed",
        "channel": "web_chat",
        "openedAt": "2026-09-12T14:00:00Z",
        "closedAt": "2026-09-12T14:15:00Z",
        "agentName": "Julián",
        "preview": "Ah, es cierto. Gracias.",
    }
    detail = client.get(f"/api/v1/customer/conversations/{PATRICIA_OLD}", headers=bearer(token))
    assert detail.status_code == 200
    body = detail.json()
    assert body["conversation"]["status"] == "closed"
    assert body["conversation"]["agentName"] == "Julián"
    assert [t["authorRole"] for t in body["turns"]] == [
        "customer",
        "system",
        "analyst",
        "customer",
        "system",
    ]
    assert body["turns"][-1]["text"].startswith("La conversación terminó")
    assert all("resuelto" not in t["text"].lower() for t in body["turns"])  # never the reason
    current_too = client.get(
        f"/api/v1/customer/conversations/{PATRICIA_AGAIN}", headers=bearer(token)
    )
    assert current_too.status_code == 200  # any own case
    missing = client.get(
        f"/api/v1/customer/conversations/{seed_case_id(999)}", headers=bearer(token)
    )
    assert missing.status_code == 404


def start_shift(client: TestClient, token: str, drain: Callable[[], None]) -> None:
    """Daniela switches to "Disponible" (nobody starts available): she takes the seeded
    queues first, then new chats land on her."""
    availability(client, token, "available")
    drain()


def test_live_round_trip_customer_to_analyst_and_back(
    client: TestClient,
    customer_session: Callable[..., str],
    sign_in: Callable[[str], str],
    drain: Callable[[], None],
) -> None:
    start_shift(client, sign_in(ANALYST.email), drain)
    customer = customer_session(RAFAEL)
    cmid = str(uuid.uuid4())
    first = write(client, customer, "Olá, não reconheço uma compra no meu cartão", cmid)
    assert first.status_code == 201
    body = first.json()
    assert body["caseCreated"]
    # Assigned in the same request: no background routing.
    assert body["conversation"]["status"] == "with_agent"
    assert body["conversation"]["agentName"] == "Daniela"
    assert body["turn"]["clientMessageId"] == cmid
    replay = write(client, customer, "Olá, não reconheço uma compra no meu cartão", cmid)
    assert (replay.status_code, replay.headers["Idempotent-Replayed"]) == (200, "true")
    conflict = write(client, customer, "Outro texto", cmid)
    assert conflict.json()["code"] == "idempotency_conflict"

    case_id = body["conversation"]["caseId"]
    daniela = bearer(sign_in(ANALYST.email))
    inbox = client.get("/api/v1/cases/inbox?status=new", headers=daniela).json()
    assert case_id in [item["id"] for item in inbox["items"]]
    detail = client.get(f"/api/v1/cases/{case_id}", headers=daniela).json()
    assert detail["assignment"]["policyRuleId"] == "H1"  # rule 3
    assert detail["case"]["priority"] == "medium"
    assert detail["case"]["slaDueAt"] == "2026-10-02T14:15:00Z"

    answer_id = str(uuid.uuid4())
    answered = client.post(
        f"/api/v1/cases/{case_id}/turns",
        headers={**daniela, "Idempotency-Key": answer_id},
        json={"text": "Olá, Rafael! Sou a Daniela, vou te ajudar.", "clientMessageId": answer_id},
    )
    assert answered.status_code == 201
    conversation = client.get("/api/v1/customer/conversation", headers=bearer(customer)).json()
    assert conversation["conversation"]["status"] == "with_agent"
    last = conversation["turns"][-1]
    assert (last["authorRole"], last["authorName"], last["clientMessageId"]) == (
        "analyst",
        "Daniela",
        None,
    )
    since = client.get(
        "/api/v1/customer/conversation",
        params={"afterSequence": conversation["turns"][-2]["sequence"]},
        headers=bearer(customer),
    ).json()
    assert [t["text"] for t in since["turns"]] == ["Olá, Rafael! Sou a Daniela, vou te ajudar."]


def test_close_then_write_again_opens_a_linked_case(
    client: TestClient,
    customer_session: Callable[..., str],
    sign_in: Callable[[str], str],
    drain: Callable[[], None],
) -> None:
    token = customer_session(MARCELA)
    daniela_token = sign_in(ANALYST.email)
    start_shift(client, daniela_token, drain)
    daniela = bearer(daniela_token)
    closed = client.post(
        f"/api/v1/cases/{seed_case_id(101)}/close",
        headers=daniela,
        json={"reason": "resolved", "note": "Nota interna"},
    )
    assert closed.status_code == 200
    ended = client.get("/api/v1/customer/conversation", headers=bearer(token)).json()
    assert ended["conversation"]["status"] == "closed"
    assert ended["conversation"]["agentName"] == "Daniela"  # "Te atendió Daniela"
    assert ended["pastConversationCount"] == 0  # the closed one is still the current one
    assert "Nota interna" not in str(ended)

    again = write(client, token, "Hola, otra vez").json()
    assert again["caseCreated"]
    new_id = again["conversation"]["caseId"]
    assert new_id != seed_case_id(101)
    assert again["conversation"]["previousCaseId"] == seed_case_id(101)
    assert again["conversation"]["status"] == "with_agent"
    now = client.get("/api/v1/customer/conversation", headers=bearer(token)).json()
    assert now["conversation"]["caseId"] == new_id
    assert now["pastConversationCount"] == 1
    past = client.get("/api/v1/customer/conversations", headers=bearer(token)).json()
    assert [item["caseId"] for item in past["items"]] == [seed_case_id(101)]

    card = client.get(f"/api/v1/cases/{new_id}", headers=daniela).json()
    assert (card["case"]["previousCaseId"], card["previousCaseCount"]) == (seed_case_id(101), 1)
    history = client.get(f"/api/v1/cases/{new_id}/history", headers=daniela).json()
    assert [(i["id"], i["closeReason"]) for i in history["items"]] == [
        (seed_case_id(101), "resolved")
    ]


def test_queue_and_drain_through_the_api(
    client: TestClient,
    customer_session: Callable[..., str],
    sign_in: Callable[[str], str],
    drain: Callable[[], None],
) -> None:
    daniela = sign_in(ANALYST.email)
    availability(client, daniela, "paused")
    token = customer_session(RAFAEL)
    queued = write(client, token, "Olá").json()
    assert queued["conversation"]["status"] == "waiting_agent"
    assert queued["conversation"]["agentName"] is None
    availability(client, daniela, "available")
    drain()  # the queue drains in the background
    after = client.get("/api/v1/customer/conversation", headers=bearer(token)).json()
    assert after["conversation"]["status"] == "with_agent"
    detail = client.get(
        f"/api/v1/cases/{queued['conversation']['caseId']}", headers=bearer(daniela)
    ).json()
    assert detail["assignment"]["reason"] == "queue_drained"
    assert detail["assignment"]["queueLabel"] == "Cola en portugués"
    assert detail["assignment"]["waitedSeconds"] == 0


def test_least_loaded_analyst_gets_the_next_case(
    client: TestClient,
    customer_session: Callable[..., str],
    sign_in: Callable[[str], str],
    drain: Callable[[], None],
    available: Callable[..., None],
) -> None:
    available(seed_staff_id(ANALYST.number))  # Daniela (5 open) is available too
    sebastian = sign_in(SEBASTIAN.email)
    availability(client, sebastian, "available")
    drain()  # he speaks es + pt and holds nothing: the three queued cases go to him
    case_id = write(client, customer_session(NATALIA), "Hola").json()["conversation"]["caseId"]
    inbox = client.get("/api/v1/cases/inbox", headers=bearer(sebastian)).json()
    # 3 open cases against Daniela's 5: he also gets the next Spanish case.
    queued = {seed_case_id(n) for n in (109, 111, 112)}
    assert {item["id"] for item in inbox["items"]} == {*queued, case_id}


def test_an_overflowing_after_sequence_is_422(
    client: TestClient, customer_session: Callable[..., str]
) -> None:
    token = customer_session(MARCELA)
    for value in ("9223372036854775808", "9" * 23):
        response = client.get(
            "/api/v1/customer/conversation",
            params={"afterSequence": value},
            headers=bearer(token),
        )
        assert response.status_code == 422, response.text
