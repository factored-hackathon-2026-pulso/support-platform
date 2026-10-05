"""Runtime contract of a deployed API (``CC_ENV=staging|prod``): fail fast, never leak values."""

from __future__ import annotations

import io
from typing import Any

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from cc_platform.bootstrap.deploy_checks import DeploymentConfigError
from cc_platform.bootstrap.settings import DEV_SESSION_SECRET, Settings
from cc_platform.bootstrap.startup import CONFIG_EXIT_STATUS, describe_settings_error, load_settings

SESSION_SECRET = "s3ss10n-" + "q" * 40
TOTP_KEY = Fernet.generate_key().decode()
DB_PASSWORD = "dbpa55-w0rd-unique"
INTERNAL_TOKEN = "int3rnal-" + "z" * 40


def deployed(env: str = "staging", **overrides: Any) -> dict[str, Any]:
    """A complete, valid deployed configuration (synthetic values)."""
    values: dict[str, Any] = {
        "env": env,
        "session_secret": SESSION_SECRET,
        "totp_secret_key": TOTP_KEY,
        "database_url": f"postgresql+asyncpg://cc_app:{DB_PASSWORD}@db.internal:5432/cc",
        "public_app_url": "https://support.example.org",
        "cors_origins": [],
        "trusted_proxies": ["10.0.0.0/16", "172.16.0.0/12"],
        "seed_demo_data": env != "prod",
        "internal_service_token": INTERNAL_TOKEN,
    }
    values.update(overrides)
    return values


def problems_of(**values: Any) -> list[str]:
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **values)
    return describe_settings_error(error.value)


@pytest.mark.parametrize("env", ["staging", "prod"])
def test_a_complete_deployed_configuration_starts(env: str) -> None:
    settings = Settings(_env_file=None, **deployed(env))
    assert settings.env == env
    assert not settings.reload_enabled


def test_a_bare_deployed_environment_lists_every_missing_variable_at_once() -> None:
    problems = problems_of(env="prod")

    for name in (
        "CC_SESSION_SECRET",
        "CC_TOTP_SECRET_KEY",
        "CC_DATABASE_URL",
        "CC_PUBLIC_APP_URL",
        "CC_CORS_ORIGINS",
        "CC_SEED_DEMO_DATA",
    ):
        assert any(line.startswith(name) for line in problems), (name, problems)


@pytest.mark.parametrize(
    ("override", "variable"),
    [
        ({"session_secret": DEV_SESSION_SECRET}, "CC_SESSION_SECRET"),
        ({"session_secret": "short"}, "CC_SESSION_SECRET"),
        ({"totp_secret_key": "not-a-fernet-key"}, "CC_TOTP_SECRET_KEY"),
        ({"persistence": "memory"}, "CC_PERSISTENCE"),
        ({"public_app_url": "http://localhost:5173"}, "CC_PUBLIC_APP_URL"),
        ({"cors_origins": ["*"]}, "CC_CORS_ORIGINS"),
        ({"cors_origins": ["http://localhost:5173"]}, "CC_CORS_ORIGINS"),
        ({"trusted_proxies": ["*"]}, "CC_TRUSTED_PROXIES"),
        ({"trusted_proxies": ["not-an-ip"]}, "CC_TRUSTED_PROXIES"),
        ({"internal_service_token": "short"}, "CC_INTERNAL_SERVICE_TOKEN"),
        ({"reload": True}, "CC_RELOAD"),
    ],
)
def test_a_development_default_is_refused_when_deployed(
    override: dict[str, Any], variable: str
) -> None:
    problems = problems_of(**deployed("staging", **override))
    assert [line for line in problems if line.startswith(variable)], problems


def test_staging_may_seed_synthetic_data_but_prod_may_not() -> None:
    Settings(_env_file=None, **deployed("staging", seed_demo_data=True, dev_mailbox=True))
    problems = problems_of(**deployed("prod", seed_demo_data=True, dev_mailbox=True))
    assert any(line.startswith("CC_SEED_DEMO_DATA") for line in problems)
    assert any(line.startswith("CC_DEV_MAILBOX") for line in problems)


def test_dev_and_test_keep_their_defaults() -> None:
    assert Settings(_env_file=None, env="dev").reload_enabled
    assert not Settings(_env_file=None, env="test").reload_enabled


def test_errors_never_echo_a_value() -> None:
    """Neither the deployment rules nor pydantic's own errors quote what they got."""
    rule_breaking = deployed(
        "prod",
        session_secret="short-but-secret-XYZ",
        totp_secret_key="totp-but-not-fernet-XYZ",
        internal_service_token="tiny-XYZ",
    )
    # A field error stops before the deployment rules run: the other kind of message.
    mistyped = deployed("prod", port="not-a-port-XYZ")
    for values in (rule_breaking, mistyped):
        with pytest.raises(ValidationError) as error:
            Settings(_env_file=None, **values)

        rendered = "\n".join([str(error.value), *describe_settings_error(error.value)])
        for value in ("XYZ", DB_PASSWORD, SESSION_SECRET, INTERNAL_TOKEN):
            assert value not in rendered


def test_the_deployment_error_keeps_each_problem_apart() -> None:
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, env="staging")
    causes = [item.get("ctx", {}).get("error") for item in error.value.errors()]
    assert any(isinstance(cause, DeploymentConfigError) for cause in causes)


def test_load_settings_exits_with_a_readable_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir("/")  # no backend/.env
    monkeypatch.setenv("CC_ENV", "prod")
    monkeypatch.setenv("CC_SESSION_SECRET", "too-short-secret-ABC")
    monkeypatch.setenv("CC_DATABASE_URL", f"postgresql+asyncpg://u:{DB_PASSWORD}@h/db")
    out = io.StringIO()

    with pytest.raises(SystemExit) as exited:
        load_settings(out)

    assert exited.value.code == CONFIG_EXIT_STATUS
    text = out.getvalue()
    assert text.startswith("Invalid configuration: the API will not start.")
    assert "  - CC_SESSION_SECRET must be at least 32 characters" in text
    assert "  - CC_TOTP_SECRET_KEY is required" in text
    assert "deploy-env.md" in text
    assert "ABC" not in text
    assert DB_PASSWORD not in text


def test_load_settings_reads_a_valid_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir("/")
    monkeypatch.setenv("CC_ENV", "staging")
    monkeypatch.setenv("CC_SESSION_SECRET", SESSION_SECRET)
    monkeypatch.setenv("CC_TOTP_SECRET_KEY", TOTP_KEY)
    monkeypatch.setenv("CC_DATABASE_URL", "postgresql+asyncpg://u:p@h/db")
    monkeypatch.setenv("CC_PUBLIC_APP_URL", "https://support.example.org")
    monkeypatch.setenv("CC_CORS_ORIGINS", "[]")
    monkeypatch.setenv("CC_TRUSTED_PROXIES", '["172.16.0.0/12"]')

    settings = load_settings()

    assert settings.env == "staging"
    assert settings.cors_origins == []
    assert SESSION_SECRET not in repr(settings)
