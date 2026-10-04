"""Application errors of the ``ai`` context (ADR 0003). Stable codes, registered in
``api/problems.py``."""

from __future__ import annotations

from typing import ClassVar

from cc_platform.application.ai.registry import (
    AgentRegistryError,
    EvalReport,
    Violation,
    YardstickChange,
)
from cc_platform.application.errors import ApplicationError


class AssistantDisabledError(ApplicationError):
    """agent-core is not configured (``CC_AGENT_CORE_URL`` unset): the platform is people-only."""

    code: ClassVar[str] = "assistant_disabled"
    default_message = "El asistente no está activo en esta plataforma."


class AgentCoreUnavailableError(ApplicationError):
    """agent-core did not answer (timeout or network): try again, or carry on without it."""

    code: ClassVar[str] = "agent_core_unavailable"
    default_message = "No pudimos comunicarnos con el asistente. Intenta de nuevo en un momento."


class AgentCoreRejectedError(ApplicationError):
    """agent-core answered with an error (``agentCoreCode`` is its stable problem code)."""

    code: ClassVar[str] = "agent_core_rejected"
    default_message = "El asistente no pudo atender esta solicitud."

    def __init__(self, *, agent_core_code: str, agent_core_status: int) -> None:
        super().__init__(None, agentCoreCode=agent_core_code, agentCoreStatus=agent_core_status)


# ----------------------------------------------------------------------------- agent builder (S16)
class BuilderStepUpInvalidError(ApplicationError):
    """The second-factor code that approving, publishing, promoting or revoking asks for did not
    match (it counts toward the account lock, like a wrong code at sign-in)."""

    code: ClassVar[str] = "builder_step_up_invalid"
    default_message = (
        "El código de verificación no es correcto. Escribe el que muestra ahora tu app."
    )

    def __init__(self, remaining_attempts: int) -> None:
        super().__init__(None, remainingAttempts=remaining_attempts)
        self.remaining_attempts = remaining_attempts


class BuilderBusyError(ApplicationError):
    """The builder agent is still answering a previous message of this thread."""

    code: ClassVar[str] = "builder_busy"
    default_message = "El constructor todavía está respondiendo tu mensaje anterior."


class RegistryRejectedError(ApplicationError):
    """The registry refused a call. Subclasses fix the stable platform ``code``; ``registryCode``
    is the registry's own (``proposal_stale``, ``illegal_transition``...). The structured parts
    (violations, the failed report) are rendered by the API layer with its schemas."""

    code: ClassVar[str] = "agent_core_rejected"

    def __init__(self, error: AgentRegistryError) -> None:
        super().__init__(error.detail or None, registryCode=error.code)
        self.registry_code = error.code
        self.registry_detail = error.detail
        self.violations: tuple[Violation, ...] = error.violations
        self.report: EvalReport | None = error.report
        self.eval_run_id: str | None = error.eval_run_id
        self.yardstick_loosened: tuple[YardstickChange, ...] = error.yardstick_loosened


class RegistryValidationFailedError(RegistryRejectedError):
    """The draft or the candidate breaks rules (``violations``) or exceeds the limits."""

    code: ClassVar[str] = "registry_validation_failed"
    default_message = "La propuesta no es válida todavía. Revisa las violaciones."


class RegistryGateFailedError(RegistryRejectedError):
    """The evaluation did not pass the gate (the proposal went back to draft) or there is no
    passing evaluation to approve or publish."""

    code: ClassVar[str] = "registry_gate_failed"
    default_message = "La candidata no pasa el gate de evaluación."


class RegistryLooseningNotAcceptedError(RegistryRejectedError):
    """The proposal loosens the yardstick: approve it again with ``acceptYardstickLoosened``."""

    code: ClassVar[str] = "registry_loosening_not_accepted"
    default_message = "La propuesta afloja la vara de evaluación: apruébala aparte, aceptándolo."


class RegistryConflictError(RegistryRejectedError):
    """The proposal is not in a state that allows this (``proposal_stale``, ``candidate_changed``,
    ``illegal_transition``) or a key was reused (``idempotency_conflict``)."""

    code: ClassVar[str] = "registry_conflict"
    default_message = "La propuesta cambió o no está en el estado que esto necesita."


class RegistryForbiddenError(RegistryRejectedError):
    """The registry's roles refuse the call (``forbidden_role``, ``step_up_required``)."""

    code: ClassVar[str] = "registry_forbidden"
    default_message = "El registro no permite esta operación con tu rol."


class RegistryNotFoundError(RegistryRejectedError):
    """The proposal, release, alias or entity does not exist in the registry."""

    code: ClassVar[str] = "registry_not_found"
    default_message = "No encontramos eso en el registro de agentes."


class RegistryQuotaExceededError(RegistryRejectedError):
    code: ClassVar[str] = "registry_quota_exceeded"
    default_message = "Se alcanzó el tope de operaciones permitidas para esta propuesta."


_BY_REGISTRY_CODE: dict[str, type[RegistryRejectedError]] = {
    "validation_failed": RegistryValidationFailedError,
    "gate_failed": RegistryGateFailedError,
    "loosening_not_accepted": RegistryLooseningNotAcceptedError,
    "proposal_stale": RegistryConflictError,
    "candidate_changed": RegistryConflictError,
    "illegal_transition": RegistryConflictError,
    "idempotency_conflict": RegistryConflictError,
    "forbidden_role": RegistryForbiddenError,
    "step_up_required": RegistryForbiddenError,
    "not_found": RegistryNotFoundError,
    "quota_exceeded": RegistryQuotaExceededError,
}


def translate_registry_error(error: AgentRegistryError) -> ApplicationError:
    """The platform error for a registry refusal; a code the platform does not know (an
    authentication problem, an internal one) is the generic ``agent_core_rejected``."""
    known = _BY_REGISTRY_CODE.get(error.code)
    if known is not None:
        return known(error)
    return AgentCoreRejectedError(agent_core_code=error.code, agent_core_status=error.status)
