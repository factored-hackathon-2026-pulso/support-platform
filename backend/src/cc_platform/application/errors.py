"""Application errors: failures that are not business rules of one aggregate.

Authentication, authorisation and request-level failures live here. Like domain errors,
each one has a stable ``code`` that the API exposes in problem+json bodies.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import ClassVar

from cc_platform.domain.shared.json import JsonValue


class ApplicationError(Exception):
    code: ClassVar[str] = "application_error"
    default_message: ClassVar[str] = "No pudimos completar la operación."

    def __init__(self, message: str | None = None, **details: JsonValue) -> None:
        self.message = message or self.default_message
        self.details: Mapping[str, JsonValue] = details
        super().__init__(self.message)


class InvalidCredentialsError(ApplicationError):
    """Wrong email or password. ``remainingAttempts`` is present when the account exists."""

    code = "invalid_credentials"
    default_message = "El correo o la contraseña no coinciden."

    def __init__(self, remaining_attempts: int | None = None) -> None:
        if remaining_attempts is None:
            super().__init__()
        else:
            super().__init__(None, remainingAttempts=remaining_attempts)
        self.remaining_attempts = remaining_attempts


class InvalidMfaCodeError(ApplicationError):
    code = "mfa_invalid"
    default_message = "El código no es válido o ya venció."

    def __init__(self, remaining_attempts: int) -> None:
        super().__init__(None, remainingAttempts=remaining_attempts)
        self.remaining_attempts = remaining_attempts


class AuthenticationRequiredError(ApplicationError):
    """No session token, or the token is malformed, forged or revoked."""

    code = "unauthenticated"
    default_message = "Necesitas iniciar sesión."


class SessionExpiredError(ApplicationError):
    code = "session_expired"
    default_message = "Tu sesión venció. Vuelve a ingresar."


class ForbiddenError(ApplicationError):
    code = "forbidden"
    default_message = "Tu rol no tiene permiso para esta acción."

    def __init__(self, required_roles: Iterable[str] = ()) -> None:
        roles: list[JsonValue] = []
        roles.extend(sorted(required_roles))
        super().__init__(None, requiredRoles=roles)


class InvalidTopicError(ApplicationError):
    code = "invalid_topic"
    default_message = "El tema de suscripción no existe."
