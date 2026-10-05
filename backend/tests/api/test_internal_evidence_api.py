"""The improvement engine asks which real cases sit in a cell (service token, ADR 0007)."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import build_container
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import SequentialIdGenerator
from tests.support import SUPERVISOR, bearer, make_settings

TOKEN = "internal-secret-for-tests-0123456789"
URL = "/api/v1/internal/evidence/cases"


def make_client(tmp_path: Path, **overrides: Any) -> Iterator[TestClient]:
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'evidence.db'}", **overrides
    )
    container = build_container(settings, clock=FixedClock(), ids=SequentialIdGenerator())
    with TestClient(create_app(container=container)) as client:
        yield client


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    yield from make_client(tmp_path, internal_service_token=SecretStr(TOKEN), evidence_min_cell=5)


def ask(client: TestClient, token: str = TOKEN, **params: Any) -> Any:
    return client.get(URL, headers=bearer(token), params=params)


def test_it_needs_the_service_token(client: TestClient, sign_in: Callable[[str], str]) -> None:
    assert client.get(URL).status_code == 401
    assert ask(client, token="not-the-token").status_code == 401


def test_a_staff_session_is_not_a_service_token(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    assert ask(client, token=sign_in(SUPERVISOR.email)).status_code == 401


def test_without_the_secret_the_route_does_not_exist(tmp_path: Path) -> None:
    for client in make_client(tmp_path):
        assert ask(client).status_code == 404


def test_a_cell_answers_its_size_and_a_bounded_sample_of_case_ids(client: TestClient) -> None:
    found = ask(client, caseType="unrecognized_charge", limit=3)

    assert found.status_code == 200, found.text
    body = found.json()
    assert body["suppressed"] is False
    assert body["matched"] == 5
    assert len(body["caseIds"]) == 3
    assert all(case_id.startswith("CASE-") for case_id in body["caseIds"])
    assert set(body) == {"suppressed", "matched", "caseIds"}  # ids only: nothing else leaves


def test_a_cell_below_k_is_suppressed_and_says_nothing_else(client: TestClient) -> None:
    found = ask(client, caseType="app_issue")

    assert found.status_code == 200
    assert found.json() == {"suppressed": True, "matched": None, "caseIds": []}


def test_a_bad_dimension_or_limit_is_a_validation_error(client: TestClient) -> None:
    assert ask(client, caseType="not-a-type").status_code == 422
    assert ask(client, limit=9).status_code == 422
    assert ask(client, limit=0).status_code == 422


def test_it_is_not_part_of_the_public_contract(client: TestClient) -> None:
    assert URL.removeprefix("/api/v1") not in client.get("/api/v1/openapi.json").text
