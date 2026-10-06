"""Demo mode (hosted demo for evaluators): seeded accounts use its own password and code."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.support import ANALYST, PASSWORD, make_settings

DEMO_STAFF_PASSWORD = "ev4luat0rs-" + "k" * 12
DEMO_MFA = "482913"


@pytest.fixture
def demo_client(tmp_path: Path) -> Iterator[TestClient]:
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'demo.db'}",
        demo_mode=True,
        demo_staff_password=DEMO_STAFF_PASSWORD,
        dev_mfa_code=DEMO_MFA,
    )
    container = build_container(settings, clock=FixedClock(), ids=SequentialIdGenerator())
    with TestClient(create_app(container=container)) as client:
        yield client


def login(client: TestClient, password: str):  # type: ignore[no-untyped-def]
    return client.post("/api/v1/auth/login", json={"email": ANALYST.email, "password": password})


def test_seeded_accounts_take_the_demo_password_and_refuse_the_dev_one(
    demo_client: TestClient,
) -> None:
    assert login(demo_client, PASSWORD).status_code == 401
    challenge = login(demo_client, DEMO_STAFF_PASSWORD)
    assert challenge.status_code == 200


def test_the_customer_simulator_lists_the_synthetic_customers(demo_client: TestClient) -> None:
    response = demo_client.get("/api/v1/customer/demo-customers")
    assert response.status_code == 200
