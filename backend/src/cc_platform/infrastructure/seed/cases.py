"""Seed cases — "Datos de ejemplo" (slice 2 contract §8.3, slice 3 §9, slice 12). Invented
people.

Daniela's inbox: Todos 6 · Por responder 3 · Nuevos 2 · Esperando al cliente 1 · Cerrados 5.
Slice 12 (simulated calls and email, no telephony or mail server): Natalia's inbound call
(115, yesterday: answered, on hold once, ended, an internal note, closed), Daniela's
outbound follow-up call to Claudia (116, linked to her unanswered chat 105, closed) and
Ignacio's email thread (117, es-AR voseo: his email, Daniela's framed reply, his answer →
Por responder).
Priorities (slice 8): every case opens with ``none`` and staff set it through the domain
(``case.priority_changed``): Marcela's 101 critical and Beatriz's 102 high (Daniela),
Mauricio's queued 112 high (Lucía), 106 and 114 low, 104/107/110/113 medium, the rest none.
Customer ratings (slice 7, invented): Patricia rated 104 "Excelente" with a comment and 110
"Bien", Héctor rated 106 "Bien"; Claudia's 105 stays unrated (the simulator asks her).
Escalations to supervision (slice 9, neutral invented motives): Daniela's 101 (open, T−6m) and
Julián's 113 (open, T−21m); Daniela's 107, answered by Lucía (T−35m, not yet acknowledged:
Daniela sees the answer card); Paula's 114, ended when Lucía reassigned the case to Julián.
Besides it: three queued cases (two in "Cola en español", one at risk and one due in 7 min; one
in "Cola en portugués"), Julián's two open cases (one overdue, one that Lucía reassigned to
him from Paula), one closed case of Julián outside the 7-day window (Patricia's history),
and Lucía's supervision view of Julián's overdue case (so the audit shows an access event).
Times are relative to the clock at the **first** seed (``T``); seeding is idempotent per
case id, so an existing database keeps its old times (delete it, or run with
``CC_PERSISTENCE=memory``, to re-anchor).

Everything goes through the domain (``Case.open``, ``append_turn``, ``assign``,
``reassign``, ``mark_read``, ``close``) and records its events with the story's own time,
so the event log, the first-response SLA and "Cómo llegó a ti" agree. The events reach the
log in story-time order across every case (``SeedTimeline``), so the audit, which reads the
log by sequence, lists them as they happened. There are no bot turns.
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
from cc_platform.application.cases.manual_assignment import MANUAL_STRATEGY
from cc_platform.application.cases.sla import FirstResponseSlaPolicy
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.call import Call
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.customer_case_slot import CustomerCaseSlot
from cc_platform.domain.cases.escalation import Escalation
from cc_platform.domain.cases.events import CaseViewed
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
from cc_platform.infrastructure.seed.timeline import SeedTimeline

DANIELA, JULIAN, PAULA, LUCIA = 1, 2, 3, 5
STRATEGY = LanguageLeastLoadedStrategy().strategy
SLA = FirstResponseSlaPolicy()
ES, PT = Language.SPANISH, Language.PORTUGUESE
APP, WEB = CaseChannel.CHAT_APP, CaseChannel.CHAT_WEB
PHONE_IN, PHONE_OUT, EMAIL = (
    CaseChannel.PHONE_INBOUND,
    CaseChannel.PHONE_OUTBOUND,
    CaseChannel.EMAIL,
)
#: Slice 12: the strategy name of a case an analyst opened to call the customer back.
FOLLOW_UP_STRATEGY = "analyst_follow_up_call"


def seed_case_id(number: int) -> str:
    return make_id(IdPrefix.CASE, str(number).zfill(BODY_LENGTH))


def seed_escalation_id(case_number: int) -> str:
    """Seeded escalations: one per case, numbered like it."""
    return make_id(IdPrefix.ESCALATION, str(case_number).zfill(BODY_LENGTH))


def seed_call_id(case_number: int) -> str:
    """Seeded calls (slice 12): one per case, numbered like it."""
    return make_id(IdPrefix.CALL, str(case_number).zfill(BODY_LENGTH))


def _staff_name(number: int) -> str:
    return next(seed.name for seed in DEMO_STAFF if seed.number == number)


def _staff_name_of(staff_id: str) -> str:
    return next(s.name for s in DEMO_STAFF if seed_staff_id(s.number) == staff_id)


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
    escalations: list[Escalation] = field(default_factory=list)
    calls: list[Call] = field(default_factory=list)

    def _turn(
        self,
        at: datetime,
        text: str,
        *,
        kind: TurnKind,
        role: TurnAuthorRole,
        author: str | None,
        audience: TurnAudience = TurnAudience.EVERYONE,
        subject: str | None = None,
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
                subject=subject,
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
            copy.opened_notice(self.case.channel, self.case.language),
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

    def reassign(self, at: datetime, staff: int, *, by: int, open_cases: int) -> None:
        """A supervisor (``by``) passes the open case to ``staff``: staff banner and the
        customer notice, as ``SetCaseAssignee`` writes them."""
        previous = self.case.assigned_analyst_id
        assignment = Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=self.case.id,
            staff_id=seed_staff_id(staff),
            reason=AssignmentReason.MANUAL,
            policy_rule_id=language_rule(self.case.language),
            open_cases_at_assignment=open_cases,
            strategy=MANUAL_STRATEGY,
            assigned_at=at,
            assigned_by=ActorRef(ActorRole.SUPERVISOR, seed_staff_id(by)),
            previous_staff_id=previous,
        )
        self.case.reassign(assignment)
        self.assignments.append(assignment)
        if self.case.open_escalation_id is not None:  # slice 9: it ends as ``reassigned``
            escalation = self._open_escalation()
            escalation.mark_reassigned(
                actor=assignment.assigned_by, to_staff_id=assignment.staff_id, at=at
            )
            self.case.clear_escalation(escalation.id)
        previous_name = _staff_name_of(previous) if previous else ""
        self.banner(at, copy.reassigned(_staff_name(by), previous_name, _staff_name(staff)))
        self._turn(
            at,
            copy.reassigned_notice(self.case.language, _staff_name(staff).split()[0]),
            kind=TurnKind.NOTICE,
            role=TurnAuthorRole.SYSTEM,
            author=None,
        )

    def escalate(self, at: datetime, motive: str) -> None:
        """The assignee escalates to supervision (slice 9), as ``EscalateCase`` does."""
        staff_id = self.case.assigned_analyst_id or seed_staff_id(DANIELA)
        number = int(self.case.id.removeprefix("CASE-"))
        escalation = Escalation.open(
            escalation_id=seed_escalation_id(number),
            case_id=self.case.id,
            motive=motive,
            actor=ActorRef(ActorRole.ANALYST, staff_id),
            at=at,
        )
        self.case.escalate(escalation.id)
        self.escalations.append(escalation)
        self.banner(at, copy.escalated(_staff_name_of(staff_id)))

    def answer_escalation(self, at: datetime, *, by: int, note: str) -> None:
        """Supervision (``by``) answers the open escalation, as ``RespondEscalation`` does."""
        escalation = self._open_escalation()
        escalation.answer(actor=ActorRef(ActorRole.SUPERVISOR, seed_staff_id(by)), note=note, at=at)
        self.case.clear_escalation(escalation.id)
        self.banner(at, copy.escalation_answered(_staff_name(by)))

    def _open_escalation(self) -> Escalation:
        return next(e for e in self.escalations if e.id == self.case.open_escalation_id)

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

    def prioritize(
        self, at: datetime, priority: CasePriority, *, by: int, role: ActorRole = ActorRole.ANALYST
    ) -> None:
        """The assignee (or a supervisor, ``role``) sets the priority (slice 8), as
        ``ChangeCasePriority`` does: every case opens with ``none``."""
        self.case.change_priority(actor=ActorRef(role, seed_staff_id(by)), priority=priority, at=at)

    def rate(self, at: datetime, score: int, comment: str | None = None) -> None:
        """The customer rates the closed case (slice 7), as ``RateConversation`` does."""
        self.case.rate(
            actor=ActorRef(ActorRole.CUSTOMER, self.case.customer_id),
            score=score,
            comment=comment,
            at=at,
        )

    # ------------------------------------------------------------------ slice 12
    def follow_up(self, at: datetime, staff: int) -> None:
        """An analyst opened this case herself to call the customer back (``outbound_call``)."""
        assignment = Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=self.case.id,
            staff_id=seed_staff_id(staff),
            reason=AssignmentReason.OUTBOUND_CALL,
            policy_rule_id=None,
            open_cases_at_assignment=0,
            strategy=FOLLOW_UP_STRATEGY,
            assigned_at=at,
            assigned_by=ActorRef(ActorRole.ANALYST, seed_staff_id(staff)),
        )
        self.case.assign(assignment)
        self.assignments.append(assignment)
        self.banner(at, copy.follow_up_call(_staff_name(staff), self.customer_first_name))

    def _call(self) -> Call:
        return next(c for c in self.calls if c.id == self.case.active_call_id)

    def _analyst_ref(self) -> ActorRef:
        return ActorRef(ActorRole.ANALYST, self.case.assigned_analyst_id or seed_staff_id(DANIELA))

    def ring_in(self, at: datetime) -> None:
        """The customer calls the bank (``StartInboundCall``)."""
        number = int(self.case.id.removeprefix("CASE-"))
        call = Call.start_inbound(
            call_id=seed_call_id(number),
            case_id=self.case.id,
            customer_id=self.case.customer_id,
            at=at,
        )
        self.case.start_call(call.id)
        self.calls.append(call)

    def call_customer(self, at: datetime, reason: str) -> None:
        """The assignee calls the customer (``StartOutboundCall``)."""
        number = int(self.case.id.removeprefix("CASE-"))
        analyst = self._analyst_ref()
        call = Call.start_outbound(
            call_id=seed_call_id(number),
            case_id=self.case.id,
            customer_id=self.case.customer_id,
            analyst_id=analyst.actor_id,
            reason=reason,
            at=at,
        )
        self.case.start_call(call.id)
        self.case.start_progress(at=at)
        self.calls.append(call)

    def answer(self, at: datetime) -> None:
        """Inbound: the assignee answers; outbound: the customer does. Either way it is the
        case's first response (``AnswerCall`` / ``AnswerOutboundCall``)."""
        call, analyst = self._call(), self._analyst_ref()
        if call.reason is None:
            call.answer(actor=analyst, at=at)
            self.case.start_progress(at=at)
        else:
            call.answer(actor=ActorRef(ActorRole.CUSTOMER, self.case.customer_id), at=at)
        self.case.respond_by_call(actor=analyst, at=at)

    def say(self, at: datetime, text: str, *, by_customer: bool) -> None:
        """A line of the call transcript."""
        role = TurnAuthorRole.CUSTOMER if by_customer else TurnAuthorRole.ANALYST
        author = self.case.customer_id if by_customer else self._analyst_ref().actor_id
        self._turn(at, text, kind=TurnKind.TRANSCRIPT, role=role, author=author)

    def _system_line(self, at: datetime, text: str) -> None:
        self._turn(at, text, kind=TurnKind.TRANSCRIPT, role=TurnAuthorRole.SYSTEM, author=None)

    def hold(self, at: datetime) -> None:
        self._call().hold(actor=self._analyst_ref(), at=at)
        self._system_line(at, copy.CALL_HELD[self.case.language])

    def resume(self, at: datetime) -> None:
        self._call().resume(actor=self._analyst_ref(), at=at)
        self._system_line(at, copy.CALL_RESUMED[self.case.language])

    def mute(self, at: datetime, muted: bool) -> None:
        self._call().set_muted(actor=self._analyst_ref(), muted=muted, at=at)

    def hang_up(self, at: datetime, *, by_customer: bool = False) -> None:
        call = self._call()
        who = ActorRef(ActorRole.CUSTOMER, self.case.customer_id) if by_customer else None
        call.hang_up(actor=who or self._analyst_ref(), at=at)
        self.case.end_call(call.id)
        self._system_line(at, copy.CALL_ENDED[self.case.language])

    def note(self, at: datetime, text: str) -> None:
        """An internal note of the assignee (staff only)."""
        self._turn(
            at,
            text,
            kind=TurnKind.NOTE,
            role=TurnAuthorRole.ANALYST,
            author=self._analyst_ref().actor_id,
            audience=TurnAudience.STAFF,
        )

    def email_in(self, at: datetime, subject: str, body: str) -> None:
        """The customer emails the bank (``SendCustomerEmail``)."""
        self._turn(
            at,
            body,
            kind=TurnKind.EMAIL,
            role=TurnAuthorRole.CUSTOMER,
            author=self.case.customer_id,
            subject=subject,
        )

    def email_out(self, at: datetime, body: str) -> None:
        """The assignee answers by email, framed like ``ReplyEmail`` does."""
        analyst = self._analyst_ref().actor_id
        thread = next(t.subject for t in self.turns if t.subject is not None)
        framed = copy.email_reply_body(
            self.case.language, self.customer_first_name, _staff_name_of(analyst), body
        )
        self.case.start_progress(at=at)
        self._turn(
            at,
            framed,
            kind=TurnKind.EMAIL,
            role=TurnAuthorRole.ANALYST,
            author=analyst,
            subject=copy.reply_subject(thread),
        )
        self.case.mark_read(up_to=self.case.last_sequence, at=at)

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
        for escalation in self.escalations:
            await uow.escalations.add(escalation)
        for call in self.calls:
            await uow.calls.add(call)


