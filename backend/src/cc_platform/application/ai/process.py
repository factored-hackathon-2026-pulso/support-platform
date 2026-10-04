"""``AssistantTurnProcess``: the process manager that keeps the assistant answering (ADR 0003).

A bus subscriber, like ``QueueDrainer``: a customer's chat message, the answer to a
confirmation or a verified step-up spawns ``AssistantEngine.run_case`` in the background, so the
request that caused it never waits for the model. The job is idempotent (it claims an input
with a compare-and-set and does nothing when there is none), so duplicate events, several
messages in a burst, or a re-delivery are harmless.
"""

from __future__ import annotations

from functools import partial

from cc_platform.application.ai.engine import AssistantEngine
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.domain.ai.events import AssistantInputQueued, AssistantStepUpVerified
from cc_platform.domain.cases.events import TurnCreated
from cc_platform.domain.cases.values import TurnAudience, TurnAuthorRole, TurnKind
from cc_platform.domain.shared.events import DomainEvent

#: Events ``AssistantTurnProcess`` subscribes to.
ASSISTANT_PROCESS_EVENTS: tuple[type[DomainEvent], ...] = (
    TurnCreated,
    AssistantInputQueued,
    AssistantStepUpVerified,
)


class AssistantTurnProcess:
    def __init__(self, tasks: BackgroundTasks, engine: AssistantEngine) -> None:
        self._tasks = tasks
        self._engine = engine

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        case_id = event.case_id
        if case_id is None:
            return
        if isinstance(event, TurnCreated) and not _is_customer_message(event):
            return
        self._tasks.spawn(f"assistant:{case_id}", partial(self._engine.run_case, case_id))


def _is_customer_message(event: TurnCreated) -> bool:
    return (
        event.author_role == TurnAuthorRole.CUSTOMER.value
        and event.kind == TurnKind.MESSAGE.value
        and event.audience == TurnAudience.EVERYONE.value
    )
