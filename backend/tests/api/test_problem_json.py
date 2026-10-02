from __future__ import annotations

from fastapi.testclient import TestClient

from cc_platform.api.problems import ProblemCode
from cc_platform.api.schemas.common import ProblemDetails
from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container
from cc_platform.domain.shared.errors import InvalidTransitionError, PolicyViolationError

PROBLEM = "application/problem+json"


def test_unknown_route_is_a_not_found_problem(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM
    assert response.json()["code"] == "not_found"
    assert response.json()["detail"] == "No encontramos lo que buscas."


def test_wrong_method_is_a_problem(client: TestClient) -> None:
    response = client.delete("/api/v1/health")
    assert response.status_code == 405
    assert response.json()["code"] == "method_not_allowed"


def test_domain_errors_map_to_stable_codes_and_unexpected_errors_to_500(
    container: Container,
) -> None:
    app = create_app(container=container)

    @app.get("/boom/transition")
    async def transition() -> None:
        raise InvalidTransitionError(currentStatus="closed")

    @app.get("/boom/policy")
    async def policy() -> None:
        raise PolicyViolationError("Supera tu límite de abono.", policyRuleId="R7")

    @app.get("/boom/crash")
    async def crash() -> None:
        raise RuntimeError("secret internals")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        transition_problem = test_client.get("/boom/transition")
        assert transition_problem.status_code == 409
        assert transition_problem.json()["code"] == "invalid_transition"
        assert transition_problem.json()["status"] == 409
        assert transition_problem.json()["currentStatus"] == "closed"

        policy_problem = test_client.get("/boom/policy").json()
        assert policy_problem["status"] == 422
        assert policy_problem["code"] == "policy_violation"
        assert policy_problem["detail"] == "Supera tu límite de abono."
        assert policy_problem["policyRuleId"] == "R7"

        crash_response = test_client.get("/boom/crash")
        assert crash_response.status_code == 500
        assert crash_response.headers["content-type"] == PROBLEM
        assert crash_response.json()["code"] == "internal_error"
        assert "secret" not in crash_response.text
        assert crash_response.json()["requestId"]


def test_unexpected_errors_keep_cors_and_request_id(container: Container) -> None:
    """The SPA is cross-origin: without CORS headers a 500 looks like a network error."""
    app = create_app(container=container)

    @app.get("/boom/crash")
    async def crash() -> None:
        raise RuntimeError("secret internals")

    origin = "http://localhost:5173"
    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/boom/crash", headers={"Origin": origin})
    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == origin
    assert "X-Request-ID" in response.headers["access-control-expose-headers"]
    assert response.headers["X-Request-ID"] == response.json()["requestId"]
    assert ProblemDetails.model_validate(response.json()).code is ProblemCode.INTERNAL_ERROR


def test_problem_bodies_match_the_published_schema(client: TestClient) -> None:
    bodies = [
        client.get("/api/v1/does-not-exist").json(),
        client.get("/api/v1/auth/me").json(),
        client.post("/api/v1/auth/login", json={"email": "x@y.co"}).json(),
        client.post("/api/v1/auth/login", json={"email": "x@y.co", "password": "no"}).json(),
    ]
    for body in bodies:
        problem = ProblemDetails.model_validate(body)
        assert problem.code.value == body["code"]
    assert ProblemDetails.model_validate(bodies[2]).errors is not None
    assert ProblemDetails.model_validate(bodies[3]).remaining_attempts == 4
