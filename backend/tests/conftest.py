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
from cc_platform.infrastructure.persistence.sqlalchemy.database import Database
from cc_platform.infrastructure.seed.customers import seed_customer_id
from tests.postgres_support import PostgresDatabases, SqliteToPostgres, postgres_server_url
from tests.support import (
    DEV_MFA_CODE,
    PASSWORD,
    AuthKit,
    build_auth_kit,
    make_available_quietly,
    make_settings,
)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "sqlite_only: tests SQLite itself; skipped on Postgres")
    config.addinivalue_line("markers", "postgres_only: needs CC_TEST_DATABASE_URL (Postgres)")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    on_postgres = postgres_server_url() is not None
    for item in items:
        if on_postgres and item.get_closest_marker("sqlite_only"):
            item.add_marker(pytest.mark.skip(reason="SQLite-only test (CC_TEST_DATABASE_URL set)"))
        if not on_postgres and item.get_closest_marker("postgres_only"):
            item.add_marker(pytest.mark.skip(reason="needs CC_TEST_DATABASE_URL (Postgres)"))


@pytest.fixture(scope="session")
def postgres_databases() -> Iterator[PostgresDatabases | None]:
    """The session's Postgres databases, or ``None`` when the suite runs on SQLite."""
    server = postgres_server_url()
    if server is None:
        yield None
        return
    databases = PostgresDatabases(server)
    databases.prepare_template()
    yield databases
    databases.drop_leftovers()


@pytest.fixture(autouse=True)
def _sqlite_urls_on_postgres(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    postgres_databases: PostgresDatabases | None,
) -> Iterator[None]:
    """With ``CC_TEST_DATABASE_URL``, each SQLite URL a test opens is a fresh Postgres one."""
    if postgres_databases is None or request.node.get_closest_marker("sqlite_only"):
        yield
        return
    mapping = SqliteToPostgres(postgres_databases)
    original = Database.__init__

    def init(self: Database, url: str, **kwargs: object) -> None:
        original(self, mapping.translate(url), **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(Database, "__init__", init)
    yield
    mapping.drop_all()


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
def available(client: TestClient, container: Container) -> Callable[..., None]:
    """Make analysts available without draining the seeded queues (``make_available_quietly``)."""

    def _available(*staff_ids: str) -> None:
        client.portal.call(make_available_quietly, container.uow, *staff_ids)  # type: ignore[union-attr]

    return _available


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
