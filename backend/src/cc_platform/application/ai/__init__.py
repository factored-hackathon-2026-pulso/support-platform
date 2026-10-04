"""The ``ai`` bounded context: the platform's side of the contract with ``agent-core`` (ADR 0003).

Ports and DTOs only. The platform never imports ``agent_core``: the contract is its
``contracts/openapi.json`` and the adapters in ``infrastructure/ai`` speak it over HTTP.
"""

from cc_platform.application.ai.credentials import (
    AgentCredentialIssuer,
    AgentCredentials,
    BuilderIdentity,
)
from cc_platform.application.ai.runtime import (
    AgentAwaiting,
    AgentConfirmation,
    AgentMessage,
    AgentOutcome,
    AgentRun,
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
    AgentStepUp,
    AgentTurn,
    HandoffQuality,
    HandoffResolutionResult,
    SessionLineage,
    SessionLineageRun,
)

__all__ = [
    "AgentAwaiting",
    "AgentConfirmation",
    "AgentCredentialIssuer",
    "AgentCredentials",
    "AgentMessage",
    "AgentOutcome",
    "AgentRun",
    "AgentRuntime",
    "AgentRuntimeError",
    "AgentRuntimeUnavailableError",
    "AgentStepUp",
    "AgentTurn",
    "BuilderIdentity",
    "HandoffQuality",
    "HandoffResolutionResult",
    "SessionLineage",
    "SessionLineageRun",
]
