"""Simulated phone calls (slice 12): no telephony, only the call's state, its times and its
transcript, written by the people on the line.

Staff side (the case's assignee, as Analista; anyone else on the case is 403
``case_not_assigned``, an unknown case or a call of another case 404):

- ``StartOutboundCall``: on an open assigned case without an active call (409
  ``call_in_progress``), with a reason (≤ 500). ``Idempotency-Key`` replays it.
- ``AnswerCall`` (an inbound call that rings): answering is a response (the first one stops
  the first-response SLA) and opens a ``new`` case (``in_progress``).
- ``HoldCall`` / ``ResumeCall`` / ``SetCallMuted`` / ``HangUpCall``.
- ``PostCallLine``: what the analyst says while the call is ``in_call`` (a ``transcript`` turn).
- ``AddInternalNote``: a staff-only ``note`` turn on an open case she holds.

Customer side (only their own calls; anyone else's is 404 like an unknown id):

- ``StartInboundCall``: joins the open case or opens one like a chat message does
  (``CaseIntake``, channel ``phone_inbound``): it rings until the assignee answers.
- ``AnswerOutboundCall`` / ``RejectOutboundCall`` / ``CustomerHangUp`` / ``PostCustomerCallLine``.

Every command runs in ``retry_on_conflict`` and re-checks its rules on fresh state. Starting
and ending a call save the case (``active_call_id``), so a call and a close serialise on the
case's ``version``: a case with an active call is never closed (409 ``call_in_progress``).
Hold, resume and the end write a ``system`` transcript line (the case is saved with it).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.cases import copy
from cc_platform.application.cases.assignment import AssignCase
from cc_platform.application.cases.commands import find_replay
from cc_platform.application.cases.customer_chat import current_case
from cc_platform.application.cases.dto import (
    CallListView,
    CallResult,
    CustomerCallResult,
    CustomerCallView,
    CustomerTurnResult,
    PostTurnCommand,
    PostTurnResult,
    StartOutboundCallCommand,
)
from cc_platform.application.cases.intake import CaseIntake
from cc_platform.application.cases.queries import load_case_for
from cc_platform.application.cases.read_model import CaseReader
from cc_platform.application.cases.sla import SlaPolicy
from cc_platform.application.concurrency import retry_on_conflict
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.application.security import Actor, CustomerActor
from cc_platform.domain.cases.call import Call, CallDirection, normalize_call_reason
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import (
    CaseClosedError,
    IdempotencyConflictError,
    invalid_case_transition,
)
from cc_platform.domain.cases.turn import Turn, normalize_turn_text
from cc_platform.domain.cases.values import (
    OPEN_ASSIGNED_STATUSES,
    CaseChannel,
    CaseStatus,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import StaffRole
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, NotFoundError
from cc_platform.domain.shared.ids import IdPrefix, is_valid_id

# ----------------------------------------------------------------------------- helpers


def _not_found(call_id: str) -> NotFoundError:
    return NotFoundError("No encontramos esa llamada.", callId=call_id)


async def _call_of_case(uow: UnitOfWork, case: Case, call_id: str) -> Call:
    """The call, if it belongs to ``case`` (else 404, like an unknown id)."""
    call = await uow.calls.get(call_id) if is_valid_id(call_id, IdPrefix.CALL) else None
    if call is None or call.case_id != case.id:
        raise _not_found(call_id)
    return call


async def _own_call(uow: UnitOfWork, customer: CustomerActor, call_id: str) -> tuple[Call, Case]:
    """One of the customer's calls and its case; anyone else's is 404 like an unknown id."""
    call = await uow.calls.get(call_id) if is_valid_id(call_id, IdPrefix.CALL) else None
    if call is None or call.customer_id != customer.customer_id:
        raise _not_found(call_id)
    case = await uow.cases.get(call.case_id)
    if case is None:  # pragma: no cover - foreign key
        raise _not_found(call_id)
    return call, case


def _line(
    case: Case,
    ids: IdGenerator,
    *,
    role: TurnAuthorRole,
    author_id: str | None,
    text: str,
    at: datetime,
    client_message_id: str | None = None,
) -> Turn:
    """A ``transcript`` turn: what someone said on the call, or a ``system`` line."""
    return case.append_turn(
        turn_id=ids.new_id(IdPrefix.TURN),
        kind=TurnKind.TRANSCRIPT,
        audience=TurnAudience.EVERYONE,
        author_role=role,
        author_id=author_id,
        text=text,
        created_at=at,
        client_message_id=client_message_id,
    )


def _system_line(case: Case, ids: IdGenerator, text: str, at: datetime) -> Turn:
    """A ``system`` transcript line (held, resumed, ended)."""
    return _line(case, ids, role=TurnAuthorRole.SYSTEM, author_id=None, text=text, at=at)


def _ended_line(case: Case, ids: IdGenerator, call: Call, at: datetime) -> Turn:
    answered = call.answered_at is not None
    text = (copy.CALL_ENDED if answered else copy.CALL_NOT_ANSWERED)[case.language]
    return _system_line(case, ids, text, at)


async def _store(uow: UnitOfWork, case: Case, call: Call, *turns: Turn) -> None:
    await uow.cases.save(case)
    await uow.calls.save(call)
    for turn in turns:
        await uow.turns.add(turn)


async def _staff_result(
    reader: CaseReader, call: Call, case: Case, *, replayed: bool = False
) -> CallResult:
    return CallResult(
        call=await reader.call_view(call), case=await reader.summary(case), replayed=replayed
    )


async def _customer_result(
    reader: CaseReader, call: Call, case: Case, *, created: bool = False, replayed: bool = False
) -> CustomerCallResult:
    return CustomerCallResult(
        call=await reader.customer_call_view(call),
        conversation=await reader.conversation(case),
        case_created=created,
        replayed=replayed,
    )


def _analyst(actor: Actor) -> ActorRef:
    return actor.acting_as({StaffRole.ANALYST})


def _require_open_assigned(case: Case) -> None:
    if case.is_closed:
        raise CaseClosedError()
    if case.status not in OPEN_ASSIGNED_STATUSES:
        raise invalid_case_transition(case.status, CaseStatus.IN_PROGRESS.value)


# ----------------------------------------------------------------------------- staff side
@dataclass(frozen=True, slots=True)
class StartOutboundCall:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, case_id: str, command: StartOutboundCallCommand
    ) -> CallResult:
        reason = normalize_call_reason(command.reason)
        return await retry_on_conflict(
            lambda: self._attempt(actor, case_id, reason, command.idempotency_key)
        )

    async def _attempt(self, actor: Actor, case_id: str, reason: str, key: str) -> CallResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            reader = CaseReader(uow)
            replay = await uow.calls.get_by_creation_key(key)
            if replay is not None:
                if replay.case_id != case.id or replay.analyst_id != actor.staff_id:
                    raise IdempotencyConflictError("Esa clave ya se usó para otra llamada.")
                return await _staff_result(reader, replay, case, replayed=True)
            _require_open_assigned(case)
            now = self.clock.now()
            call = Call.start_outbound(
                call_id=self.ids.new_id(IdPrefix.CALL),
                case_id=case.id,
                customer_id=case.customer_id,
                analyst_id=actor.staff_id,
                reason=reason,
                at=now,
                creation_key=key,
            )
            case.start_call(call.id)  # one active call per case
            case.start_progress(at=now)  # she is working the case
            await uow.cases.save(case)
            await uow.calls.add(call)
            result = await _staff_result(reader, call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class AnswerCall:
    """The assignee answers an inbound call: the first answer is the case's first response."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, call_id))

    async def _attempt(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            call = await _call_of_case(uow, case, call_id)
            if call.direction is CallDirection.OUTBOUND and call.is_active:
                raise InvalidTransitionError(
                    "Esta llamada la contesta el cliente.", currentState=call.state.value
                )
            now = self.clock.now()
            me = _analyst(actor)
            call.answer(actor=me, at=now)
            case.start_progress(at=now)
            case.respond_by_call(actor=me, at=now)
            await _store(uow, case, call)
            result = await _staff_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class HoldCall:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, call_id))

    async def _attempt(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            call = await _call_of_case(uow, case, call_id)
            now = self.clock.now()
            call.hold(actor=_analyst(actor), at=now)
            text = copy.CALL_HELD[case.language]
            line = _line(
                case, self.ids, role=TurnAuthorRole.SYSTEM, author_id=None, text=text, at=now
            )
            await _store(uow, case, call, line)
            result = await _staff_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class ResumeCall:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, call_id))

    async def _attempt(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            call = await _call_of_case(uow, case, call_id)
            now = self.clock.now()
            call.resume(actor=_analyst(actor), at=now)
            text = copy.CALL_RESUMED[case.language]
            line = _line(
                case, self.ids, role=TurnAuthorRole.SYSTEM, author_id=None, text=text, at=now
            )
            await _store(uow, case, call, line)
            result = await _staff_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class SetCallMuted:
    """Mute or unmute the analyst's line; the same value changes nothing (no event)."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, case_id: str, call_id: str, muted: bool) -> CallResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, call_id, muted))

    async def _attempt(self, actor: Actor, case_id: str, call_id: str, muted: bool) -> CallResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            call = await _call_of_case(uow, case, call_id)
            if call.set_muted(actor=_analyst(actor), muted=muted, at=self.clock.now()):
                await uow.calls.save(call)
            result = await _staff_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class HangUpCall:
    """The analyst ends the call (or stops calling while it rings)."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        return await retry_on_conflict(lambda: self._attempt(actor, case_id, call_id))

    async def _attempt(self, actor: Actor, case_id: str, call_id: str) -> CallResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            call = await _call_of_case(uow, case, call_id)
            now = self.clock.now()
            call.hang_up(actor=_analyst(actor), at=now)
            case.end_call(call.id)
            await _store(uow, case, call, _ended_line(case, self.ids, call, now))
            result = await _staff_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class PostCallLine:
    """What the analyst says on the call (``transcript``), only while ``in_call``.
    Idempotent on ``clientMessageId`` like a chat reply."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, case_id: str, call_id: str, command: PostTurnCommand
    ) -> PostTurnResult:
        text = normalize_turn_text(command.text)
        return await retry_on_conflict(
            lambda: self._attempt(actor, case_id, call_id, text, command.client_message_id)
        )

    async def _attempt(
        self, actor: Actor, case_id: str, call_id: str, text: str, client_message_id: str
    ) -> PostTurnResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            reader = CaseReader(uow)
            call = await _call_of_case(uow, case, call_id)
            replay = await find_replay(
                uow, author_id=actor.staff_id, client_message_id=client_message_id, text=text
            )
            if replay is not None:
                if replay.case_id != case.id or replay.kind is not TurnKind.TRANSCRIPT:
                    raise IdempotencyConflictError()
                return await _turn_result(reader, case, replay, replayed=True)
            call.ensure_talking()
            line = _line(
                case,
                self.ids,
                role=TurnAuthorRole.ANALYST,
                author_id=actor.staff_id,
                text=text,
                at=self.clock.now(),
                client_message_id=client_message_id,
            )
            await uow.cases.save(case)
            await uow.turns.add(line)
            result = await _turn_result(reader, case, line, replayed=False)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class AddInternalNote:
    """A staff-only ``note`` turn by the assignee on an open case (the customer never sees
    it, REST or socket). Idempotent on ``clientMessageId``."""

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
                if replay.case_id != case.id or replay.kind is not TurnKind.NOTE:
                    raise IdempotencyConflictError()
                return await _turn_result(reader, case, replay, replayed=True)
            _require_open_assigned(case)
            note = case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=TurnKind.NOTE,
                audience=TurnAudience.STAFF,
                author_role=TurnAuthorRole.ANALYST,
                author_id=actor.staff_id,
                text=text,
                created_at=self.clock.now(),
                client_message_id=client_message_id,
            )
            await uow.cases.save(case)
            await uow.turns.add(note)
            result = await _turn_result(reader, case, note, replayed=False)
            await uow.commit()
        return result


async def _turn_result(
    reader: CaseReader, case: Case, turn: Turn, *, replayed: bool
) -> PostTurnResult:
    (view,) = await reader.turn_views([turn])
    return PostTurnResult(turn=view, case=await reader.summary(case), replayed=replayed)


@dataclass(frozen=True, slots=True)
class ListCaseCalls:
    """Every call of a case, the most recent first (whoever may read the case)."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, actor: Actor, case_id: str) -> CallListView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=False)
            reader = CaseReader(uow)
            calls = await uow.calls.list_for_case(case.id)
            items = tuple([await reader.call_view(call) for call in calls])
        return CallListView(items=items, server_time=self.clock.now())


# ----------------------------------------------------------------------------- customer side
@dataclass(frozen=True, slots=True)
class StartInboundCall:
    """The customer calls the bank: the call joins the open case or opens one (channel
    ``phone_inbound``), assigned like a chat or waiting in the language queue."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    sla: SlaPolicy
    assign_case: AssignCase

    async def execute(self, customer: CustomerActor, idempotency_key: str) -> CustomerCallResult:
        return await retry_on_conflict(lambda: self._attempt(customer, idempotency_key))

    async def _attempt(self, customer: CustomerActor, key: str) -> CustomerCallResult:
        async with self.uow() as uow:
            reader = CaseReader(uow)
            replay = await uow.calls.get_by_creation_key(key)
            if replay is not None:
                if replay.customer_id != customer.customer_id:
                    raise IdempotencyConflictError("Esa clave ya se usó para otra llamada.")
                case = await uow.cases.get(replay.case_id)
                if case is None:  # pragma: no cover - foreign key
                    raise _not_found(replay.id)
                return await _customer_result(reader, replay, case, replayed=True)
            call_id = self.ids.new_id(IdPrefix.CALL)
            intake = await CaseIntake(
                self.clock, self.ids, self.sla, self.assign_case
            ).open_or_join(
                uow,
                customer,
                channel=CaseChannel.PHONE_INBOUND,
                contact=lambda _case, _at: [],
                on_case=lambda case: case.start_call(call_id),
            )
            call = Call.start_inbound(
                call_id=call_id,
                case_id=intake.case.id,
                customer_id=customer.customer_id,
                at=self.clock.now(),
                creation_key=key,
            )
            await uow.calls.add(call)
            result = await _customer_result(reader, call, intake.case, created=intake.created)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class AnswerOutboundCall:
    """The customer answers the bank's call: the analyst's first response if none yet."""

    uow: UnitOfWorkFactory
    clock: Clock

    async def execute(self, customer: CustomerActor, call_id: str) -> CustomerCallResult:
        return await retry_on_conflict(lambda: self._attempt(customer, call_id))

    async def _attempt(self, customer: CustomerActor, call_id: str) -> CustomerCallResult:
        async with self.uow() as uow:
            call, case = await _own_call(uow, customer, call_id)
            if call.direction is CallDirection.INBOUND and call.is_active:
                raise InvalidTransitionError(
                    "Esta llamada la atiende el banco.", currentState=call.state.value
                )
            now = self.clock.now()
            call.answer(actor=customer.actor_ref(), at=now)
            if call.analyst_id is not None:
                case.respond_by_call(actor=ActorRef(ActorRole.ANALYST, call.analyst_id), at=now)
            await _store(uow, case, call)
            result = await _customer_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class EndCustomerCall:
    """The customer rejects the bank's ringing call (``reject=True``) or hangs up any call."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    reject: bool = False

    async def execute(self, customer: CustomerActor, call_id: str) -> CustomerCallResult:
        return await retry_on_conflict(lambda: self._attempt(customer, call_id))

    async def _attempt(self, customer: CustomerActor, call_id: str) -> CustomerCallResult:
        async with self.uow() as uow:
            call, case = await _own_call(uow, customer, call_id)
            now = self.clock.now()
            if self.reject:
                call.reject(actor=customer.actor_ref(), at=now)
            else:
                call.hang_up(actor=customer.actor_ref(), at=now)
            case.end_call(call.id)
            await _store(uow, case, call, _ended_line(case, self.ids, call, now))
            result = await _customer_result(CaseReader(uow), call, case)
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class PostCustomerCallLine:
    """What the customer says on the call (``transcript``), only while ``in_call``."""

    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, customer: CustomerActor, call_id: str, command: PostTurnCommand
    ) -> CustomerTurnResult:
        text = normalize_turn_text(command.text)
        return await retry_on_conflict(
            lambda: self._attempt(customer, call_id, text, command.client_message_id)
        )

    async def _attempt(
        self, customer: CustomerActor, call_id: str, text: str, client_message_id: str
    ) -> CustomerTurnResult:
        async with self.uow() as uow:
            call, case = await _own_call(uow, customer, call_id)
            reader = CaseReader(uow)
            replay = await find_replay(
                uow, author_id=customer.customer_id, client_message_id=client_message_id, text=text
            )
            if replay is not None:
                if replay.case_id != case.id or replay.kind is not TurnKind.TRANSCRIPT:
                    raise IdempotencyConflictError()
                (view,) = await reader.customer_turn_views([replay], customer.customer_id)
                return CustomerTurnResult(
                    turn=view, call=await reader.customer_call_view(call), replayed=True
                )
            call.ensure_talking()
            line = _line(
                case,
                self.ids,
                role=TurnAuthorRole.CUSTOMER,
                author_id=customer.customer_id,
                text=text,
                at=self.clock.now(),
                client_message_id=client_message_id,
            )
            await uow.cases.save(case)
            await uow.turns.add(line)
            (view,) = await reader.customer_turn_views([line], customer.customer_id)
            result = CustomerTurnResult(
                turn=view, call=await reader.customer_call_view(call), replayed=False
            )
            await uow.commit()
        return result


@dataclass(frozen=True, slots=True)
class GetCustomerCall:
    """The customer's call now: the active call of the current case, else its latest call
    (the simulator keeps showing how it ended), else ``None``."""

    uow: UnitOfWorkFactory

    async def execute(self, customer: CustomerActor) -> CustomerCallView | None:
        async with self.uow() as uow:
            case = await current_case(uow, customer.customer_id)
            if case is None:
                return None
            call = (
                await uow.calls.get(case.active_call_id)
                if case.active_call_id is not None
                else await uow.calls.latest_for_case(case.id)
            )
            if call is None:
                return None
            return await CaseReader(uow).customer_call_view(call)
