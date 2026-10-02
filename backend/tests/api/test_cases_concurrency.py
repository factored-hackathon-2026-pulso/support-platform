"""Parallel chat requests against a real SQLite file (separate connections): the case's
compare-and-set and the slot keep one open case per customer and one turn per message id."""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.customers import seed_customer_id
from tests.support import ANALYST, DEV_MFA_CODE, PASSWORD, bearer, make_settings

TURNS = "/api/v1/customer/conversation/turns"


@pytest.fixture
async def setup(tmp_path: Path) -> AsyncIterator[tuple[httpx.AsyncClient, Container]]:
    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    container = build_container(settings)
    await container.startup()
    transport = httpx.ASGITransport(app=create_app(container=container))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http, container
    await container.shutdown()


async def customer_token(http: httpx.AsyncClient, number: int) -> str:
    response = await http.post(
        "/api/v1/customer/sessions", json={"customerId": seed_customer_id(number)}
    )
    token: str = response.json()["token"]
    return token


def send(http: httpx.AsyncClient, token: str, text: str, cmid: str) -> object:
    return http.post(
        TURNS,
        headers={**bearer(token), "Idempotency-Key": cmid},
        json={"text": text, "clientMessageId": cmid},
    )


async def test_parallel_first_messages_open_one_case(
    setup: tuple[httpx.AsyncClient, Container],
) -> None:
    http, container = setup
    token = await customer_token(http, 2001)
    responses = await asyncio.gather(
        *(send(http, token, f"Mensaje {i}", str(uuid.uuid4())) for i in range(6))  # type: ignore[misc]
    )
    assert [r.status_code for r in responses] == [201] * 6
    bodies = [r.json() for r in responses]
    assert len({b["conversation"]["caseId"] for b in bodies}) == 1
    assert sum(b["caseCreated"] for b in bodies) == 1
    await container.background.drain()
    conversation = (await http.get("/api/v1/customer/conversation", headers=bearer(token))).json()
    messages = [t for t in conversation["turns"] if t["kind"] == "message"]
    assert len(messages) == 6
    sequences = [t["sequence"] for t in conversation["turns"]]
    assert sequences == sorted(set(sequences))


async def test_double_send_is_one_turn(setup: tuple[httpx.AsyncClient, Container]) -> None:
    http, _ = setup
    login = await http.post(
        "/api/v1/auth/login", json={"email": ANALYST.email, "password": PASSWORD}
    )
    mfa = await http.post(
        "/api/v1/auth/mfa", json={"challengeId": login.json()["challengeId"], "code": DEV_MFA_CODE}
    )
    daniela = bearer(mfa.json()["token"])
    cmid = str(uuid.uuid4())
    responses = await asyncio.gather(
        *(
            http.post(
                f"/api/v1/cases/{seed_case_id(102)}/turns",
                headers={**daniela, "Idempotency-Key": cmid},
                json={"text": "Hola, Beatriz.", "clientMessageId": cmid},
            )
            for _ in range(5)
        )
    )
    assert Counter(r.status_code for r in responses) == {201: 1, 200: 4}
    assert len({r.json()["turn"]["id"] for r in responses}) == 1
    page = await http.get(f"/api/v1/cases/{seed_case_id(102)}/turns", headers=daniela)
    assert [t["clientMessageId"] for t in page.json()["items"]].count(cmid) == 1
