"""The AI maturity per case type (slice 21, ADR 0006 §1 and §4).

- ``MaturityProjector`` (a bus subscriber, only while the AI switch is on) turns what the platform
  records into each type's signals and applies the team rule (``StageRule``): a case of the type
  closes (resolved or not, whether someone asked the copilot, whether it proposed tools and one
  was used), a draft of the copilot is decided (sent as is, edited, discarded). When the rule is
  met the type advances one stage, or is marked ready for an agent at stage 3: audited and pushed
  live (``ai.stage_updated`` on ``ai:stages``).
- ``GetAiStages`` is what the Workspace (the stage strip, the copilot mode of a case) and
  Supervisión read; ``MoveStageBack`` is Supervisión moving a type back.
- ``RecordToolUsed`` records that the analyst used a ``tool`` the copilot proposed: a platform-side
  event (``copilot.tool_used``) next to the suggestion, which it does not change.
- ``WhileTypeProposes`` gates the copilot's automatic suggestions (ADR 0005): they are made only
  for cases whose type is at stage 2 or more (a type at stage 0 or 1 gets no proposals).

A case's copilot mode is its type's: stage 0 (and "Sin tipo") none, 1 ``answer``, 2 ``tools``,
3 and beyond ``drafts``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import Protocol

from cc_platform.application.ai.errors import AssistantDisabledError
from cc_platform.application.cases.queries import load_case_for
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.events import EventRecord
from cc_platform.application.platform.settings import AiSwitch
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.event_log import AuditFilters
from cc_platform.application.ports.realtime import RealtimeHub
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.realtime.projector import derived_envelope
from cc_platform.application.realtime.topics import Topic
from cc_platform.application.security import Actor, ensure_any_role
from cc_platform.domain.ai.events import CopilotQueryAsked, CopilotSuggestionDecided
from cc_platform.domain.ai.maturity import (
    MATURING_TYPES,
    CaseTypeMaturity,
    CopilotMode,
    MaturityStage,
    StageRule,
)
from cc_platform.domain.ai.maturity_events import STAGE_EVENTS, CopilotToolUsed
from cc_platform.domain.ai.suggestion import SuggestionStatus
from cc_platform.domain.cases.events import CaseClosed
from cc_platform.domain.cases.values import CaseType, CloseReason
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.events import DomainEvent

#: What ``MaturityProjector`` listens to.
MATURITY_SIGNAL_EVENTS: tuple[type[DomainEvent], ...] = (CaseClosed, CopilotSuggestionDecided)

#: The envelope Supervisión and the Workspace follow on ``ai:stages``.
STAGE_SIGNAL_TYPE = "ai.stage_updated"

#: The most copilot events one case is read for when it closes (far above a real case).
_CASE_EVENTS_LIMIT = 500

_SUGGESTION_READY = "copilot.suggestion_ready"


class CaseTypeMaturityRepository(Protocol):
    async def get(self, case_type: CaseType) -> CaseTypeMaturity | None: ...

    async def list(self) -> list[CaseTypeMaturity]: ...

    async def add(self, maturity: CaseTypeMaturity) -> None:
        """Store a type the first time (a concurrent first insert raises
        ``ConcurrentUpdateError``: retry on fresh state)."""
        ...

    async def save(self, maturity: CaseTypeMaturity) -> None: ...


async def load_maturity(uow: UnitOfWork, case_type: CaseType) -> tuple[CaseTypeMaturity, bool]:
    """The type's maturity and whether it is new (a type nothing happened to yet: stage 0)."""
    stored = await uow.case_type_maturity.get(case_type)
    if stored is not None:
        return stored, False
    return CaseTypeMaturity(case_type=case_type), True


async def store_maturity(uow: UnitOfWork, maturity: CaseTypeMaturity, *, new: bool) -> None:
    if new:
        await uow.case_type_maturity.add(maturity)
    else:
        await uow.case_type_maturity.save(maturity)


async def copilot_mode_for(uow: UnitOfWork, case_type: CaseType) -> CopilotMode | None:
    """The copilot mode of a case of that type (``None``: no copilot, "Sin tipo" included)."""
    if case_type is CaseType.NONE:
        return None
    maturity = await uow.case_type_maturity.get(case_type)
    return maturity.copilot_mode if maturity is not None else None


# ----------------------------------------------------------------------------------- signals
@dataclass(frozen=True, slots=True)
class CaseCopilotFacts:
    """What the copilot did in one case, read from the event log when it closes."""

    asked: bool
    tools_proposed: bool
    tool_used: bool


