"""Parallel auth requests against a real SQLite file (separate connections, real Argon2
in worker threads): bursts of guesses are counted one by one and a challenge is single use."""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import build_container
from tests.support import ANALYST, DEV_MFA_CODE, PASSWORD, make_settings

LOGIN = "/api/v1/auth/login"
MFA = "/api/v1/auth/mfa"


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    container = build_container(settings)
    await container.startup()
    app = create_app(container=container)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http
    await container.shutdown()


async def burst(
    client: httpx.AsyncClient, url: str, body: dict[str, str], n: int
) -> list[httpx.Response]:
    return list(await asyncio.gather(*(client.post(url, json=body) for _ in range(n))))


async def test_parallel_wrong_passwords_lock_after_five_failures(client: httpx.AsyncClient) -> None:
    responses = await burst(client, LOGIN, {"email": ANALYST.email, "password": "nope"}, 20)
    statuses = Counter(r.status_code for r in responses)
    assert statuses[401] <= 5
    assert statuses[401] + statuses[423] == 20
    assert statuses[423] >= 15
    # The account is really locked: the right password is refused too.
    right = await client.post(LOGIN, json={"email": ANALYST.email, "password": PASSWORD})
    assert right.status_code == 423
    assert right.json()["code"] == "account_locked"


async def test_one_challenge_starts_exactly_one_session(client: httpx.AsyncClient) -> None:
    login = await client.post(LOGIN, json={"email": ANALYST.email, "password": PASSWORD})
    challenge = login.json()["challengeId"]
    responses = await burst(client, MFA, {"challengeId": challenge, "code": DEV_MFA_CODE}, 10)
    winners = [r for r in responses if r.status_code == 200]
    assert len(winners) == 1
    assert {r.json()["code"] for r in responses if r.status_code != 200} == {
        "mfa_challenge_invalid"
    }


async def test_parallel_wrong_codes_get_at_most_the_challenge_attempts(
    client: httpx.AsyncClient,
) -> None:
    login = await client.post(LOGIN, json={"email": ANALYST.email, "password": PASSWORD})
    challenge = login.json()["challengeId"]
    responses = await burst(client, MFA, {"challengeId": challenge, "code": "999999"}, 15)
    codes = Counter(r.json()["code"] for r in responses)
    assert codes["mfa_invalid"] == 3
    assert codes["mfa_challenge_invalid"] == 12
