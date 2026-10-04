"""Errors of the assistant context (ADR 0003). Stable codes: the frontend branches on them."""

from __future__ import annotations

from typing import ClassVar

from cc_platform.domain.shared.errors import ConflictError, DomainError


class AssistantNotActiveError(ConflictError):
    code: ClassVar[str] = "assistant_not_active"
    default_message = "El asistente ya no está atendiendo esta conversación."


class ConfirmationNotPendingError(ConflictError):
    code: ClassVar[str] = "confirmation_not_pending"
    default_message = "No hay ninguna confirmación pendiente con ese código."


class ConfirmationExpiredError(ConflictError):
    code: ClassVar[str] = "confirmation_expired"
    default_message = "La confirmación venció. Cuéntanos de nuevo qué necesitas."


class StepUpNotPendingError(ConflictError):
    code: ClassVar[str] = "step_up_not_pending"
    default_message = "No hace falta una verificación adicional ahora."


class InvalidStepUpCodeError(DomainError):
    code: ClassVar[str] = "invalid_step_up_code"
    default_message = "El código no es correcto."


class AssistantBusyError(ConflictError):
    code: ClassVar[str] = "assistant_busy"
    default_message = "El asistente todavía está respondiendo. Espera un momento."


class CopilotUnavailableError(ConflictError):
    """The copilot cannot answer about this case: the customer is not linked to the dataset."""

    code: ClassVar[str] = "copilot_unavailable"
    default_message = "El copiloto no tiene datos de este cliente para responder."


class CopilotBusyError(ConflictError):
    """The copilot is still answering a question of this thread."""

    code: ClassVar[str] = "copilot_busy"
    default_message = "El copiloto todavía está respondiendo tu pregunta anterior."


class AssistantActiveError(ConflictError):
    """A call or an email cannot join a conversation the assistant is handling (nobody would
    answer it): the customer writes in the chat, or asks for a person first."""

    code: ClassVar[str] = "assistant_active"
    default_message = (
        "Ahora te atiende el asistente por el chat. Escríbele ahí o pide hablar con una persona."
    )


class HandoffUnavailableError(DomainError):
    code: ClassVar[str] = "handoff_unavailable"
    default_message = "Este caso no viene de un traspaso del asistente."