def _open(
    ids: IdGenerator,
    *,
    number: int,
    customer: int,
    channel: CaseChannel,
    language: Language,
    opened: datetime,
    previous: int | None = None,
    opened_by: int | None = None,
) -> _Story:
    customer_id = seed_customer_id(customer)
    actor = (
        ActorRef(ActorRole.ANALYST, seed_staff_id(opened_by))
        if opened_by is not None
        else ActorRef(ActorRole.CUSTOMER, customer_id)
    )
    case = Case.open(
        case_id=seed_case_id(number),
        customer_id=customer_id,
        customer_name=_customer_name(customer),
        channel=channel,
        language=language,
        priority=CasePriority.NONE,  # every case opens without a priority (slice 8)
        opened_at=opened,
        sla_due_at=SLA.due_at(opened_at=opened),
        actor=actor,
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
    s.prioritize(opened + timedelta(minutes=2), CasePriority.MEDIUM, by=JULIAN)
    s.analyst(opened + timedelta(minutes=3),
              "Hola, Patricia. Soy Julián, de LATAM Bank. Ese cargo es de su suscripción de "
              "música, contratada en marzo.")  # fmt: skip
    s.customer(opened + timedelta(minutes=10), "Ah, es cierto. Gracias.")
    s.close(opened + timedelta(minutes=15), CloseReason.RESOLVED)
    s.rate(opened + timedelta(minutes=16), 3)
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
    s.prioritize(opened + timedelta(minutes=2), CasePriority.MEDIUM, by=DANIELA)
    s.analyst(opened + timedelta(minutes=3),
              "Hola, Patricia. Soy Daniela, de LATAM Bank. Ya veo los dos cobros: uno se "
              "reversa en un plazo de 5 días hábiles.")  # fmt: skip
    s.customer(opened + timedelta(minutes=20), "Perfecto, muchas gracias.")
    s.close(closed, CloseReason.RESOLVED, "Se explicó el plazo del reverso (5 días hábiles).")
    s.rate(closed + timedelta(minutes=2), 4, "Muy clara la explicación del plazo, gracias.")
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
    """106 · Héctor, app chat (Daniela set it low) asking for a mortgage → Cerrados."""
    opened = t - timedelta(hours=4)
    s = _open(ids, number=106, customer=1006, channel=APP, language=ES, opened=opened)
    s.customer(opened, "Buen día, quiero saber cuánto me prestan para una casa.")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=0)
    s.prioritize(opened + timedelta(minutes=8), CasePriority.LOW, by=DANIELA)
    s.analyst(opened + timedelta(minutes=10),
              "Hola, Héctor. Soy Daniela, de LATAM Bank. Por este chat atendemos dudas de "
              "cargos y movimientos; para créditos hipotecarios lo atienden en la línea de "
              "créditos.")  # fmt: skip
    s.customer(opened + timedelta(minutes=30), "Ah ok, gracias")
    s.close(
        t - timedelta(hours=3), CloseReason.OUT_OF_SCOPE, "Pregunta por un crédito hipotecario."
    )
    s.rate(t - timedelta(hours=3) + timedelta(minutes=5), 3)
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
    s.prioritize(t - timedelta(minutes=41), CasePriority.MEDIUM, by=DANIELA)
    s.analyst(t - timedelta(minutes=40),
              "Hola, Joaquín. Soy Daniela, de LATAM Bank. Para encontrar su reclamo, ¿me "
              "podría decir la fecha aproximada del cobro y el monto?")  # fmt: skip
    s.escalate(t - timedelta(minutes=38),
               "Pide el estado de un reclamo de hace dos semanas y quiere que alguien de "
               "supervisión le confirme el plazo.")  # fmt: skip
    s.answer_escalation(
        t - timedelta(minutes=35),
        by=LUCIA,
        note="Revisé el reclamo: sigue dentro del plazo. Cuando te dé la fecha y el monto, "
        "confírmale que le escribimos apenas haya respuesta.",
    )
    return s


