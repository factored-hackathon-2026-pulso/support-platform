"""Realtime of administration (slice 4 §9): ``admin:directory`` and ``staff:<id>`` access,
``directory.updated`` and ``me.updated``, the extra supervision signals, and the sockets a
roles change (4409) or a deactivation (4401) closes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from cc_platform.api.schemas.people import StaffOut
from cc_platform.api.schemas.supervision import QueueCounts
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.people import seed_staff_id, seed_team_id
from tests.api.test_cases_realtime import close_case, connect, subscribe, until_pong
from tests.api.test_supervision_realtime import put_assignee
from tests.support import ADMIN, ADMIN_ONLY, ANALYST, SUPERVISOR, TEAM_LEAD, TOMAS, bearer

SignIn = Callable[[str], str]
DIRECTORY = "admin:directory"
TEAM, QUEUES = "supervision:team", "supervision:queues"
DANIELA_ID, TOMAS_ID, FELIPE_ID = seed_staff_id(1), seed_staff_id(8), seed_staff_id(11)
VALERIA_ID, MARIANA_ID, JULIAN_ID = seed_staff_id(7), seed_staff_id(12), seed_staff_id(2)
MARCELA_CASE, CAMILA_CASE = seed_case_id(101), seed_case_id(113)  # Daniela's, Julián's
ANDES, PACIFICO = seed_team_id(1), seed_team_id(2)


def version_of(client: TestClient, token: str, staff_id: str) -> int:
    version: int = client.get(f"/api/v1/admin/users/{staff_id}", headers=bearer(token)).json()[
        "version"
    ]
    return version


def patch_user(client: TestClient, token: str, staff_id: str, **changes: Any) -> dict[str, Any]:
    body = {"expectedVersion": version_of(client, token, staff_id), **changes}
    response = client.patch(f"/api/v1/admin/users/{staff_id}", json=body, headers=bearer(token))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def _read_forever(ws: Any) -> None:
    while True:
        ws.receive_json()


def closed_by_server(ws: Any) -> WebSocketDisconnect:
    """Read until the server closes the socket; the close frame."""
    with pytest.raises(WebSocketDisconnect) as closed:
        _read_forever(ws)
    return closed.value


def of_type(envelopes: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [e for e in envelopes if e["type"] == kind]


def test_topic_access(client: TestClient, sign_in: SignIn, customer_session: Any) -> None:
    with connect(client, sign_in(ADMIN.email)) as admin:
        admin.receive_json()
        assert subscribe(admin, DIRECTORY)["type"] == "subscribed"
        assert subscribe(admin, f"staff:{seed_staff_id(9)}")["type"] == "subscribed"  # herself
        assert subscribe(admin, f"staff:{VALERIA_ID}")["data"]["code"] == "forbidden"
        for bad in ("admin:users", "admin:", "staff:nope", "staff:TEAM-" + "0" * 26):
            assert subscribe(admin, bad)["data"]["code"] == "invalid_topic", bad
    with connect(client, sign_in(SUPERVISOR.email)) as lucia:
        lucia.receive_json()
        assert subscribe(lucia, DIRECTORY)["data"]["code"] == "forbidden"
        assert subscribe(lucia, f"staff:{seed_staff_id(5)}")["type"] == "subscribed"
    with connect(client, customer_session(2001)) as customer:
        customer.receive_json()
        assert subscribe(customer, DIRECTORY)["data"]["code"] == "forbidden"
        assert subscribe(customer, f"staff:{DANIELA_ID}")["data"]["code"] == "forbidden"


def test_directory_updated_carries_ids_only(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    with connect(client, sign_in(ADMIN.email)) as ws:
        ws.receive_json()
        subscribe(ws, DIRECTORY)
        patch_user(client, admin, TOMAS_ID, teamId=ANDES)
        client.post(f"/api/v1/admin/users/{MARIANA_ID}/unlock", headers=bearer(admin))
        created = client.post("/api/v1/admin/teams", json={"name": "Equipo Sur"},
                              headers=bearer(admin)).json()  # fmt: skip
        received = of_type(until_pong(ws), "directory.updated")
    payloads = [e["data"]["payload"] for e in received]
    assert payloads == [
        {"staffIds": [TOMAS_ID], "teamIds": [PACIFICO, ANDES]},
        {"staffIds": [MARIANA_ID], "teamIds": [PACIFICO]},
        {"staffIds": [], "teamIds": [created["id"]]},
    ]
    assert all(e["id"].startswith("EVT-") for e in received)


def test_availability_and_locks_reach_the_directory(
    client: TestClient, sign_in: SignIn, drain: Callable[[], None]
) -> None:
    admin = sign_in(ADMIN.email)

    def open_total() -> int:
        user = client.get(f"/api/v1/admin/users/{TOMAS_ID}", headers=bearer(admin)).json()
        total: int = user["openCases"]["total"]
        return total

    before = open_total()
    with connect(client, admin) as ws:
        ws.receive_json()
        subscribe(ws, DIRECTORY)
        client.put("/api/v1/me/availability", json={"status": "available"},
                   headers=bearer(sign_in(TOMAS.email)))  # fmt: skip
        drain()  # the queue hands him waiting cases
        for _ in range(5):
            client.post("/api/v1/auth/login", json={"email": TOMAS.email, "password": "nope"})
        received = of_type(until_pong(ws), "directory.updated")
    handed = open_total() - before
    assert handed > 0
    # The availability change, one signal per case the queue hands him, then the lock.
    assert [e["data"]["payload"] for e in received] == [{"staffIds": [TOMAS_ID], "teamIds": []}] * (
        1 + handed + 1
    )


def test_case_moves_reach_the_directory(
    client: TestClient,
    sign_in: SignIn,
    available: Callable[..., None],
    drain: Callable[[], None],
) -> None:
    """``openCases`` gates deactivation (§3.6): a reassignment or a close must refresh it."""
    available(DANIELA_ID)
    admin = sign_in(ADMIN.email)

    def open_total(staff_id: str) -> int:
        user = client.get(f"/api/v1/admin/users/{staff_id}", headers=bearer(admin)).json()
        total: int = user["openCases"]["total"]
        return total

    julian_before, daniela_before = open_total(JULIAN_ID), open_total(DANIELA_ID)
    with connect(client, admin) as ws:
        ws.receive_json()
        subscribe(ws, DIRECTORY)
        put_assignee(
            client,
            sign_in(SUPERVISOR.email),
            CAMILA_CASE,
            {"analystId": DANIELA_ID, "expectedAnalystId": JULIAN_ID},
        )
        close_case(client, bearer(sign_in(ANALYST.email)), MARCELA_CASE)
        drain()  # the freed slot may pull a waiting case to her
        received = of_type(until_pong(ws), "directory.updated")
    pulled = len(received) - 2
    assert [e["data"]["payload"] for e in received] == [
        {"staffIds": [JULIAN_ID, DANIELA_ID], "teamIds": []},  # the reassignment
        {"staffIds": [DANIELA_ID], "teamIds": []},  # her close
        *[{"staffIds": [DANIELA_ID], "teamIds": []}] * pulled,  # cases the queue hands her
    ]
    assert open_total(JULIAN_ID) == julian_before - 1
    assert open_total(DANIELA_ID) == daniela_before + pulled  # one more, one closed


def test_me_updated_reaches_only_that_person(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    daniela = sign_in(ANALYST.email)
    with connect(client, daniela) as mine, connect(client, sign_in(TOMAS.email)) as other:
        mine.receive_json()
        other.receive_json()
        subscribe(mine, f"staff:{DANIELA_ID}")
        subscribe(other, f"staff:{TOMAS_ID}")
        patch_user(client, admin, DANIELA_ID, name="Daniela Ríos Paz")
        received = of_type(until_pong(mine), "me.updated")
        assert of_type(until_pong(other), "me.updated") == []
    (envelope,) = received
    payload = envelope["data"]["payload"]
    assert StaffOut.model_validate(payload).model_dump(mode="json", by_alias=True) == payload
    assert (payload["name"], payload["team"]["id"]) == ("Daniela Ríos Paz", ANDES)


def test_a_team_rename_updates_each_active_member(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    with (
        connect(client, sign_in(TOMAS.email)) as tomas,
        connect(client, sign_in(SUPERVISOR.email)) as lucia,
    ):
        tomas.receive_json()
        lucia.receive_json()
        subscribe(tomas, f"staff:{TOMAS_ID}")
        subscribe(lucia, TEAM)
        team = client.get(f"/api/v1/admin/teams/{PACIFICO}", headers=bearer(admin)).json()["team"]
        renamed = client.patch(
            f"/api/v1/admin/teams/{PACIFICO}",
            json={"expectedVersion": team["version"], "name": "Equipo Pacífico Sur"},
            headers=bearer(admin),
        )
        assert renamed.status_code == 200
        mine = of_type(until_pong(tomas), "me.updated")
        rows = of_type(until_pong(lucia), "team.updated")
    assert [e["data"]["payload"]["team"]["name"] for e in mine] == ["Equipo Pacífico Sur"]
    (row,) = rows
    assert set(row["data"]["payload"]["staffIds"]) == {
        seed_staff_id(3),
        seed_staff_id(4),
        TOMAS_ID,
    }  # Pacífico's active analysts
    overview = client.get("/api/v1/supervision/team", headers=bearer(sign_in(SUPERVISOR.email)))
    assert "Equipo Pacífico Sur" in [t["name"] for t in overview.json()["teams"]]


def test_supervision_gets_team_and_queue_signals(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    with connect(client, sign_in(SUPERVISOR.email)) as ws:
        ws.receive_json()
        subscribe(ws, TEAM)
        subscribe(ws, QUEUES)
        patch_user(client, admin, TOMAS_ID, languages=["es"])
        patch_user(client, admin, seed_staff_id(6), name="Martín Salazar Gil")  # supervisor
        received = until_pong(ws)
    assert [e["type"] for e in received] == ["team.updated", "queue.updated"]
    assert received[0]["data"]["payload"] == {"staffIds": [TOMAS_ID]}
    counts = received[1]["data"]["payload"]
    assert QueueCounts.model_validate(counts).model_dump(mode="json", by_alias=True) == counts
    queues = client.get("/api/v1/supervision/queues", headers=bearer(sign_in(SUPERVISOR.email)))
    portuguese = next(q for q in queues.json()["queues"] if q["language"] == "pt")
    assert portuguese["speakers"] == 2  # Daniela and Sebastián (Tomás no longer)


def test_a_roles_change_closes_only_that_persons_sockets_with_4409(
    client: TestClient, sign_in: SignIn
) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    felipe = sign_in(TEAM_LEAD.email)
    with (
        connect(client, felipe) as first,
        connect(client, felipe) as second,
        connect(client, sign_in(ANALYST.email)) as daniela,
    ):
        for ws in (first, second, daniela):
            ws.receive_json()
        subscribe(first, TEAM)
        patch_user(client, admin, FELIPE_ID, roles=["analyst"])
        for ws in (first, second):
            closed = closed_by_server(ws)
            assert (closed.code, closed.reason) == (4409, "access_changed")
        daniela.send_json({"action": "ping"})
        assert daniela.receive_json()["type"] == "pong"  # untouched
    # The session is still valid: he reconnects at once, and the lost topic is refused.
    with connect(client, felipe) as again:
        again.receive_json()
        assert subscribe(again, TEAM)["data"]["code"] == "forbidden"
        assert subscribe(again, f"inbox:{FELIPE_ID}")["type"] == "subscribed"


def test_a_name_change_does_not_close_sockets(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN_ONLY.email)
    with connect(client, sign_in(TEAM_LEAD.email)) as ws:
        ws.receive_json()
        patch_user(client, admin, FELIPE_ID, name="Felipe Echeverri Paz")
        ws.send_json({"action": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_deactivation_closes_her_sockets_with_4401(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN.email)
    with connect(client, sign_in(TOMAS.email)) as ws:
        ws.receive_json()
        version = version_of(client, admin, TOMAS_ID)
        response = client.post(
            f"/api/v1/admin/users/{TOMAS_ID}/deactivate",
            json={"expectedVersion": version},
            headers=bearer(admin),
        )
        assert response.json()["revokedSessions"] == 1
        closed = closed_by_server(ws)
        assert (closed.code, closed.reason) == (4401, "session_ended")


def test_a_password_reset_closes_her_sockets_with_4401(client: TestClient, sign_in: SignIn) -> None:
    admin = sign_in(ADMIN.email)
    with connect(client, sign_in(TOMAS.email)) as ws:
        ws.receive_json()
        client.post(f"/api/v1/admin/users/{TOMAS_ID}/password-reset", headers=bearer(admin))
        assert closed_by_server(ws).code == 4401
