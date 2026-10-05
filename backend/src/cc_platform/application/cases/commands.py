"""Commands of the analyst side: reply, mark read, close.

Each runs inside ``retry_on_conflict`` and re-checks its rules on fresh state: two tabs
sending at once, a reply racing a close, or a close racing the customer's next message are
serialised by the case's optimistic ``version`` (the loser re-runs and sees the winner's
change: a customer message that loses to a close opens a new linked case instead).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import partial
from typing import Protocol

from cc_platform.application.cases import copy
from cc_platform.application.cases.dto import (
    CaseDetailView,
    CaseSummaryView,
    CloseCaseCommand,
    PostTurnCommand,
    PostTurnResult,
)
from cc_platform.application.cases.queries import case_detail, load_case_for
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.background import BackgroundTasks
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.ai.session import HANDOFF_QUALITIES, handoff_reasks
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import (
    CallInProgressError,
    CaseClosedError,
    IdempotencyConflictError,
    invalid_case_transition,
)
from cc_platform.domain.cases.events import CaseHandoffRated
from cc_platform.domain.cases.turn import Turn, normalize_turn_text
from cc_platform.domain.cases.values import (
    CLOSABLE_STATUSES,
    CaseStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.errors import InvalidValueError
from cc_platform.domain.shared.ids import IdPrefix


class HandoffResolutionSender(Protocol):
    """What ``CloseCase`` needs of ``ai.staff.RecordHandoffResolution`` (no import of it)."""

    async def execute(
        self, *, case_id: str, staff_id: str, resolution_code: str, quality: str
    ) -> bool: ...


async def find_replay(
    uow: UnitOfWork, *, author_id: str, client_message_id: str, text: str
) -> Turn | None:
    """Dedupe on ``(author, clientMessageId)``: same text → the original turn (replay);
    another text → ``idempotency_conflict``."""
    existing = await uow.turns.find_by_client_message_id(author_id, client_message_id)
    if existing is not None and existing.text != text:
        raise IdempotencyConflictError()
    return existing


@dataclass(frozen=True, slots=True)
class PostAnalystTurn:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, case_id: str, command: PostTurnCommand) -> PostTurnResult:
        text = normalize_turn_text(command.text)
        return await retry_on_conflict(
            lambda: self._attempt(actor, case_id, text, command.client_message_id)
        )

    async def _attempt(
        self, actor: Actor, case_id: str, text: str, client_message_id: str
    ) -> PostTurnResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            reader = CaseReader(uow)
            replay = await find_replay(
                uow, author_id=actor.staff_id, client_message_id=client_message_id, text=text
            )
            if replay is not None:
                if replay.case_id != case.id:
                    raise IdempotencyConflictError()
                return await _turn_result(reader, case, replay, replayed=True)
            case.ensure_assignee_can_reply()

            now = self.clock.now()
            case.start_progress(at=now)
            turn = case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.MESSAGE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.ANALYST,
                author_id=actor.staff_id,
                text=text,
                created_at=now,
                client_message_id=client_message_id,
            )
            case.mark_read(up_to=turn.sequence, at=now)  # she has seen what she answered
            await uow.cases.save(case)
            await uow.turns.add(turn)
            result = await _turn_result(reader, case, turn, replayed=False)
            await uow.commit()
        return result


async def _turn_result(
    reader: CaseReader, case: Case, turn: Turn, *, replayed: bool
) -> PostTurnResult:
    views = await reader.turn_views([turn])
    return PostTurnResult(turn=views[0], case=await reader.summary(case), replayed=replayed)


@dataclass(frozen=True, slots=True)
class MarkCaseRead:
    """The assignee read up to a sequence (monotonic, clamped); opening a new case moves it
    to ``in_progress``."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, case_id: str, up_to_sequence: int) -> CaseSummaryView:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, up_to_sequence))

    async def _attempt(self, actor: Actor, case_id: str, up_to: int) -> CaseSummaryView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            if case.mark_read(up_to=up_to, at=self.clock.now()):
                await uow.cases.save(case)
            summary = await CaseReader(uow).summary(case)
            await uow.commit()
        return summary