def _marcela_to_reply(ids: IdGenerator, t: datetime) -> _Story:
    """101 · Marcela, web chat; she answered Daniela's question → Por responder. An ATM
    withdrawal she did not make: Daniela set it critical."""
    opened = t - timedelta(minutes=19)
    s = _open(ids, number=101, customer=1001, channel=WEB, language=ES, opened=opened)
    s.customer(opened, "hola buenas, hay un cargo en mi tarjeta q no reconozco, me colaboran?")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=1)
    s.read_up_to(t - timedelta(minutes=11), 3)
    s.prioritize(t - timedelta(minutes=11), CasePriority.CRITICAL, by=DANIELA)
    s.analyst(t - timedelta(minutes=10),
              "Hola, Marcela. Soy Daniela, de LATAM Bank. Con gusto le ayudo. ¿Me cuenta de "
              "qué fecha es el cargo y por qué valor?")  # fmt: skip
    s.escalate(t - timedelta(minutes=6),
               "La clienta pide hablar con supervisión: no reconoce un retiro en cajero y no "
               "quiere esperar el proceso normal.")  # fmt: skip
    s.customer(t - timedelta(minutes=2),
               "es un retiro en cajero del 9 de enero por $1.585.208, yo no lo hice")  # fmt: skip
    return s


