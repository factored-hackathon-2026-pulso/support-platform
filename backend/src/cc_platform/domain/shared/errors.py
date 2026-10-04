"""Domain error hierarchy.

Every error carries a stable machine ``code`` (part of the public API: the frontend
branches on it) plus structured ``details``. Messages are Spanish because the
API surfaces them as ``detail`` in problem+json responses that the UI may show.

HTTP status mapping lives in the API layer (``cc_platform.api.errors``), never here.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import ClassVar

from cc_platform.domain.shared.json import JsonValue


class DomainError(Exception):
    """Base class for business-rule violations raised by the domain."""

    code: ClassVar[str] = "domain_error"
    default_message: ClassVar[str] = "La operación no cumple las reglas del negocio."

    def __init__(self, message: str | None = None, **details: JsonValue) -> None:
        self.message = message or self.default_message
        self.details: Mapping[str, JsonValue] = details
        super().__init__(self.message)


class InvalidValueError(DomainError):
    """A value object or entity received a value that breaks its invariants."""

    code = "invalid_value"
    default_message = "Uno de los datos no es válido."


class NotFoundError(DomainError):
    """The referenced entity does not exist (or the actor cannot see it)."""

    code = "not_found"
    default_message = "No encontramos lo que buscas."


class ConflictError(DomainError):
    """The operation conflicts with the current state (duplicate, stale version...)."""

    code = "conflict"
    default_message = "La operación entra en conflicto con el estado actual."


class ConcurrentUpdateError(ConflictError):
    """Optimistic-locking failure: someone saved the same aggregate after it was loaded.

    Raised by repositories (compare-and-set on ``version``). Use cases that can safely
    re-run retry on it (``application.concurrency.retry_on_conflict``); otherwise the API
    answers 409 ``concurrent_update`` and the client reloads.
    """

    code = "concurrent_update"
    default_message = "Alguien más actualizó este registro al mismo tiempo. Vuelve a intentarlo."


class InvalidTransitionError(DomainError):
    """A state machine refused a transition."""

    code = "invalid_transition"
    default_message = "Ese cambio de estado no está permitido."


class PolicyViolationError(DomainError):
    """A product policy (pulso-data/docs/policies.md) forbids the operation."""

    code = "policy_violation"
    default_message = "La política del banco no permite esta operación."
