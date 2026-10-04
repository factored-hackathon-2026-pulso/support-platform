"""Simulated email (slice 12): no mail server. An email is a turn of the case (kind
``email``, with a ``subject``): from the customer = ``in``, from an analyst = ``out``. The
case's email thread is its ``email`` turns in order; its subject is the first email's.

- ``SendCustomerEmail``: the customer writes: the email joins the open case or opens one
  (``CaseIntake``, channel ``email``), assigned like a chat or waiting in the queue.
- ``ReplyEmail``: the assignee answers. The platform frames what she wrote with the greeting
  "Hola, {nombre}:" (the customer's first name) and the signature "Saludos,\\n{Analista}\\n
  LATAM Bank" (Portuguese cases: "Olá, {nome}:" / "Atenciosamente,"). The subject is
  "Re: <thread subject>" unless she gives one (required when the case has no email yet).
  The first reply is the case's first response, like a chat reply.
- ``GetEmailThread`` (staff, whoever may read the case) and ``GetCustomerEmails`` (the
  customer's current case).

Both writes are idempotent on ``clientMessageId`` (= ``Idempotency-Key``): a retry with the
same email replays it; the same id with another email is ``idempotency_conflict``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cc_platform.application.cases import copy
from cc_platform.application.cases.assignment import AssignCase
from cc_platform.application.cases.commands import find_replay
from cc_platform.application.cases.customer_chat import current_case
from cc_platform.application.cases.dto import (
    CustomerEmailCommand,
    CustomerEmailResult,
    CustomerEmailThreadView,
    EmailReplyCommand,
    EmailReplyResult,
    EmailThreadView,
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
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.errors import IdempotencyConflictError
from cc_platform.domain.cases.turn import (
    MAX_TURN_TEXT,
    Turn,
    normalize_email_subject,
    normalize_turn_text,
)
from cc_platform.domain.cases.values import (
    CaseChannel,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.shared.errors import InvalidValueError, NotFoundError
from cc_platform.domain.shared.ids import IdPrefix

#: An email thread lists at most this many emails (oldest first).
MAX_THREAD = 200


async def thread_of(uow: UnitOfWork, case_id: str) -> list[Turn]:
    return await uow.turns.list_of_kind(case_id, TurnKind.EMAIL, limit=MAX_THREAD)


def _email(
    case: Case,
    ids: IdGenerator,
    *,
    role: TurnAuthorRole,
    author_id: str,
    subject: str,
    body: str,
    at: datetime,
    client_message_id: str,
) -> Turn:
    return case.append_turn(
        turn_id=ids.new_id(IdPrefix.TURN),
        kind=TurnKind.EMAIL,
        audience=TurnAudience.EVERYONE,
        author_role=role,
        author_id=author_id,
        text=body,
        created_at=at,
        client_message_id=client_message_id,
        subject=subject,
    )


def _check_replay(replay: Turn, case_id: str | None, subject: str | None) -> None:
    """A replay must be the same email (same case when known, same subject)."""
    if replay.kind is not TurnKind.EMAIL or (case_id is not None and replay.case_id != case_id):
        raise IdempotencyConflictError()
    if subject is not None and replay.subject != subject:
        raise IdempotencyConflictError()


# ----------------------------------------------------------------------------- customer side
@dataclass(frozen=True, slots=True)
class SendCustomerEmail:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator
    sla: SlaPolicy
    assign_case: AssignCase

    async def execute(
        self, customer: CustomerActor, command: CustomerEmailCommand
    ) -> CustomerEmailResult:
        subject = normalize_email_subject(command.subject)
        body = normalize_turn_text(command.body)
        return await retry_on_conflict(
            lambda: self._attempt(customer, subject, body, command.client_message_id)
        )

    async def _attempt(
        self, customer: CustomerActor, subject: str, body: str, client_message_id: str
    ) -> CustomerEmailResult:
        async with self.uow() as uow:
            reader = CaseReader(uow)
            replay = await find_replay(
                uow, author_id=customer.customer_id, client_message_id=client_message_id, text=body
            )
            if replay is not None:
                _check_replay(replay, None, subject)
                case = await uow.cases.get(replay.case_id)
                if case is None:  # pragma: no cover - turns never outlive their case
                    raise NotFoundError(caseId=replay.case_id)
                return await _customer_result(reader, case, replay, customer, replayed=True)

            def email(case: Case, at: datetime) -> list[Turn]:
                return [
                    _email(
                        case,
                        self.ids,
                        role=TurnAuthorRole.CUSTOMER,
                        author_id=customer.customer_id,
                        subject=subject,
                        body=body,
                        at=at,
                        client_message_id=client_message_id,
                    )
                ]

            intake = await CaseIntake(
                self.clock, self.ids, self.sla, self.assign_case
            ).open_or_join(uow, customer, channel=CaseChannel.EMAIL, contact=email)
            result = await _customer_result(
                reader, intake.case, intake.turns[0], customer, created=intake.created
            )
            await uow.commit()
        return result


async def _customer_result(
    reader: CaseReader,
    case: Case,
    turn: Turn,
    customer: CustomerActor,
    *,
    created: bool = False,
    replayed: bool = False,
) -> CustomerEmailResult:
    (view,) = await reader.customer_email_views([turn], customer.customer_id)
    return CustomerEmailResult(
        email=view,
        conversation=await reader.conversation(case),
        case_created=created or (replayed and turn.sequence == 1),
        replayed=replayed,
    )


@dataclass(frozen=True, slots=True)
class GetCustomerEmails:
    """The email thread of the customer's current case (open, else the latest)."""

    uow: UnitOfWorkFactory

    async def execute(self, customer: CustomerActor) -> CustomerEmailThreadView:
        async with self.uow() as uow:
            case = await current_case(uow, customer.customer_id)
            if case is None:
                return CustomerEmailThreadView(case_id=None, subject=None, items=())
            turns = await thread_of(uow, case.id)
            items = await CaseReader(uow).customer_email_views(turns, customer.customer_id)
        return CustomerEmailThreadView(
            case_id=case.id, subject=items[0].subject if items else None, items=tuple(items)
        )