def _beatriz_impatient(ids: IdGenerator, t: datetime) -> _Story:
    """102 · Beatriz, app chat, no answer yet, SLA at risk → Por responder (3 unread); Daniela
    set it high."""
    opened = t - timedelta(minutes=13)
    s = _open(ids, number=102, customer=1002, channel=APP, language=ES, opened=opened)
    s.customer(opened, "no reconozco un cargo en mi tarjeta y estoy muy molesta")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=3)
    s.read_up_to(t - timedelta(minutes=9), 3)
    s.prioritize(t - timedelta(minutes=9), CasePriority.HIGH, by=DANIELA)
    s.customer(t - timedelta(minutes=8), "hola?")
    s.customer(t - timedelta(minutes=5), "hola?? hay alguien??")
    s.customer(t - timedelta(minutes=1), "contesten!! qué mal servicio")
    return s


def _patricia_again(ids: IdGenerator, t: datetime) -> _Story:
    """108 · Patricia wrote again after 104 closed → Nuevos ("Volvió a escribir")."""
    opened = t - timedelta(minutes=14)
    s = _open(ids, number=108, customer=1004, channel=APP, language=ES, opened=opened,
              previous=104)  # fmt: skip
    s.customer(opened,
               "Hola, otra vez yo. El reembolso que me dijeron todavía no aparece en mi "
               "cuenta.")  # fmt: skip
    s.opened_notice(opened)
    s.wrote_again(opened, t - PATRICIA_104_CLOSED, CloseReason.RESOLVED)
    s.assign(opened, DANIELA, open_cases=2)
    return s


