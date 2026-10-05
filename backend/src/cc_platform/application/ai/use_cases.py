"""The use cases of the ``ai`` context, as one bundle the composition root builds when
agent-core is configured (``UseCases.assistant`` is ``None`` otherwise: the platform is
people-only and the routes answer ``assistant_disabled``)."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ai.builder import AgentBuilder
from cc_platform.application.ai.builder_chat import (
    AskBuilder,
    GetBuilderThread,
    RestartBuilderThread,
)
from cc_platform.application.ai.copilot import AskCopilot, GetCopilotThread
from cc_platform.application.ai.customer import (
    AnswerAssistantConfirmation,
    RequestPerson,
    VerifyAssistantStepUp,
)
from cc_platform.application.ai.grants import GetGrantStatus
from cc_platform.application.ai.staff import GetCaseHandoff, ReleaseAssistantCase
from cc_platform.application.ai.suggestions import (
    DecideSuggestion,
    GetLatestSuggestion,
    LinkSuggestion,
    PurgeSuggestionDrafts,
    RequestSuggestion,
    SuggestionService,
)


@dataclass(frozen=True, slots=True)
class BuilderUseCases:
    """The agent builder (slice 16): the registry operations and the chat with the builder agent."""

    registry: AgentBuilder
    thread: GetBuilderThread
    ask: AskBuilder
    restart: RestartBuilderThread


@dataclass(frozen=True, slots=True)
class SuggestionUseCases:
    """The copilot's suggestions (ADR 0005): ask, read the latest, decide, link what the analyst
    did, and purge the drafts. ``service`` is the engine the automatic ones also use."""

    service: SuggestionService
    request: RequestSuggestion
    latest: GetLatestSuggestion
    decide: DecideSuggestion
    link: LinkSuggestion
    purge: PurgeSuggestionDrafts


@dataclass(frozen=True, slots=True)
class AssistantUseCases:
    # the customer's side
    confirm: AnswerAssistantConfirmation
    verify_step_up: VerifyAssistantStepUp
    request_person: RequestPerson
    # the staff side
    handoff: GetCaseHandoff
    release: ReleaseAssistantCase
    # the analyst's copilot (slice 15)
    copilot_thread: GetCopilotThread
    ask_copilot: AskCopilot
    # service-to-service: agent-core's ``grant_active`` check
    grant_status: GetGrantStatus
    # the agent builder for supervisors (slice 16): ``None`` when the registry is not wired
    builder: BuilderUseCases | None = None
    # the copilot's suggestions (ADR 0005): ``None`` when no suggestions agent is configured
    suggestions: SuggestionUseCases | None = None