# ----------------------------------------------------------------------------- staff side
@dataclass(frozen=True, slots=True)
class ReplyEmail:
    uow: UnitOfWorkFactory
    clock: Clock
    ids: IdGenerator

    async def execute(
        self, actor: Actor, case_id: str, command: EmailReplyCommand
    ) -> EmailReplyResult:
        body = normalize_turn_text(command.body)
        subject = normalize_email_subject(command.subject) if command.subject else None
        return await retry_on_conflict(
            lambda: self._attempt(actor, case_id, body, subject, command)
        )

    async def _attempt(
        self,
        actor: Actor,
        case_id: str,
        body: str,
        subject: str | None,
        command: EmailReplyCommand,
    ) -> EmailReplyResult:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=True)
            reader = CaseReader(uow)
            customer = await uow.customers.get(case.customer_id)
            name = customer.first_name if customer is not None else "Cliente"
            framed = copy.email_reply_body(case.language, name, actor.name, body)
            if len(framed) > MAX_TURN_TEXT:
                raise InvalidValueError(
                    "El correo con el saludo y la firma supera "
                    f"{MAX_TURN_TEXT} caracteres. Acórtalo un poco.",
                    field="body",
                )
            replay = await find_replay(
                uow,
                author_id=actor.staff_id,
                client_message_id=command.client_message_id,
                text=framed,
            )
            if replay is not None:
                _check_replay(replay, case.id, subject)
                return await _staff_result(reader, case, replay, replayed=True)
            case.ensure_assignee_can_reply()
            thread = await thread_of(uow, case.id)
            if subject is None:
                if not thread or thread[0].subject is None:
                    raise InvalidValueError("Escribe el asunto del correo.", field="subject")
                subject = copy.reply_subject(thread[0].subject)
            now = self.clock.now()
            case.start_progress(at=now)
            email = _email(
                case,
                self.ids,
                role=TurnAuthorRole.ANALYST,
                author_id=actor.staff_id,
                subject=subject,
                body=framed,
                at=now,
                client_message_id=command.client_message_id,
            )
            case.mark_read(up_to=email.sequence, at=now)  # she has seen what she answered
            await uow.cases.save(case)
            await uow.turns.add(email)
            result = await _staff_result(reader, case, email, replayed=False)
            await uow.commit()
        return result


async def _staff_result(
    reader: CaseReader, case: Case, turn: Turn, *, replayed: bool
) -> EmailReplyResult:
    (view,) = await reader.email_views([turn])
    return EmailReplyResult(email=view, case=await reader.summary(case), replayed=replayed)


@dataclass(frozen=True, slots=True)
class GetEmailThread:
    """A case's email thread, oldest first (whoever may read the case)."""

    uow: UnitOfWorkFactory

    async def execute(self, actor: Actor, case_id: str) -> EmailThreadView:
        async with self.uow() as uow:
            case = await load_case_for(uow, actor, case_id, write=False)
            items = await CaseReader(uow).email_views(await thread_of(uow, case.id))
        return EmailThreadView(
            case_id=case.id, subject=items[0].subject if items else None, items=tuple(items)
        )