@dataclass(frozen=True, slots=True)
class CloseCase:
    """Close with a required reason (contract §4.4), in one Unit of Work: the closed notice
    in the case language (the customer never sees the reason or the note), ``case.closed``
    + ``case.status_changed``, and the customer's slot is freed (their next message opens a
    new case linked to this one). Slice 9: an open escalation ends with the case
    (``escalation.closed``)."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    tasks: BackgroundTasks | None = None
    resolution: HandoffResolutionSender | None = None
    """ADR 0003: tells agent-core how the assistant's handoff went (the analyst's label)."""

    async def execute(
        self, actor: Actor, case_id: str, command: CloseCaseCommand
    ) -> CaseDetailView:
        quality = command.handoff_quality
        if quality is not None and quality not in HANDOFF_QUALITIES:
            raise InvalidValueError("handoffQuality is not valid", field="handoffQuality")
        reasked = handoff_reasks(command.handoff_reasked)
        if reasked and quality != "incomplete":
            raise InvalidValueError(
                "handoffReasked goes with an incomplete handoff", field="handoffReasked"
            )
        detail = await retry_on_conflict(lambda: self._attempt(actor, case_id, command))
        if quality is not None and self.resolution is not None and self.tasks is not None:
            # After the commit and off the request: a failure here never fails the close.
            self.tasks.spawn(
                "handoff_resolution",
                partial(
                    self.resolution.execute,
                    case_id=case_id,
                    staff_id=actor.staff_id,
                    resolution_code=command.reason.value,
                    quality=quality,
                ),
            )
        return detail

    async def _attempt(
        self, actor: Actor, case_id: str, command: CloseCaseCommand
    ) -> CaseDetailView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            if case.is_closed:
                raise CaseClosedError()
            if case.status not in CLOSABLE_STATUSES:
                raise invalid_case_transition(case.status, CaseStatus.CLOSED.value)
            if case.active_call_id is not None:  # slice 12: hang up first
                raise CallInProgressError(case.active_call_id)

            now = self.clock.now()
            notice = case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.NOTICE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.SYSTEM,
                author_id=None,
                text=copy.NOTICE_CLOSED[case.language],
                created_at=now,
            )
            closer = actor.acting_as({StaffRole.ANALYST})
            case.close(actor=closer, at=now, reason=command.reason, note=command.note)
            if command.handoff_quality is not None:
                await _rate_handoff(uow, case.id, closer, command, now)
            escalation_id = case.open_escalation_id
            if escalation_id is not None:  # slice 9: an open escalation ends with the case
                case.clear_escalation(escalation_id)
                escalation = await uow.escalations.get(escalation_id)
                if escalation is not None and escalation.is_open:
                    escalation.end_with_case(actor=closer, at=now)
                    await uow.escalations.save(escalation)
            await uow.cases.save(case)
            await uow.turns.add(notice)
            slot = await uow.case_slots.get(case.customer_id)
            if slot is not None and slot.open_case_id == case.id:
                slot.release(case.id)
                await uow.case_slots.save(slot)
            detail = await case_detail(uow, case, actor)
            await uow.commit()
        return detail


async def _rate_handoff(
    uow: UnitOfWork, case_id: str, closer: ActorRef, command: CloseCaseCommand, at: datetime
) -> None:
    """``case.handoff_rated``, in the close's own Unit of Work (it never depends on agent-core):
    only for a case the assistant handed over (its session has a handoff)."""
    session = await uow.assistant_sessions.get_by_case(case_id)
    if session is None or session.handoff_ref is None or command.handoff_quality is None:
        return
    uow.record(
        CaseHandoffRated(
            occurred_at=at,
            actor=closer,
            entity_id=case_id,
            case_id=case_id,
            handoff_ref=session.handoff_ref,
            quality=command.handoff_quality,
            reasked=tuple(r.value for r in handoff_reasks(command.handoff_reasked)),
            release=session.agent_release,
        )
    )
