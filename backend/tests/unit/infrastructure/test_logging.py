"""Log output never contains session tokens (e.g. uvicorn's WebSocket handshake line)."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
import structlog
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from cc_platform.bootstrap.app import create_app
from cc_platform.infrastructure.logging import REDACTED, configure_logging, redact_secrets
from tests.support import make_settings

TOKEN = "eyJhbGciOiJIUzI1NiIs.payload.kHehnKNcLkjMGLzHmRiTdl_8GNbB0qFA21YUpIIYj9o"


@pytest.fixture
def restore_logging() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers, root.level = handlers, level


@pytest.mark.usefixtures("restore_logging")
def test_uvicorn_websocket_handshake_line_is_redacted(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(level="INFO", fmt="json")
    logging.getLogger("uvicorn.error").info(
        '%s - "WebSocket %s" [accepted]', "127.0.0.1:58776", f"/api/v1/ws?token={TOKEN}"
    )
    output = capsys.readouterr().err
    assert "WebSocket /api/v1/ws?token=" in output
    assert TOKEN not in output
    assert REDACTED in output


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/ws?token=abc&x=1", f"/ws?token={REDACTED}&x=1"),
        ('GET /x?access_token=abc"', f'GET /x?access_token={REDACTED}"'),
        ("password=hunter2 next", f"password={REDACTED} next"),
        ("no secrets here", "no secrets here"),
        (
            "[parameters: ('STF-1', '$argon2id$v=19$m=65536,t=3,p=4$jsGCOMDY05/x$EN/HoR1n+q')]",
            f"[parameters: ('STF-1', '{REDACTED}')]",
        ),
        ("SET password_hash=? WHERE", "SET password_hash=? WHERE"),
        (
            "connect postgresql+asyncpg://cc_app:s3cr3t@db.internal:5432/cc failed",
            f"connect postgresql+asyncpg://cc_app:{REDACTED}@db.internal:5432/cc failed",
        ),
        ("http://core.internal:8000/readyz", "http://core.internal:8000/readyz"),
    ],
)
def test_redact_secrets(raw: str, expected: str) -> None:
    assert redact_secrets(raw) == expected


@pytest.mark.usefixtures("restore_logging")
def test_exception_text_is_redacted_too(capsys: pytest.CaptureFixture[str]) -> None:
    """The traceback ``format_exc_info`` renders is masked, not only the message."""
    configure_logging(level="INFO", fmt="json")
    secret_hash = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA"
    try:
        raise RuntimeError(f"write failed: {secret_hash} /ws?token={TOKEN}")
    except RuntimeError:
        structlog.get_logger("cc_platform.api.errors").exception("unhandled_error")
    output = capsys.readouterr().err
    assert "unhandled_error" in output
    assert "RuntimeError: write failed" in output
    assert "argon2" not in output
    assert TOKEN not in output


@pytest.mark.usefixtures("restore_logging")
def test_a_full_start_and_stop_never_logs_a_secret(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    """Deploy contract: secret values never reach the log, whatever the level."""
    secrets = {
        "session_secret": "session-" + "S" * 40,
        "totp_secret_key": Fernet.generate_key().decode(),
        "internal_service_token": "internal-" + "I" * 40,
    }
    settings = make_settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'logs.db'}",
        log_level="DEBUG",
        **secrets,
    )
    with TestClient(create_app(settings)) as client:
        client.get("/readyz")
        client.get("/api/v1/meta")
    output = capsys.readouterr()
    logged = output.err + output.out
    assert "readyz" in logged  # the log was captured
    for value in secrets.values():
        assert value not in logged
