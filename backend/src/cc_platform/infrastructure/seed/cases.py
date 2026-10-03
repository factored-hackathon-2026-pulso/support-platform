"""Seed cases — "Datos de ejemplo" (slice 2 contract §8.3). Chat only, invented people.

Daniela's inbox: Todos 5 · Por responder 2 · Nuevos 2 · Esperando al cliente 1 · Cerrados 3.
Besides it: one case queued in the Portuguese queue (in no inbox) and one closed case of
Julián outside the 7-day window (Patricia's history). Times are relative to the clock at
the **first** seed (``T``); seeding is idempotent per case id, so an existing database keeps
its old times (delete it, or run with ``CC_PERSISTENCE=memory``, to re-anchor).

Everything goes through the domain (``Case.open``, ``append_turn``, ``assign``,
``mark_read``, ``close``) and records its events with the story's own time, so the event
log, the first-response SLA and "Cómo llegó a ti" agree. There are no bot turns.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from cc_platform.application.cases import copy
from cc_platform.application.cases.assignment import (
    REASON_NO_ANALYST,
    LanguageLeastLoadedStrategy,
    language_rule,
)
from cc_platform.application.cases.sla import FirstResponseSlaPolicy
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.turn import Turn
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CloseReason,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS, seed_customer_id
from cc_platform.infrastructure.seed.people import DEMO_STAFF, seed_staff_id

DANIELA, JULIAN = 1, 2
STRATEGY = LanguageLeastLoadedStrategy().strategy
SLA = FirstResponseSlaPolicy()
ES, PT = Language.SPANISH, Language.PORTUGUESE
APP, WEB = CaseChannel.APP_CHAT, CaseChannel.WEB_CHAT


def seed_case_id(number: int) -> str:
    return make_id(IdPrefix.CASE, str(number).zfill(BODY_LENGTH))


def _staff_name(number: int) -> str:
    return next(seed.name for seed in DEMO_STAFF if seed.number == number)


def _customer_name(number: int) -> str:
    return next(seed.name for seed in DEMO_CUSTOMERS if seed.number == number)


@dataclass
class _Story:
    """Builds one seeded case in chronological order through the domain."""

    ids: IdGenerator
    case: Case
    customer_first_name: str
    turns: list[Turn] = field(default_factory=list)
    assignments: list[Assignment] = field(default_factory=list)

    def _turn(
        self,
        at: datetime,
        text: str,
        *,
        kind: TurnKind,
        role: TurnAuthorRole,
        author: str | None,
        audience: TurnAudience = TurnAudience.EVERYONE,
    ) -> None:
        self.turns.append(
            self.case.append_turn(
                turn_id=self.ids.new_id(IdPrefix.TURN),
                kind=kind,
                audience=audience,
                author_role=role,
                author_id=author,
                text=text,
                created_at=at,
            )
        )

    def customer(self, at: datetime, text: str) -> None:
        self._turn(
            at,
            text,
            kind=TurnKind.MESSAGE,
            role=TurnAuthorRole.CUSTOMER,
            author=self.case.customer_id,
        )

    def opened_notice(self, at: datetime) -> None:
        self._turn(
            at,
            copy.NOTICE_OPENED[self.case.language],
            kind=TurnKind.NOTICE,
            role=TurnAuthorRole.SYSTEM,
            author=None,
        )

    def banner(self, at: datetime, text: str) -> None:
        self._turn(
            at,
            text,
            kind=TurnKind.ROUTING,
            role=TurnAuthorRole.SYSTEM,
            author=None,
            audience=TurnAudience.STAFF,
        )

    def wrote_again(self, at: datetime, previous_closed_at: datetime, reason: CloseReason) -> None:
        self.banner(at, copy.wrote_again(self.customer_first_name, previous_closed_at, reason))

    def assign(self, at: datetime, staff: int, *, open_cases: int) -> None:
        """Assigned on arrival (``language_least_loaded``) with its banner."""
        assignment = Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=self.case.id,
            staff_id=seed_staff_id(staff),
            reason=AssignmentReason.LANGUAGE_LEAST_LOADED,
            policy_rule_id=language_rule(self.case.language),
            open_cases_at_assignment=open_cases,
            strategy=STRATEGY,
            assigned_at=at,
            assigned_by=ActorRef.system(),
        )
        self.case.assign(assignment)
        self.assignments.append(assignment)
        self.banner(at, copy.assigned_on_arrival(_staff_name(staff), self.case.language))

    def wait_in_queue(self, at: datetime) -> None:
        label = copy.QUEUE_LABEL[self.case.language]
        self.case.mark_waiting_in_queue(
            label=label,
            reason_code=REASON_NO_ANALYST,
            policy_rule_id=language_rule(self.case.language),
            at=at,
        )
        self.banner(at, copy.queued(self.case.language, label))

    def read_up_to(self, at: datetime, sequence: int) -> None:
        self.case.mark_read(up_to=sequence, at=at)

    def analyst(self, at: datetime, text: str) -> None:
        """The assignee answers (opens the case if needed; the first answer stops the SLA)."""
        staff_id = self.case.assigned_analyst_id
        self.case.start_progress(at=at)
        self._turn(at, text, kind=TurnKind.MESSAGE, role=TurnAuthorRole.ANALYST, author=staff_id)
        self.case.mark_read(up_to=self.case.last_sequence, at=at)

    def close(self, at: datetime, reason: CloseReason, note: str | None = None) -> None:
        self._turn(
            at,
            copy.NOTICE_CLOSED[self.case.language],
            kind=TurnKind.NOTICE,
            role=TurnAuthorRole.SYSTEM,
            author=None,
        )
        staff_id = self.case.assigned_analyst_id or seed_staff_id(DANIELA)
        self.case.close(
            actor=ActorRef(ActorRole.ANALYST, staff_id), at=at, reason=reason, note=note
        )

    async def save(self, uow: UnitOfWork) -> None:
        """Store the case; an open case takes the customer's one-open-case slot."""
        slot = await uow.case_slots.get(self.case.customer_id)
        if slot is None:
            slot = CustomerCaseSlot(customer_id=self.case.customer_id)
            if not self.case.is_closed:
                slot.occupy(self.case.id)
            await uow.case_slots.add(slot)
        elif not self.case.is_closed:
            slot.occupy(self.case.id)
            await uow.case_slots.save(slot)
        await uow.cases.add(self.case)
        for turn in self.turns:
            await uow.turns.add(turn)
        for assignment in self.assignments:
            await uow.assignments.add(assignment)


