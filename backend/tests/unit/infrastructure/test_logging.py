"""Log output never contains session tokens (e.g. uvicorn's WebSocket handshake line)."""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest

from cc_platform.infrastructure.logging import REDACTED, configure_logging, redact_secrets

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
    ],
)
def test_redact_secrets(raw: str, expected: str) -> None:
    assert redact_secrets(raw) == expected
