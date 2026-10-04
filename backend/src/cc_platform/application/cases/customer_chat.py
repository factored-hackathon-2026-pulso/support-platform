"""The customer's side of the chat (simulator): read the conversation, write a message, and
look at past conversations, and rate a closed one (slice 7).

A customer only ever sees their own cases and only ``everyone`` turns. Writing with no open
case opens one (contract §3.1), all in **one** Unit of Work: the slot is taken, the case
opens ``queued`` with the customer's message and the "Recibimos tu mensaje" notice, a
staff-only "volvió a escribir" banner when it follows a closed case (``previous_case_id``),
and ``AssignCase`` assigns it or leaves it waiting in the language queue. The answer
therefore already says ``with_agent`` or ``waiting_agent``. With an open case the message is
appended (a customer message never changes the status).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases import copy
from cc_platform.application.cases.assignment import AssignCase
from cc_platform.application.cases.commands import find_replay
from cc_platform.application.cases.dto import (
    CustomerConversationDetailView,
    CustomerConversationResult,
    CustomerConversationSummaryView,
    PostCustomerTurnResult,
    PostTurnCommand,
    RateConversationCommand,
    RateConversationResult,
)
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.cases.sla import SlaPolicy
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import CustomerActor
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.errors import AlreadyRatedError, IdempotencyConflictError
from cc_platform.domain.cases.rating import normalize_rating_comment, normalize_rating_score
from cc_platform.domain.cases.turn import Turn, normalize_turn_text
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CasePriority,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

CUSTOMER_TURN_LIMIT = 200
MAX_PAST_CONVERSATIONS = 20


async def current_case(uow: UnitOfWork, customer_id: str) -> Case | None:
    """The open case, else the most recent one (the simulator keeps showing it closed)."""
    slot = await uow.case_slots.get(customer_id)
    if slot is not None and slot.open_case_id is not None:
        case = await uow.cases.get(slot.open_case_id)
        if case is not None:
            return case
    return await uow.cases.latest_for_customer(customer_id)


def latest_closed(cases: list[Case]) -> Case | None:
    """The most recently closed case (whatever its age)."""
    closed = [case for case in cases if case.closure is not None]
    return max(closed, key=lambda c: (c.closed_at or c.opened_at, c.id)) if closed else None


async def past_conversations(uow: UnitOfWork, customer_id: str) -> list[Case]:
    """Closed cases other than the current conversation, newest ``opened_at`` first."""
    current = await current_case(uow, customer_id)
    return [
        case
        for case in await uow.cases.list_for_customer(customer_id)
        if case.is_closed and (current is None or case.id != current.id)
    ]


async def _public_turns(uow: UnitOfWork, case_id: str, after: int | None = None) -> list[Turn]:
    if after is not None:
        return await uow.turns.page(
            case_id, limit=CUSTOMER_TURN_LIMIT, after=max(after, 0), audience=TurnAudience.EVERYONE
        )
    return await uow.turns.page(case_id, limit=CUSTOMER_TURN_LIMIT, audience=TurnAudience.EVERYONE)


@dataclass(frozen=True, slots=True)
class GetCustomerConversation:
    uow: UnitOfWorkFactory

    async def execute(
        self, customer: CustomerActor, *, after_sequence: int | None = None
    ) -> CustomerConversationResult:
        async with self.uow() as uow:
            case = await current_case(uow, customer.customer_id)
            past = len(await past_conversations(uow, customer.customer_id))
            if case is None:
                return CustomerConversationResult(
                    conversation=None, turns=(), past_conversation_count=past
                )
            turns = await _public_turns(uow, case.id, after_sequence)
            reader = CaseReader(uow)
            return CustomerConversationResult(
                conversation=await reader.conversation(case),
                turns=tuple(await reader.customer_turn_views(turns, customer.customer_id)),
                past_conversation_count=past,
            )


@dataclass(frozen=True, slots=True)
class ListPastConversations:
    """The customer's closed conversations other than the current one (newest first, ≤ 20)."""

    uow: UnitOfWorkFactory

    async def execute(self, customer: CustomerActor) -> tuple[CustomerConversationSummaryView, ...]:
        async with self.uow() as uow:
            cases = (await past_conversations(uow, customer.customer_id))[:MAX_PAST_CONVERSATIONS]
            reader = CaseReader(uow)
            return tuple([await reader.conversation_summary(case) for case in cases])