def _larissa_portuguese(ids: IdGenerator, t: datetime) -> _Story:
    """103 · Larissa, Portuguese web chat, rule 3 → Nuevos. Daniela's last new case before
    her pause (``DEMO_PAUSED_BEFORE``)."""
    opened = t - timedelta(minutes=12, seconds=30)
    s = _open(ids, number=103, customer=1003, channel=WEB, language=PT, opened=opened)
    s.customer(opened, "Oi, cobraram uma coisa que não corresponde, já estou no limite com isso!")
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=4)
    return s


def _gabriela_queued(ids: IdGenerator, t: datetime) -> _Story:
    """109 · Gabriela, Portuguese web chat that arrived after Daniela paused (T−12m) →
    queued: nobody available speaks Portuguese.

    Startup runs no drain: it waits until a supervisor assigns it or a Portuguese speaker
    switches to "Disponible".
    """
    opened = t - timedelta(minutes=6)
    s = _open(ids, number=109, customer=1008, channel=WEB, language=PT, opened=opened)
    s.customer(opened, "Olá, preciso de ajuda com uma compra que não reconheço.")
    s.opened_notice(opened)
    s.wait_in_queue(opened)
    return s


# ----------------------------------------------------------------------------- slice 3
def _esteban_reassigned(ids: IdGenerator, t: datetime) -> _Story:
    """114 · Esteban, web chat: Paula got it (Julián tied on load but was assigned more
    recently), paused at T−33m, and Lucía passed it to Julián, who set it low and answered →
    Julián's Esperando al cliente."""
    opened = t - timedelta(minutes=40)
    s = _open(ids, number=114, customer=1012, channel=WEB, language=ES, opened=opened)
    s.customer(opened, "Quiero saber por qué me cobraron una comisión por manejo.")
    s.opened_notice(opened)
    s.assign(opened, PAULA, open_cases=0)
    s.escalate(t - timedelta(minutes=36), "Pregunta por una comisión que no sé explicar.")
    s.reassign(t - timedelta(minutes=32), JULIAN, by=LUCIA, open_cases=1)
    s.prioritize(t - timedelta(minutes=31), CasePriority.LOW, by=JULIAN)
    s.analyst(t - timedelta(minutes=30),
              "Hola, Esteban. Soy Julián, de LATAM Bank. Ya reviso la comisión; ¿de qué mes "
              "es el cobro?")  # fmt: skip
    return s


