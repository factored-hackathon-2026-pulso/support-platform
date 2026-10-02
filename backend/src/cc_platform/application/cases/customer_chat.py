"""The customer's side of the chat (simulator): read the conversation, write a message.

A customer only ever sees their own case and only ``everyone`` turns (rule 2). Writing with
no open case opens one (``routing``, SLA from ``SlaPolicy``) with the customer's message and
a "Recibimos tu mensaje" notice; the routing process manager then routes it in the
background. With an open case the message is appended whatever its status (a customer
message never changes the status).
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.application.cases import copy
from cc_platform.application.cases.commands import find_replay
from cc_platform.application.cases.dto import (
    CustomerConversationResult,
    PostCustomerTurnResult,
    PostTurnCommand,
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
from cc_platform.domain.cases.turn import Turn, normalize_turn_text
from cc_platform.domain.cases.values import (
    CaseOrigin,
    CasePriority,
    ChannelSessionKind,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

CUSTOMER_TURN_LIMIT = 200


async def current_case(uow: UnitOfWork, customer_id: str) -> Case | None:
    """The open case, else the most recent closed one (the simulator keeps showing it)."""
    slot = await uow.case_slots.get(customer_id)
    if slot is not None and slot.open_case_id is not None:
        case = await uow.cases.get(slot.open_case_id)
        if case is not None:
            return case
    return await uow.cases.latest_for_customer(customer_id)


@dataclass(frozen=True, slots=True)
class GetCustomerConversation:
    uow: UnitOfWorkFactory

    async def execute(
        self, customer: CustomerActor, *, after_sequence: int | None = None
    ) -> CustomerConversationResult:
        async with self.uow() as uow:
            case = await current_case(uow, customer.customer_id)
            if case is None:
                return CustomerConversationResult(conversation=None, turns=())
            if after_sequence is not None:
                turns = await uow.turns.page(
                    case.id,
                    limit=CUSTOMER_TURN_LIMIT,
                    after=max(after_sequence, 0),
                    audience=TurnAudience.EVERYONE,
                )
            else:
                turns = await uow.turns.page(
                    case.id, limit=CUSTOMER_TURN_LIMIT, audience=TurnAudience.EVERYONE
                )
            reader = CaseReader(uow)
            return CustomerConversationResult(
                conversation=await reader.conversation(case),
                turns=tuple(await reader.customer_turn_views(turns, customer.customer_id)),
            )


@dataclass(frozen=True, slots=True)
class PostCustomerTurn:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    sla: SlaPolicy

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
            if case is not None:
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
                    slot.occupy(case.id)
                    await uow.case_slots.save(slot)
                await uow.cases.add(case)
                for item in turns:
                    await uow.turns.add(item)
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
        now = self.clock.now()
        channel = customer.channel
        case = Case.open(
            case_id=self.ids.new_id(IdPrefix.CASE),
            customer_id=profile.id,
            customer_name=profile.display_name,
            channel=channel,
            channel_session=ChannelSessionKind.for_chat(channel),
            language=profile.language,
            origin=CaseOrigin.CUSTOMER,
            priority=CasePriority.MEDIUM,  # no judge yet (slice 1)
            opened_at=now,
            sla_due_at=self.sla.due_at(
                channel=channel,
                origin=CaseOrigin.CUSTOMER,
                priority=CasePriority.MEDIUM,
                opened_at=now,
            ),
            actor=customer.actor_ref(),
        )
        message = self._append_message(case, customer, text, client_message_id)
        notice = case.append_turn(
            turn_id=self.ids.new_id(IdPrefix.TURN),
            kind=TurnKind.NOTICE,
            audience=TurnAudience.EVERYONE,
            author_role=TurnAuthorRole.SYSTEM,
            author_id=None,
            text=copy.NOTICE_OPENED[case.language],
            created_at=now,
        )
        return case, [message, notice]


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
