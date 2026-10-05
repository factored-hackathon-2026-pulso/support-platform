"""Runtime contract of a deployed API (``CC_ENV=staging`` or ``prod``): what must be set and
which development defaults are refused. ``Settings`` calls ``deployment_problems`` from its
validator; ``docs/platform/deploy-env.md`` documents every rule.

Messages name the variable and the rule, never its value (they end up in logs).
"""

from __future__ import annotations

import base64
import binascii
import ipaddress
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from cc_platform.bootstrap.settings import Settings

#: Environments that serve real traffic through the edge (CloudFront + reverse proxy).
DEPLOYED_ENVS: frozenset[str] = frozenset({"staging", "prod"})
MIN_SECRET_LENGTH = 32
_FERNET_KEY_BYTES = 32


class DeploymentConfigError(ValueError):
    """Every broken rule at once, so one restart fixes them all."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def is_deployed(env: str) -> bool:
    return env in DEPLOYED_ENVS


def deployment_problems(settings: Settings, *, dev_session_secret: str) -> list[str]:
    """The broken rules of a deployed environment (empty in ``dev`` and ``test``)."""
    if not is_deployed(settings.env):
        return []
    return [
        *_secret_problems(settings, dev_session_secret),
        *_endpoint_problems(settings),
        *_runtime_problems(settings),
    ]


def _secret_problems(settings: Settings, dev_session_secret: str) -> list[str]:
    problems: list[str] = []
    secret = settings.session_secret.get_secret_value()
    if secret == dev_session_secret:
        problems.append("CC_SESSION_SECRET is required (the development default is refused)")
    elif len(secret) < MIN_SECRET_LENGTH:
        problems.append(f"CC_SESSION_SECRET must be at least {MIN_SECRET_LENGTH} characters")

    if settings.totp_secret_key is None:
        problems.append("CC_TOTP_SECRET_KEY is required (a Fernet key)")
    elif not _is_fernet_key(settings.totp_secret_key.get_secret_value()):
        problems.append("CC_TOTP_SECRET_KEY is not a Fernet key (32 url-safe base64 bytes)")

    token = settings.internal_service_token
    if token is not None and len(token.get_secret_value()) < MIN_SECRET_LENGTH:
        problems.append(f"CC_INTERNAL_SERVICE_TOKEN must have {MIN_SECRET_LENGTH}+ characters")
    return problems


def _endpoint_problems(settings: Settings) -> list[str]:
    explicit = settings.model_fields_set
    problems: list[str] = []
    if settings.persistence != "sqlalchemy":
        problems.append("CC_PERSISTENCE must be sqlalchemy (memory loses every write)")
    elif "database_url" not in explicit:
        problems.append("CC_DATABASE_URL is required (the local SQLite default is refused)")

    if "public_app_url" not in explicit:
        problems.append("CC_PUBLIC_APP_URL is required (the public https origin of the SPA)")
    elif not _is_public_https(settings.public_app_url):
        problems.append("CC_PUBLIC_APP_URL must be an https URL that is not localhost")

    if "*" in settings.cors_origins:
        problems.append("CC_CORS_ORIGINS must list origins, not '*' (requests carry credentials)")
    elif not all(_is_public_https(origin) for origin in settings.cors_origins):
        problems.append(
            "CC_CORS_ORIGINS may only hold https origins that are not localhost "
            "([] when the SPA and the API share the CloudFront origin)"
        )
    return problems


def _runtime_problems(settings: Settings) -> list[str]:
    problems: list[str] = []
    if "*" in settings.trusted_proxies:
        problems.append("CC_TRUSTED_PROXIES must list the proxy addresses or CIDRs, not '*'")
    if settings.reload:
        problems.append("CC_RELOAD is a development tool: never in a deployed environment")
    return problems


def invalid_trusted_proxies(entries: list[str]) -> list[str]:
    """Entries of ``CC_TRUSTED_PROXIES`` that are neither ``*``, an IP nor a CIDR."""
    invalid = []
    for entry in entries:
        if entry == "*":
            continue
        try:
            ipaddress.ip_network(entry, strict=False)
        except ValueError:
            invalid.append(entry)
    return invalid


def _is_fernet_key(key: str) -> bool:
    try:
        return len(base64.urlsafe_b64decode(key.encode())) == _FERNET_KEY_BYTES
    except (binascii.Error, ValueError):
        return False


def _is_public_https(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and host not in {"", "localhost", "127.0.0.1", "::1"}