def _open(
    ids: IdGenerator,
    *,
    number: int,
    customer: int,
    channel: CaseChannel,
    language: Language,
    opened: datetime,
    priority: CasePriority = CasePriority.MEDIUM,
    previous: int | None = None,
) -> _Story:
    customer_id = seed_customer_id(customer)
    case = Case.open(
        case_id=seed_case_id(number),
        customer_id=customer_id,
        customer_name=_customer_name(customer),
        channel=channel,
        language=language,
        priority=priority,
        opened_at=opened,
        sla_due_at=SLA.due_at(priority=priority, opened_at=opened),
        actor=ActorRef(ActorRole.CUSTOMER, customer_id),
        previous_case_id=seed_case_id(previous) if previous is not None else None,
    )
    return _Story(ids=ids, case=case, customer_first_name=_customer_name(customer).split()[0])


# ----------------------------------------------------------------------------- the stories
# Patricia (1004): 110 (Julián, 20 days ago) → 104 (Daniela, 2 days ago) → 108 (now, new).
PATRICIA_104_CLOSED = timedelta(days=2)


def _patricia_old(ids: IdGenerator, t: datetime) -> _Story:
    """110 · Patricia, web chat with Julián 20 days ago → closed outside the 7-day window."""
    opened = t - timedelta(days=20)
    s = _open(ids, number=110, customer=1004, channel=WEB, language=ES, opened=opened)
    s.customer(opened, "Hola, no reconozco un cargo de una suscripción.")
    s.opened_notice(opened)
    s.assign(opened, JULIAN, open_cases=0)
    s.analyst(opened + timedelta(minutes=3),
              "Hola, Patricia. Soy Julián, de LATAM Bank. Ese cargo es de su suscripción de "
              "música, contratada en marzo.")  # fmt: skip
    s.customer(opened + timedelta(minutes=10), "Ah, es cierto. Gracias.")
    s.close(opened + timedelta(minutes=15), CloseReason.RESOLVED)
    return s


