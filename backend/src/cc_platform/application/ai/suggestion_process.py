"""The automatic suggestions (ADR 0005): a customer message or a case that reaches an analyst.

``SuggestionProcess`` is a bus subscriber, like ``AssistantTurnProcess``: the request that caused
the event never waits for the model. It does three things on top of ``SuggestionService``:

- **coalesces**: a burst of messages makes one suggestion (it waits ``coalesce_seconds`` for the
  last one and reads the case as it is then); a message that arrives while the model is working
  asks for one more round, once;
- **skips quietly** whatever has nothing to propose (the service decides: a greeting, nothing new,
  a case nobody holds, an unlinked customer);
- **never raises**: a failure is stored on the suggestion and the analyst can press *Sugerir*.

It is best effort on purpose: a suggestion lost with the process is not recovered (there is no
sweep, unlike the assistant); the analyst asks again.

``SuggestionSignal`` tells the analyst's own ``inbox:<staffId>`` topic that a suggestion changed:
the suggestion id and its status only. The content is read over REST (the copilot's rule: what the
copilot says never travels on a socket).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from functools import partial

from cc_platform.application.ai.suggestions import SuggestionService
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.domain.ai.events import (
    CopilotSuggestionFailed,
    CopilotSuggestionNone,
    CopilotSuggestionReady,
    CopilotSuggestionRequested,
)
from cc_platform.domain.ai.suggestion import SuggestionStatus, SuggestionTrigger
from cc_platform.domain.cases.events import CaseAssigned, TurnCreated
from cc_platform.domain.cases.values import (
    AssignmentReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.shared.actor import ActorRole
from cc_platform.domain.shared.events import DomainEvent

#: Events ``SuggestionProcess`` subscribes to.
SUGGESTION_PROCESS_EVENTS: tuple[type[DomainEvent], ...] = (TurnCreated, CaseAssigned)

#: Events ``SuggestionSignal`` subscribes to.
SUGGESTION_SIGNAL_EVENTS: tuple[type[DomainEvent], ...] = (
    CopilotSuggestionRequested,
    CopilotSuggestionReady,
    CopilotSuggestionNone,
    CopilotSuggestionFailed,
)

#: The signal's envelope type on the analyst's inbox topic.
SIGNAL_TYPE = "copilot.suggestion_updated"

type Sleep = Callable[[float], Awaitable[object]]


def _trigger(event: DomainEvent) -> SuggestionTrigger | None:
    if isinstance(event, TurnCreated):
        is_customer_message = (
            event.author_role == TurnAuthorRole.CUSTOMER.value
            and event.kind in (TurnKind.MESSAGE.value, TurnKind.EMAIL.value)
            and event.audience == TurnAudience.EVERYONE.value
        )
        return SuggestionTrigger.CUSTOMER_MESSAGE if is_customer_message else None
    if isinstance(event, CaseAssigned) and event.reason != AssignmentReason.OUTBOUND_CALL.value:
        return SuggestionTrigger.HANDOVER
    return None


def _strongest(
    first: SuggestionTrigger | None, second: SuggestionTrigger | None
) -> SuggestionTrigger | None:
    """Coalesced events keep the strongest reason: a case reaching an analyst proposes even when
    the assistant spoke last, which a customer message alone would not."""
    if SuggestionTrigger.HANDOVER in (first, second):
        return SuggestionTrigger.HANDOVER
    return first or second


class SuggestionProcess:
    def __init__(
        self,
        tasks: BackgroundTasks,
        service: SuggestionService,
        *,
        coalesce_seconds: float,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self._tasks = tasks
        self._service = service
        self._coalesce = coalesce_seconds
        self._sleep = sleep
        self._running: set[str] = set()
        self._again: dict[str, SuggestionTrigger] = {}

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        case_id = event.case_id
        trigger = _trigger(event)
        if case_id is None or trigger is None:
            return
        if case_id in self._running:  # one more round after the one in flight, not one per event
            self._again[case_id] = _strongest(self._again.get(case_id), trigger) or trigger
            return
        self._running.add(case_id)
        self._tasks.spawn(f"suggest:{case_id}", partial(self._run, case_id, trigger))

    async def _run(self, case_id: str, trigger: SuggestionTrigger) -> None:
        try:
            current: SuggestionTrigger | None = trigger
            while current is not None:
                if self._coalesce > 0:
                    await self._sleep(self._coalesce)
                # what arrived while waiting is read now, under the strongest reason
                current = _strongest(current, self._again.pop(case_id, None))
                assert current is not None  # noqa: S101 - narrowing for the type checker
                prepared = await self._service.prepare_automatic(case_id, current)
                if prepared is not None:
                    await self._service.produce(prepared, raise_errors=False)
                current = self._again.pop(case_id, None)
        finally:
            self._running.discard(case_id)
            self._again.pop(case_id, None)


class SuggestionSignal:
    """A suggestion changed: tell the analyst's inbox (id and status only)."""

    def __init__(self, hub: RealtimeHub) -> None:
        self._hub = hub

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if event.case_id is None:
            return
        status, analyst_id = self._status(event)
        if status is None or analyst_id is None:
            return
        if isinstance(event, CopilotSuggestionRequested) and event.trigger == "manual":
            return  # she asked: her request is waiting for the answer
        envelope = derived_envelope(
            record,
            SIGNAL_TYPE,
            {"suggestionId": event.entity_id, "status": status.value},
            actor_role=ActorRole.SYSTEM.value,
            actor_id=None,
        )
        await self._hub.publish_many((str(Topic.inbox(analyst_id)),), envelope)

    @staticmethod
    def _status(event: DomainEvent) -> tuple[SuggestionStatus | None, str | None]:
        if isinstance(event, CopilotSuggestionRequested):
            return SuggestionStatus.PREPARING, event.analyst_id
        if isinstance(event, CopilotSuggestionReady):
            return SuggestionStatus.READY, event.analyst_id
        if isinstance(event, CopilotSuggestionNone):
            return SuggestionStatus.NONE, event.analyst_id
        if isinstance(event, CopilotSuggestionFailed):
            return SuggestionStatus.FAILED, event.analyst_id
        return None, None
