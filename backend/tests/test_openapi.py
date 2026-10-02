"""``backend/openapi.json`` is the frontend contract: it must be current and truthful."""

from __future__ import annotations

from typing import Any

from cc_platform.scripts.export_openapi import DEFAULT_OUTPUT, build_openapi, main, render


def test_committed_openapi_is_up_to_date() -> None:
    assert DEFAULT_OUTPUT.exists(), "run: uv run python -m cc_platform.scripts.export_openapi"
    assert main(["--check"]) == 0, "openapi.json is stale; regenerate it with export_openapi"


def test_export_is_deterministic() -> None:
    assert render(build_openapi()) == render(build_openapi())


def test_every_error_response_is_problem_json() -> None:
    document: dict[str, Any] = build_openapi()
    for path, item in document["paths"].items():
        for method, operation in item.items():
            assert operation["operationId"], (method, path)
            for status, response in operation["responses"].items():
                if status.startswith(("4", "5")) and path != "/api/v1/health":
                    assert list(response["content"]) == ["application/problem+json"], (path, status)
    assert "HTTPValidationError" not in document["components"]["schemas"]


def test_protected_routes_declare_the_session_scheme() -> None:
    paths = build_openapi()["paths"]
    assert paths["/api/v1/auth/me"]["get"]["security"] == [{"SessionToken": []}]
    assert paths["/api/v1/staff"]["get"]["security"] == [{"SessionToken": []}]
    assert "security" not in paths["/api/v1/auth/login"]["post"]
