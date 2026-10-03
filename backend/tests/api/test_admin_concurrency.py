"""Administration races on a real SQLite file (separate connections, slice 4 §3.8): every
race ends in one consistent state, never a lost update or an empty admin roster."""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container, build_container
from cc_platform.infrastructure.seed.people import seed_staff_id
from tests.support import (
    ADMIN,
    ADMIN_ONLY,
    DEV_MFA_CODE,
    PASSWORD,
    TOMAS,
    bearer,
    make_settings,
)

VALERIA_ID, CAROLINA_ID, TOMAS_ID = seed_staff_id(7), seed_staff_id(9), seed_staff_id(8)


@pytest.fixture
async def setup(tmp_path: Path) -> AsyncIterator[tuple[httpx.AsyncClient, Container]]:
    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    container = build_container(settings)
    await container.startup()
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


async def version(http: httpx.AsyncClient, headers: dict[str, str], staff_id: str) -> int:
    response = await http.get(f"/api/v1/admin/users/{staff_id}", headers=headers)
    value: int = response.json()["version"]
    return value


def codes(responses: list[httpx.Response]) -> Counter[Any]:
    return Counter(r.json().get("code", r.status_code) for r in responses)


async def test_two_admins_demoting_each_other(
    setup: tuple[httpx.AsyncClient, Container],
) -> None:
    http, container = setup
    valeria, carolina = (
        await headers_for(http, ADMIN_ONLY.email),
        await headers_for(http, ADMIN.email),
    )
    for _ in range(3):
        v_ver = await version(http, valeria, VALERIA_ID)
        c_ver = await version(http, carolina, CAROLINA_ID)
        responses = await asyncio.gather(
            http.patch(
                f"/api/v1/admin/users/{CAROLINA_ID}",
                json={"expectedVersion": c_ver, "roles": ["supervisor"]},
                headers=valeria,
            ),
            http.patch(
                f"/api/v1/admin/users/{VALERIA_ID}",
                json={"expectedVersion": v_ver, "roles": ["supervisor"]},
                headers=carolina,
            ),
        )
        assert sorted(r.status_code for r in responses) == [200, 403]
        async with container.uow() as uow:
            roster = await uow.admin_roster.get()
            admins = [s.id for s in await uow.staff.list() if s.is_active_admin]
        assert roster is not None
        assert len(roster.admin_ids) == 1
        assert set(admins) == roster.admin_ids
        # The winner gives the role back so the next round races again.
        winner = valeria if responses[0].status_code == 200 else carolina
        loser_id = CAROLINA_ID if winner is valeria else VALERIA_ID
        back = await http.patch(
            f"/api/v1/admin/users/{loser_id}",
            json={
                "expectedVersion": await version(http, winner, loser_id),
                "roles": ["supervisor", "admin"],
            },
            headers=winner,
        )
        assert back.status_code == 200


async def test_same_email_twice(setup: tuple[httpx.AsyncClient, Container]) -> None:
    http, _ = setup
    valeria = await headers_for(http, ADMIN_ONLY.email)
    body = {
        "name": "Ana Gil",
        "email": "ana.gil@latambank.example",
        "roles": ["analyst"],
        "languages": ["pt"],
        "teamId": "TEAM-00000000000000000000000002",
    }
    responses = await asyncio.gather(
        *(http.post("/api/v1/admin/users", json=body, headers=valeria) for _ in range(4))
    )
    assert codes(responses) == Counter({201: 1, "email_taken": 3})
    keyed = {**valeria, "Idempotency-Key": "same-key-0001"}
    other = {**body, "email": "bruno.paz@latambank.example"}
    replays = await asyncio.gather(
        *(http.post("/api/v1/admin/users", json=other, headers=keyed) for _ in range(4))
    )
    assert sorted(r.status_code for r in replays) == [200, 200, 200, 201]
    assert len({r.json()["user"]["id"] for r in replays}) == 1
    assert sum(r.json()["temporaryPassword"] is not None for r in replays) == 1


async def test_same_team_name_twice(setup: tuple[httpx.AsyncClient, Container]) -> None:
    http, _ = setup
    valeria = await headers_for(http, ADMIN_ONLY.email)
    responses = await asyncio.gather(
        *(
            http.post("/api/v1/admin/teams", json={"name": name}, headers=valeria)
            for name in ("Equipo Sur", "equipo sur", "EQUIPO SÚR")
        )
    )
    assert codes(responses) == Counter({201: 1, "team_name_taken": 2})


async def test_two_admins_edit_the_same_person(setup: tuple[httpx.AsyncClient, Container]) -> None:
    http, _ = setup
    valeria, carolina = (
        await headers_for(http, ADMIN_ONLY.email),
        await headers_for(http, ADMIN.email),
    )
    seen = await version(http, valeria, TOMAS_ID)
    responses = await asyncio.gather(
        http.patch(
            f"/api/v1/admin/users/{TOMAS_ID}",
            json={"expectedVersion": seen, "name": "Tomás Primero"},
            headers=valeria,
        ),
        http.patch(
            f"/api/v1/admin/users/{TOMAS_ID}",
            json={"expectedVersion": seen, "name": "Tomás Segundo"},
            headers=carolina,
        ),
    )
    assert codes(responses) == Counter({200: 1, "version_conflict": 1})
    winner = next(r for r in responses if r.status_code == 200).json()["user"]
    loser = next(r for r in responses if r.status_code == 409).json()
    assert loser["current"] == winner


