from __future__ import annotations

from fastapi.testclient import TestClient

from cc_platform import __version__


def test_health_reports_database(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": "ok"}}


def test_meta_reports_version_and_build(client: TestClient) -> None:
    assert client.get("/api/v1/meta").json() == {
        "name": "cc-platform",
        "version": __version__,
        "build": "test-build",
        "environment": "test",
        "apiVersion": "v1",
    }


def test_request_and_correlation_ids_are_echoed_or_generated(client: TestClient) -> None:
    echoed = client.get(
        "/api/v1/meta",
        headers={"X-Request-ID": "req-12345678", "X-Correlation-ID": "corr-abcdefgh"},
    )
    assert echoed.headers["X-Request-ID"] == "req-12345678"
    assert echoed.headers["X-Correlation-ID"] == "corr-abcdefgh"

    generated = client.get("/api/v1/meta", headers={"X-Request-ID": "bad id with spaces"})
    assert generated.headers["X-Request-ID"] != "bad id with spaces"
    assert len(generated.headers["X-Request-ID"]) == 32
    assert generated.headers["X-Correlation-ID"] == generated.headers["X-Request-ID"]


def test_cors_allows_the_vite_dev_origin(client: TestClient) -> None:
    response = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"

    blocked = client.options(
        "/api/v1/auth/login",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in blocked.headers