def _patricia_refund(ids: IdGenerator, t: datetime) -> _Story:
    """104 · Patricia, app chat with Daniela 2 days ago → Cerrados (resolved, with a note)."""
    closed = t - PATRICIA_104_CLOSED
    opened = closed - timedelta(minutes=30)
    s = _open(ids, number=104, customer=1004, channel=APP, language=ES, opened=opened,
              previous=110)  # fmt: skip
    s.customer(opened, "Buenas tardes, me cobraron dos veces la misma compra en una farmacia.")
    s.opened_notice(opened)
    old_closed = t - timedelta(days=20) + timedelta(minutes=15)
    s.wrote_again(opened, old_closed, CloseReason.RESOLVED)
    s.assign(opened, DANIELA, open_cases=0)
    s.analyst(opened + timedelta(minutes=3),
              "Hola, Patricia. Soy Daniela, de LATAM Bank. Ya veo los dos cobros: uno se "
              "reversa en un plazo de 5 días hábiles.")  # fmt: skip
    s.customer(opened + timedelta(minutes=20), "Perfecto, muchas gracias.")
    s.close(closed, CloseReason.RESOLVED, "Se explicó el plazo del reverso (5 días hábiles).")
    return s


def _claudia_unresponsive(ids: IdGenerator, t: datetime) -> _Story:
    """105 · Claudia, web chat yesterday, never answered back → Cerrados."""
    closed = t - timedelta(days=1)
    opened = closed - timedelta(hours=3)
    s = _open(ids, number=105, customer=1005, channel=WEB, language=ES, opened=opened)
    s.customer(opened, "Hola, necesito ayuda con un cargo")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=0)
    s.analyst(opened + timedelta(minutes=10),
              "Hola, Claudia. Soy Daniela, de LATAM Bank. ¿Me cuenta qué cargo es y de qué "
              "fecha?")  # fmt: skip
    s.close(closed, CloseReason.CUSTOMER_UNRESPONSIVE)
    return s


def _hector_out_of_scope(ids: IdGenerator, t: datetime) -> _Story:
    """106 · Héctor, app chat (low priority) asking for a mortgage → Cerrados."""
    opened = t - timedelta(hours=4)
    s = _open(ids, number=106, customer=1006, channel=APP, language=ES, opened=opened,
              priority=CasePriority.LOW)  # fmt: skip
    s.customer(opened, "Buen día, quiero saber cuánto me prestan para una casa.")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=0)
    s.analyst(opened + timedelta(minutes=10),
              "Hola, Héctor. Soy Daniela, de LATAM Bank. Por este chat atendemos dudas de "
              "cargos y movimientos; para créditos hipotecarios lo atienden en la línea de "
              "créditos.")  # fmt: skip
    s.customer(opened + timedelta(minutes=30), "Ah ok, gracias")
    s.close(
        t - timedelta(hours=3), CloseReason.OUT_OF_SCOPE, "Pregunta por un crédito hipotecario."
    )
    return s


def _joaquin_waiting(ids: IdGenerator, t: datetime) -> _Story:
    """107 · Joaquín (es-AR), app chat; Daniela asked for data → Esperando al cliente."""
    opened = t - timedelta(minutes=50)
    s = _open(ids, number=107, customer=1007, channel=APP, language=ES, opened=opened)
    s.customer(opened,
               "Hola, ¿me podés decir cómo va el reclamo que hice por un cobro en un súper? Ya "
               "pasaron como dos semanas y no sé nada.")  # fmt: skip
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=0)
    s.read_up_to(t - timedelta(minutes=41), 3)
    s.analyst(t - timedelta(minutes=40),
              "Hola, Joaquín. Soy Daniela, de LATAM Bank. Para encontrar su reclamo, ¿me "
              "podría decir la fecha aproximada del cobro y el monto?")  # fmt: skip
    return s


