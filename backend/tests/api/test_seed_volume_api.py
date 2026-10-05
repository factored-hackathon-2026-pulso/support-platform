"""``cc-seed --profile volume`` on a real database file: idempotent, the evidence route answers
every claimed cell at ``CC_EVIDENCE_MIN_CELL=10``, the supervisor screens work on the volume and
the AI events follow each type's stage.

The database is seeded once for the module (about 1,600 cases), then seeded again."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import build_container
from cc_platform.domain.ai.maturity import StageRule
from cc_platform.infrastructure.clock import FixedClock
from cc_platform.infrastructure.ids import UlidIdGenerator
from cc_platform.infrastructure.seed import volume_catalog as cat
from cc_platform.infrastructure.seed.cases import seed_case_id
from cc_platform.infrastructure.seed.volume import claimed_cells
from cc_platform.scripts.seed import run_seed
from tests.support import DEV_MFA_CODE, PASSWORD, SUPERVISOR, bearer, make_settings

TOKEN = "internal-secret-for-tests-0123456789"
EVIDENCE = "/api/v1/internal/evidence/cases"
#: Tables whose row counts must not move on a second run.
TABLES = (
    "cases", "turns", "event_log", "customers", "staff", "login_accounts", "assignments",
    "escalations", "calls", "assistant_sessions", "copilot_threads", "copilot_suggestions",
    "notifications", "case_type_maturity",
)  # fmt: skip
FIRST_VOLUME_CASE = seed_case_id(cat.VOLUME_BASE + 1)


def _settings(path: Path) -> Any:
    return make_settings(
        database_url=f"sqlite+aiosqlite:///{path}",
        internal_service_token=SecretStr(TOKEN),
        evidence_min_cell=10,
    )


async def _seed(path: Path) -> dict[str, Any]:
    clock = FixedClock()
    container = build_container(_settings(path), clock=clock, ids=UlidIdGenerator(clock))
    try:
        return await run_seed(container, "volume")
    finally:
        await container.shutdown()


def _snapshot(path: Path) -> dict[str, Any]:
    with sqlite3.connect(path) as db:
        counts = {t: db.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}  # noqa: S608
        signals = dict(db.execute("SELECT case_type, signals FROM case_type_maturity").fetchall())
        first = db.execute("SELECT opened_at FROM cases WHERE id = ?", (FIRST_VOLUME_CASE,))
    return {"counts": counts, "signals": signals, "first_opened": first.fetchone()}


@pytest.fixture(scope="module")
def seeded(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, list[dict[str, Any]]]:
    path = tmp_path_factory.mktemp("volume") / "volume.db"
    runs = []
    for _ in range(2):
        summary = asyncio.run(_seed(path))
        runs.append({"summary": summary, **_snapshot(path)})
    return path, runs


@pytest.fixture(scope="module")
def client(seeded: tuple[Path, list[dict[str, Any]]]) -> Iterator[TestClient]:
    path, _runs = seeded
    clock = FixedClock()
    container = build_container(_settings(path), clock=clock, ids=UlidIdGenerator(clock))
    with TestClient(create_app(container=container)) as test_client:
        yield test_client


def _query(path: Path, sql: str, *params: object) -> list[tuple[Any, ...]]:
    with sqlite3.connect(path) as db:
        return db.execute(sql, params).fetchall()


def test_running_it_twice_gives_the_same_database(
    seeded: tuple[Path, list[dict[str, Any]]],
) -> None:
    _path, (first, second) = seeded
    assert first["summary"]["volume_cases_added"] == first["summary"]["volume_cases_planned"]
    assert first["summary"]["volume_cases_planned"] >= 1000
    assert second["summary"]["volume_cases_added"] == 0
    assert second["summary"]["stage_signals_updated"] == 0
    assert second["counts"] == first["counts"]
    assert second["signals"] == first["signals"]
    assert second["first_opened"] == first["first_opened"]


def test_the_evidence_route_answers_every_claimed_cell_at_min_cell_10(client: TestClient) -> None:
    for case_type, channel, language in claimed_cells():
        params = {"caseType": case_type.value, "channel": channel.value, "language": language.value}
        found = client.get(EVIDENCE, headers=bearer(TOKEN), params=params)
        assert found.status_code == 200, found.text
        body = found.json()
        assert body["suppressed"] is False, params
        assert body["matched"] >= cat.CELL_FLOOR, params
        assert len(body["caseIds"]) == 8


def _sign_in(client: TestClient, email: str) -> dict[str, str]:
    login = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    mfa = client.post(
        "/api/v1/auth/mfa", json={"challengeId": login.json()["challengeId"], "code": DEV_MFA_CODE}
    )
    assert mfa.status_code == 200, mfa.text
    return bearer(mfa.json()["token"])


def test_the_supervisor_screens_work_on_the_volume(client: TestClient) -> None:
    lucia = _sign_in(client, SUPERVISOR.email)

    team = client.get("/api/v1/supervision/team", headers=lucia)
    queues = client.get("/api/v1/supervision/queues", headers=lucia)
    open_cases = client.get(
        "/api/v1/supervision/open-cases", headers=lucia, params={"language": "pt"}
    )
    escalations = client.get("/api/v1/supervision/escalations", headers=lucia)
    audit = client.get("/api/v1/audit/events", headers=lucia, params={"limit": 100})
    stages = client.get("/api/v1/ai/stages", headers=lucia)

    for response in (team, queues, open_cases, escalations, audit, stages):
        assert response.status_code == 200, response.text
    names = {row["name"] for row in team.json()["analysts"]}
    assert {staff.name for staff in cat.VOLUME_STAFF} <= names
    waiting = {q["language"]: q["waiting"] for q in queues.json()["queues"]}
    assert waiting["es"] >= cat.QUEUED_OPEN[cat.ES]
    assert waiting["pt"] >= cat.QUEUED_OPEN[cat.PT]
    assert audit.json()["items"]
    types = {t["caseType"]: t for t in stages.json()["types"]}
    assert all(types[t.value]["signals"]["closedCases"] > 0 for t in cat.DATASET_TYPES)


def test_the_stages_stay_where_the_story_has_them(client: TestClient) -> None:
    """The recomputed signals keep every climbing type below the team rule's next step."""
    lucia = _sign_in(client, SUPERVISOR.email)
    body = client.get("/api/v1/ai/stages", headers=lucia).json()
    rule = StageRule()
    for row in body["types"]:
        signals, stage = row["signals"], row["stage"]
        if stage == 0:
            assert signals["resolvedCases"] < rule.resolved_cases_to_ask
        elif stage == 1:
            assert signals["askedCases"] < rule.asked_cases_to_propose_tools
        elif stage == 2:
            used, proposed = signals["toolUsedCases"], signals["toolCases"]
            assert proposed >= rule.tool_cases_minimum
            assert used * 100 < rule.tool_use_percent_to_shadow * proposed
    undue = next(row for row in body["types"] if row["caseType"] == "undue_charge")
    assert undue["agent"] == "ready"
    assert undue["signals"]["drafts"] == rule.draft_window
    assert (
        undue["signals"]["draftsAsIs"] * 100
        >= rule.draft_as_is_percent_for_agent * rule.draft_window
    )


