"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from cc_platform.infrastructure.seed.customers import seed_customer_id
from tests.support import DEV_MFA_CODE, PASSWORD, AuthKit, build_auth_kit, make_settings


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock()


@pytest.fixture
def auth_kit() -> AuthKit:
    return build_auth_kit()


@pytest.fixture
def container(clock: FixedClock, tmp_path: Path) -> Container:
    # A file database (one connection per Unit of Work), like production: in-memory SQLite
    # shares a single connection, so a background queue drain interleaved with a request
    # would share its transaction (and its rollback).
    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'api.db'}")
    return build_container(settings, clock=clock, ids=SequentialIdGenerator())


@pytest.fixture
def client(container: Container) -> Iterator[TestClient]:
    with TestClient(create_app(container=container)) as test_client:
        yield test_client


@pytest.fixture
def sign_in(client: TestClient) -> Callable[[str], str]:
    """Password + MFA login through the API; returns the session token."""

    def _sign_in(email: str) -> str:
        login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
        assert login.status_code == 200, login.text
        mfa = client.post(
            "/api/v1/auth/mfa",
            json={"challengeId": login.json()["challengeId"], "code": DEV_MFA_CODE},
        )
        assert mfa.status_code == 200, mfa.text
        token: str = mfa.json()["token"]
        return token

    return _sign_in


@pytest.fixture
def drain(client: TestClient, container: Container) -> Callable[[], None]:
    """Wait for background work (queue drains after an analyst becomes available)."""

    def _drain() -> None:
        client.portal.call(container.background.drain)  # type: ignore[union-attr]

    return _drain


@pytest.fixture
def customer_session(client: TestClient) -> Callable[..., str]:
    """Start a simulator session for a seeded customer number; returns the token."""

    def _start(number: int, channel: str | None = None) -> str:
        body: dict[str, str] = {"customerId": seed_customer_id(number)}
        if channel is not None:
            body["channel"] = channel
        response = client.post("/api/v1/customer/sessions", json=body)
        assert response.status_code == 201, response.text
        token: str = response.json()["token"]
        return token

    return _start
