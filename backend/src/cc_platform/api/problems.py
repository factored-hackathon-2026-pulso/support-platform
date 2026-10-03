"""Problem code registry: the single list of stable error codes and their HTTP meaning.

Every ``code`` the API can answer (problem+json bodies and WebSocket ``error`` envelopes)
is a ``ProblemCode`` member with one ``ProblemSpec`` (status, title, optional default
detail). Error classes in the domain and application layers declare their ``code`` string;
``tests/api/test_problem_codes.py`` checks that each of them is registered here, and the
OpenAPI document publishes ``ProblemCode`` as an enum, so the frontend's generated types
fail ``check:api`` when a code is added or renamed without regenerating.

Adding an error: declare the class with its ``code``, add the member and its spec here,
re-export ``openapi.json`` and run ``pnpm gen:api`` in the frontend.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum


class ProblemCode(StrEnum):
    # authentication / session
    INVALID_CREDENTIALS = "invalid_credentials"
    MFA_INVALID = "mfa_invalid"
    MFA_CHALLENGE_INVALID = "mfa_challenge_invalid"
    ACCOUNT_LOCKED = "account_locked"
    UNAUTHENTICATED = "unauthenticated"
    SESSION_EXPIRED = "session_expired"
    FORBIDDEN = "forbidden"
    # resources and state
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    CONFLICT = "conflict"
    CONCURRENT_UPDATE = "concurrent_update"
    INVALID_TRANSITION = "invalid_transition"
    # cases
    CASE_NOT_ASSIGNED = "case_not_assigned"
    CASE_CLOSED = "case_closed"
    IDEMPOTENCY_CONFLICT = "idempotency_conflict"
    # input and business rules
    INVALID_VALUE = "invalid_value"
    POLICY_VIOLATION = "policy_violation"
    VALIDATION_ERROR = "validation_error"
    DOMAIN_ERROR = "domain_error"
    APPLICATION_ERROR = "application_error"
    # realtime (WebSocket ``error`` envelopes)
    INVALID_TOPIC = "invalid_topic"
    INVALID_MESSAGE = "invalid_message"
    # transport
    HTTP_ERROR = "http_error"
    INTERNAL_ERROR = "internal_error"


@dataclass(frozen=True, slots=True)
class ProblemSpec:
    status: int
    title: str
    detail: str | None = None  # default Spanish detail when the error carries none


P = ProblemCode

PROBLEMS: Mapping[ProblemCode, ProblemSpec] = {
    P.INVALID_CREDENTIALS: ProblemSpec(401, "Invalid credentials"),
    P.MFA_INVALID: ProblemSpec(401, "Invalid second-factor code"),
    P.MFA_CHALLENGE_INVALID: ProblemSpec(401, "Second-factor challenge is no longer valid"),
    P.ACCOUNT_LOCKED: ProblemSpec(423, "Account locked"),
    P.UNAUTHENTICATED: ProblemSpec(401, "Authentication required", "Necesitas iniciar sesión."),
    P.SESSION_EXPIRED: ProblemSpec(401, "Session expired"),
    P.FORBIDDEN: ProblemSpec(403, "Forbidden", "Tu rol no tiene permiso para esta acción."),
    P.NOT_FOUND: ProblemSpec(404, "Not found", "No encontramos lo que buscas."),
    P.METHOD_NOT_ALLOWED: ProblemSpec(
        405, "Method not allowed", "Esta operación no está disponible en esta ruta."
    ),
    P.CONFLICT: ProblemSpec(409, "Conflict"),
    P.CONCURRENT_UPDATE: ProblemSpec(409, "Concurrent update"),
    P.INVALID_TRANSITION: ProblemSpec(409, "Invalid state transition"),
    P.CASE_NOT_ASSIGNED: ProblemSpec(403, "Case not assigned", "No tienes acceso a este caso."),
    P.CASE_CLOSED: ProblemSpec(409, "Case closed", "Este caso ya está cerrado."),
    P.IDEMPOTENCY_CONFLICT: ProblemSpec(
        409, "Idempotency conflict", "Ese mensaje ya se envió con otro texto."
    ),
    P.INVALID_VALUE: ProblemSpec(422, "Invalid value"),
    P.POLICY_VIOLATION: ProblemSpec(422, "Policy violation"),
    P.VALIDATION_ERROR: ProblemSpec(
        422, "Request validation failed", "La solicitud tiene datos inválidos."
    ),
    P.DOMAIN_ERROR: ProblemSpec(422, "Business rule violated"),
    P.APPLICATION_ERROR: ProblemSpec(400, "Request failed"),
    P.INVALID_TOPIC: ProblemSpec(422, "Invalid topic"),
    P.INVALID_MESSAGE: ProblemSpec(422, "Invalid realtime message", "Mensaje no reconocido."),
    P.HTTP_ERROR: ProblemSpec(400, "Request failed"),
    P.INTERNAL_ERROR: ProblemSpec(
        500, "Internal server error", "Ocurrió un error inesperado. Intenta de nuevo."
    ),
}

#: Framework HTTP errors (routing, method) → code. Other statuses answer ``http_error``.
CODE_BY_HTTP_STATUS: Mapping[int, ProblemCode] = {
    401: P.UNAUTHENTICATED,
    403: P.FORBIDDEN,
    404: P.NOT_FOUND,
    405: P.METHOD_NOT_ALLOWED,
}


def problem_code(code: str, *, fallback: ProblemCode) -> ProblemCode:
    """The registered member for ``code``; ``fallback`` for an unregistered string."""
    try:
        return ProblemCode(code)
    except ValueError:
        return fallback


def spec_for(code: ProblemCode) -> ProblemSpec:
    return PROBLEMS[code]