def test_the_ai_events_follow_each_types_stage(seeded: tuple[Path, list[dict[str, Any]]]) -> None:
    path, _runs = seeded
    by_type = dict(
        _query(
            path,
            "SELECT c.case_type, group_concat(DISTINCT e.event_type) FROM event_log e "
            "JOIN cases c ON c.id = e.case_id WHERE e.event_type LIKE 'copilot.%' "
            "AND c.id >= ? GROUP BY c.case_type",
            FIRST_VOLUME_CASE,
        )
    )
    # Stage 0: no copilot at all; stage 1: questions only; stage 2+: proposals; 3: drafts.
    assert "virtual_card" not in by_type
    assert set(by_type["branch_service"].split(",")) == {"copilot.query_asked", "copilot.answered"}
    assert "copilot.tool_used" in by_type["app_issue"]
    assert "copilot.suggestion_decided" in by_type["undue_charge"]
    handoffs = _query(
        path,
        "SELECT count(*) FROM event_log WHERE event_type = 'case.assistant_released' "
        "AND case_id >= ?",
        FIRST_VOLUME_CASE,
    )[0][0]
    assert handoffs > 0


def test_events_reach_the_log_with_the_platform_envelope(
    seeded: tuple[Path, list[dict[str, Any]]],
) -> None:
    """Written by the Unit of Work, not by hand: ids, actors and JSON payloads as usual."""
    path, _runs = seeded
    rows = _query(
        path,
        "SELECT event_id, actor_role, actor_id, payload FROM event_log WHERE case_id >= ? "
        "AND event_type IN ('copilot.suggestion_decided', 'case.rated', 'case.type_changed')",
        FIRST_VOLUME_CASE,
    )
    assert rows
    for event_id, role, actor, payload in rows:
        assert event_id.startswith("EVT-")
        assert role in {"analyst", "customer", "system"}
        assert actor
        assert isinstance(json.loads(payload), dict)
