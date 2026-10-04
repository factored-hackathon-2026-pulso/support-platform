"""Shared by the routers that expose the assistant (ADR 0003)."""

from __future__ import annotations

from cc_platform.api.context import ApiContext
from cc_platform.application.ai.errors import AssistantDisabledError
from cc_platform.application.ai.use_cases import AssistantUseCases


def assistant_use_cases(api: ApiContext) -> AssistantUseCases:
    """The assistant's use cases, or ``assistant_disabled`` (404) when agent-core is not
    configured (``CC_AGENT_CORE_URL`` unset: the platform is people-only)."""
    use_cases = api.use_cases.assistant
    if use_cases is None:
        raise AssistantDisabledError()
    return use_cases
