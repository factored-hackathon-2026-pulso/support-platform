"""What the synthetic volume is made of: invented people, short texts and the proportions.

Everything here is **synthetic** (brief §5): no dataset record, customer, analyst or message is
copied. Names are combinations of common first names and surnames; texts are short templates
per case type, in Spanish and Brazilian Portuguese. The proportions are team-generated and
plausible: the five dataset complaint subcategories in about equal shares (the dataset's
aggregate report has them close to even), most contacts by chat, Spanish ahead of Portuguese.

Id ranges (documented in the RUNBOOK, so anyone can tell a synthetic record from the demo
story): customers ``CUS-…5xxxxx`` and cases ``CASE-…5xxxxx`` (from ``VOLUME_BASE``), synthetic
analysts ``STF-…9xx`` (``VOLUME_STAFF_BASE``).
"""

from __future__ import annotations

from types import MappingProxyType

from cc_platform.domain.cases.values import CaseChannel, CaseType, CloseReason
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale
from cc_platform.domain.people.staff import Language, StaffRole
from cc_platform.infrastructure.seed.people import TEAM_ANDES, TEAM_PACIFICO, StaffSeed

ES, PT = Language.SPANISH, Language.PORTUGUESE

#: Synthetic customers and cases are numbered from here (``seed_customer_id``, ``seed_case_id``).
VOLUME_BASE = 500_000
#: Synthetic analysts are numbered from here (``seed_staff_id``).
VOLUME_STAFF_BASE = 900

#: The five dataset subcategories (``complaints.subcategory``), the cells the engine reads.
DATASET_TYPES: tuple[CaseType, ...] = (
    CaseType.UNRECOGNIZED_CHARGE,
    CaseType.UNDUE_CHARGE,
    CaseType.APP_ISSUE,
    CaseType.BRANCH_SERVICE,
    CaseType.SERVICE_QUALITY,
)

#: Closed cases per dataset type (about equal shares). Times 5, plus the floors below.
CLOSED_PER_TYPE = 300
#: Team-generated channel mix (chat first, then calls and email; follow-up calls are few).
CHANNEL_SHARE = MappingProxyType(
    {
        CaseChannel.CHAT_APP: 0.34,
        CaseChannel.CHAT_WEB: 0.24,
        CaseChannel.PHONE_INBOUND: 0.22,
        CaseChannel.EMAIL: 0.12,
        CaseChannel.PHONE_OUTBOUND: 0.08,
    }
)
LANGUAGE_SHARE = MappingProxyType({ES: 0.7, PT: 0.3})
#: Every cell of a dataset type (type x channel x language, 50 cells) holds at least this many
#: closed cases, so the evidence route answers it at ``CC_EVIDENCE_MIN_CELL=10`` with room to
#: spare (the rare ones, such as Portuguese follow-up calls, are raised to it).
CELL_FLOOR = 12

#: "Tarjeta virtual" is team-generated (a new product at stage 0): a handful of cases only, so
#: its "resolved by people" count stays below the team rule's step to stage 1.
VIRTUAL_CARD_CLOSED = 8
#: Closed cases nobody typed (out of scope, duplicates): "Sin tipo".
UNTYPED_CLOSED = 40
#: Open cases now: in the queues, with the synthetic analysts, with the assistant.
QUEUED_OPEN = MappingProxyType({ES: 10, PT: 4})
ASSIGNED_OPEN = 36
WITH_ASSISTANT_OPEN = 3
#: How far back the history goes.
HISTORY_DAYS = 90

#: Close reasons of the cases people closed (team-generated list, plausible shares).
CLOSE_REASON_SHARE = MappingProxyType(
    {
        CloseReason.RESOLVED: 0.82,
        CloseReason.CUSTOMER_UNRESPONSIVE: 0.08,
        CloseReason.OUT_OF_SCOPE: 0.04,
        CloseReason.DUPLICATE: 0.03,
        CloseReason.OTHER: 0.03,
    }
)
#: CSAT (1-4): share of closed cases rated, and the scores of resolved and other cases.
RATED_SHARE = 0.45
SCORES_RESOLVED = MappingProxyType({4: 0.5, 3: 0.32, 2: 0.12, 1: 0.06})
SCORES_OTHER = MappingProxyType({4: 0.15, 3: 0.3, 2: 0.3, 1: 0.25})

