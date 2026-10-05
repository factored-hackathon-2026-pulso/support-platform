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
        "devMailbox": True,  # part 4: the tests turn the dev mailbox on
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


def test_the_api_sets_no_cookies_and_is_never_cached(client: TestClient) -> None:
    """Deploy contract: sessions are bearer tokens (no cookie to secure), and no cache between
    the browser and the API (CloudFront, the reverse proxy) may keep a response."""
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "daniela.rios@latambank.example", "password": "demo1234"},
    )
    assert login.status_code == 200
    assert "set-cookie" not in login.headers
    assert login.headers["cache-control"] == "no-store"
    assert client.get("/api/v1/meta").headers["cache-control"] == "no-store"
    assert client.get("/api/v1/nope").headers["cache-control"] == "no-store"
