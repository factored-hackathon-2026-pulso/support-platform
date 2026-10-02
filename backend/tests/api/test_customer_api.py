"""Customer chat simulator API: picker, sessions, conversation, and the live round trip."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from tests.support import ANALYST, SEBASTIAN, bearer

NATALIA, RAFAEL, MARCELA, PATRICIA = 2001, 2004, 1001, 1004


def write(client: TestClient, token: str, text: str, cmid: str | None = None) -> Any:
    cmid = cmid or str(uuid.uuid4())
    return client.post(
        "/api/v1/customer/conversation/turns",
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"text": text, "clientMessageId": cmid},
    )


def test_demo_customers_simulator_first_then_open_chats(client: TestClient) -> None:
    items = client.get("/api/v1/customer/demo-customers").json()["items"]
    names = [item["displayName"].split()[0] for item in items]
    assert names == [
        "Natalia", "Ximena", "Lucas", "Rafael", "Andrés",  # simulator customers
        "Marcela", "Beatriz", "Larissa", "Joaquín",  # open chat cases (not email/phone)
    ]  # fmt: skip
    assert items[0]["openConversation"] is None
    assert len(items[0]["suggestions"]) == 3
    assert items[3]["locale"] == "pt-BR"
    assert items[5]["openConversation"] == {
        "caseId": seed_case_id(101),
        "channel": "web_chat",
        "status": "with_agent",
    }


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
    # An open case decides the channel.
    marcela = client.post(
        "/api/v1/customer/sessions", json={"customerId": seed_customer_id(MARCELA)}
    )
    assert marcela.json()["channel"] == "web_chat"
    for unknown in (seed_customer_id(9999), "nope"):
        missing = client.post("/api/v1/customer/sessions", json={"customerId": unknown})
        assert (missing.status_code, missing.json()["code"]) == (404, "not_found")
    email = client.post(
        "/api/v1/customer/sessions", json={"customerId": seed_customer_id(PATRICIA)}
    )
    assert email.status_code == 404  # her open case is an email: not a chat
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
    on_customer_route = client.get("/api/v1/customer/conversation", headers=bearer(staff))
    assert (on_customer_route.status_code, on_customer_route.json()["code"]) == (
        401,
        "unauthenticated",
    )
    assert client.get("/api/v1/customer/conversation").status_code == 401


def test_a_customer_only_ever_sees_their_own_conversation(
    client: TestClient, customer_session: Callable[..., str]
) -> None:
    marcela = customer_session(MARCELA)
    natalia = customer_session(NATALIA)
    mine = client.get("/api/v1/customer/conversation", headers=bearer(marcela)).json()
    assert mine["conversation"]["caseId"] == seed_case_id(101)
    assert all(turn["kind"] in {"message", "notice"} for turn in mine["turns"])
    assert "Escalado" not in " ".join(turn["text"] for turn in mine["turns"])  # staff banner
    theirs = client.get("/api/v1/customer/conversation", headers=bearer(natalia)).json()
    assert theirs == {"conversation": None, "turns": []}
    # Writing as Natalia never lands in Marcela's case.
    created = write(client, natalia, "Hola").json()
    assert created["caseCreated"]
    assert created["conversation"]["caseId"] != seed_case_id(101)


def test_live_round_trip_customer_to_analyst_and_back(
    client: TestClient,
    customer_session: Callable[..., str],
    sign_in: Callable[[str], str],
    drain: Callable[[], None],
) -> None:
    customer = customer_session(RAFAEL)
    cmid = str(uuid.uuid4())
    first = write(client, customer, "Olá, não reconheço uma compra no meu cartão", cmid)
    assert first.status_code == 201
    body = first.json()
    assert body["caseCreated"]
    assert body["conversation"]["status"] == "waiting_agent"
    assert body["turn"]["clientMessageId"] == cmid
    replay = write(client, customer, "Olá, não reconheço uma compra no meu cartão", cmid)
    assert (replay.status_code, replay.headers["Idempotent-Replayed"]) == (200, "true")
    conflict = write(client, customer, "Outro texto", cmid)
    assert conflict.json()["code"] == "idempotency_conflict"
    drain()  # routing runs in the background

    case_id = body["conversation"]["caseId"]
    daniela = bearer(sign_in(ANALYST.email))
    inbox = client.get("/api/v1/cases/inbox?status=new", headers=daniela).json()
    assert case_id in [item["id"] for item in inbox["items"]]
    detail = client.get(f"/api/v1/cases/{case_id}", headers=daniela).json()
    assert detail["case"]["topic"] is None  # "Sin clasificar": no judge yet
    assert detail["assignment"]["policyRuleId"] == "H1"  # rule 3
    assert [s["reasonCode"] for s in detail["routing"]["stops"][:3]] == [
        "component_not_connected"
    ] * 3

    answer_id = str(uuid.uuid4())
    answered = client.post(
        f"/api/v1/cases/{case_id}/turns",
        headers={**daniela, "Idempotency-Key": answer_id},
        json={"text": "Olá, Rafael! Sou a Daniela, vou te ajudar.", "clientMessageId": answer_id},
    )
    assert answered.status_code == 201
    conversation = client.get("/api/v1/customer/conversation", headers=bearer(customer)).json()
    assert conversation["conversation"]["status"] == "with_agent"
    assert conversation["conversation"]["agentName"] == "Daniela"
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


def test_least_loaded_analyst_gets_the_next_case(
    client: TestClient,
    customer_session: Callable[..., str],
    sign_in: Callable[[str], str],
    drain: Callable[[], None],
) -> None:
    sebastian = bearer(sign_in(SEBASTIAN.email))
    assert (
        client.put(
            "/api/v1/me/availability", headers=sebastian, json={"status": "available"}
        ).json()["status"]
        == "available"
    )
    case_id = write(client, customer_session(NATALIA), "Hola").json()["conversation"]["caseId"]
    drain()
    inbox = client.get("/api/v1/cases/inbox", headers=sebastian).json()
    assert [item["id"] for item in inbox["items"]] == [case_id]