# ----------------------------------------------------------------------------- the copilot
#: Share of closed cases (of a type at stage 1 or more) in which the analyst asks the copilot.
#: Types that are still at stage 1 ask less, so their count stays below the 20 of the rule.
ASK_SHARE = MappingProxyType(
    {
        CaseType.UNRECOGNIZED_CHARGE: 0.5,
        CaseType.UNDUE_CHARGE: 0.45,
        CaseType.APP_ISSUE: 0.35,
        CaseType.BRANCH_SERVICE: 0.15,
        CaseType.SERVICE_QUALITY: 0.25,
    }
)
#: Share of the cases with tool proposals in which the analyst used one (stage 2): below 70 %
#: for the type that stays at stage 2, above it for the ones that went on to stage 3.
TOOL_USE_SHARE_STAYING = 0.55
TOOL_USE_SHARE_CLIMBING = 0.8
#: Share of suggestions agent-core answered with nothing to propose / failed.
SUGGESTION_NONE_SHARE = 0.12
SUGGESTION_FAILED_SHARE = 0.02
#: What the analyst does with a draft (stage 3): sent as is, with minor or larger changes,
#: discarded, or nobody decided. About 85 % as is or minor, as in the demo story.
DRAFT_DECISION_SHARE = MappingProxyType(
    {"used": 0.62, "minor": 0.22, "major": 0.09, "discarded": 0.05, "ignored": 0.02}
)
#: Share of the escalated cases (5 %) and of the assistant's conversations it resolves.
ESCALATED_SHARE = 0.05
ASSISTANT_RESOLVES_SHARE = 0.45
#: How the analyst labels the assistant's handoff when she closes the case.
HANDOFF_QUALITY_SHARE = MappingProxyType({"useful": 0.68, "incomplete": 0.24, "unnecessary": 0.08})
#: Share of typed cases first given another type and corrected (``case.type_changed`` twice).
RECLASSIFIED_SHARE = 0.08
#: Share of closed cases whose customer had an earlier synthetic case ("Volvió a escribir").
REPEAT_CUSTOMER_SHARE = 0.1

#: The agents and releases the synthetic events name (agent-core's shapes; invented values).
COPILOT_AGENT = "copiloto-asesor@prod"
SUGGESTIONS_AGENT = "copiloto-sugerencias@prod"
ENTRY_AGENT = "recepcion@prod"
TYPE_AGENT_VERSION = "1.3.0"


def type_agent(agent_id: str) -> str:
    """The agent that serves a case type, as agent-core names the one that answered
    (``id@version``). Its id is the one the type's ``case_type_maturity`` row holds."""
    return f"{agent_id}@{TYPE_AGENT_VERSION}"


#: The suggestions agent changed release mid-history (so the engine can slice by release).
SUGGESTION_RELEASES: tuple[tuple[int, str], ...] = (
    (45, "rel-sug-2026.07.2"),
    (0, "rel-sug-2026.09.1"),
)
ASSISTANT_RELEASE = "rel-disputas-2026.09.3"
TOOLS: MappingProxyType[CaseType, tuple[str, ...]] = MappingProxyType(
    {
        CaseType.UNRECOGNIZED_CHARGE: ("leer_movimientos", "leer_productos"),
        CaseType.UNDUE_CHARGE: ("leer_movimientos", "leer_pqr_cliente"),
        CaseType.APP_ISSUE: ("leer_productos", "leer_pqr_cliente"),
        CaseType.BRANCH_SERVICE: ("leer_pqr_cliente",),
        CaseType.SERVICE_QUALITY: ("leer_pqr_cliente",),
        CaseType.VIRTUAL_CARD: ("leer_productos",),
    }
)

