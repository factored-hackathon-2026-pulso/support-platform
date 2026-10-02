"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.support import DEV_MFA_CODE, PASSWORD, AuthKit, build_auth_kit, make_settings


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock()


@pytest.fixture
def auth_kit() -> AuthKit:
    return build_auth_kit()


@pytest.fixture
def container(clock: FixedClock) -> Container:
    return build_container(make_settings(), clock=clock, ids=SequentialIdGenerator())


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
