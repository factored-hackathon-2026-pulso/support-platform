"""Shared by the routers that expose the assistant (ADR 0003).

Slice 18: the AI switch ("Funciones de IA"). While it is off, the copilot and the agent builder
behave exactly as if agent-core were not configured (``assistant_disabled``, or
``available: false`` on the reads that report availability). The routes that let an assistant
conversation already under way finish (the customer's confirmation, step-up and "ask for a
person", the handoff read, Supervisión's release, agent-core's grant check) do not ask the
switch: turning AI off stops new chats from starting with the assistant, it does not strand
the ones it holds.
"""

from __future__ import annotations

from cc_platform.api.context import ApiContext
from cc_platform.application.ai.errors import AssistantDisabledError
from cc_platform.application.ai.use_cases import AssistantUseCases, BuilderUseCases


def assistant_use_cases(api: ApiContext) -> AssistantUseCases:
    """The assistant's use cases, or ``assistant_disabled`` (404) when agent-core is not
    configured (``CC_AGENT_CORE_URL`` unset: the platform is people-only)."""
    use_cases = api.use_cases.assistant
    if use_cases is None:
        raise AssistantDisabledError()
    return use_cases


async def ai_is_on(api: ApiContext) -> bool:
    """The AI switch (slice 18): the stored setting, else ``CC_AI_ENABLED``."""
    return await api.use_cases.platform.ai_switch.is_on()


async def switched_assistant_use_cases(api: ApiContext) -> AssistantUseCases:
    """``assistant_use_cases``, and ``assistant_disabled`` (404) while the AI switch is off."""
    use_cases = assistant_use_cases(api)
    if not await ai_is_on(api):
        raise AssistantDisabledError()
    return use_cases


async def builder_use_cases(api: ApiContext) -> BuilderUseCases:
    """The agent builder's use cases, or ``assistant_disabled`` (404) without agent-core or
    while the AI switch is off."""
    builder = (await switched_assistant_use_cases(api)).builder
    if builder is None:
        raise AssistantDisabledError()
    return builder
