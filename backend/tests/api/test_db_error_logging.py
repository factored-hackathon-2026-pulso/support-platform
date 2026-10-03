"""A database error that becomes a 500 is logged without its bind values (slice 4 review):
the traceback must never carry a password hash, a temporary-password hash or an email."""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from cc_platform.bootstrap.app import create_app
from cc_platform.bootstrap.container import Container

HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA"
EMAIL = "ana.gil@latambank.example"


@pytest.fixture
def restore_logging() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers, root.level = handlers, level


@pytest.mark.usefixtures("restore_logging")
def test_a_failed_statement_is_logged_without_its_parameters(
    container: Container, capsys: pytest.CaptureFixture[str]
) -> None:
    app = create_app(container=container)

    @app.post("/boom/db")
    async def failing_write() -> None:
        assert container.database is not None
        async with container.database.engine.begin() as connection:
            await connection.execute(
                text("UPDATE no_such_table SET password_hash = :hash WHERE email = :email"),
                {"hash": HASH, "email": EMAIL},
            )

    with TestClient(app, raise_server_exceptions=False) as client:
        capsys.readouterr()  # drop the startup lines
        response = client.post("/boom/db")
    assert (response.status_code, response.json()["code"]) == (500, "internal_error")
    output = capsys.readouterr().err
    assert "unhandled_error" in output
    assert "OperationalError" in output  # the error itself is still diagnosable
    assert "[parameters:" not in output
    assert "argon2" not in output
    assert EMAIL not in output
