"""``docs/platform/deploy-env.md`` documents every ``CC_*`` setting (generated table)."""

from __future__ import annotations

from cc_platform.bootstrap.settings import Settings
from cc_platform.scripts.env_contract import (
    DOC_PATH,
    build_rows,
    main,
    missing_documentation,
)


def test_every_setting_has_a_description_and_an_example_shape() -> None:
    assert missing_documentation(build_rows()) == []


def test_every_setting_is_in_the_deploy_env_document() -> None:
    document = DOC_PATH.read_text(encoding="utf-8")
    missing = [
        f"CC_{name.upper()}"
        for name in Settings.model_fields
        if f"`CC_{name.upper()}`" not in document
    ]
    assert missing == [], "run: uv run python -m cc_platform.scripts.env_contract"


def test_the_generated_table_is_current() -> None:
    assert main(["--check"]) == 0, "run: uv run python -m cc_platform.scripts.env_contract"


def test_secrets_are_marked_and_have_placeholder_examples() -> None:
    rows = {row.variable: row for row in build_rows()}
    for variable in (
        "CC_SESSION_SECRET",
        "CC_TOTP_SECRET_KEY",
        "CC_INTERNAL_SERVICE_TOKEN",
        "CC_DATABASE_URL",
    ):
        assert rows[variable].secret.startswith("yes"), variable
        assert "<" in rows[variable].example, variable  # a placeholder, never a value
    assert rows["CC_SESSION_SECRET"].default == "dev-only value"