# ----------------------------------------------------------------------------- people
_ES_FIRST = (
    "Alejandra", "Andrea", "Ángela", "Carolina", "Catalina", "Diana", "Elena", "Fernanda",
    "Gloria", "Isabel", "Juliana", "Laura", "Lorena", "Mónica", "Paola", "Sandra", "Silvia",
    "Valentina", "Adriana", "Verónica", "Alberto", "Andrés", "Camilo", "Carlos", "Diego",
    "Eduardo", "Felipe", "Fernando", "Gustavo", "Hernán", "Javier", "Jorge", "Luis", "Manuel",
    "Mateo", "Nicolás", "Óscar", "Pablo", "Ricardo", "Santiago",
)  # fmt: skip
_ES_LAST = (
    "Acosta", "Aguilar", "Benítez", "Bermúdez", "Cabrera", "Castaño", "Cifuentes", "Correa",
    "Delgado", "Escobar", "Figueroa", "Fuentes", "Galindo", "Gallego", "Henao", "Jaramillo",
    "Londoño", "Lugo", "Maldonado", "Montoya", "Navarro", "Ocampo", "Orozco", "Pineda",
    "Quiroga", "Rendón", "Salinas", "Sarmiento", "Tamayo", "Toro", "Urrutia", "Valencia",
    "Vargas", "Zapata", "Arango", "Cuéllar", "Ledesma", "Ibáñez", "Sepúlveda", "Villegas",
)  # fmt: skip
_PT_FIRST = (
    "Ana Clara", "Beatriz", "Camila", "Daniela", "Fernanda", "Gabriela", "Isabela", "Juliana",
    "Larissa", "Letícia", "Mariana", "Patrícia", "Renata", "Tatiane", "Vanessa", "André",
    "Bruno", "Caio", "Diego", "Eduardo", "Felipe", "Gustavo", "Henrique", "João Pedro",
    "Leonardo", "Lucas", "Marcelo", "Rafael", "Thiago", "Vinícius",
)  # fmt: skip
_PT_LAST = (
    "Almeida", "Araújo", "Barbosa", "Cardoso", "Carvalho", "Castro", "Correia", "Costa",
    "Dias", "Fernandes", "Ferreira", "Gomes", "Lima", "Martins", "Melo", "Moreira",
    "Nascimento", "Oliveira", "Pereira", "Ribeiro", "Rocha", "Santos", "Teixeira", "Vieira",
)  # fmt: skip
CITIES = MappingProxyType(
    {
        CountryCode.CO: ("Bogotá", "Medellín", "Cali", "Barranquilla", "Bucaramanga", "Pereira"),
        CountryCode.MX: ("Ciudad de México", "Guadalajara", "Monterrey", "Puebla", "Querétaro"),
        CountryCode.AR: ("Buenos Aires", "Córdoba", "Rosario", "Mendoza", "La Plata"),
        CountryCode.BR: ("São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Recife"),
    }
)
#: Spanish-speaking customers by locale (weights), Portuguese ones are pt-BR.
ES_LOCALES: tuple[tuple[CustomerLocale, CountryCode, float], ...] = (
    (CustomerLocale.ES_CO, CountryCode.CO, 0.45),
    (CustomerLocale.ES_MX, CountryCode.MX, 0.35),
    (CustomerLocale.ES_AR, CountryCode.AR, 0.2),
)


