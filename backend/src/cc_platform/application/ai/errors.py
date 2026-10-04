"""Application errors of the ``ai`` context (ADR 0003). Stable codes, registered in
``api/problems.py``."""

from __future__ import annotations

from typing import ClassVar

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
