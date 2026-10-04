"""The customer's side of the assistant (ADR 0003): answer a confirmation, pass the second
factor, ask for a person. Each is a short command in one Unit of Work; the model never runs
inside a request (``AssistantTurnProcess`` reacts to the events they record).

The customer only ever acts on their own open case (anything else is ``not_found``) and only
while the assistant handles it (``assistant_not_active`` otherwise).
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Literal

from cc_platform.application.ai.config import AssistantConfig
from cc_platform.application.ai.engine import AssistantHandover
from cc_platform.application.cases import copy
from cc_platform.application.cases.dto import CustomerConversationView
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import CustomerActor
from cc_platform.domain.ai.errors import AssistantNotActiveError, InvalidStepUpCodeError
from cc_platform.domain.ai.session import MAX_STEP_UP_ATTEMPTS, AssistantSession
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import TurnAudience, TurnAuthorRole, TurnKind
from cc_platform.domain.shared.errors import NotFoundError
from cc_platform.domain.shared.ids import IdPrefix


async def _own_assistant_case(
    uow: UnitOfWork, customer: CustomerActor
) -> tuple[Case, AssistantSession]:
    """The customer's open case, handled by the assistant, with its session."""
    slot = await uow.case_slots.get(customer.customer_id)
    case = await uow.cases.get(slot.open_case_id) if slot and slot.open_case_id else None
    if case is None or case.is_closed:
        raise NotFoundError("No encontramos una conversación abierta.")
    session = await uow.assistant_sessions.get_by_case(case.id)
    if session is None or not session.is_active or not case.is_with_assistant:
        raise AssistantNotActiveError()
    return case, session


async def _notice(uow: UnitOfWork, case: Case, ids: IdGenerator, clock: Clock, text: str) -> None:
    turn = case.append_turn(
        turn_id=ids.new_id(IdPrefix.TURN),
        kind=TurnKind.NOTICE,
        audience=TurnAudience.EVERYONE,
        author_role=TurnAuthorRole.SYSTEM,
        author_id=None,
        text=text,
        created_at=clock.now(),
    )
    await uow.turns.add(turn)


@dataclass(frozen=True, slots=True)
class AnswerAssistantConfirmation:
    """``POST /customer/conversation/confirmation``: yes or no to what the assistant asked."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, customer: CustomerActor, *, token: str, answer: Literal["yes", "no"]
    ) -> CustomerConversationView:
        return await retry_on_conflict(lambda: self._attempt(customer, token, answer))

    async def _attempt(
        self, customer: CustomerActor, token: str, answer: Literal["yes", "no"]
    ) -> CustomerConversationView:
        async with self.uow() as uow:
            case, session = await _own_assistant_case(uow, customer)
            session.answer_confirmation(
                token=token,
                answer=answer,
                turn_id=self.ids.new_id(IdPrefix.TURN),
                actor=customer.actor_ref(),
                at=self.clock.now(),
            )
            await _notice(
                uow,
                case,
                self.ids,
                self.clock,
                copy.confirmation_notice(case.language, confirmed=answer == "yes"),
            )
            await uow.cases.save(case)
            await uow.assistant_sessions.save(session)
            view = await CaseReader(uow).conversation(case)
            await uow.commit()
        return view


@dataclass(frozen=True, slots=True)
class VerifyAssistantStepUp:
    """``POST /customer/conversation/step-up``: the (simulated) second factor the assistant
    asked for. A wrong code counts; the third one hands the case to people."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    handover: AssistantHandover
    config: AssistantConfig

    async def execute(self, customer: CustomerActor, *, code: str) -> CustomerConversationView:
        remaining = await retry_on_conflict(lambda: self._attempt(customer, code))
        if remaining is not None:
            raise InvalidStepUpCodeError(remainingAttempts=remaining)
        async with self.uow() as uow:
            slot = await uow.case_slots.get(customer.customer_id)
            case = await uow.cases.get(slot.open_case_id) if slot and slot.open_case_id else None
            if case is None:
                raise NotFoundError("No encontramos una conversación abierta.")
            return await CaseReader(uow).conversation(case)

    async def _attempt(self, customer: CustomerActor, code: str) -> int | None:
        """``None`` when the code was right; else the attempts left (after committing)."""
        async with self.uow() as uow:
            case, session = await _own_assistant_case(uow, customer)
            now = self.clock.now()
            actor = customer.actor_ref()
            if hmac.compare_digest(code.encode(), self.config.step_up_code.encode()):
                session.verify_step_up(actor=actor, at=now)
                await _notice(
                    uow, case, self.ids, self.clock, copy.NOTICE_STEP_UP_VERIFIED[case.language]
                )
                await uow.cases.save(case)
                await uow.assistant_sessions.save(session)
                await uow.commit()
                return None
            exhausted = session.reject_step_up(actor=actor, at=now)
            remaining = max(0, MAX_STEP_UP_ATTEMPTS - session.step_up_attempts)
            if exhausted:
                session.fail(at=now, code="step_up_failed")
                await uow.assistant_sessions.save(session)
                await self.handover.to_people(
                    uow,
                    case,
                    reason="failed",
                    actor=actor,
                    code="step_up_failed",
                )
            else:
                await uow.assistant_sessions.save(session)
            await uow.commit()
            return remaining


@dataclass(frozen=True, slots=True)
class RequestPerson:
    """``POST /customer/conversation/human``: the customer asks to talk to a person. The case
    leaves the assistant and is placed like any arrival (rule 3)."""

    uow: UnitOfWorkFactory
    clock: Clock
    handover: AssistantHandover

    async def execute(self, customer: CustomerActor) -> CustomerConversationView:
        return await retry_on_conflict(lambda: self._attempt(customer))

    async def _attempt(self, customer: CustomerActor) -> CustomerConversationView:
        async with self.uow() as uow:
            case, session = await _own_assistant_case(uow, customer)
            actor = customer.actor_ref()
            session.release(actor=actor, at=self.clock.now())
            await uow.assistant_sessions.save(session)
            await self.handover.to_people(uow, case, reason="customer_request", actor=actor)
            view = await CaseReader(uow).conversation(case)
            await uow.commit()
        return view