def customer_name(language: Language, k: int) -> str:
    """The ``k``-th invented name (deterministic): first name and two surnames."""
    first: tuple[str, ...] = _PT_FIRST if language is PT else _ES_FIRST
    last: tuple[str, ...] = _PT_LAST if language is PT else _ES_LAST
    a = first[k % len(first)]
    b = last[(k // len(first)) % len(last)]
    c = last[(k * 7 + 3) % len(last)]
    if c == b:
        c = last[(k * 7 + 4) % len(last)]
    return f"{a} {b} {c}"


A = StaffRole.ANALYST
#: Synthetic analysts (they hold the volume's cases; the demo people keep their story). Six
#: speak Portuguese too. All paused, with the demo password, like the demo accounts.
VOLUME_STAFF: tuple[StaffSeed, ...] = (
    StaffSeed(901, "Mariela Castaño Ruiz", "mariela.castano", frozenset({A}), frozenset({ES}),
              TEAM_ANDES),
    StaffSeed(902, "Hernán Ocampo Díaz", "hernan.ocampo", frozenset({A}), frozenset({ES, PT}),
              TEAM_ANDES),
    StaffSeed(903, "Lorena Bermúdez Sáenz", "lorena.bermudez", frozenset({A}), frozenset({ES}),
              TEAM_ANDES),
    StaffSeed(904, "Gustavo Pineda Lara", "gustavo.pineda", frozenset({A}), frozenset({ES, PT}),
              TEAM_ANDES),
    StaffSeed(905, "Silvia Montoya Rey", "silvia.montoya", frozenset({A}), frozenset({ES}),
              TEAM_ANDES),
    StaffSeed(906, "Rafael Teixeira Lima", "rafael.teixeira", frozenset({A}), frozenset({ES, PT}),
              TEAM_ANDES),
    StaffSeed(907, "Natalia Fuentes Gil", "natalia.fuentes", frozenset({A}), frozenset({ES}),
              TEAM_PACIFICO),
    StaffSeed(908, "Óscar Galindo Peña", "oscar.galindo", frozenset({A}), frozenset({ES, PT}),
              TEAM_PACIFICO),
    StaffSeed(909, "Paola Sarmiento Vidal", "paola.sarmiento", frozenset({A}), frozenset({ES}),
              TEAM_PACIFICO),
    StaffSeed(910, "Thiago Martins Rocha", "thiago.martins", frozenset({A}), frozenset({ES, PT}),
              TEAM_PACIFICO),
    StaffSeed(911, "Adriana Lugo Prieto", "adriana.lugo", frozenset({A}), frozenset({ES}),
              TEAM_PACIFICO),
    StaffSeed(912, "Bruno Carvalho Dias", "bruno.carvalho", frozenset({A}), frozenset({ES, PT}),
              TEAM_PACIFICO),
)  # fmt: skip
#: The demo's supervisors answer the volume's escalations (Lucía, Martín, Renata).
SUPERVISORS: tuple[int, ...] = (5, 6, 10)

# ----------------------------------------------------------------------------- texts
type Texts = MappingProxyType[CaseType, MappingProxyType[Language, tuple[str, ...]]]


def _texts(table: dict[CaseType, dict[Language, tuple[str, ...]]]) -> Texts:
    return MappingProxyType({k: MappingProxyType(v) for k, v in table.items()})


#: The customer's first message, by the type the case turns out to be.
OPENERS = _texts({
    CaseType.UNRECOGNIZED_CHARGE: {
        ES: ("Hola, me aparece un cargo en la tarjeta que no reconozco.",
             "Buenas, hay una compra en mi cuenta que yo no hice.",
             "Hola, tengo un retiro en cajero que no fui yo."),
        PT: ("Olá, apareceu uma compra no meu cartão que eu não reconheço.",
             "Oi, tem um saque na minha conta que eu não fiz."),
    },
    CaseType.UNDUE_CHARGE: {
        ES: ("Me cobraron dos veces la misma compra.",
             "Hola, me están cobrando una comisión que no corresponde.",
             "Buenas, me siguen cobrando una suscripción que ya cancelé."),
        PT: ("Fui cobrado duas vezes pela mesma compra.",
             "Olá, estão me cobrando uma tarifa que não deveria."),
    },
    CaseType.APP_ISSUE: {
        ES: ("La app no me deja entrar desde ayer.",
             "Hola, la app se cierra cuando intento hacer una transferencia.",
             "No me llega el código para entrar a la app."),
        PT: ("O aplicativo não me deixa entrar desde ontem.",
             "Olá, o app fecha quando tento fazer uma transferência."),
    },
    CaseType.BRANCH_SERVICE: {
        ES: ("Fui a la sucursal y no me pudieron atender.",
             "Hola, en la oficina me dieron una información distinta a la del chat.",
             "Esperé más de una hora en la sucursal."),
        PT: ("Fui à agência e não consegui ser atendido.",
             "Olá, na agência me deram uma informação diferente."),
    },
    CaseType.SERVICE_QUALITY: {
        ES: ("Ya es la tercera vez que escribo por lo mismo y nadie me responde.",
             "Quiero dejar un reclamo por la atención que recibí.",
             "Hola, me colgaron la llamada dos veces."),
        PT: ("Já é a terceira vez que escrevo sobre isso e ninguém responde.",
             "Quero registrar uma reclamação sobre o atendimento."),
    },
    CaseType.VIRTUAL_CARD: {
        ES: ("Hola, no puedo activar la tarjeta virtual.",),
        PT: ("Olá, não consigo ativar o cartão virtual.",),
    },
    CaseType.NONE: {
        ES: ("Hola, quiero saber cuánto me prestan para un carro.",
             "Buen día, ¿cuál es el horario de atención?"),
        PT: ("Olá, qual é o horário de atendimento?",),
    },
})  # fmt: skip

#: The analyst's first answer (after the greeting the story adds), by type.
REPLIES = _texts({
    CaseType.UNRECOGNIZED_CHARGE: {
        ES: ("Ya reviso el movimiento. ¿Me confirma la fecha y el valor del cargo?",
             "Veo el cargo. Le ayudo a abrir el reclamo; ¿todavía tiene la tarjeta con usted?"),
        PT: ("Já vou verificar a transação. Pode me confirmar a data e o valor?",
             "Estou vendo a cobrança. Vou te ajudar a abrir a contestação."),
    },
    CaseType.UNDUE_CHARGE: {
        ES: ("Ya veo los dos cobros: uno se reversa en hasta 5 días hábiles.",
             "Reviso la comisión. ¿De qué mes es el cobro?"),
        PT: ("Já vejo as duas cobranças: uma será estornada em até 5 dias úteis.",
             "Vou verificar a tarifa. De qual mês é a cobrança?"),
    },
    CaseType.APP_ISSUE: {
        ES: ("Le ayudo. ¿Qué mensaje le aparece al intentar entrar?",
             "Pruebe actualizar la app y borrar los datos; si sigue, lo reviso con usted."),
        PT: ("Vou te ajudar. Qual mensagem aparece quando tenta entrar?",
             "Tente atualizar o app e limpar os dados; se continuar, verifico com você."),
    },
    CaseType.BRANCH_SERVICE: {
        ES: ("Lamento la experiencia. ¿En qué sucursal y en qué fecha fue?",
             "Gracias por contarnos. Registro su reclamo para el equipo de oficinas."),
        PT: ("Sinto muito pela experiência. Em qual agência e em que data foi?",
             "Obrigado por nos contar. Vou registrar a sua reclamação."),
    },
    CaseType.SERVICE_QUALITY: {
        ES: ("Lamento la demora. Ya tengo su caso y lo sigo yo misma.",
             "Entiendo su molestia. Reviso lo que pasó con sus contactos anteriores."),
        PT: ("Sinto muito pela demora. Já estou com o seu caso.",
             "Entendo o seu incômodo. Vou verificar o que aconteceu."),
    },
    CaseType.VIRTUAL_CARD: {
        ES: ("La tarjeta virtual se activa desde la app, en Tarjetas. ¿Le aparece la opción?",),
        PT: ("O cartão virtual é ativado no app, em Cartões. Aparece a opção?",),
    },
    CaseType.NONE: {
        ES: ("Por este canal atendemos reclamos de movimientos; para eso lo atiende otra línea.",),
        PT: ("Por este canal atendemos reclamações de transações; para isso há outra linha.",),
    },
})  # fmt: skip

FOLLOW_UPS = MappingProxyType({
    ES: ("Sí, fue la semana pasada.", "Listo, ya le envié los datos.", "Ok, quedo atento.",
         "Gracias, ¿y cuánto se demora?"),
    PT: ("Sim, foi semana passada.", "Pronto, já enviei os dados.", "Ok, fico no aguardo.",
         "Obrigado, e quanto tempo demora?"),
})  # fmt: skip
CLOSINGS = MappingProxyType({
    ES: ("Queda registrado. Le escribimos apenas tengamos respuesta.",
         "Listo, quedó resuelto. ¿Le ayudo con algo más?"),
    PT: ("Fica registrado. Escrevemos assim que tivermos resposta.",
         "Pronto, ficou resolvido. Posso ajudar com mais alguma coisa?"),
})  # fmt: skip
PROGRESS = MappingProxyType({
    ES: ("Gracias. Ya quedó registrado con esos datos y lo estoy revisando.",
         "Perfecto. Le confirmo que el caso quedó documentado.",
         "Listo, con eso ya puedo avanzar en la revisión."),
    PT: ("Obrigado. Já ficou registrado com esses dados e estou verificando.",
         "Perfeito. Confirmo que o caso ficou documentado."),
})  # fmt: skip
THANKS = MappingProxyType({ES: ("Gracias.", "Perfecto, muchas gracias."), PT: ("Obrigado.",)})
#: A minor edit the analyst adds to a draft (keeps it "as is" for the rule).
MINOR_EDIT = MappingProxyType({ES: " Gracias.", PT: " Obrigado."})
GREETING = MappingProxyType({ES: "Hola, {customer}. Soy {analyst}, de LATAM Bank.",
                             PT: "Olá, {customer}. Sou {analyst}, do LATAM Bank."})  # fmt: skip
EMAIL_SUBJECTS = MappingProxyType({ES: "Consulta sobre mi cuenta", PT: "Dúvida sobre minha conta"})
ASSISTANT_REPLY = MappingProxyType({
    ES: "Hola, soy el asistente virtual. Ya reviso el movimiento que mencionas.",
    PT: "Olá, sou o assistente virtual. Já vou verificar a transação que você mencionou.",
})  # fmt: skip
ASSISTANT_RESOLVED = MappingProxyType({
    ES: "Listo: el cargo corresponde a una suscripción activa. Te dejo cómo cancelarla.",
    PT: "Pronto: a cobrança é de uma assinatura ativa. Te mostro como cancelar.",
})  # fmt: skip
COPILOT_QUESTIONS = MappingProxyType(
    {
        CaseType.UNRECOGNIZED_CHARGE: "¿Qué movimientos tiene la clienta en los últimos 30 días?",
        CaseType.UNDUE_CHARGE: "¿Este cliente tiene cobros duplicados este mes?",
        CaseType.APP_ISSUE: "¿Tiene bloqueos de acceso a la app registrados?",
        CaseType.BRANCH_SERVICE: "¿Tiene reclamos anteriores por atención en sucursal?",
        CaseType.SERVICE_QUALITY: "¿Cuántos contactos tuvo antes de este caso?",
        CaseType.VIRTUAL_CARD: "¿Tiene la tarjeta virtual emitida?",
    }
)
COPILOT_ANSWER = "Según los datos disponibles, hay información relevante en el perfil del cliente."
CALL_LINES = MappingProxyType({
    ES: ("Buenas tardes, llamo por un tema con mi cuenta.",
         "Con gusto. ¿Me confirma su nombre completo?",
         "Ya lo veo. Le explico los pasos a seguir.",
         "Perfecto, muchas gracias."),
    PT: ("Boa tarde, estou ligando por um problema na minha conta.",
         "Claro. Pode me confirmar o seu nome completo?",
         "Já estou vendo. Vou te explicar os próximos passos.",
         "Perfeito, muito obrigado."),
})  # fmt: skip
ESCALATION_MOTIVE = "El cliente pide que supervisión confirme el plazo de la respuesta."
ESCALATION_ANSWER = "Revisado: confírmale el plazo estándar y deja la nota en el caso."
FOLLOW_UP_REASON = "Seguimiento del caso anterior del cliente."
CALL_NOTE = "Llamada atendida: se explicaron los pasos del reclamo."
