"""Realtime of supervision (slice 3 contract §3.10, §7): ``case.unassigned`` to the previous
inbox, the supervision topics and their access, what the customer sees of a reassignment,
and ``case.viewed`` on no socket."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from cc_platform.api.schemas.cases import CaseSummary, Escalation, InboxCounts
from cc_platform.api.schemas.common import ApiModel
from cc_platform.api.schemas.supervision import QueueCounts
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.api.test_cases_realtime import (
    close_case,
    connect,
    post_as_customer,
    subscribe,
    until_pong,
)
from tests.support import ADMIN, ANALYST, JULIAN, SUPERVISOR, TEAM_LEAD, bearer

DANIELA_ID, JULIAN_ID, LUCIA_ID = seed_staff_id(1), seed_staff_id(2), seed_staff_id(5)
MARCELA, ROSA_ES, CAMILA = seed_case_id(101), seed_case_id(111), seed_case_id(113)
QUEUES, TEAM = "supervision:queues", "supervision:team"

SignIn = Callable[[str], str]

SCHEMAS: dict[str, type[ApiModel]] = {
    "escalation.updated": Escalation,
    "case.updated": CaseSummary,
    "case.assigned": CaseSummary,
    "case.unassigned": CaseSummary,
    "queue.case_queued": CaseSummary,
    "inbox.counts": InboxCounts,
    "queue.updated": QueueCounts,
}


def validate(envelopes: list[dict[str, Any]]) -> None:
    for envelope in envelopes:
        payload = envelope["data"]["payload"]
        if envelope["type"] == "team.updated":
            assert set(payload) == {"staffIds"}
            continue
        schema = SCHEMAS[envelope["type"]]
        assert schema.model_validate(payload).model_dump(mode="json", by_alias=True) == payload


def put_assignee(client: TestClient, token: str, case_id: str, body: dict[str, Any]) -> None:
    response = client.put(
        f"/api/v1/supervision/cases/{case_id}/assignee", headers=bearer(token), json=body
    )
    assert response.status_code == 200, response.text


def availability(client: TestClient, token: str, status: str) -> None:
    response = client.put("/api/v1/me/availability", headers=bearer(token), json={"status": status})
    assert response.status_code == 200, response.text


def of_type(envelopes: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [e for e in envelopes if e["type"] == kind]


# ----------------------------------------------------------------------------- access
@pytest.mark.parametrize(
    ("email", "allowed"),
    [
        (SUPERVISOR.email, True),
        (TEAM_LEAD.email, True),
        (ANALYST.email, False),
        (ADMIN.email, False),
    ],
)
def test_supervision_topics_are_for_supervisors(
    client: TestClient, sign_in: SignIn, email: str, allowed: bool
) -> None:
    with connect(client, sign_in(email)) as ws:
        ws.receive_json()
        for topic in (QUEUES, TEAM):
            reply = subscribe(ws, topic)
            if allowed:
                assert (reply["type"], reply["data"]) == ("subscribed", {"topic": topic})
            else:
                assert (reply["type"], reply["data"]["code"]) == ("error", "forbidden")


def test_customers_and_unknown_keys_are_refused(
    client: TestClient, sign_in: SignIn, customer_session: Callable[..., str]
) -> None:
    with connect(client, customer_session(1009)) as customer:
        customer.receive_json()
        assert subscribe(customer, QUEUES)["data"]["code"] == "forbidden"
        assert subscribe(customer, TEAM)["data"]["code"] == "forbidden"
    with connect(client, sign_in(SUPERVISOR.email)) as ws:
        ws.receive_json()
        for raw in ("supervision:approvals", "supervision:", "supervision", "supervision:Team"):
            reply = subscribe(ws, raw)
            assert (reply["type"], reply["data"]["code"]) == ("error", "invalid_topic"), raw


# ----------------------------------------------------------------------------- reassignment
def test_reassignment_reaches_both_inboxes_and_the_customer(
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    available: Callable[..., None],
) -> None:
    available(DANIELA_ID)
    lucia = sign_in(SUPERVISOR.email)
    camila = customer_session(1011)
    with (
        connect(client, sign_in(JULIAN.email)) as julian,
        connect(client, sign_in(ANALYST.email)) as daniela,
        connect(client, camila) as customer,
        connect(client, lucia) as supervisor,
    ):
        for ws in (julian, daniela, customer, supervisor):
            ws.receive_json()
        subscribe(julian, f"inbox:{JULIAN_ID}")
        subscribe(daniela, f"inbox:{DANIELA_ID}")
        subscribe(customer, "customer:" + "CUS-" + "1011".zfill(26))
        subscribe(supervisor, TEAM)
        subscribe(supervisor, QUEUES)
        put_assignee(
            client, lucia, CAMILA, {"analystId": DANIELA_ID, "expectedAnalystId": JULIAN_ID}
        )
        to_julian, to_daniela = until_pong(julian), until_pong(daniela)
        to_customer, to_supervisor = until_pong(customer), until_pong(supervisor)

    # Julián had escalated 113 (seed): the reassignment ends it, and he hears it (slice 9).
    (ended,) = of_type(to_julian, "escalation.updated")
    assert (ended["data"]["payload"]["state"], ended["data"]["payload"]["reassignedToId"]) == (
        "reassigned",
        DANIELA_ID,
    )
    case_envelopes = [e for e in to_julian if e["type"] != "escalation.updated"]
    assert [e["type"] for e in case_envelopes] == [
        "case.updated",
        "case.unassigned",
        "inbox.counts",
    ]
    unassigned = case_envelopes[1]
    assert unassigned["data"]["payload"]["assignedAnalystId"] == DANIELA_ID
    assert unassigned["data"]["actor"] == {"role": "supervisor", "id": LUCIA_ID}
    julian_counts = case_envelopes[2]["data"]["payload"]
    assert (julian_counts["all"], julian_counts["toReply"]) == (1, 0)  # 114 only
    validate(to_julian)

    assigned = of_type(to_daniela, "case.assigned")
    assert [e["data"]["payload"]["id"] for e in assigned] == [CAMILA]
    assert assigned[0]["data"]["actor"]["role"] == "supervisor"  # "desde supervisión"
    assert of_type(to_daniela, "inbox.counts")[-1]["data"]["payload"]["new"] == 3
    assert not of_type(to_daniela, "case.unassigned")
    validate(to_daniela)

    # The customer: the new name and the notice, never the banner nor who reassigned.
    assert [e["type"] for e in to_customer] == [
        "conversation.updated",
        "conversation.updated",
        "turn.created",
    ]
    assert (
        to_customer[-1]["data"]["payload"]["text"] == "Ahora te atiende Daniela, de nuestro equipo."
    )
    assert {e["data"]["payload"]["agentName"] for e in to_customer[:2]} == {"Daniela"}
    for envelope in to_customer:
        assert envelope["data"]["actor"] == {"role": "system", "id": None}
        assert "Lucía" not in str(envelope)
        assert "Julián" not in str(envelope)

    team = of_type(to_supervisor, "team.updated")
    assert [DANIELA_ID, JULIAN_ID] in [e["data"]["payload"]["staffIds"] for e in team]
    assert not of_type(to_supervisor, "queue.updated")  # an open case never was queued


def test_assignment_from_the_queue_updates_the_queues(
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    available: Callable[..., None],
) -> None:
    available(DANIELA_ID)
    lucia = sign_in(SUPERVISOR.email)
    rosa = customer_session(1009)
    with connect(client, lucia) as supervisor, connect(client, rosa) as customer:
        supervisor.receive_json()
        customer.receive_json()
        subscribe(supervisor, QUEUES)
        subscribe(supervisor, TEAM)
        subscribe(customer, "customer:" + "CUS-" + "1009".zfill(26))
        put_assignee(client, lucia, ROSA_ES, {"analystId": DANIELA_ID, "expectedAnalystId": None})
        to_supervisor, to_customer = until_pong(supervisor), until_pong(customer)

    updates = of_type(to_supervisor, "queue.updated")
    assert [u["data"]["payload"]["total"] for u in updates] == [2]  # it left the queue
    assert [e["data"]["payload"]["staffIds"] for e in of_type(to_supervisor, "team.updated")] == [
        [DANIELA_ID]
    ]
    validate(to_supervisor)
    # From the queue the customer only sees the header change ("Te atiende Daniela").
    assert [e["type"] for e in to_customer] == ["conversation.updated"]
    assert (
        to_customer[0]["data"]["payload"]["status"],
        to_customer[0]["data"]["payload"]["agentName"],
    ) == (
        "with_agent",
        "Daniela",
    )


# ----------------------------------------------------------------------------- queues
def test_a_case_entering_and_leaving_the_queue(
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
) -> None:
    daniela = sign_in(ANALYST.email)
    availability(client, daniela, "paused")
    with connect(client, sign_in(SUPERVISOR.email)) as supervisor:
        supervisor.receive_json()
        subscribe(supervisor, QUEUES)
        post_as_customer(client, customer_session(2001), "Hola, no reconozco un cargo")
        entered = until_pong(supervisor)
        post_as_customer(client, customer_session(1009), "¿Hay alguien?")  # a queued case
        message = until_pong(supervisor)
        availability(client, daniela, "available")
        drain()  # Daniela gets every queued case
        drained = until_pong(supervisor)

    queued = of_type(entered, "queue.case_queued")
    assert len(queued) == 1
    assert queued[0]["data"]["payload"]["customer"]["displayName"] == "Natalia Guzmán Rincón"
    assert queued[0]["data"]["payload"]["status"] == "queued"
    assert {u["data"]["payload"]["total"] for u in of_type(entered, "queue.updated")} == {4}
    assert [e["type"] for e in message] == ["queue.updated"]
    assert of_type(drained, "queue.updated")[-1]["data"]["payload"]["total"] == 0
    validate(entered + message + drained)


def test_a_case_assigned_on_arrival_sends_no_queue_update(
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    drain: Callable[[], None],
) -> None:
    """A new case that goes straight to an available analyst never entered a queue: the
    team row changes, the queue counts do not (contract §7.2)."""
    availability(client, sign_in(ANALYST.email), "available")
    drain()  # Daniela takes the seeded queues first
    with connect(client, sign_in(SUPERVISOR.email)) as supervisor:
        supervisor.receive_json()
        subscribe(supervisor, QUEUES)
        subscribe(supervisor, TEAM)
        post_as_customer(client, customer_session(2001), "Hola, no reconozco un cargo")
        arrival = until_pong(supervisor)

    assert of_type(arrival, "team.updated")
    assert [e["data"]["payload"]["staffIds"] for e in of_type(arrival, "team.updated")] == [
        [DANIELA_ID]
    ] * len(of_type(arrival, "team.updated"))
    assert not of_type(arrival, "queue.updated")
    assert not of_type(arrival, "queue.case_queued")


# ----------------------------------------------------------------------------- team
def test_team_updated_triggers(
    client: TestClient,
    sign_in: SignIn,
    customer_session: Callable[..., str],
    available: Callable[..., None],
) -> None:
    available(DANIELA_ID)  # so that pausing is a change
    daniela = sign_in(ANALYST.email)
    marcela = customer_session(1001)
    with connect(client, sign_in(SUPERVISOR.email)) as supervisor:
        supervisor.receive_json()
        subscribe(supervisor, TEAM)
        post_as_customer(client, marcela, "Sigo esperando")
        message = until_pong(supervisor)
        availability(client, daniela, "paused")
        paused = until_pong(supervisor)
        sign_in(JULIAN.email)
        session = until_pong(supervisor)
        sign_in(SUPERVISOR.email)  # a supervisor's session is not a team row
        not_analyst = until_pong(supervisor)
        close_case(client, bearer(daniela), MARCELA)
        closed = until_pong(supervisor)

    def ids(envelopes: list[dict[str, Any]]) -> list[list[str]]:
        return [e["data"]["payload"]["staffIds"] for e in of_type(envelopes, "team.updated")]

    assert ids(message) == [[DANIELA_ID]]  # the customer's message (not the notice)
    assert ids(paused) == [[DANIELA_ID]]
    assert ids(session) == [[JULIAN_ID]]
    assert not_analyst == []
    # case.closed + case.status_changed + escalation.closed (101 was escalated, slice 9)
    assert ids(closed) == [[DANIELA_ID], [DANIELA_ID], [DANIELA_ID]]
    for envelope in session:
        assert envelope["type"] == "team.updated"  # auth events never go out raw


# ----------------------------------------------------------------------------- case.viewed
def test_a_supervisor_view_reaches_no_socket(client: TestClient, sign_in: SignIn) -> None:
    lucia, daniela = sign_in(SUPERVISOR.email), sign_in(ANALYST.email)
    with connect(client, lucia) as supervisor, connect(client, daniela) as analyst:
        supervisor.receive_json()
        analyst.receive_json()
        for topic in (f"case:{MARCELA}", f"inbox:{DANIELA_ID}", QUEUES, TEAM):
            assert subscribe(supervisor, topic)["type"] == "subscribed"
        subscribe(analyst, f"case:{MARCELA}")
        subscribe(analyst, f"inbox:{DANIELA_ID}")
        response = client.get(f"/api/v1/cases/{MARCELA}", headers=bearer(lucia))
        assert response.status_code == 200
        assert until_pong(supervisor) == []
        assert until_pong(analyst) == []
    log = client.get(
        "/api/v1/audit/events",
        headers=bearer(lucia),
        params={"caseId": MARCELA, "family": "access"},
    ).json()["items"]
    assert [e["type"] for e in log] == ["case.viewed"]