async def case_copilot_facts(uow: UnitOfWork, case_id: str) -> CaseCopilotFacts:
    events = await uow.event_log.search(
        AuditFilters(
            case_id=case_id,
            event_types=frozenset(
                {CopilotQueryAsked.event_type, _SUGGESTION_READY, CopilotToolUsed.event_type}
            ),
        ),
        before=None,
        limit=_CASE_EVENTS_LIMIT,
    )
    asked = any(e.event_type == CopilotQueryAsked.event_type for e in events)
    tool_used = any(e.event_type == CopilotToolUsed.event_type for e in events)
    tools_proposed = tool_used or any(
        e.event_type == _SUGGESTION_READY and "tool" in _kinds(e.payload.get("kinds"))
        for e in events
    )
    return CaseCopilotFacts(asked=asked, tools_proposed=tools_proposed, tool_used=tool_used)


def _kinds(raw: object) -> Sequence[object]:
    return raw if isinstance(raw, list | tuple) else ()


@dataclass(frozen=True, slots=True)
class MaturityProjector:
    """Counts each type's signals and applies the team rule (see the module docstring). A case
    counts once, when it closes, with the type it has then; a draft counts when it is decided."""

    uow: UnitOfWorkFactory
    rule: StageRule

    async def __call__(self, record: EventRecord) -> None:
        event = record.event
        if isinstance(event, CaseClosed):
            await retry_on_conflict(partial(self._closed, event))
        elif isinstance(event, CopilotSuggestionDecided) and event.subject == "reply":
            await retry_on_conflict(partial(self._draft, event))

    async def _closed(self, event: CaseClosed) -> None:
        async with self.uow() as uow:
            case = await uow.cases.get(event.entity_id)
            if case is None or case.case_type is CaseType.NONE:
                return
            facts = await case_copilot_facts(uow, case.id)
            maturity, new = await load_maturity(uow, case.case_type)
            maturity.record_closed_case(
                resolved=event.reason == CloseReason.RESOLVED.value,
                asked=facts.asked,
                tools_proposed=facts.tools_proposed,
                tool_used=facts.tool_used,
            )
            maturity.evaluate(self.rule, at=event.occurred_at)
            await store_maturity(uow, maturity, new=new)
            await uow.commit()

    async def _draft(self, event: CopilotSuggestionDecided) -> None:
        outcome = self.rule.draft_outcome(event.decision, event.edit_distance_permille)
        if outcome is None or event.case_id is None:
            return
        async with self.uow() as uow:
            case = await uow.cases.get(event.case_id)
            if case is None or case.case_type is CaseType.NONE:
                return
            maturity, new = await load_maturity(uow, case.case_type)
            maturity.record_draft(outcome, self.rule)
            maturity.evaluate(self.rule, at=event.occurred_at)
            await store_maturity(uow, maturity, new=new)
            await uow.commit()


@dataclass(frozen=True, slots=True)
class MaturityRealtimeProjector:
    """A stage change → ``ai.stage_updated`` ``{caseType}`` on ``ai:stages`` (a signal: the
    clients read ``GET /ai/stages`` again)."""

    hub: RealtimeHub

    async def __call__(self, record: EventRecord) -> None:
        if not isinstance(record.event, STAGE_EVENTS):
            return
        envelope = derived_envelope(
            record, STAGE_SIGNAL_TYPE, {"caseType": record.entity_id}, actor_id=None
        )
        await self.hub.publish(str(Topic.ai_stages()), envelope)


@dataclass(frozen=True, slots=True)
class WhileTypeProposes:
    """Forwards a case event to the copilot's automatic suggestions only when the case's type is
    at stage 2 or more (its copilot proposes tools, or drafts too). Wraps ADR 0005's
    ``SuggestionProcess`` without changing it."""

    uow: UnitOfWorkFactory
    subscriber: Callable[[EventRecord], Awaitable[None]]

    async def __call__(self, record: EventRecord) -> None:
        if record.case_id is None:
            return
        async with self.uow() as uow:
            case = await uow.cases.get(record.case_id)
            mode = await copilot_mode_for(uow, case.case_type) if case is not None else None
        if mode in (CopilotMode.TOOLS, CopilotMode.DRAFTS):
            await self.subscriber(record)


# ----------------------------------------------------------------------------------- queries
@dataclass(frozen=True, slots=True)
class CaseTypeStageView:
    maturity: CaseTypeMaturity
    changed_by_name: str | None


@dataclass(frozen=True, slots=True)
class AiStagesView:
    available: bool
    """False while the AI switch is off: hide every stage (``types`` is empty)."""
    rule: StageRule
    types: tuple[CaseTypeStageView, ...]


async def _view(uow: UnitOfWork, maturity: CaseTypeMaturity) -> CaseTypeStageView:
    name = None
    if maturity.changed_by_id is not None:
        person = await uow.staff.get(maturity.changed_by_id)
        name = person.name if person is not None else None
    return CaseTypeStageView(maturity=maturity, changed_by_name=name)


