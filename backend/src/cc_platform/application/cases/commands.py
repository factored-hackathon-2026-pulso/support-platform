"""Commands of the analyst side: reply, mark read, close.

Each runs inside ``retry_on_conflict`` and re-checks its rules on fresh state: two tabs
sending at once, or a reply racing a close, are serialised by the case's optimistic
``version`` (the loser re-runs and sees the winner's change).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

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
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import (
    CaseClosedError,
    ChannelNotSupportedError,
    IdempotencyConflictError,
    invalid_case_transition,
)
from cc_platform.domain.cases.turn import Turn, normalize_turn_text
from cc_platform.domain.cases.values import (
    CLOSABLE_STATUSES,
    CaseStatus,
    FollowUp,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.ids import IdPrefix

FOLLOW_UP_DELAY: dict[FollowUp, timedelta | None] = {
    FollowUp.NONE: None,
    FollowUp.TOMORROW: timedelta(hours=24),
    FollowUp.IN_TWO_DAYS: timedelta(hours=48),
}


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
            if case.is_closed:
                raise CaseClosedError()
            if not case.channel.is_chat:
                raise ChannelNotSupportedError(case.channel.value)
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
    views = await reader.turn_views(case, [turn])
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
    """Close (contract ``case_close``): notice to the customer, the customer's slot is
    freed (their next message opens a new case), ``case.closed`` is recorded."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, case_id: str, command: CloseCaseCommand
    ) -> CaseDetailView:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, command))

    async def _attempt(
        self, actor: Actor, case_id: str, command: CloseCaseCommand
    ) -> CaseDetailView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            if case.is_closed:
                raise CaseClosedError()
            if case.status not in CLOSABLE_STATUSES:
                raise invalid_case_transition(case.status, CaseStatus.CLOSED.value)

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
            case.close(
                actor=actor.acting_as({StaffRole.ANALYST}),
                at=now,
                resolved=command.resolved,
                contact_reason=command.contact_reason,
                resolution_code=command.resolution_code,
                followup_at=_followup_at(now, command.follow_up),
                csat_requested=command.send_csat_survey,
            )
            await uow.cases.save(case)
            await uow.turns.add(notice)
            slot = await uow.case_slots.get(case.customer_id)
            if slot is not None and slot.open_case_id == case.id:
                slot.release(case.id)
                await uow.case_slots.save(slot)
            detail = await case_detail(uow, case, actor.staff_id)
            await uow.commit()
        return detail


def _followup_at(now: datetime, follow_up: FollowUp) -> datetime | None:
    delay = FOLLOW_UP_DELAY[follow_up]
    return now + delay if delay is not None else None