async def test_a_move_in_makes_a_deactivation_with_the_old_version_stale(
    setup: tuple[httpx.AsyncClient, Container],
) -> None:
    """The ordering the race above hits when the move commits first, made deterministic."""
    http, _ = setup
    valeria = await headers_for(http, ADMIN_ONLY.email)
    team = (
        await http.post("/api/v1/admin/teams", json={"name": "Equipo Norte"}, headers=valeria)
    ).json()
    moved = await http.patch(
        f"/api/v1/admin/users/{TOMAS_ID}",
        json={"expectedVersion": await version(http, valeria, TOMAS_ID), "teamId": team["id"]},
        headers=valeria,
    )
    assert moved.status_code == 200
    stale = await http.post(
        f"/api/v1/admin/teams/{team['id']}/deactivate",
        json={"expectedVersion": team["version"]},
        headers=valeria,
    )
    body = stale.json()
    assert (stale.status_code, body["code"]) == (409, "version_conflict")
    assert (body["current"]["version"], body["current"]["memberCount"]) == (team["version"] + 1, 1)
    fresh = await http.post(
        f"/api/v1/admin/teams/{team['id']}/deactivate",
        json={"expectedVersion": body["current"]["version"]},
        headers=valeria,
    )
    assert (fresh.status_code, fresh.json()["code"]) == (409, "team_not_empty")


async def test_deactivating_a_team_while_someone_moves_in(
    setup: tuple[httpx.AsyncClient, Container],
) -> None:
    http, container = setup
    valeria, carolina = (
        await headers_for(http, ADMIN_ONLY.email),
        await headers_for(http, ADMIN.email),
    )
    for round_ in range(4):
        created = await http.post(
            "/api/v1/admin/teams", json={"name": f"Equipo Ronda {round_}"}, headers=valeria
        )
        team = created.json()
        responses = await asyncio.gather(
            http.post(
                f"/api/v1/admin/teams/{team['id']}/deactivate",
                json={"expectedVersion": team["version"]},
                headers=valeria,
            ),
            http.patch(
                f"/api/v1/admin/users/{TOMAS_ID}",
                json={
                    "expectedVersion": await version(http, carolina, TOMAS_ID),
                    "teamId": team["id"],
                },
                headers=carolina,
            ),
        )
        deactivation, move = responses
        # The two serialise on the team row (§3.8). The move first: it bumped the team's
        # version, so the deactivation's retry finds its ``expectedVersion`` stale
        # (``version_conflict`` with the current team, now with a member). The
        # deactivation first: the move's retry finds an inactive team.
        assert codes(responses) in (
            Counter({200: 1, "version_conflict": 1}),
            Counter({200: 1, "team_inactive": 1}),
        )
        if move.status_code == 200:
            stale = deactivation.json()
            assert stale["code"] == "version_conflict"
            assert stale["current"]["memberCount"] == 1
            # Sent again with the fresh version, the rule itself answers.
            again = await http.post(
                f"/api/v1/admin/teams/{team['id']}/deactivate",
                json={"expectedVersion": stale["current"]["version"]},
                headers=valeria,
            )
            assert (again.status_code, again.json()["code"]) == (409, "team_not_empty")
        else:
            assert deactivation.status_code == 200
            assert move.json()["code"] == "team_inactive"
        async with container.uow() as uow:
            stored = await uow.teams.get(team["id"])
            tomas = await uow.staff.get(TOMAS_ID)
        assert stored is not None
        assert tomas is not None
        assert not (
            not stored.active and tomas.team_id == stored.id
        )  # never inside an inactive team


async def test_a_password_reset_racing_the_mfa_step_never_leaves_a_working_session(
    setup: tuple[httpx.AsyncClient, Container],
) -> None:
    """A sign-in with the old password that is finishing its MFA step while an admin
    resets the password: either the MFA step loses (its challenge was cancelled) or it won
    first and the reset ended the session it got. Never a working token."""
    http, _ = setup
    valeria = await headers_for(http, ADMIN_ONLY.email)
    password = PASSWORD
    for _ in range(4):
        login = await http.post(
            "/api/v1/auth/login", json={"email": TOMAS.email, "password": password}
        )
        assert login.status_code == 200
        reset, mfa = await asyncio.gather(
            http.post(f"/api/v1/admin/users/{TOMAS_ID}/password-reset", headers=valeria),
            http.post(
                "/api/v1/auth/mfa",
                json={"challengeId": login.json()["challengeId"], "code": DEV_MFA_CODE},
            ),
        )
        assert reset.status_code == 200
        if mfa.status_code == 200:
            me = await http.get("/api/v1/auth/me", headers=bearer(mfa.json()["token"]))
            assert me.status_code == 401
            assert reset.json()["revokedSessions"] == 1
        else:
            assert (mfa.status_code, mfa.json()["code"]) == (401, "mfa_challenge_invalid")
        password = reset.json()["temporaryPassword"]  # the next round signs in with it