def _camila_overdue(ids: IdGenerator, t: datetime) -> _Story:
    """113 · Camila, app chat with Julián (the least loaded: Daniela and Paula held one case
    each): he opened it but never answered, SLA vencido → Julián's Por responder (he paused
    afterwards)."""
    opened = t - timedelta(minutes=34)
    s = _open(ids, number=113, customer=1011, channel=APP, language=ES, opened=opened)
    s.customer(opened, "Hola, hice una transferencia y no le llegó a mi hermano.")
    s.opened_notice(opened)
    s.assign(opened, JULIAN, open_cases=0)
    s.read_up_to(t - timedelta(minutes=22), 3)
    s.prioritize(t - timedelta(minutes=22), CasePriority.MEDIUM, by=JULIAN)
    s.escalate(t - timedelta(minutes=21),
               "Problema con la app al hacer una transferencia: no le llegó a su hermano y no "
               "sé cómo seguir.")  # fmt: skip
    s.customer(t - timedelta(minutes=12), "¿Me ayudan por favor?")
    return s


def _rosa_queued(ids: IdGenerator, t: datetime) -> _Story:
    """111 · Rosa, app chat, the first case after Daniela paused → queued in "Cola en
    español", SLA at risk (due in 4 min)."""
    opened = t - timedelta(minutes=11)
    s = _open(ids, number=111, customer=1009, channel=APP, language=ES, opened=opened)
    s.customer(opened, "Buenas, me llegó un cobro de una suscripción que cancelé hace meses.")
    s.opened_notice(opened)
    s.wait_in_queue(opened)
    return s


def _mauricio_queued(ids: IdGenerator, t: datetime) -> _Story:
    """112 · Mauricio, web chat → queued, wrote again; Lucía (supervision) set it high while it
    waits (first response due in 7 min)."""
    opened = t - timedelta(minutes=8)
    s = _open(ids, number=112, customer=1010, channel=WEB, language=ES, opened=opened)
    s.customer(opened,
               "Me están cobrando dos veces el mismo pago del celular, necesito que lo frenen "
               "ya.")  # fmt: skip
    s.opened_notice(opened)
    s.wait_in_queue(opened)
    s.customer(t - timedelta(minutes=4), "¿Alguien me puede atender?")
    s.prioritize(t - timedelta(minutes=3), CasePriority.HIGH, by=LUCIA, role=ActorRole.SUPERVISOR)
    return s