@dataclass(frozen=True, slots=True)
class GetAiStages:
    """``GET /ai/stages``: every case type's stage, signals and last change (analysts and
    Supervisión). A type nothing happened to yet is at stage 0."""

    uow: UnitOfWorkFactory
    switch: AiSwitch
    rule: StageRule

    async def execute(self, actor: Actor) -> AiStagesView:
        ensure_any_role(actor, {StaffRole.ANALYST, StaffRole.SUPERVISOR})
        async with self.uow() as uow:
            if not await self.switch.is_on_in(uow):
                return AiStagesView(available=False, rule=self.rule, types=())
            stored = {m.case_type: m for m in await uow.case_type_maturity.list()}
            views = [
                await _view(uow, stored.get(t) or CaseTypeMaturity(case_type=t))
                for t in MATURING_TYPES
            ]
        return AiStagesView(available=True, rule=self.rule, types=tuple(views))


def maturing_type(raw: str) -> CaseType:
    """A path's case type: one that matures (``none`` and unknown values are not found)."""
    try:
        case_type = CaseType(raw)
    except ValueError:
        raise NotFoundError("No encontramos ese tipo de caso.") from None
    if case_type is CaseType.NONE:
        raise NotFoundError("No encontramos ese tipo de caso.")
    return case_type


@dataclass(frozen=True, slots=True)
class MoveStageResultView:
    changed: bool
    type: CaseTypeStageView


@dataclass(frozen=True, slots=True)
class MoveStageBack:
    """Supervisión moves a type back to an earlier stage (a desired state: the same stage is
    ``changed: false``). Audited; the type earns the stages above again from zero."""

    uow: UnitOfWorkFactory
    clock: Clock
    switch: AiSwitch

    async def execute(self, actor: Actor, case_type: str, *, to_stage: int) -> MoveStageResultView:
        ensure_any_role(actor, {StaffRole.SUPERVISOR})
        kind = maturing_type(case_type)
        try:
            target = MaturityStage(to_stage)
        except ValueError:
            raise InvalidValueError("La etapa va de 0 a 3.", field="toStage") from None
        return await retry_on_conflict(partial(self._attempt, actor, kind, target))

    async def _attempt(
        self, actor: Actor, case_type: CaseType, target: MaturityStage
    ) -> MoveStageResultView:
        async with self.uow() as uow:
            if not await self.switch.is_on_in(uow):
                raise AssistantDisabledError()
            maturity, new = await load_maturity(uow, case_type)
            changed = maturity.move_back(
                to_stage=target,
                actor=actor.acting_as({StaffRole.SUPERVISOR}),
                at=self.clock.now(),
            )
            if changed:
                await store_maturity(uow, maturity, new=new)
                await uow.commit()
            return MoveStageResultView(changed=changed, type=await _view(uow, maturity))


@dataclass(frozen=True, slots=True)
class RecordToolUsed:
    """``POST /cases/{caseId}/copilot/suggestions/{suggestionId}/tools``: the analyst used a tool
    the copilot proposed ("Usar" in Herramientas). Records ``copilot.tool_used`` (the suggestion
    is not changed). Her own suggestion, on her open case, a tool it proposed; AI on."""

    uow: UnitOfWorkFactory
    clock: Clock
    switch: AiSwitch

    async def execute(self, actor: Actor, case_id: str, suggestion_id: str, *, tool: str) -> None:
        ensure_any_role(actor, {StaffRole.ANALYST})
        async with self.uow() as uow:
            if not await self.switch.is_on_in(uow):
                raise AssistantDisabledError()
            case = await load_case_for(uow, actor, case_id, write=True)
            suggestion = await uow.copilot_suggestions.get(suggestion_id)
            if (
                suggestion is None
                or suggestion.case_id != case.id
                or suggestion.analyst_id != actor.staff_id
                or suggestion.status is not SuggestionStatus.READY
                or tool not in suggestion.tool_ids
            ):
                raise NotFoundError("No encontramos esa herramienta en la sugerencia.")
            uow.record(
                CopilotToolUsed(
                    occurred_at=self.clock.now(),
                    actor=actor.acting_as({StaffRole.ANALYST}),
                    entity_id=suggestion.id,
                    case_id=case.id,
                    tool=tool,
                )
            )
            await uow.commit()


@dataclass(frozen=True, slots=True)
class MaturityUseCases:
    """Slice 21: the stages per case type (whatever agent-core says: they are platform data)."""

    stages: GetAiStages
    move_back: MoveStageBack
    tool_used: RecordToolUsed


def stage_since(maturity: CaseTypeMaturity) -> list[tuple[int, datetime]]:
    """The reached stages (1-3) and when, in order."""
    return sorted(maturity.stage_since.items())
