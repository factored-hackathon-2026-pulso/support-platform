"""Generate the ``CC_*`` variable table of ``docs/platform/deploy-env.md`` from ``Settings``.

Usage: ``uv run python -m cc_platform.scripts.env_contract [--check]``. The table sits between
two markers in the document; everything around it is hand-written. ``--check`` exits with
status 1 when the document is stale (``tests/unit/infrastructure/test_env_contract.py`` runs
it, so a new setting cannot ship undocumented).

Per variable: the description is its ``Field(description=…)``, else the ``#:`` comment above
the field in ``settings.py``, else ``NOTES``, else the comment that opens its group; whether
it is required, secret, and an example shape come from the tables below.
Examples are shapes, never real values.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import types
import typing
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import SecretStr
from pydantic.fields import FieldInfo

from cc_platform.bootstrap import settings as settings_module
from cc_platform.bootstrap.settings import BACKEND_DIR, DEFAULT_DATABASE_URL, Settings

DOC_PATH = BACKEND_DIR.parent / "docs" / "platform" / "deploy-env.md"
BEGIN = "<!-- BEGIN GENERATED: env table (cc_platform.scripts.env_contract) -->"
END = "<!-- END GENERATED: env table -->"

DEPLOYED = "staging, prod"
#: When a variable must be set. Anything not listed: optional (its default applies).
REQUIRED: dict[str, str] = {
    "env": DEPLOYED,
    "session_secret": DEPLOYED,
    "totp_secret_key": DEPLOYED,
    "database_url": DEPLOYED,
    "public_app_url": DEPLOYED,
    "cors_origins": DEPLOYED,
    "trusted_proxies": "deployed behind a proxy",
    "agent_core_url": "with the Core (with the keys)",
    "agent_keys_file": "with the Core (with the URL)",
    "internal_service_token": "with the Core and the engine",
    "seed_demo_data": "prod (false)",
}

#: Secret values (never logged, injected by infra). Files: the path is not secret, the file is.
SECRET: dict[str, str] = {
    "database_url": "yes (holds the password)",
    "agent_keys_file": "file contents",
    "bank_customer_links_file": "file contents",
}

#: Example shapes where the default is not one (secrets, unset values, deployed values).
EXAMPLES: dict[str, str] = {
    "env": "staging",
    "build": "<git sha>",
    "database_url": "postgresql+asyncpg://<app_role>:<password>@<host>:5432/<db>",
    "session_secret": "<64 random url-safe characters>",
    "totp_secret_key": "<Fernet.generate_key()>",
    "public_app_url": "https://<cloudfront-domain>",
    "cors_origins": "[]",
    "trusted_proxies": '["<proxy docker network CIDR>","<VPC CIDR>"]',
    "reload": "false",
    "dev_mailbox": "false",
    "agent_core_url": "http://<core-host>:<port>",
    "agent_keys_file": "/run/secrets/agent-keys.json",
    "copilot_suggestions_agent": "copiloto-sugerencias@prod",
    "internal_service_token": "<48+ random url-safe characters>",
    "bank_customer_links_file": "/run/secrets/bank-customer-links.json",
    "core_timeout_assistant_seconds": "60",
    "core_timeout_copilot_seconds": "60",
    "core_timeout_suggestions_seconds": "60",
    "core_timeout_builder_seconds": "60",
}

#: Descriptions of the fields ``settings.py`` does not comment.
NOTES: dict[str, str] = {
    "persistence": "`memory` keeps nothing across restarts (tests, demos without a database).",
    "database_url": (
        "SQLAlchemy async URL. SQLite for local development and tests; Postgres when "
        "deployed (roles and grants: [database.md](deploy/database.md))."
    ),
    "database_echo": "Log every SQL statement (development only).",
    "seed_demo_data": (
        "Insert the synthetic demo data (accounts, customers, cases) that is missing; "
        "idempotent. Refused in prod."
    ),
    "session_secret": "HMAC key of the staff and customer session tokens (32+ characters).",
    "session_ttl_minutes": "Staff session lifetime.",
    "lockout_max_attempts": "Failed passwords before an account locks.",
    "lockout_minutes": "How long a locked account stays locked.",
    "mfa_ttl_seconds": "Lifetime of an MFA challenge.",
    "mfa_max_attempts": "Wrong MFA codes before the challenge is spent.",
    "dev_mfa_code": "MFA code of the seeded accounts without an authenticator (synthetic data).",
    "argon2_time_cost": "Argon2id password hashing: iterations.",
    "argon2_memory_cost": "Argon2id password hashing: memory in KiB.",
    "argon2_parallelism": "Argon2id password hashing: lanes.",
    "invitation_ttl_hours": "Lifetime of an invitation link.",
    "password_reset_ttl_minutes": "Lifetime of a password-reset link.",
    "cors_origins": (
        "Origins allowed to call the API from a browser (JSON list). `[]` when the SPA and the "
        "API share the CloudFront origin."
    ),
    "host": "Bind address of `cc-api` (`0.0.0.0` in a container).",
    "port": "Port of `cc-api`.",
    "realtime_queue_size": "Envelopes a slow socket may lag behind before it is closed (1013).",
    "realtime_expiry_check_seconds": "How often an idle socket re-checks its session expiry.",
    "core_timeout_assistant_seconds": (
        "Core call timeout for the assistant; unset: the general Core timeout."
    ),
    "core_timeout_copilot_seconds": (
        "Core call timeout for the copilot; unset: the general Core timeout."
    ),
    "core_timeout_suggestions_seconds": (
        "Core call timeout for copilot suggestions; unset: the general Core timeout."
    ),
    "core_timeout_builder_seconds": (
        "Core call timeout for the builder; unset: the general Core timeout."
    ),
    "core_timeout_evaluate_seconds": "Core call timeout for evaluations.",
    "core_probe_timeout_seconds": "Core call timeout for the `/readyz` status probe.",
    "core_retry_base_delay_seconds": (
        "First delay between Core call retries (doubles each attempt)."
    ),
    "core_retry_max_delay_seconds": "Ceiling of the delay between Core call retries.",
    "core_breaker_reset_seconds": (
        "How long the Core circuit breaker stays open before a trial call."
    ),
    "log_level": "Root log level.",
    "log_format": "`json` (one object per line) or `console` (development).",
}


@dataclass(frozen=True, slots=True)
class Row:
    variable: str
    required: str
    default: str
    secret: str
    example: str
    description: str
    group: str


@dataclass(frozen=True, slots=True)
class _Comments:
    #: ``#:`` comments (or a plain comment glued to the field) right above each field.
    fields: dict[str, str]
    #: The plain comment block that opens a group (after a blank line), per first field.
    headers: dict[str, str]
    #: The group each field belongs to (the header's first words).
    groups: dict[str, str]


def _read_comments(source: str) -> _Comments:
    field = re.compile(r"^    ([a-z_][a-z0-9_]*)\s*:")
    result = _Comments({}, {}, {})
    group = "General"
    block: list[str] = []
    block_after_blank = previous_blank = True
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped:
            block, previous_blank = [], True
            continue
        if line.startswith("    #"):
            if not block:
                block_after_blank = previous_blank
            block.append(stripped)
            previous_blank = False
            continue
        match = field.match(line)
        if match is not None:
            name = match.group(1)
            doc = [text[2:].strip() for text in block if text.startswith("#:")]
            plain = [text[1:].strip() for text in block if not text.startswith("#:")]
            if plain and block_after_blank:
                group = re.split(r" \(|:|\. ", plain[0], maxsplit=1)[0].rstrip(".")
                result.headers[name] = " ".join(plain)
                plain = []
            if text := " ".join(doc or plain):
                result.fields[name] = text
            result.groups[name] = group
        block, previous_blank = [], False
    return result


def _render_default(name: str, info: FieldInfo) -> str:
    value = info.get_default(call_default_factory=True)
    if name == "database_url" and value == DEFAULT_DATABASE_URL:
        return "`sqlite+aiosqlite:///<backend>/cc_platform.db`"
    if value is None:
        return "unset"
    if isinstance(value, SecretStr):
        return "dev-only value"
    if isinstance(value, bool | list):
        text = json.dumps(value, ensure_ascii=False)
    elif isinstance(value, Path):
        text = value.as_posix()
    else:
        text = str(value)
    return f"`{text}`"


def _allowed_values(annotation: Any) -> list[str]:
    origin = typing.get_origin(annotation)
    if origin is Literal:
        return [str(v) for v in typing.get_args(annotation)]
    if origin in (typing.Union, types.UnionType):
        for arg in typing.get_args(annotation):
            if values := _allowed_values(arg):
                return values
    return []


def _is_secret_type(annotation: Any) -> bool:
    if annotation is SecretStr:
        return True
    return any(arg is SecretStr for arg in typing.get_args(annotation))


def build_rows() -> list[Row]:
    comments = _read_comments(Path(settings_module.__file__).read_text(encoding="utf-8"))
    rows = []
    for name, info in Settings.model_fields.items():
        description = (
            info.description
            or comments.fields.get(name)
            or NOTES.get(name)
            or comments.headers.get(name, "")
        ).replace("``", "`")
        if allowed := _allowed_values(info.annotation):
            description = f"{description} One of: {', '.join(f'`{v}`' for v in allowed)}."
        default = _render_default(name, info)
        secret = "yes" if _is_secret_type(info.annotation) else SECRET.get(name, "no")
        example = EXAMPLES.get(name) or ("" if default in ("unset", "dev-only value") else default)
        rows.append(
            Row(
                variable=f"CC_{name.upper()}",
                required=REQUIRED.get(name, "no"),
                default=default,
                secret=secret,
                example=example.strip("`"),
                description=description.strip(),
                group=comments.groups.get(name, "General"),
            )
        )
    return rows


def missing_documentation(rows: list[Row]) -> list[str]:
    """Variables without a description or an example shape (a test keeps this empty)."""
    return [row.variable for row in rows if not row.description or not row.example]


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_table(rows: list[Row]) -> str:
    out: list[str] = []
    group = None
    for row in rows:
        if row.group != group:
            group = row.group
            out += [
                "",
                f"#### {group}",
                "",
                "| Variable | Required | Default | Secret | Example shape | Description |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        example = f"`{_cell(row.example)}`"
        cells = [f"`{row.variable}`", row.required, row.default, row.secret, example]
        out.append("| " + " | ".join([*map(_cell, cells), _cell(row.description)]) + " |")
    return "\n".join([BEGIN, *out, "", END])


def render_document(current: str) -> str:
    start, end = current.find(BEGIN), current.find(END)
    if start < 0 or end < start:
        raise SystemExit(f"{DOC_PATH} lacks the generated-table markers")
    return current[:start] + render_table(build_rows()) + current[end + len(END) :]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the document is stale")
    args = parser.parse_args(argv)

    rows = build_rows()
    if missing := missing_documentation(rows):
        print("Undocumented settings (add a #: comment or NOTES/EXAMPLES entry):", file=sys.stderr)
        for variable in missing:
            print(f"  - {variable}", file=sys.stderr)
        return 1
    current = DOC_PATH.read_text(encoding="utf-8")
    content = render_document(current)
    if args.check:
        if current != content:
            print(f"{DOC_PATH} is out of date; run env_contract", file=sys.stderr)
            return 1
        return 0
    DOC_PATH.write_text(content, encoding="utf-8")
    print(f"wrote {DOC_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