# ----------------------------------------------------------------------------- slice 12
def _natalia_called(ids: IdGenerator, t: datetime) -> _Story:
    """115 · Natalia called the bank yesterday (``phone_inbound``): Daniela answered (the first
    response), put her on hold to check, wrote an internal note and closed it → Cerrados."""
    opened = t - timedelta(days=1, hours=5)
    s = _open(ids, number=115, customer=1013, channel=PHONE_IN, language=ES, opened=opened)
    s.ring_in(opened)
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=0)
    at = opened + timedelta(seconds=20)
    s.answer(at)
    s.say(at + timedelta(seconds=10),
          "Hola, buenas tardes. Llamo porque me apareció un cobro de una tienda en línea que no "
          "reconozco.", by_customer=True)  # fmt: skip
    s.say(at + timedelta(seconds=25),
          "Buenas tardes, Natalia. Habla Daniela, de LATAM Bank. ¿Me confirma la fecha y el "
          "valor del cobro?", by_customer=False)  # fmt: skip
    s.say(at + timedelta(seconds=45), "Fue el 2 de octubre, por 189.900 pesos.", by_customer=True)
    s.prioritize(at + timedelta(seconds=50), CasePriority.MEDIUM, by=DANIELA)
    s.say(at + timedelta(seconds=55), "Gracias. Permítame un momento mientras lo reviso.",
          by_customer=False)  # fmt: skip
    s.hold(at + timedelta(minutes=1))
    s.mute(at + timedelta(minutes=1, seconds=5), True)
    s.mute(at + timedelta(minutes=2, seconds=25), False)
    s.resume(at + timedelta(minutes=2, seconds=30))
    s.say(at + timedelta(minutes=2, seconds=40),
          "Ya lo veo. Le explico cómo abrir el reclamo por ese cobro y le llega la confirmación "
          "por correo.", by_customer=False)  # fmt: skip
    s.say(at + timedelta(minutes=4), "Listo, muchas gracias.", by_customer=True)
    s.hang_up(at + timedelta(minutes=4, seconds=20))
    s.note(at + timedelta(minutes=5),
           "Llamada de 4 min: no reconoce un cobro en línea del 2 de octubre por $189.900. Se le "
           "explicó cómo abrir el reclamo.")  # fmt: skip
    s.close(at + timedelta(minutes=6), CloseReason.RESOLVED, "Se explicó el reclamo por teléfono.")
    return s


def _claudia_follow_up(ids: IdGenerator, t: datetime) -> _Story:
    """116 · Daniela called Claudia back (``phone_outbound``, linked to her unanswered chat
    105): Claudia answered, the call ended when she hung up, and Daniela closed it."""
    opened = t - timedelta(hours=20)
    s = _open(ids, number=116, customer=1005, channel=PHONE_OUT, language=ES, opened=opened,
              previous=105, opened_by=DANIELA)  # fmt: skip
    s.follow_up(opened, DANIELA)
    s.call_customer(opened, "Seguimiento del chat de ayer, que quedó sin respuesta: confirmar "
                    "qué cargo no reconoce.")  # fmt: skip
    at = opened + timedelta(seconds=15)
    s.answer(at)
    s.say(at + timedelta(seconds=5),
          "Buenos días, Claudia. Le habla Daniela, de LATAM Bank. La llamo por el chat de ayer "
          "sobre un cargo.", by_customer=False)  # fmt: skip
    s.say(at + timedelta(seconds=20), "Ay, sí, qué pena, se me descargó el celular.",
          by_customer=True)  # fmt: skip
    s.say(at + timedelta(seconds=30), "No se preocupe. ¿Me confirma qué cargo no reconoce?",
          by_customer=False)  # fmt: skip
    s.say(at + timedelta(seconds=50), "Uno de 45.000 pesos de una plataforma de música.",
          by_customer=True)  # fmt: skip
    s.say(at + timedelta(minutes=1, seconds=30),
          "Ya lo veo: es la renovación de una suscripción. Le explico cómo cancelarla si ya no "
          "la usa.", by_customer=False)  # fmt: skip
    s.say(at + timedelta(minutes=3), "Perfecto, gracias por llamar.", by_customer=True)
    s.hang_up(at + timedelta(minutes=3, seconds=10), by_customer=True)
    s.close(at + timedelta(minutes=5), CloseReason.RESOLVED, "Seguimiento por teléfono.")
    return s


IGNACIO_SUBJECT = "Cobro duplicado en mi tarjeta"


