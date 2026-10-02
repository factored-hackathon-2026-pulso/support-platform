"""Routing use cases: ``RouteCase`` (Chain of Responsibility) and ``DrainQueue``.

``RouteCase`` offers a new case to the automated tiers in order (``ResponderRegistry``:
judge → tree → ai_agent), **outside** any transaction (a responder may call a remote
model), then in one Unit of Work records each decision as a ``routing_step`` and runs the
terminal human tier: ``AssignmentPolicy`` picks an available analyst who speaks the case
language, or the case waits in the queue. Idempotent: a case that already left ``routing``
is left alone, so a duplicate run (retry, startup recovery) does nothing.

``DrainQueue`` assigns queued cases (oldest first, one Unit of Work each) when an analyst
becomes available and at startup.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import datetime
from functools import partial

from cc_platform.application.cases import copy
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.routing.assignment import (
    AnalystDirectory,
    AssignmentChoice,
    AssignmentPolicy,
    AssignmentRequest,
    language_rule,
)
from cc_platform.application.routing.ports import (
    Responder,
    ResponderRegistry,
    RoutingContext,
    RoutingDecision,
)
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.routing.routing_step import RoutingStep
from cc_platform.domain.routing.values import RoutingOutcome
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.ids import IdPrefix

REASON_NOT_CONNECTED = "component_not_connected"
REASON_COMPONENT_ERROR = "component_error"
REASON_NO_ANALYST = "no_available_analyst"
TRANSCRIPT_LIMIT = 200


@dataclass(frozen=True, slots=True)
class _Decided:
    decision: RoutingDecision
    at: datetime


@dataclass(frozen=True, slots=True)
class HumanTier:
    """Terminal handler of the chain: assign (Strategy) or queue, plus the staff banner."""

    clock: Clock
    ids: IdGenerator
    policy: AssignmentPolicy
    directory: AnalystDirectory

    async def place(
        self,
        uow: UnitOfWork,
        case: Case,
        *,
        reason: AssignmentReason,
        null_chain: bool = False,
    ) -> bool:
        """Assign ``case`` or queue it (if it is still ``routing``). True when assigned.

        ``null_chain``: every automated tier abstained because none is connected yet; the
        staff banner says so.
        """
        now = self.clock.now()
        candidates = await self.directory.candidates(uow)
        choice = self.policy.choose(
            AssignmentRequest(case_id=case.id, language=case.language, origin=case.origin),
            candidates,
        )
        if choice is None:
            if case.status is not CaseStatus.ROUTING:
                return False  # still queued; nothing changes
            label = copy.QUEUE_LABEL[case.language]
            case.queue(
                label=label,
                reason_code=REASON_NO_ANALYST,
                policy_rule_id=language_rule(case.language),
                at=now,
            )
            await self._banner(uow, case, copy.queued(case.language, label), now)
            return False

        choice = replace(choice, reason=reason)
        assignment = self._assignment(case, choice, now)
        waited_from = case.queued_at
        case.assign(assignment)
        await uow.assignments.add(assignment)
        name = choice.candidate.name
        if reason is AssignmentReason.QUEUE_DRAINED and waited_from is not None:
            minutes = max(1, math.ceil((now - waited_from).total_seconds() / 60))
            text = copy.assigned_from_queue(name, minutes, case.queue_label or "")
        elif null_chain:
            text = copy.assigned_after_null_chain(name, case.language)
        else:
            text = copy.assigned_after_chain(name, case.language)
        await self._banner(uow, case, text, now)
        return True

    def _assignment(self, case: Case, choice: AssignmentChoice, now: datetime) -> Assignment:
        return Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=case.id,
            staff_id=choice.candidate.staff_id,
            reason=choice.reason,
            policy_rule_id=choice.policy_rule_id,
            open_cases_at_assignment=choice.candidate.open_case_count,
            strategy=choice.strategy,
            assigned_at=now,
            assigned_by=ActorRef.system(),
        )

    async def _banner(self, uow: UnitOfWork, case: Case, text: str, now: datetime) -> None:
        turn = case.append_turn(
            turn_id=self.ids.new_id(IdPrefix.TURN),
            kind=TurnKind.ROUTING,
            audience=TurnAudience.STAFF,
            author_role=TurnAuthorRole.SYSTEM,
            author_id=None,
            text=text,
            created_at=now,
        )
        await uow.cases.save(case)
        await uow.turns.add(turn)


@dataclass(frozen=True, slots=True)
class RouteCase:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    responders: ResponderRegistry
    human: HumanTier

    async def execute(self, case_id: str) -> None:
        context = await self._context(case_id)
        if context is None:
            return
        decided: list[_Decided] = []
        for responder in self.responders.chain():
            decision = await self._ask(responder, context)
            decided.append(_Decided(decision, self.clock.now()))
            if not decision.outcome.passes_case_on:
                break  # resolved / mitigated / handed off: later tiers are skipped
        await retry_on_conflict(lambda: self._apply(case_id, decided))

    async def _context(self, case_id: str) -> RoutingContext | None:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            if case is None or case.status is not CaseStatus.ROUTING:
                return None
            turns = await uow.turns.page(
                case.id, limit=TRANSCRIPT_LIMIT, audience=TurnAudience.EVERYONE
            )
        return RoutingContext(
            case_id=case.id,
            customer_ref=case.customer_id,
            channel=case.channel.value,
            language=case.language.value,
            origin=case.origin.value,
            transcript=[
                {"sequence": t.sequence, "author_role": t.author_role.value, "text": t.text}
                for t in turns
                if t.kind is TurnKind.MESSAGE
            ],
        )

    async def _ask(self, responder: Responder, context: RoutingContext) -> RoutingDecision:
        """A failing component abstains (recorded as such) instead of blocking the case."""
        try:
            return await responder.respond(context)
        except Exception:
            return RoutingDecision(
                outcome=RoutingOutcome.ABSTAINED,
                tier=responder.tier,
                component=responder.component,
                reason_code=REASON_COMPONENT_ERROR,
            )

    async def _apply(self, case_id: str, decided: list[_Decided]) -> None:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            if case is None or case.status is not CaseStatus.ROUTING:
                return  # already routed (duplicate run)
            for item in decided:
                step = _step(self.ids.new_id(IdPrefix.ROUTING_STEP), case.id, item)
                await uow.routing_steps.add(step)
                uow.record(step.recorded_event())
            null_chain = bool(decided) and all(
                item.decision.reason_code == REASON_NOT_CONNECTED for item in decided
            )
            await self.human.place(
                uow, case, reason=AssignmentReason.LANGUAGE_LEAST_LOADED, null_chain=null_chain
            )
            await uow.commit()


def _step(step_id: str, case_id: str, item: _Decided) -> RoutingStep:
    decision = item.decision
    return RoutingStep(
        id=step_id,
        case_id=case_id,
        tier=decision.tier,
        component=decision.component,
        outcome=decision.outcome,
        occurred_at=item.at,
        component_name=decision.component_name,
        reason_code=decision.reason_code,
        policy_rule_id=decision.policy_rule_id,
        confidence=decision.confidence,
        inputs_used=decision.inputs_used,
        handoff=decision.handoff,
    )


@dataclass(frozen=True, slots=True)
class DrainQueue:
    uow: UnitOfWorkFactory
    human: HumanTier

    async def execute(self) -> int:
        """Assign what can be assigned now; returns how many cases left the queue."""
        async with self.uow() as uow:
            queued = [case.id for case in await uow.cases.list_by_status(CaseStatus.QUEUED)]
        assigned = 0
        for case_id in queued:
            if await retry_on_conflict(partial(self._drain_one, case_id)):
                assigned += 1
        return assigned

    async def _drain_one(self, case_id: str) -> bool:
        async with self.uow() as uow:
            case = await uow.cases.get(case_id)
            if case is None or case.status is not CaseStatus.QUEUED:
                return False
            placed = await self.human.place(uow, case, reason=AssignmentReason.QUEUE_DRAINED)
            if placed:
                await uow.commit()
            return placed


@dataclass(frozen=True, slots=True)
class RecoverRouting:
    """Startup recovery: route cases left in ``routing`` (the process died before routing
    them), then drain the queue (analysts may have become available meanwhile)."""

    uow: UnitOfWorkFactory
    route_case: RouteCase
    drain_queue: DrainQueue

    async def execute(self) -> int:
        async with self.uow() as uow:
            pending = [case.id for case in await uow.cases.list_by_status(CaseStatus.ROUTING)]
        for case_id in pending:
            await self.route_case.execute(case_id)
        return len(pending) + await self.drain_queue.execute()
