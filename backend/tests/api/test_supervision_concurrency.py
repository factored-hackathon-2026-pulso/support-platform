"""Manual assignment racing other writers on a real SQLite file (separate connections,
contract §3.9): every race ends in one consistent state, never a lost update."""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import (
    DEV_MFA_CODE,
    JULIAN,
    PASSWORD,
    SECOND_SUPERVISOR,
    SUPERVISOR,
    bearer,
    make_available_quietly,
    make_settings,
)

CAMILA, MAURICIO = seed_case_id(113), seed_case_id(112)
DANIELA_ID, JULIAN_ID, FELIPE_ID = seed_staff_id(1), seed_staff_id(2), seed_staff_id(11)


@pytest.fixture
async def setup(tmp_path: Path) -> AsyncIterator[tuple[httpx.AsyncClient, Container]]:
    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    container = build_container(settings)
    await container.startup()
    await make_available_quietly(container.uow, DANIELA_ID)  # the reassignment target
    transport = httpx.ASGITransport(app=create_app(container=container))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http, container
    await container.shutdown()


async def headers_for(http: httpx.AsyncClient, email: str) -> dict[str, str]:
    login = await http.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    mfa = await http.post(
        "/api/v1/auth/mfa", json={"challengeId": login.json()["challengeId"], "code": DEV_MFA_CODE}
    )
    return bearer(mfa.json()["token"])


def reassign(
    http: httpx.AsyncClient, headers: dict[str, str], case_id: str, body: dict[str, Any]
) -> Any:
    return http.put(f"/api/v1/supervision/cases/{case_id}/assignee", headers=headers, json=body)


async def staff_turns(
    http: httpx.AsyncClient, headers: dict[str, str], case_id: str
) -> list[dict[str, Any]]:
    page = await http.get(f"/api/v1/cases/{case_id}/turns", headers=headers, params={"limit": 200})
    items: list[dict[str, Any]] = page.json()["items"]
    return items


async def test_customer_messages_racing_a_reassignment(
    setup: tuple[httpx.AsyncClient, Container],
) -> None:
    http, _ = setup
    lucia = await headers_for(http, SUPERVISOR.email)
    session = await http.post(
        "/api/v1/customer/sessions", json={"customerId": seed_customer_id(1011)}
    )
    camila = bearer(session.json()["token"])

    def write(i: int) -> Any:
        cmid = str(uuid.uuid4())
        return http.post(
            "/api/v1/customer/conversation/turns",
            headers={**camila, "Idempotency-Key": cmid},
            json={"text": f"Mensaje {i}", "clientMessageId": cmid},
        )

    responses = await asyncio.gather(
        *(write(i) for i in range(4)),
        reassign(http, lucia, CAMILA, {"analystId": DANIELA_ID, "expectedAnalystId": JULIAN_ID}),
    )
    assert [r.status_code for r in responses[:4]] == [201] * 4
    assert responses[4].status_code == 200, responses[4].text
    assert {r.json()["conversation"]["caseId"] for r in responses[:4]} == {CAMILA}
    turns = await staff_turns(http, lucia, CAMILA)
    assert [t["sequence"] for t in turns] == list(range(1, len(turns) + 1))
    assert sorted(t["text"] for t in turns if t["text"].startswith("Mensaje")) == [
        f"Mensaje {i}" for i in range(4)
    ]
    detail = (await http.get(f"/api/v1/cases/{CAMILA}", headers=lucia)).json()
    assert detail["case"]["assignedAnalystId"] == DANIELA_ID
    assert detail["case"]["unreadCount"] >= 4


async def test_a_close_racing_a_reassignment(setup: tuple[httpx.AsyncClient, Container]) -> None:
    http, _ = setup
    lucia, julian = await asyncio.gather(
        headers_for(http, SUPERVISOR.email), headers_for(http, JULIAN.email)
    )
    closed, moved = await asyncio.gather(
        http.post(
            f"/api/v1/cases/{CAMILA}/close",
            headers=julian,
            json={"reason": "resolved", "note": None},
        ),
        reassign(http, lucia, CAMILA, {"analystId": DANIELA_ID, "expectedAnalystId": JULIAN_ID}),
    )
    outcome = {closed.status_code, moved.status_code}
    detail = (await http.get(f"/api/v1/cases/{CAMILA}", headers=lucia)).json()
    if closed.status_code == 200:
        assert (moved.status_code, moved.json()["code"]) == (409, "case_closed")
        assert detail["case"]["status"] == "closed"
    else:
        assert (closed.status_code, closed.json()["code"]) == (403, "case_not_assigned")
        assert detail["case"]["assignedAnalystId"] == DANIELA_ID
    assert 200 in outcome


async def test_two_supervisors_at_once(setup: tuple[httpx.AsyncClient, Container]) -> None:
    http, _ = setup
    lucia, renata = await asyncio.gather(
        headers_for(http, SUPERVISOR.email), headers_for(http, SECOND_SUPERVISOR.email)
    )
    same = await asyncio.gather(
        reassign(http, lucia, MAURICIO, {"analystId": DANIELA_ID, "expectedAnalystId": None}),
        reassign(http, renata, MAURICIO, {"analystId": DANIELA_ID, "expectedAnalystId": None}),
    )
    assert sorted(r.json()["changed"] for r in same) == [False, True]
    different = await asyncio.gather(
        reassign(
            http, lucia, seed_case_id(111), {"analystId": DANIELA_ID, "expectedAnalystId": None}
        ),
        reassign(
            http,
            renata,
            seed_case_id(111),
            {"analystId": FELIPE_ID, "expectedAnalystId": None, "confirmPaused": True},
        ),
    )
    codes = Counter(r.json().get("code", "ok") for r in different)
    assert codes == {"ok": 1, "assignment_changed": 1}
    banners = [
        t for t in await staff_turns(http, lucia, seed_case_id(111)) if t["kind"] == "routing"
    ]
    assert len([b for b in banners if "asignó el caso" in b["text"]]) == 1