def _ignacio_email(ids: IdGenerator, t: datetime) -> _Story:
    """117 · Ignacio (es-AR, voseo) wrote an email last night; Daniela answered (greeting and
    signature added by the platform) and he wrote back → Por responder."""
    opened = t - timedelta(hours=16)
    s = _open(ids, number=117, customer=1014, channel=EMAIL, language=ES, opened=opened)
    s.email_in(opened, IGNACIO_SUBJECT,
               "Hola, ¿cómo andan? Les escribo porque en el resumen de la tarjeta me aparece dos "
               "veces el mismo cobro de una estación de servicio, del 28 de septiembre. ¿Me "
               "pueden decir qué tengo que hacer?\n\nGracias,\nIgnacio")  # fmt: skip
    s.opened_notice(opened)
    s.assign(opened, DANIELA, open_cases=0)
    s.prioritize(opened + timedelta(minutes=8), CasePriority.MEDIUM, by=DANIELA)
    s.email_out(
        opened + timedelta(minutes=10),
        "Gracias por escribirnos. Ya vemos los dos cobros del 28 de septiembre en su "
        "tarjeta. ¿Nos confirma si hizo una sola carga de combustible ese día?",
    )
    s.email_in(t - timedelta(hours=9), copy.reply_subject(IGNACIO_SUBJECT),
               "Hola, Daniela. Sí, cargué una sola vez, el sábado a la mañana. Si necesitás el "
               "detalle del resumen, te lo mando.\n\nAbrazo,\nIgnacio")  # fmt: skip
    return s


#: Lucía opened Julián's overdue case in supervision mode (an audited read).
SUPERVISOR_VIEW = (LUCIA, 113, timedelta(minutes=5))


type StoryFactory = Callable[[IdGenerator, datetime], _Story]

#: By opening time (a customer's older case is stored before the one that follows it).
#: Every arrival agrees with rule 3 and the least-loaded strategy at its time, given the
#: availability story of ``people.DEMO_PAUSED_BEFORE``: Daniela takes every new case until
#: she pauses at T−12m, and the queued cases (111, 112, 109) all arrive after that.
DEMO_STORIES: tuple[tuple[int, StoryFactory], ...] = (
    (110, _patricia_old),
    (104, _patricia_refund),
    (115, _natalia_called),
    (105, _claudia_unresponsive),
    (116, _claudia_follow_up),
    (117, _ignacio_email),
    (106, _hector_out_of_scope),
    (107, _joaquin_waiting),
    (114, _esteban_reassigned),
    (113, _camila_overdue),
    (101, _marcela_to_reply),
    (108, _patricia_again),
    (102, _beatriz_impatient),
    (103, _larissa_portuguese),
    (111, _rosa_queued),
    (112, _mauricio_queued),
    (109, _gabriela_queued),
)


async def add_demo_cases(
    unit: UnitOfWork, ids: IdGenerator, t: datetime, timeline: SeedTimeline
) -> int:
    """Add the seeded cases missing from ``unit`` and Lucía's supervision view; their events
    go to ``timeline``. Returns how many cases."""
    built: dict[str, Case] = {}
    for number, factory in DEMO_STORIES:
        if await unit.cases.get(seed_case_id(number)) is not None:
            continue
        story = factory(ids, t)
        await story.save(unit)
        timeline.take(story.case, *story.escalations, *story.calls)
        built[story.case.id] = story.case
    await _add_supervisor_view(unit, t, timeline, built)
    return len(built)


async def seed_demo_cases(uow: UnitOfWorkFactory, ids: IdGenerator, clock: Clock) -> int:
    """``add_demo_cases`` in its own Unit of Work (events in story-time order). Idempotent
    per case; returns how many cases it added."""
    timeline = SeedTimeline()
    async with uow() as unit:
        created = await add_demo_cases(unit, ids, clock.now(), timeline)
        timeline.record_into(unit)
        await unit.commit()
    return created


async def _add_supervisor_view(
    unit: UnitOfWork, t: datetime, timeline: SeedTimeline, built: dict[str, Case]
) -> None:
    """``case.viewed`` by Lucía (idempotent: skipped when she already has one there)."""
    supervisor, number, ago = SUPERVISOR_VIEW
    viewer_id, case_id = seed_staff_id(supervisor), seed_case_id(number)
    case = built.get(case_id) or await unit.cases.get(case_id)
    if case is None or await unit.event_log.latest(CaseViewed.event_type, viewer_id, case_id):
        return
    timeline.add(
        CaseViewed(
            occurred_at=t - ago,
            actor=ActorRef(ActorRole.SUPERVISOR, viewer_id),
            entity_id=case_id,
            case_id=case_id,
            viewer_id=viewer_id,
            access="supervisor",
            case_status=case.status.value,
            assigned_analyst_id=case.assigned_analyst_id,
        )
    )
