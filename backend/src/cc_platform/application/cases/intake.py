"""``CaseIntake``: a customer contacts the bank by chat, phone or email (slice 12).

One open case per customer, whatever the channel: with an open case the new contact joins it
(the case keeps the channel that opened it); otherwise a new case opens with the contact's
channel, all in the caller's Unit of Work (contract §3.1): the slot is taken, the case opens
``queued`` with the contact's turns and the channel's "we got it" notice, a staff-only
"volvió a escribir" banner when it follows a closed case (``previous_case_id``), and
``AssignCase`` assigns it or leaves it waiting in the language queue.

The caller passes ``contact``: what the contact adds to the case (the customer's message, an
email, or nothing for a call, whose ``Call`` the caller starts through ``on_case``). It runs
before the notice, so a first message keeps sequence 1.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from cc_platform.application.ai.config import AssistantGate
from cc_platform.application.cases import copy, staff_lines
from cc_platform.application.cases.assignment import AssignCase
from cc_platform.application.cases.sla import SlaPolicy
from cc_platform.application.errors import AuthenticationRequiredError
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.application.security import CustomerActor
from cc_platform.domain.ai.errors import AssistantActiveError
from cc_platform.domain.ai.session import AssistantSession
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.shared.ids import IdPrefix

#: Adds the contact's turns to the case (it may add none: a call).
type Contact = Callable[[Case, datetime], list[Turn]]


def latest_closed(cases: list[Case]) -> Case | None:
    """The most recently closed case (whatever its age)."""
    closed = [case for case in cases if case.closure is not None]
    return max(closed, key=lambda c: (c.closed_at or c.opened_at, c.id)) if closed else None


@dataclass(slots=True)
class Intake:
    """What the contact did: the case it opened or joined and every turn it wrote."""

    case: Case
    created: bool
    turns: list[Turn] = field(default_factory=list)

    @property
    def first(self) -> Turn | None:
        return self.turns[0] if self.turns else None


@dataclass(frozen=True, slots=True)
class CaseIntake:
    clock: Clock
    ids: IdGenerator
    sla: SlaPolicy
    assign_case: AssignCase
    assistant: AssistantGate | None = None
    """ADR 0003: when set, a new chat case of a linked customer opens in the agent's hands."""

    async def open_or_join(
        self,
        uow: UnitOfWork,
        customer: CustomerActor,
        *,
        channel: CaseChannel,
        contact: Contact,
        on_case: Callable[[Case], None] | None = None,
    ) -> Intake:
        """Join the open case or open one. ``on_case`` runs on the case before it is stored
        (a call takes the case's active-call pointer there); it may raise to refuse."""
        now = self.clock.now()
        slot = await uow.case_slots.get(customer.customer_id)
        case = None
        if slot is not None and slot.open_case_id is not None:
            case = await uow.cases.get(slot.open_case_id)
        if case is not None and not case.is_closed:
            if case.is_with_assistant and not channel.is_chat:
                raise AssistantActiveError()  # nobody would answer a call or an email now
            if on_case is not None:
                on_case(case)
            turns = contact(case, now)
            await uow.cases.save(case)
            for turn in turns:
                await uow.turns.add(turn)
            return Intake(case=case, created=False, turns=turns)

        case, turns, session = await self._open(uow, customer, channel, contact, now)
        if on_case is not None:
            on_case(case)
        if slot is None:
            slot = CustomerCaseSlot(customer_id=customer.customer_id)
            slot.occupy(case.id)
            await uow.case_slots.add(slot)
        else:
            slot.release(slot.open_case_id or case.id)
            slot.occupy(case.id)
            await uow.case_slots.save(slot)
        await uow.cases.add(case)
        for turn in turns:
            await uow.turns.add(turn)
        if session is not None:
            # ADR 0003: nobody holds it and it is in no queue until the agent hands it over.
            await uow.assistant_sessions.add(session)
        else:
            await self.assign_case.place(uow, case, reason=AssignmentReason.LANGUAGE_LEAST_LOADED)
        return Intake(case=case, created=True, turns=turns)

    async def _open(
        self,
        uow: UnitOfWork,
        customer: CustomerActor,
        channel: CaseChannel,
        contact: Contact,
        now: datetime,
    ) -> tuple[Case, list[Turn], AssistantSession | None]:
        profile = await uow.customers.get(customer.customer_id)
        if profile is None:
            raise AuthenticationRequiredError()
        previous = latest_closed(await uow.cases.list_for_customer(profile.id))
        case_id = self.ids.new_id(IdPrefix.CASE)
        agent = (
            await self.assistant.agent_for(uow, profile, channel)
            if self.assistant is not None
            else None
        )
        session = (
            None
            if agent is None
            else AssistantSession.start(
                session_id=self.ids.new_id(IdPrefix.ASSISTANT_SESSION),
                case_id=case_id,
                customer_id=profile.id,
                entry_agent=agent,
                at=now,
            )
        )
        case = Case.open(
            case_id=case_id,
            customer_id=profile.id,
            customer_name=profile.display_name,
            channel=channel,
            language=profile.language,
            priority=CasePriority.NONE,  # every case opens without a priority (slice 8)
            opened_at=now,
            sla_due_at=self.sla.due_at(opened_at=now),
            actor=customer.actor_ref(),
            previous_case_id=previous.id if previous else None,
            assistant=None if session is None or agent is None else (session.id, agent),
        )
        turns = contact(case, now)
        if session is None:  # the assistant answers instead of "una persona te responde"
            turns.append(
                case.append_turn(
                    turn_id=self.ids.new_id(IdPrefix.TURN),
                    kind=TurnKind.NOTICE,
                    audience=TurnAudience.EVERYONE,
                    author_role=TurnAuthorRole.SYSTEM,
                    author_id=None,
                    text=copy.opened_notice(channel, case.language),
                    created_at=now,
                )
            )
        if previous is not None and previous.closure is not None:
            again = staff_lines.wrote_again(
                profile.first_name, previous.closure.closed_at, previous.closure.reason, channel
            )
            turns.append(
                case.append_turn(
                    turn_id=self.ids.new_id(IdPrefix.TURN),
                    kind=TurnKind.ROUTING,
                    audience=TurnAudience.STAFF,
                    author_role=TurnAuthorRole.SYSTEM,
                    author_id=None,
                    text=again.text,
                    created_at=now,
                    staff_line=again.line,
                )
            )
        return case, turns, session