def _marcela_to_reply(ids: IdGenerator, t: datetime) -> _Story:
    """101 · Marcela, web chat; she answered Daniela's question → Por responder."""
    opened = t - timedelta(minutes=14)
    s = _open(ids, number=101, customer=1001, channel=WEB, language=ES, opened=opened)
    s.customer(opened, "hola buenas, hay un cargo en mi tarjeta q no reconozco, me colaboran?")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=1)
    s.read_up_to(t - timedelta(minutes=11), 3)
    s.analyst(t - timedelta(minutes=10),
              "Hola, Marcela. Soy Daniela, de LATAM Bank. Con gusto le ayudo. ¿Me cuenta de "
              "qué fecha es el cargo y por qué valor?")  # fmt: skip
    s.customer(t - timedelta(minutes=2),
               "es un retiro en cajero del 9 de enero por $1.585.208, yo no lo hice")  # fmt: skip
    return s


def _beatriz_impatient(ids: IdGenerator, t: datetime) -> _Story:
    """102 · Beatriz, app chat, no answer yet, SLA at risk → Por responder (3 unread)."""
    opened = t - timedelta(minutes=12)
    s = _open(ids, number=102, customer=1002, channel=APP, language=ES, opened=opened)
    s.customer(opened, "no reconozco un cargo en mi tarjeta y estoy muy molesta")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=2)
    s.read_up_to(t - timedelta(minutes=9), 3)
    s.customer(t - timedelta(minutes=8), "hola?")
    s.customer(t - timedelta(minutes=5), "hola?? hay alguien??")
    s.customer(t - timedelta(minutes=1), "contesten!! qué mal servicio")
    return s


def _patricia_again(ids: IdGenerator, t: datetime) -> _Story:
    """108 · Patricia wrote again after 104 closed → Nuevos ("Volvió a escribir")."""
    opened = t - timedelta(minutes=4)
    s = _open(ids, number=108, customer=1004, channel=APP, language=ES, opened=opened,
              previous=104)  # fmt: skip
    s.customer(opened,
               "Hola, otra vez yo. El reembolso que me dijeron todavía no aparece en mi "
               "cuenta.")  # fmt: skip
    s.opened_notice(opened)
    s.wrote_again(opened, t - PATRICIA_104_CLOSED, CloseReason.RESOLVED)
    s.assign(opened, DANIELA, open_cases=3)
    return s


def _larissa_portuguese(ids: IdGenerator, t: datetime) -> _Story:
    """103 · Larissa, Portuguese web chat, rule 3 → Nuevos."""
    opened = t - timedelta(minutes=2)
    s = _open(ids, number=103, customer=1003, channel=WEB, language=PT, opened=opened)
    s.customer(opened, "Oi, cobraram uma coisa que não corresponde, já estou no limite com isso!")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=4)
    return s


def _gabriela_queued(ids: IdGenerator, t: datetime) -> _Story:
    """109 · Gabriela, Portuguese web chat that arrived while Daniela was paused → queued.

    Startup runs no drain: it waits until a Portuguese speaker switches to "Disponible".
    """
    opened = t - timedelta(minutes=6)
    s = _open(ids, number=109, customer=1008, channel=WEB, language=PT, opened=opened)
    s.customer(opened, "Olá, preciso de ajuda com uma compra que não reconheço.")
    s.opened_notice(opened)
    s.wait_in_queue(opened)
    return s


type StoryFactory = Callable[[IdGenerator, datetime], _Story]

#: Chronological order (a customer's older case is stored before the one that follows it).
DEMO_STORIES: tuple[tuple[int, StoryFactory], ...] = (
    (110, _patricia_old),
    (104, _patricia_refund),
    (105, _claudia_unresponsive),
    (106, _hector_out_of_scope),
    (107, _joaquin_waiting),
    (101, _marcela_to_reply),
    (102, _beatriz_impatient),
    (109, _gabriela_queued),
    (108, _patricia_again),
    (103, _larissa_portuguese),
)


async def seed_demo_cases(uow: UnitOfWorkFactory, ids: IdGenerator, clock: Clock) -> int:
    """Insert the missing seeded cases (one Unit of Work each). Returns how many."""
    t = clock.now()
    created = 0
    for number, factory in DEMO_STORIES:
        if await _seed_one(uow, ids, t, number, factory):
            created += 1
    return created


async def _seed_one(
    uow: UnitOfWorkFactory, ids: IdGenerator, t: datetime, number: int, factory: StoryFactory
) -> bool:
    async with uow() as unit:
        if await unit.cases.get(seed_case_id(number)) is not None:
            return False
        story = factory(ids, t)
        await story.save(unit)
        await unit.commit()
    return True
