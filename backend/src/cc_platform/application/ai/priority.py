"""The urgency the assistant saw becomes the case's priority (ADR 0003, slice 14 follow-up).

When the assistant escalates, agent-core's handoff packet carries a ``priority`` (``low`` ..
``critical``). The platform copies it to the case, so the analyst sees the urgency before opening
it: a stolen card arrives ``critical``. It runs in the background after the hand-over (reading the
packet is a call to agent-core, never inside the hand-over's Unit of Work), with the customer's own
credential (the packet's priority and queue are not personal data), and is best effort: no packet,
an unknown value or a case already closed changes nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial

from cc_platform.application.ai.credentials import AgentCredentialIssuer
from cc_platform.application.ai.errors import AgentCoreRejectedError, AgentCoreUnavailableError
from cc_platform.application.ai.runtime import (
    AgentRuntime,
    AgentRuntimeError,
    AgentRuntimeUnavailableError,
)
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.events import EventRecord
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.unit_of_work import UnitOfWorkFactory
from cc_platform.domain.ai.events import AssistantEnded
from cc_platform.domain.cases.errors import CaseClosedError
from cc_platform.domain.cases.values import CasePriority
from cc_platform.domain.shared.actor import ActorRef

#: What agent-core's packet may say, by its own words (anything else is ignored).
_PRIORITIES: dict[str, CasePriority] = {
    "low": CasePriority.LOW,
    "medium": CasePriority.MEDIUM,
    "high": CasePriority.HIGH,
    "critical": CasePriority.CRITICAL,
}


@dataclass(frozen=True, slots=True)
class ApplyHandoffPriority:
    uow: UnitOfWorkFactory
    clock: Clock
    runtime: AgentRuntime
    issuer: AgentCredentialIssuer

    async def execute(self, case_id: str) -> bool:
        """Copy the handoff's priority to the case; True when it changed."""
        async with self.uow() as uow:
            session = await uow.assistant_sessions.get_by_case(case_id)
            if session is None or session.handoff_ref is None:
                return False
            bank_id = await uow.bank_links.get(session.customer_id)
            if bank_id is None:
                return False
            handoff_ref = session.handoff_ref
        credentials = self.issuer.customer(bank_customer_id=bank_id, session_id=session.id)
        try:
            packet = await self.runtime.get_handoff(credentials, handoff_ref=handoff_ref)
        except AgentRuntimeUnavailableError:
            raise AgentCoreUnavailableError() from None  # the background runner logs it
        except AgentRuntimeError as error:
            raise AgentCoreRejectedError(
                agent_core_code=error.code, agent_core_status=error.status
            ) from None
        priority = _PRIORITIES.get(str(packet.get("priority", "")).lower())
        if priority is None:
            return False
        return await retry_on_conflict(partial(self._apply, case_id, priority))

    async def _apply(self, case_id: str, priority: CasePriority) -> bool:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            if case is None:
                return False
            try:
                changed = case.change_priority(
                    actor=ActorRef.system(), priority=priority, at=self.clock.now()
                )
            except CaseClosedError:
                return False
            if changed:
                await uow.cases.save(case)
                await uow.commit()
            return changed


class HandoffPriorityProcess:
    """A bus subscriber: an assistant session that ended by escalating spawns the job."""

    def __init__(self, tasks: BackgroundTasks, apply: ApplyHandoffPriority) -> None:
        self._tasks = tasks
        self._apply = apply

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if not isinstance(event, AssistantEnded) or event.result != "escalated":
            return
        if event.case_id is not None:
            self._tasks.spawn(
                f"handoff_priority:{event.case_id}", partial(self._apply.execute, event.case_id)
            )
