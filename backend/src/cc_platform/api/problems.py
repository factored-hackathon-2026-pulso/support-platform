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
    # customer rating (slice 7)
    CASE_NOT_CLOSED = "case_not_closed"
    ALREADY_RATED = "already_rated"
    # escalations (slice 9)
    ESCALATION_OPEN = "escalation_open"
    ESCALATION_NOT_OPEN = "escalation_not_open"
    # calls (slice 12)
    CALL_IN_PROGRESS = "call_in_progress"
    CALL_NOT_ACTIVE = "call_not_active"
    # the assistant (ADR 0003)
    ASSISTANT_DISABLED = "assistant_disabled"
    ASSISTANT_NOT_ACTIVE = "assistant_not_active"
    ASSISTANT_ACTIVE = "assistant_active"
    ASSISTANT_BUSY = "assistant_busy"
    CONFIRMATION_NOT_PENDING = "confirmation_not_pending"
    CONFIRMATION_EXPIRED = "confirmation_expired"
    STEP_UP_NOT_PENDING = "step_up_not_pending"
    INVALID_STEP_UP_CODE = "invalid_step_up_code"
    HANDOFF_UNAVAILABLE = "handoff_unavailable"
    COPILOT_UNAVAILABLE = "copilot_unavailable"
    COPILOT_BUSY = "copilot_busy"
    AGENT_CORE_UNAVAILABLE = "agent_core_unavailable"
    AGENT_CORE_REJECTED = "agent_core_rejected"
    # the agent builder (slice 16)
    BUILDER_STEP_UP_INVALID = "builder_step_up_invalid"
    BUILDER_BUSY = "builder_busy"
    REGISTRY_VALIDATION_FAILED = "registry_validation_failed"
    REGISTRY_GATE_FAILED = "registry_gate_failed"
    REGISTRY_LOOSENING_NOT_ACCEPTED = "registry_loosening_not_accepted"
    REGISTRY_CONFLICT = "registry_conflict"
    REGISTRY_FORBIDDEN = "registry_forbidden"
    REGISTRY_NOT_FOUND = "registry_not_found"
    REGISTRY_QUOTA_EXCEEDED = "registry_quota_exceeded"
    # supervision (manual assignment)
    ANALYST_NOT_ELIGIBLE = "analyst_not_eligible"
    LANGUAGE_MISMATCH = "language_mismatch"
    ANALYST_PAUSED = "analyst_paused"
    ASSIGNMENT_CHANGED = "assignment_changed"
    # administration (slice 4)
    VERSION_CONFLICT = "version_conflict"
    EMAIL_TAKEN = "email_taken"
    TEAM_NAME_TAKEN = "team_name_taken"
    SELF_CHANGE_FORBIDDEN = "self_change_forbidden"
    LAST_ADMIN = "last_admin"
    STAFF_HAS_OPEN_CASES = "staff_has_open_cases"
    TEAM_NOT_EMPTY = "team_not_empty"
    TEAM_INACTIVE = "team_inactive"
    STAFF_INACTIVE = "staff_inactive"
    # secure onboarding (part 4)
    STAFF_INVITED = "staff_invited"
    LINK_INVALID = "link_invalid"
    RATE_LIMITED = "rate_limited"
    PASSWORD_REJECTED = "password_rejected"  # noqa: S105 - a problem code, not a secret
    TOTP_INVALID = "totp_invalid"
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
    P.CASE_NOT_CLOSED: ProblemSpec(
        409, "Case not closed", "Solo se puede calificar una conversación terminada."
    ),
    P.ALREADY_RATED: ProblemSpec(
        409, "Already rated", "Esta conversación ya tiene una calificación."
    ),
    P.ESCALATION_OPEN: ProblemSpec(
        409, "Escalation already open", "Este caso ya está escalado a supervisión."
    ),
    P.ESCALATION_NOT_OPEN: ProblemSpec(
        409, "Escalation not open", "Este escalamiento ya no está abierto."
    ),
    P.CALL_IN_PROGRESS: ProblemSpec(
        409, "Call in progress", "Este caso tiene una llamada en curso."
    ),
    P.CALL_NOT_ACTIVE: ProblemSpec(409, "Call not active", "Esta llamada ya terminó."),
    P.ASSISTANT_DISABLED: ProblemSpec(
        404, "Assistant disabled", "El asistente no está activo en esta plataforma."
    ),
    P.ASSISTANT_NOT_ACTIVE: ProblemSpec(
        409, "Assistant not active", "El asistente ya no está atendiendo esta conversación."
    ),
    P.ASSISTANT_ACTIVE: ProblemSpec(
        409,
        "Assistant active",
        "Ahora te atiende el asistente por el chat. Escríbele ahí o pide hablar con una persona.",
    ),
    P.ASSISTANT_BUSY: ProblemSpec(
        409, "Assistant busy", "El asistente todavía está respondiendo. Espera un momento."
    ),
    P.CONFIRMATION_NOT_PENDING: ProblemSpec(
        409, "Confirmation not pending", "No hay ninguna confirmación pendiente con ese código."
    ),
    P.CONFIRMATION_EXPIRED: ProblemSpec(
        409, "Confirmation expired", "La confirmación venció. Cuéntanos de nuevo qué necesitas."
    ),
    P.STEP_UP_NOT_PENDING: ProblemSpec(
        409, "Step-up not pending", "No hace falta una verificación adicional ahora."
    ),
    P.INVALID_STEP_UP_CODE: ProblemSpec(422, "Invalid step-up code", "El código no es correcto."),
    P.COPILOT_UNAVAILABLE: ProblemSpec(
        409, "Copilot unavailable", "El copiloto no tiene datos de este cliente para responder."
    ),
    P.COPILOT_BUSY: ProblemSpec(
        409, "Copilot busy", "El copiloto todavía está respondiendo tu pregunta anterior."
    ),
    P.HANDOFF_UNAVAILABLE: ProblemSpec(
        404, "Handoff unavailable", "Este caso no viene de un traspaso del asistente."
    ),
    P.AGENT_CORE_UNAVAILABLE: ProblemSpec(
        503,
        "Assistant service unavailable",
        "No pudimos comunicarnos con el asistente. Intenta de nuevo en un momento.",
    ),
    P.AGENT_CORE_REJECTED: ProblemSpec(
        502, "Assistant service refused", "El asistente no pudo atender esta solicitud."
    ),
    P.BUILDER_STEP_UP_INVALID: ProblemSpec(
        422,
        "Invalid step-up code",
        "El código de verificación no es correcto. Escribe el que muestra ahora tu app.",
    ),
    P.BUILDER_BUSY: ProblemSpec(
        409, "Builder busy", "El constructor todavía está respondiendo tu mensaje anterior."
    ),
    P.REGISTRY_VALIDATION_FAILED: ProblemSpec(
        422, "Proposal not valid", "La propuesta no es válida todavía. Revisa las violaciones."
    ),
    P.REGISTRY_GATE_FAILED: ProblemSpec(
        409, "Evaluation gate failed", "La candidata no pasa el gate de evaluación."
    ),
    P.REGISTRY_LOOSENING_NOT_ACCEPTED: ProblemSpec(
        409,
        "Yardstick loosening not accepted",
        "La propuesta afloja la vara de evaluación: apruébala aparte, aceptándolo.",
    ),
    P.REGISTRY_CONFLICT: ProblemSpec(
        409,
        "Proposal state conflict",
        "La propuesta cambió o no está en el estado que esto necesita.",
    ),
    P.REGISTRY_FORBIDDEN: ProblemSpec(
        403, "Registry refused", "El registro no permite esta operación con tu rol."
    ),
    P.REGISTRY_NOT_FOUND: ProblemSpec(
        404, "Not found in the registry", "No encontramos eso en el registro de agentes."
    ),
    P.REGISTRY_QUOTA_EXCEEDED: ProblemSpec(
        429, "Registry quota exceeded", "Se alcanzó el tope de operaciones para esta propuesta."
    ),
    P.ANALYST_NOT_ELIGIBLE: ProblemSpec(
        422, "Analyst not eligible", "Esa persona no puede recibir casos."
    ),
    P.LANGUAGE_MISMATCH: ProblemSpec(
        422,
        "Language rule violated",
        "Ese caso necesita a alguien que hable su idioma (regla 3).",
    ),
    P.ANALYST_PAUSED: ProblemSpec(
        409,
        "Analyst paused",
        "Esa persona está en pausa. Confirma para asignarle el caso igual.",
    ),
    P.ASSIGNMENT_CHANGED: ProblemSpec(
        409, "Assignment changed", "El caso cambió de manos mientras decidías."
    ),
    P.VERSION_CONFLICT: ProblemSpec(
        409, "Version conflict", "Alguien más cambió este registro mientras editabas."
    ),
    P.EMAIL_TAKEN: ProblemSpec(409, "Email already in use", "Ya existe una cuenta con ese correo."),
    P.TEAM_NAME_TAKEN: ProblemSpec(
        409, "Team name already in use", "Ya existe un equipo con ese nombre."
    ),
    P.SELF_CHANGE_FORBIDDEN: ProblemSpec(
        422, "Self change forbidden", "No puedes hacer ese cambio sobre tu propia cuenta."
    ),
    P.LAST_ADMIN: ProblemSpec(
        409,
        "Last administrator",
        "Debe quedar al menos una persona activa con el rol de Administración.",
    ),
    P.STAFF_HAS_OPEN_CASES: ProblemSpec(
        409,
        "Staff has open cases",
        "Tiene casos abiertos. Supervisión tiene que reasignarlos antes de este cambio.",
    ),
    P.TEAM_NOT_EMPTY: ProblemSpec(
        409, "Team not empty", "El equipo todavía tiene personas activas."
    ),
    P.TEAM_INACTIVE: ProblemSpec(422, "Team inactive", "Ese equipo está desactivado."),
    P.STAFF_INACTIVE: ProblemSpec(409, "Account inactive", "Esta cuenta está desactivada."),
    P.STAFF_INVITED: ProblemSpec(
        409,
        "Account not activated",
        "Esta persona todavía no activó su cuenta. Reenvía la invitación.",
    ),
    P.LINK_INVALID: ProblemSpec(410, "Link no longer valid", "El enlace venció o ya se usó."),
    P.RATE_LIMITED: ProblemSpec(
        429,
        "Too many attempts",
        "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
    ),
    P.PASSWORD_REJECTED: ProblemSpec(
        422, "Password rejected", "La contraseña no cumple los requisitos."
    ),
    P.TOTP_INVALID: ProblemSpec(
        422,
        "Invalid authenticator code",
        "El código no coincide. Escribe el código que muestra ahora tu app.",
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
