"""The use cases of the ``ai`` context, as one bundle the composition root builds when
agent-core is configured (``UseCases.assistant`` is ``None`` otherwise: the platform is
people-only and the routes answer ``assistant_disabled``)."""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.ai.customer import (
    AnswerAssistantConfirmation,
    RequestPerson,
    VerifyAssistantStepUp,
)
from cc_platform.application.ai.staff import GetCaseHandoff, ReleaseAssistantCase


@dataclass(frozen=True, slots=True)
class AssistantUseCases:
    # the customer's side
    confirm: AnswerAssistantConfirmation
    verify_step_up: VerifyAssistantStepUp
    request_person: RequestPerson
    # the staff side
    handoff: GetCaseHandoff
    release: ReleaseAssistantCase
