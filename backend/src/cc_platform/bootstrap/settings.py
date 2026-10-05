"""Runtime configuration (environment variables with the ``CC_`` prefix, or ``.env``)."""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DATABASE_URL = f"sqlite+aiosqlite:///{BACKEND_DIR / 'cc_platform.db'}"
DEV_SESSION_SECRET = "dev-only-session-secret-change-me-0123456789"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="CC_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    env: Literal["dev", "test", "prod"] = "dev"
    build: str = Field(default="dev", description="Build id (git sha or CI run) shown in /meta.")

    # Persistence
    persistence: Literal["sqlalchemy", "memory"] = "sqlalchemy"
    database_url: str = DEFAULT_DATABASE_URL
    database_echo: bool = False
    seed_demo_data: bool = True

    # Auth (brief §4.5, canvas BoLogin/BoMfa/BoLocked)
    session_secret: SecretStr = SecretStr(DEV_SESSION_SECRET)
    session_ttl_minutes: int = Field(default=480, ge=1)
    lockout_max_attempts: int = Field(default=5, ge=1)
    lockout_minutes: int = Field(default=15, ge=1)
    mfa_ttl_seconds: int = Field(default=300, ge=10)
    mfa_max_attempts: int = Field(default=3, ge=1)
    dev_mfa_code: str = "000000"
    argon2_time_cost: int = Field(default=3, ge=1)
    argon2_memory_cost: int = Field(default=65536, ge=8)
    argon2_parallelism: int = Field(default=4, ge=1)
    # Customer chat simulator sessions (stateless tokens, audience cc-customer)
    customer_session_ttl_minutes: int = Field(default=480, ge=1)

    # Secure onboarding (part 4): invitation and password-reset links, TOTP enrollment.
    #: Origin of the SPA: the emails link to ``{public_app_url}/activar?token=…``.
    public_app_url: str = "http://localhost:5173"
    invitation_ttl_hours: int = Field(default=48, ge=1)
    password_reset_ttl_minutes: int = Field(default=60, ge=5)
    #: The name authenticator apps show above the codes.
    totp_issuer: str = "LATAM Bank CC"
    #: Fernet key that seals the TOTP secrets at rest. Unset: derived from the session
    #: secret (development and tests only; production must set it).
    totp_secret_key: SecretStr | None = None
    #: The development mailbox (``GET /api/v1/dev/mailbox``): unset = on only with
    #: ``CC_ENV=dev``; the browser e2e turns it on with ``CC_ENV=test``. Refused in prod.
    dev_mailbox: bool | None = None

    # HTTP
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    host: str = "127.0.0.1"
    port: int = 8000

    # Realtime
    realtime_queue_size: int = Field(default=256, ge=1)
    realtime_expiry_check_seconds: float = Field(default=30.0, gt=0)

    # Notifications (slice 10): how often the SLA sweep looks for cases at risk without a
    # first response ("Caso por vencer sin respuesta"); 0 turns it off (tests).
    notification_sweep_seconds: float = Field(default=30.0, ge=0)

    # agent-core (ADR 0003). Unset ``agent_core_url`` = the platform runs people-only, as before.
    #: Base URL of agent-core's runtime API (``agentcore serve``), e.g. ``http://localhost:8001``.
    agent_core_url: str | None = None
    #: A turn takes as long as the model; past this the case falls back to a person.
    agent_core_timeout_seconds: float = Field(default=60.0, gt=0)
    #: Private signing keys for agent-core credentials (see ``scripts/gen_agent_keys``); secret.
    agent_keys_file: Path | None = None
    #: The agent a conversation starts with (``id``, ``id@alias`` or ``id@X.Y.Z``).
    assistant_agent: str = "recepcion@prod"
    #: Case languages the assistant handles; other languages go straight to people. Policy
    #: ``H1``: the assistant serves Spanish and Portuguese; its hand-overs follow rule 3.
    assistant_languages: list[str] = ["es", "pt"]
    #: The analyst's copilot agent (``id``, ``id@alias`` or ``id@X.Y.Z``).
    copilot_agent: str = "copiloto-asesor@prod"
    #: The agent that proposes suggestions for a case (ADR 0005; ``id@alias``). Unset = the
    #: platform makes no suggestions (the panel answers ``available: false``).
    copilot_suggestions_agent: str | None = None
    #: Suggest on its own when a customer writes or a case reaches an analyst (off: only *Sugerir*).
    copilot_suggestions_auto: bool = True
    #: A customer's burst of messages makes one suggestion: it waits this long for the last one.
    copilot_suggestions_coalesce_seconds: float = Field(default=3.0, ge=0)
    #: How often the drafts older than 24 hours are purged; 0 turns it off.
    copilot_suggestions_purge_seconds: float = Field(default=600.0, ge=0)
    #: The builder agent supervisors chat with (slice 16; ``id``, ``id@alias`` or ``id@X.Y.Z``).
    builder_agent: str = "constructor-chat@prod"
    #: Shared secret of the service-to-service routes (``/api/v1/internal``): agent-core's
    #: ``grant_active`` check. Unset = those routes do not exist.
    internal_service_token: SecretStr | None = None
    #: How often the sweep looks for assistant work lost with its process; 0 turns it off.
    assistant_sweep_seconds: float = Field(default=30.0, ge=0)
    #: The simulated second factor (development stand-in; a real one replaces it).
    assistant_step_up_code: str = "000000"
    #: Private JSON ``{platform customer id: dataset customer id}``; never committed. Only linked
    #: customers can talk to the assistant (agent-core's customer principal is the dataset id).
    bank_customer_links_file: Path | None = None

    # Logging
    log_level: str = "INFO"
    log_format: Literal["json", "console"] = "json"

    @model_validator(mode="after")
    def _refuse_dev_defaults_in_prod(self) -> Self:
        if self.env == "prod":
            if self.session_secret.get_secret_value() == DEV_SESSION_SECRET:
                raise ValueError("CC_SESSION_SECRET must be set in production")
            if self.seed_demo_data:
                raise ValueError("CC_SEED_DEMO_DATA must be false in production")
            if self.dev_mailbox:
                raise ValueError("CC_DEV_MAILBOX is a development tool: never in production")
            if self.totp_secret_key is None:
                raise ValueError("CC_TOTP_SECRET_KEY must be set in production")
        if (self.agent_core_url is None) != (self.agent_keys_file is None):
            raise ValueError("CC_AGENT_CORE_URL and CC_AGENT_KEYS_FILE go together or not at all")
        return self

    @property
    def dev_mailbox_enabled(self) -> bool:
        if self.env == "prod":
            return False
        return self.dev_mailbox if self.dev_mailbox is not None else self.env == "dev"

    @property
    def invitation_ttl(self) -> timedelta:
        return timedelta(hours=self.invitation_ttl_hours)

    @property
    def password_reset_ttl(self) -> timedelta:
        return timedelta(minutes=self.password_reset_ttl_minutes)

    @property
    def session_ttl(self) -> timedelta:
        return timedelta(minutes=self.session_ttl_minutes)

    @property
    def customer_session_ttl(self) -> timedelta:
        return timedelta(minutes=self.customer_session_ttl_minutes)

    @property
    def lockout_duration(self) -> timedelta:
        return timedelta(minutes=self.lockout_minutes)

    @property
    def realtime_expiry_check_interval(self) -> timedelta:
        return timedelta(seconds=self.realtime_expiry_check_seconds)

    @property
    def mfa_ttl(self) -> timedelta:
        return timedelta(seconds=self.mfa_ttl_seconds)
