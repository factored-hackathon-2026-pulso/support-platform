"""Seed cases — "Datos de ejemplo": Daniela Ríos's inbox with every status of the canvas.

Seven stories from the Workspace canvas with invented people (slice 1 contract §6.1):
Todos 7 · Por responder 3 · En curso 1 · Nuevos 1 · Por llamar 1 · En espera 1. Times are
relative to the clock at the **first** seed (``T``); seeding is idempotent per case id, so an
existing database keeps its old times (delete it, or run with ``CC_PERSISTENCE=memory``, to
re-anchor). Everything goes through the domain (``Case`` state machine, turns, routing steps,
assignments) and records its events with the story's own time, so the event log and "Cómo
llegó a ti" agree. Bot turns use seed components (``tree.disputas@ejemplo``…); no action
cards yet (slice 3).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from cc_platform.application.cases import copy
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
    CaseOrigin,
    CasePriority,
    CaseTopic,
    ChannelSessionKind,
    TurnAudience,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.people.staff import Language
from cc_platform.domain.routing.routing_step import RoutingStep
from cc_platform.domain.routing.values import ComponentRef, Handoff, RoutingOutcome, Tier
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.ids import BODY_LENGTH, IdPrefix, make_id
from cc_platform.infrastructure.seed.customers import DEMO_CUSTOMERS, seed_customer_id
from cc_platform.infrastructure.seed.people import seed_staff_id

DANIELA = seed_staff_id(1)
DANIELA_NAME = "Daniela Ríos"

JUDGE = ComponentRef("judge.entrada", "ejemplo")
TREE = ComponentRef("tree.disputas", "ejemplo")
AGENT = ComponentRef("agent.disputas", "ejemplo")
COMPONENT_NAMES: dict[ComponentRef, str] = {
    JUDGE: "Juez de entrada",
    TREE: "Árbol de disputas",
    AGENT: "Agente de disputas",
}
STRATEGY = "language_least_loaded@1"


def seed_case_id(number: int) -> str:
    return make_id(IdPrefix.CASE, str(number).zfill(BODY_LENGTH))


def _ago(t: datetime, **delta: float) -> datetime:
    return t - timedelta(**delta)


@dataclass
class _Story:
    """Builds one seeded case in chronological order through the domain."""

    uow: UnitOfWork
    ids: IdGenerator
    case: Case
    turns: list[Turn] = field(default_factory=list)
    steps: list[RoutingStep] = field(default_factory=list)
    assignments: list[Assignment] = field(default_factory=list)

    @property
    def customer_actor(self) -> ActorRef:
        return ActorRef(ActorRole.CUSTOMER, self.case.customer_id)

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

    def analyst(self, at: datetime, text: str) -> None:
        self.case.start_progress(at=at)
        self._turn(at, text, kind=TurnKind.MESSAGE, role=TurnAuthorRole.ANALYST, author=DANIELA)
        self.case.mark_read(up_to=self.case.last_sequence, at=at)

    def bot(self, at: datetime, text: str, component: ComponentRef = TREE) -> None:
        self._turn(at, text, kind=TurnKind.MESSAGE, role=TurnAuthorRole.TREE, author=str(component))

    def notice(
        self, at: datetime, text: str, audience: TurnAudience = TurnAudience.EVERYONE
    ) -> None:
        self._turn(
            at,
            text,
            kind=TurnKind.NOTICE,
            role=TurnAuthorRole.SYSTEM,
            author=None,
            audience=audience,
        )

    def opened_notice(self, at: datetime) -> None:
        self.notice(at, copy.NOTICE_OPENED[self.case.language])

    def banner(self, at: datetime, text: str) -> None:
        self._turn(
            at,
            text,
            kind=TurnKind.ROUTING,
            role=TurnAuthorRole.SYSTEM,
            author=None,
            audience=TurnAudience.STAFF,
        )

    def step(
        self,
        at: datetime,
        tier: Tier,
        component: ComponentRef,
        outcome: RoutingOutcome,
        summary: str,
        *,
        reason: str,
        inputs: tuple[str, ...],
        rule: str | None = None,
        confidence: float | None = None,
    ) -> None:
        step = RoutingStep(
            id=self.ids.new_id(IdPrefix.ROUTING_STEP),
            case_id=self.case.id,
            tier=tier,
            component=component,
            outcome=outcome,
            occurred_at=at,
            component_name=COMPONENT_NAMES[component],
            reason_code=reason,
            policy_rule_id=rule,
            confidence=confidence,
            inputs_used=inputs,
            handoff=Handoff(summary=summary),
        )
        self.steps.append(step)
        self.uow.record(step.recorded_event())

    def assign(
        self,
        at: datetime,
        *,
        reason: AssignmentReason = AssignmentReason.LANGUAGE_LEAST_LOADED,
        rule: str | None = None,
        open_cases: int = 0,
        strategy: str = STRATEGY,
    ) -> None:
        assignment = Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=self.case.id,
            staff_id=DANIELA,
            reason=reason,
            policy_rule_id=rule,
            open_cases_at_assignment=open_cases,
            strategy=strategy,
            assigned_at=at,
            assigned_by=ActorRef.system(),
        )
        self.case.assign(assignment)
        self.assignments.append(assignment)

    def read_all(self, at: datetime) -> None:
        self.case.mark_read(up_to=self.case.last_sequence, at=at)

    def read_up_to(self, at: datetime, sequence: int) -> None:
        self.case.mark_read(up_to=sequence, at=at)

    async def save(self) -> None:
        slot = await self.uow.case_slots.get(self.case.customer_id)
        if slot is None:
            slot = CustomerCaseSlot(customer_id=self.case.customer_id)
            slot.occupy(self.case.id)
            await self.uow.case_slots.add(slot)
        else:
            slot.occupy(self.case.id)
            await self.uow.case_slots.save(slot)
        await self.uow.cases.add(self.case)
        for turn in self.turns:
            await self.uow.turns.add(turn)
        for step in self.steps:
            await self.uow.routing_steps.add(step)
        for assignment in self.assignments:
            await self.uow.assignments.add(assignment)


def _customer_name(number: int) -> str:
    return next(seed.name for seed in DEMO_CUSTOMERS if seed.number == number)


def _open(
    uow: UnitOfWork,
    ids: IdGenerator,
    *,
    number: int,
    customer: int,
    channel: CaseChannel,
    language: Language,
    topic: CaseTopic,
    opened: datetime,
    sla: datetime,
    priority: CasePriority = CasePriority.MEDIUM,
    origin: CaseOrigin = CaseOrigin.CUSTOMER,
    session: ChannelSessionKind | None = None,
    entry: tuple[str, str] | None = None,
) -> _Story:
    customer_id = seed_customer_id(customer)
    case = Case.open(
        case_id=seed_case_id(number),
        customer_id=customer_id,
        customer_name=_customer_name(customer),
        channel=channel,
        channel_session=session or ChannelSessionKind.for_chat(channel),
        language=language,
        origin=origin,
        priority=priority,
        opened_at=opened,
        sla_due_at=sla,
        actor=(
            ActorRef(ActorRole.CUSTOMER, customer_id)
            if not origin.is_outbound
            else ActorRef.system()
        ),
        topic=topic,
        entry_label=entry[0] if entry else None,
        entry_summary=entry[1] if entry else None,
    )
    return _Story(uow=uow, ids=ids, case=case)


# ----------------------------------------------------------------------------- the stories
def _web_dispute(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """101 · canvas "Ana": web dispute, ATM withdrawal over the limit → Por responder."""
    s = _open(uow, ids, number=101, customer=1001, channel=CaseChannel.WEB_CHAT,
              language=Language.SPANISH, topic=CaseTopic.DISPUTAR_CARGO,
              opened=_ago(t, minutes=14), sla=t + timedelta(hours=5))  # fmt: skip
    s.customer(
        _ago(t, minutes=14), "hola buenas, hay un cargo en mi tarjeta q no reconozco, me colaboran?"
    )
    s.step(_ago(t, minutes=13, seconds=55), Tier.JUDGE, JUDGE, RoutingOutcome.HANDED_OFF,
           "Lo clasificó como disputa de un cargo con tarjeta.",
           reason="routed_to_tree", inputs=("customers",), confidence=0.93)  # fmt: skip
    s.bot(
        _ago(t, minutes=13, seconds=30),
        "¿El cargo que no reconoce es el de un retiro en cajero por $1.585.208 COP, del 9 ene?",
    )
    s.customer(_ago(t, minutes=13), "si, ese es")
    s.bot(_ago(t, minutes=12, seconds=30),
          "Para proteger su cuenta, le propongo bloquear la tarjeta terminada en 8501. "
          "¿Me confirma si está de acuerdo?")  # fmt: skip
    s.customer(_ago(t, minutes=2), "si, bloqueela porfa")
    s.step(_ago(t, minutes=1, seconds=58), Tier.TREE, TREE, RoutingOutcome.MITIGATED,
           "Rama «cargo no reconocido»: encontró el retiro y abrió el reclamo con su "
           "confirmación. No cierra: le pasó al agente el cargo verificado.",
           reason="open_problem", inputs=("customers", "transactions"))  # fmt: skip
    s.step(_ago(t, minutes=1, seconds=55), Tier.AI_AGENT, AGENT, RoutingOutcome.HANDED_OFF,
           "Escaló porque el retiro supera $1.000.000 y el abono provisional lo decide una "
           "persona.",
           reason="R4_amount_over_limit", rule="R4",
           inputs=("customers", "transactions", "interactions"))  # fmt: skip
    s.assign(_ago(t, minutes=1, seconds=50), open_cases=0)
    s.banner(_ago(t, minutes=1, seconds=50),
             "Escalado por el agente de disputas: el retiro supera $1.000.000 (regla 10) y el "
             "abono lo decide una persona (regla 6).")  # fmt: skip
    s.read_all(_ago(t, minutes=1))
    return s


def _impatient_app_chat(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """102 · canvas "Mercedes": live app chat, impatient, SLA at risk → Por responder."""
    s = _open(uow, ids, number=102, customer=1002, channel=CaseChannel.APP_CHAT,
              language=Language.SPANISH, topic=CaseTopic.DISPUTAR_CARGO,
              opened=_ago(t, minutes=7), sla=t + timedelta(minutes=9))  # fmt: skip
    s.customer(_ago(t, minutes=7), "no reconozco un cargo en mi tarjeta y estoy muy molesta")
    s.opened_notice(_ago(t, minutes=7))
    s.step(_ago(t, minutes=6, seconds=55), Tier.JUDGE, JUDGE, RoutingOutcome.HANDED_OFF,
           "Lo clasificó como cargo no reconocido y detectó molestia.",
           reason="routed_to_tree", inputs=("customers",), confidence=0.88)  # fmt: skip
    s.step(_ago(t, minutes=6, seconds=10), Tier.TREE, TREE, RoutingOutcome.HANDED_OFF,
           "Rama «cargo no reconocido»: no encontró el cargo en sus movimientos, así que no "
           "hay nada que bloquear ni reclamar todavía.",
           reason="charge_not_found", inputs=("customers", "transactions"))  # fmt: skip
    s.assign(_ago(t, minutes=6), open_cases=1)
    s.banner(_ago(t, minutes=6),
             "Lo pasó el árbol: no encontró el cargo en sus movimientos y la clienta escribe "
             "molesta.")  # fmt: skip
    s.read_all(_ago(t, minutes=5, seconds=30))
    s.customer(_ago(t, minutes=5), "hola?")
    s.customer(_ago(t, minutes=3), "hola?? hay alguien??")
    s.customer(_ago(t, minutes=1), "contesten!! qué mal servicio")
    return s


def _portuguese_web_chat(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """103 · canvas "Fernanda": Portuguese web chat, rule 3 → Nuevos."""
    s = _open(uow, ids, number=103, customer=1003, channel=CaseChannel.WEB_CHAT,
              language=Language.PORTUGUESE, topic=CaseTopic.CONSULTAR_CARGO,
              opened=_ago(t, minutes=2), sla=t + timedelta(minutes=58))  # fmt: skip
    s.customer(
        _ago(t, minutes=2),
        "Oi, cobraram uma coisa que não corresponde, já estou no limite com isso!",
    )
    s.opened_notice(_ago(t, minutes=2))
    s.step(_ago(t, minutes=1, seconds=50), Tier.JUDGE, JUDGE, RoutingOutcome.HANDED_OFF,
           "Detectó portugués: ninguna rama ni agente de IA atiende en portugués todavía "
           "(regla 3).",
           reason="language_pt", rule="H1", inputs=("customers",), confidence=0.97)  # fmt: skip
    s.assign(_ago(t, minutes=1, seconds=40), rule="H1", open_cases=2)
    s.banner(
        _ago(t, minutes=1, seconds=40),
        f"Asignado a {DANIELA_NAME} porque habla portugués (regla 3).",
    )
    return s


def _email(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """104 · canvas "Angélica": email, asked for a supervisor → Por responder (read-only)."""
    s = _open(uow, ids, number=104, customer=1004, channel=CaseChannel.EMAIL,
              language=Language.SPANISH, topic=CaseTopic.DISPUTAR_CARGO,
              opened=_ago(t, hours=22), sla=t + timedelta(hours=22),
              session=ChannelSessionKind.EMAIL_ADDRESS)  # fmt: skip
    s.customer(_ago(t, hours=22),
               "Buenas tardes:\n\nEscribo porque hay un cargo en mi tarjeta que no reconozco. "
               "No sé decir el comercio ni cuánto fue.\n\nQuedo al pendiente")  # fmt: skip
    s.step(_ago(t, hours=21, minutes=59, seconds=50), Tier.JUDGE, JUDGE,
           RoutingOutcome.HANDED_OFF, "Lo clasificó como cargo no reconocido.",
           reason="routed_to_tree", inputs=("customers",), confidence=0.81)  # fmt: skip
    s.step(_ago(t, hours=21, minutes=59, seconds=30), Tier.TREE, TREE,
           RoutingOutcome.HANDED_OFF,
           "No encontró el cargo en sus movimientos: sin el cargo no hay nada que bloquear "
           "ni reclamar todavía.",
           reason="charge_not_found", inputs=("customers", "transactions"))  # fmt: skip
    s.assign(_ago(t, hours=21, minutes=59), open_cases=3)
    s.banner(
        _ago(t, hours=21, minutes=59),
        "Llegó por correo. El árbol no encontró el cargo en sus movimientos.",
    )
    s.read_all(_ago(t, hours=21, minutes=30))
    s.analyst(_ago(t, hours=21, minutes=24),
              "Hola, Patricia:\n\nSoy Daniela, de LATAM Bank. Agradezco su mensaje; en este "
              "momento estoy revisando su caso.")  # fmt: skip
    s.customer(_ago(t, hours=18),
               "Hola:\n\nAntes de seguir, quiero hablar con un supervisor. No tengo mucha "
               "confianza en que esto se resuelva por este medio.\n\nSaludos")  # fmt: skip
    s.analyst(_ago(t, hours=17),
              "Hola, Patricia:\n\nEntiendo su preocupación. Puedo atender su caso con calma "
              "y, si llega a hacer falta, mi supervisora lo revisará. Le pido la oportunidad "
              "de ayudarle.")  # fmt: skip
    s.customer(
        _ago(t, hours=1, minutes=31),
        "Hola:\n\nBueno, adelante. Veamos si pueden resolverlo.\n\nSaludos",
    )
    return s


def _inbound_call(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """105 · canvas "Rocío": inbound call with live transcript → En curso (read-only)."""
    live_since = _ago(t, minutes=4, seconds=6)
    queued_at = live_since - timedelta(seconds=133)
    s = _open(uow, ids, number=105, customer=1005, channel=CaseChannel.PHONE,
              language=Language.SPANISH, topic=CaseTopic.DISPUTAR_CARGO,
              opened=queued_at - timedelta(seconds=40), sla=t + timedelta(hours=1),
              session=ChannelSessionKind.CALLER_NUMBER,
              entry=("IVR", "Verificó su identidad con documento y clave."))  # fmt: skip
    s.case.queue(label=copy.QUEUE_LABEL[Language.SPANISH], reason_code="ivr_transfer",
                 policy_rule_id=None, at=queued_at)  # fmt: skip
    s.assign(live_since, reason=AssignmentReason.QUEUE_DRAINED, open_cases=4)
    s.case.start_call(at=live_since, actor=ActorRef(ActorRole.ANALYST, DANIELA))
    lines: tuple[tuple[int, str, str], ...] = (
        (240, "a", "Buenas tardes, gracias por llamar a LATAM Bank. Le saluda Daniela. Claudia, "
                   "con mucho gusto, ¿en qué le puedo colaborar?"),
        (220, "c", "Buenas tardes. Eh, llamo porque no reconozco un cargo de Cable TV por "
                   "$223.690, yo no tengo nada contratado con ellos."),
        (200, "a", "Claro que sí, señora. Permítame un momento en línea mientras reviso su caso."),
        (125, "n", "En espera · 1 min 15 s"),
        (100, "a", "Gracias por esperar. Le consulto, ¿el cargo que no reconoce es Cable TV por "
                   "$223.690 del 13 de diciembre?"),
        (90, "c", "Sí, ese, ese es."),
        (70, "a", "Gracias. Para proteger su cuenta le propongo bloquear la tarjeta terminada "
                  "en 7560. ¿Me confirma si está de acuerdo?"),
        (55, "c", "Sí, claro, bloquéela."),
    )  # fmt: skip
    for seconds_ago, who, text in lines:
        at = _ago(t, seconds=seconds_ago)
        if who == "a":
            s.analyst(at, text)
        elif who == "c":
            s.customer(at, text)
        else:
            s.notice(at, text, audience=TurnAudience.STAFF)
    s.read_all(_ago(t, seconds=50))
    return s


def _regulator_callback(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """106 · canvas "Fernando": CONDUSEF complaint, the bank must call → Por llamar."""
    opened = _ago(t, days=2)
    s = _open(uow, ids, number=106, customer=1006, channel=CaseChannel.PHONE,
              language=Language.SPANISH, topic=CaseTopic.DISPUTAR_CARGO,
              priority=CasePriority.LOW, origin=CaseOrigin.REGULATOR,
              opened=opened, sla=t + timedelta(days=2),
              session=ChannelSessionKind.OUTBOUND_CALL,
              entry=("CONDUSEF", "Recibió el reclamo y lo envió al banco."))  # fmt: skip
    s.case.queue(label="Cola regulatoria", reason_code="regulator_followup", policy_rule_id="A2",
                 at=opened + timedelta(minutes=5),
                 summary="Lo asignó para llamar al cliente.")  # fmt: skip
    assigned = opened + timedelta(minutes=20)
    s.assign(assigned, reason=AssignmentReason.OUTBOUND_FOLLOWUP, rule="A2", open_cases=0,
             strategy="regulatory_queue@ejemplo")  # fmt: skip
    s.case.require_callback(at=assigned, actor=ActorRef.system())
    s.banner(assigned,
             "Reclamo que llegó por la CONDUSEF. Después de la llamada, la respuesta a la "
             "CONDUSEF la firma tu supervisora (regla 11).")  # fmt: skip
    return s


def _waiting_on_customer(uow: UnitOfWork, ids: IdGenerator, t: datetime) -> _Story:
    """107 · es-AR app chat, Daniela asked for data → En espera ("Esperando al cliente")."""
    s = _open(uow, ids, number=107, customer=1007, channel=CaseChannel.APP_CHAT,
              language=Language.SPANISH, topic=CaseTopic.ESTADO_DISPUTA,
              opened=_ago(t, minutes=50), sla=t + timedelta(hours=3))  # fmt: skip
    s.customer(_ago(t, minutes=50),
               "Hola, ¿me podés decir cómo va el reclamo que hice por un cobro en un súper? Ya "
               "pasaron como dos semanas y no sé nada.")  # fmt: skip
    s.opened_notice(_ago(t, minutes=50))
    s.step(_ago(t, minutes=49, seconds=50), Tier.JUDGE, JUDGE, RoutingOutcome.HANDED_OFF,
           "Lo clasificó como consulta por el estado de una disputa.",
           reason="routed_to_tree", inputs=("customers",), confidence=0.9)  # fmt: skip
    s.step(_ago(t, minutes=48, seconds=30), Tier.TREE, TREE, RoutingOutcome.HANDED_OFF,
           "Rama «estado de la disputa»: no encontró un reclamo abierto con los datos que dio.",
           reason="complaint_not_found", inputs=("customers", "complaints"))  # fmt: skip
    s.assign(_ago(t, minutes=48), open_cases=5)
    s.banner(
        _ago(t, minutes=48), "Lo pasó el árbol: no encontró un reclamo abierto con esos datos."
    )
    s.read_all(_ago(t, minutes=26))
    s.analyst(_ago(t, minutes=25),
              "Hola, Joaquín. Soy Daniela, de LATAM Bank. Para encontrar su reclamo, ¿me "
              "podría decir la fecha aproximada del cobro y el monto?")  # fmt: skip
    return s


type StoryFactory = Callable[[UnitOfWork, IdGenerator, datetime], _Story]

DEMO_STORIES: tuple[tuple[int, StoryFactory], ...] = (
    (101, _web_dispute),
    (102, _impatient_app_chat),
    (103, _portuguese_web_chat),
    (104, _email),
    (105, _inbound_call),
    (106, _regulator_callback),
    (107, _waiting_on_customer),
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
        story = factory(unit, ids, t)
        await story.save()
        await unit.commit()
    return True
