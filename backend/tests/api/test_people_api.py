from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient

from tests.support import ADMIN, ANALYST, SUPERVISOR, bearer

STAFF_KEYS = {"id", "name", "email", "roles", "languages", "team", "active"}


def test_analyst_cannot_list_staff(client: TestClient, sign_in: Callable[[str], str]) -> None:
    response = client.get("/api/v1/staff", headers=bearer(sign_in(ANALYST.email)))
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert response.json()["requiredRoles"] == ["admin", "supervisor"]


def test_supervisor_lists_staff_and_filters_by_role(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    token = sign_in(SUPERVISOR.email)
    everyone = client.get("/api/v1/staff", headers=bearer(token))
    assert everyone.status_code == 200
    names = [person["name"] for person in everyone.json()["items"]]
    assert names == sorted(names)
    assert "Daniela Ríos" in names

    supervisors = client.get("/api/v1/staff", params={"role": "supervisor"}, headers=bearer(token))
    assert {p["name"] for p in supervisors.json()["items"]} == {
        "Felipe Echeverri",  # analyst + supervisor (team lead)
        "Lucía Herrera",
        "Mariana Duque",  # slice 4: locked, still an active account
        "Martín Salazar",
        "Renata Villalba",
    }
    assert "Andrés Villamil" not in names  # inactive: only with includeInactive
    assert all(person["active"] for person in everyone.json()["items"])
    assert all(person["team"]["id"].startswith("TEAM-") for person in everyone.json()["items"])
    roles = {role for person in everyone.json()["items"] for role in person["roles"]}
    assert roles == {"analyst", "supervisor", "admin"}
    assert all(set(person) == STAFF_KEYS for person in everyone.json()["items"])


def test_admin_can_list_staff(client: TestClient, sign_in: Callable[[str], str]) -> None:
    assert client.get("/api/v1/staff", headers=bearer(sign_in(ADMIN.email))).status_code == 200


def test_unknown_role_filter_is_a_validation_problem(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    response = client.get(
        "/api/v1/staff", params={"role": "ceo"}, headers=bearer(sign_in(ADMIN.email))
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_listing_staff_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/v1/staff").json()["code"] == "unauthenticated"


def test_include_inactive_lists_deactivated_people_too(
    client: TestClient, sign_in: Callable[[str], str]
) -> None:
    response = client.get(
        "/api/v1/staff", params={"includeInactive": "true"}, headers=bearer(sign_in(ADMIN.email))
    )
    people = {person["name"]: person for person in response.json()["items"]}
    assert people["Andrés Villamil"]["active"] is False
    assert people["Andrés Villamil"]["team"]["name"] == "Disputas · Equipo Andes"
    assert len(people) == 13
