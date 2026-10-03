"""structlog configuration: JSON lines with request/correlation ids from contextvars.

Standard-library loggers (uvicorn, sqlalchemy) are routed through the same processors so
every line in the output has the same shape.

Secrets never reach the output: ``SecretRedactionFilter`` sits on the root handler and masks
credentials embedded in log text, e.g. the WebSocket session token that uvicorn prints with
the handshake path (``"WebSocket /api/v1/ws?token=…" [accepted]``).
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any, Literal

import structlog
from structlog.types import Processor

type LogFormat = Literal["json", "console"]

REDACTED = "[REDACTED]"
# token=…, access_token=…, password=… in query strings or free text.
_SECRET_PARAM = re.compile(r"(?i)\b((?:access_|session_)?token|password|secret)=([^\s\"'&]+)")
# A password hash in PHC form (``$argon2id$v=19$m=…,t=…,p=…$salt$hash``), wherever it is.
_PASSWORD_HASH = re.compile(r"\$argon2(?:id|i|d)\$[A-Za-z0-9+/=$,.\-]+")


def redact_secrets(text: str) -> str:
    text = _PASSWORD_HASH.sub(REDACTED, text)
    return _SECRET_PARAM.sub(lambda match: f"{match.group(1)}={REDACTED}", text)


def _redact_rendered(_logger: object, _method: str, rendered: Any) -> Any:
    """Last processor: masks secrets in the whole rendered line, including the exception
    text ``format_exc_info`` adds (``SecretRedactionFilter`` only sees the message).

    Runs after the renderer, so it receives the rendered ``str``.
    """
    return redact_secrets(rendered) if isinstance(rendered, str) else rendered


class SecretRedactionFilter(logging.Filter):
    """Masks secrets in the rendered message of every record that reaches the handler.

    Installed on the handler (not a logger) so it also covers records propagated from
    third-party loggers such as ``uvicorn.error``.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            message = record.getMessage()
            redacted = redact_secrets(message)
            if redacted != message:
                record.msg = redacted
                record.args = None
        return True


def configure_logging(*, level: str = "INFO", fmt: LogFormat = "json") -> None:
    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    renderer: Processor = (
        structlog.processors.JSONRenderer()
        if fmt == "json"
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )

    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.format_exc_info,
            renderer,
            _redact_rendered,
        ],
    )
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    handler.addFilter(SecretRedactionFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
    # Our middleware writes the access log with request ids; silence uvicorn's duplicate.
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False