@dataclass(frozen=True, slots=True)
class GetPastConversation:
    """Any of the customer's own cases with its latest 200 public turns (ascending). Someone
    else's case answers ``not_found`` exactly like an unknown id."""

    uow: UnitOfWorkFactory

    async def execute(
        self, customer: CustomerActor, case_id: str
    ) -> CustomerConversationDetailView:
        async with self.uow() as uow:
            case = await _own_case(uow, customer, case_id)
            reader = CaseReader(uow)
            turns = await _public_turns(uow, case.id)
            return CustomerConversationDetailView(
                conversation=await reader.conversation(case),
                turns=tuple(await reader.customer_turn_views(turns, customer.customer_id)),
            )


async def _own_case(uow: UnitOfWork, customer: CustomerActor, case_id: str) -> Case:
    """One of the customer's cases; someone else's answers ``not_found`` like an unknown id."""
    case = await uow.cases.get(case_id) if is_valid_id(case_id, IdPrefix.CASE) else None
    if case is None or case.customer_id != customer.customer_id:
        raise NotFoundError("No encontramos esa conversación.", caseId=case_id)
    return case


@dataclass(frozen=True, slots=True)
class RateConversation:
    """The customer rates a closed conversation (CSAT 1–4, slice 7 contract §3), in one Unit
    of Work: ``case.rated`` lands in the event log with the case's new version.

    Checks, in this order: the case is theirs (else ``not_found``) · the answer is valid
    (``invalid_value``) · a rating already there with the same ``Idempotency-Key`` and the
    same answer is a replay (another answer with that key: ``idempotency_conflict``; another
    key: ``already_rated``) · the case is closed (``case_not_closed``). Runs inside
    ``retry_on_conflict``: of two ratings racing on the same case one commits, the other
    re-runs on fresh state and answers ``already_rated`` (or replays when it was the same
    request retried).
    """

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(
        self, customer: CustomerActor, case_id: str, command: RateConversationCommand
    ) -> RateConversationResult:
        score = normalize_rating_score(command.score)
        comment = normalize_rating_comment(command.comment)
        return await retry_on_conflict(
            lambda: self._attempt(customer, case_id, score, comment, command.idempotency_key)
        )

    async def _attempt(
        self, customer: CustomerActor, case_id: str, score: int, comment: str | None, key: str
    ) -> RateConversationResult:
        async with self.uow() as uow:
            case = await _own_case(uow, customer, case_id)
            reader = CaseReader(uow)
            existing = case.rating
            if existing is not None and existing.key == key:
                if not existing.answers(score, comment):
                    raise IdempotencyConflictError("Esa clave ya se usó para otra calificación.")
                return RateConversationResult(
                    conversation=await reader.conversation(case), replayed=True
                )
            if existing is not None:
                raise AlreadyRatedError()
            case.rate(
                actor=customer.actor_ref(),
                score=score,
                comment=comment,
                at=self.clock.now(),
                key=key,
            )
            await uow.cases.save(case)
            result = RateConversationResult(
                conversation=await reader.conversation(case), replayed=False
            )
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class PostCustomerTurn:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    sla: SlaPolicy
    assign_case: AssignCase

    async def execute(
        self, customer: CustomerActor, command: PostTurnCommand
    ) -> PostCustomerTurnResult:
        text = normalize_turn_text(command.text)
        return await retry_on_conflict(
            lambda: self._attempt(customer, text, command.client_message_id)
        )

    async def _attempt(
        self, customer: CustomerActor, text: str, client_message_id: str
    ) -> PostCustomerTurnResult:
        async with self.uow() as uow:
            reader = CaseReader(uow)
            replay = await find_replay(
                uow, author_id=customer.customer_id, client_message_id=client_message_id, text=text
            )
            if replay is not None:
                case = await uow.cases.get(replay.case_id)
                if case is None:  # pragma: no cover - turns never outlive their case
                    raise NotFoundError(caseId=replay.case_id)
                return await _result(reader, case, replay, customer, created=False, replayed=True)

            slot = await uow.case_slots.get(customer.customer_id)
            case = None
            if slot is not None and slot.open_case_id is not None:
                case = await uow.cases.get(slot.open_case_id)
            if case is not None and not case.is_closed:
                turn = self._append_message(case, customer, text, client_message_id)
                await uow.cases.save(case)
                await uow.turns.add(turn)
                created = False
            else:
                case, turns = await self._open(uow, customer, text, client_message_id)
                if slot is None:
                    slot = CustomerCaseSlot(customer_id=customer.customer_id)
                    slot.occupy(case.id)
                    await uow.case_slots.add(slot)
                else:
                    slot.release(slot.open_case_id or case.id)
                    slot.occupy(case.id)
                    await uow.case_slots.save(slot)
                await uow.cases.add(case)
                for item in turns:
                    await uow.turns.add(item)
                await self.assign_case.place(
                    uow, case, reason=AssignmentReason.LANGUAGE_LEAST_LOADED
                )
                turn, created = turns[0], True
            result = await _result(reader, case, turn, customer, created=created, replayed=False)
            await uow.commit()
        return result

    def _append_message(
        self, case: Case, customer: CustomerActor, text: str, client_message_id: str
    ) -> Turn:
        return case.append_turn(
            turn_id=self.ids.new_id(IdPrefix.TURN),
            kind=TurnKind.MESSAGE,
            audience=TurnAudience.EVERYONE,
            author_role=TurnAuthorRole.CUSTOMER,
            author_id=customer.customer_id,
            text=text,
            created_at=self.clock.now(),
            client_message_id=client_message_id,
        )

    async def _open(
        self, uow: UnitOfWork, customer: CustomerActor, text: str, client_message_id: str
    ) -> tuple[Case, list[Turn]]:
        profile = await uow.customers.get(customer.customer_id)
        if profile is None:
            raise AuthenticationRequiredError()
        previous = latest_closed(await uow.cases.list_for_customer(profile.id))
        now = self.clock.now()
        case = Case.open(
            case_id=self.ids.new_id(IdPrefix.CASE),
            customer_id=profile.id,
            customer_name=profile.display_name,
            channel=customer.channel,
            language=profile.language,
            priority=CasePriority.NONE,  # every case opens without a priority (slice 8)
            opened_at=now,
            sla_due_at=self.sla.due_at(opened_at=now),
            actor=customer.actor_ref(),
            previous_case_id=previous.id if previous else None,
        )
        turns = [self._append_message(case, customer, text, client_message_id)]
        turns.append(
            case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.NOTICE,
                audience=TurnAudience.EVERYONE,
                author_role=TurnAuthorRole.SYSTEM,
                author_id=None,
                text=copy.NOTICE_OPENED[case.language],
                created_at=now,
            )
        )
        if previous is not None and previous.closure is not None:
            turns.append(
                case.append_turn(
                    turn_id=self.ids.new_id(IdPrefix.TURN),
                    kind=TurnKind.ROUTING,
                    audience=TurnAudience.STAFF,
                    author_role=TurnAuthorRole.SYSTEM,
                    author_id=None,
                    text=copy.wrote_again(
                        profile.first_name, previous.closure.closed_at, previous.closure.reason
                    ),
                    created_at=now,
                )
            )
        return case, turns


async def _result(
    reader: CaseReader,
    case: Case,
    turn: Turn,
    customer: CustomerActor,
    *,
    created: bool,
    replayed: bool,
) -> PostCustomerTurnResult:
    views = await reader.customer_turn_views([turn], customer.customer_id)
    return PostCustomerTurnResult(
        turn=views[0],
        conversation=await reader.conversation(case),
        case_created=created or (replayed and turn.sequence == 1),
        replayed=replayed,
    )
