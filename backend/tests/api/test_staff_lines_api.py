"""Slice 23c: a staff-only transcript line carries its facts (``staffLine``) through REST and
the socket, stored in the database next to its Spanish text."""

from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from cc_platform.infrastructure.seed.cases import seed_case_id
from tests.api.test_cases_realtime import assert_contract_payloads, connect, subscribe, until_pong
from tests.api.test_escalations_api import escalate
from tests.support import ANALYST, bearer

SignIn = Callable[[str], str]
BEATRIZ, PATRICIA = seed_case_id(102), seed_case_id(108)


def test_routing_turns_carry_their_facts(client: TestClient, sign_in: SignIn) -> None:
    daniela = bearer(sign_in(ANALYST.email))
    turns = client.get(f"/api/v1/cases/{BEATRIZ}/turns", headers=daniela).json()["items"]
    routing = [t for t in turns if t["kind"] == "routing"]
    assert routing[0]["staffLine"] == {
        "kind": "assigned_on_arrival",
        "params": {"analyst": "Daniela Ríos", "language": "es"},
    }
    assert routing[0]["text"] == "Asignado a Daniela Ríos porque está disponible y habla español."
    assert all(t["staffLine"] is None for t in turns if t["kind"] != "routing")


def test_a_new_line_reaches_the_socket_with_its_facts(client: TestClient, sign_in: SignIn) -> None:
    token = sign_in(ANALYST.email)
    with connect(client, token) as ws:
        ws.receive_json()
        subscribe(ws, f"case:{PATRICIA}")
        created = escalate(client, token, PATRICIA)
        assert created.status_code == 201, created.text
        received = until_pong(ws)
    assert_contract_payloads(received)
    turns = [e["data"]["payload"] for e in received if e["type"] == "turn.created"]
    (line,) = [t for t in turns if t["kind"] == "routing"]
    assert line["staffLine"] == {"kind": "escalated", "params": {"analyst": "Daniela Ríos"}}
    stored = client.get(f"/api/v1/cases/{PATRICIA}/turns", headers=bearer(token)).json()["items"]
    assert stored[-1]["staffLine"] == line["staffLine"]
