"""The synthetic volume (seed profile ``volume``): about 1,300 cases over the last 90 days.

What it is for: the improvement engine's sensors and the evidence route
(``GET /internal/evidence/cases``) need enough closed cases per case type x channel x language,
and the supervisor screens (Colas, Equipo, Auditoría, Automatización) need something to show
beyond the demo story. Everything is **synthetic** (invented people and texts, see
``volume_catalog``) and lives in documented id ranges: customers and cases from
``VOLUME_BASE``, analysts from ``VOLUME_STAFF_BASE``.

How it is written: like the demo story (``cases._Story``), every case goes through the domain
(``Case.open``, ``append_turn``, ``assign``, ``classify``, ``close``, ``rate``, calls,
escalations, ``AssistantSession``, ``CopilotThread``, ``CopilotSuggestion``) and its events reach
the event log through the Unit of Work (``SeedTimeline.record_into`` → ``UnitOfWork.commit``),
the same path a request takes, so they carry whatever envelope the log adds. The only events
built here by hand are ``copilot.tool_used`` and ``copilot.item_decided`` (the use case records
them loose too); they go
through the same ``UnitOfWork.record``. Writes are batched (``BATCH_SIZE`` cases per Unit of
Work). The Unit of Work it gets should publish to **no** subscriber: replaying 90 days must not
notify anyone, move a stage or call agent-core (``scripts.seed`` builds it so).

The AI part follows each type's stage at the time (slice 21, read from ``case_type_maturity``):
no copilot at stage 0, questions from stage 1, tool proposals (and their use) from stage 2,
drafts and their decisions from stage 3, and for a type an agent serves (Cargo no reconocido in
the demo, the agent and name its ``case_type_maturity`` row holds) chat conversations that start
with the assistant (``recepcion``, then the type's agent, both as the audit actor), which resolves
some and hands the rest over. The types still climbing stay below the team rule's next step, and
once the cases are in, each type's signals are recomputed from the volume (what
``MaturityProjector`` would have counted since the type reached its stage), so the Automatización
panorama agrees with the log.

Idempotent: the plan is deterministic (case numbers, customers, choices) and anchored on the
first run's time (read back from the first stored case), cases that exist are skipped, and the
signals are recomputed only when something was added.
"""

from __future__ import annotations

import random
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from enum import StrEnum

from cc_platform.application.cases import copy, staff_lines
from cc_platform.application.cases.assignment import language_rule
from cc_platform.application.ports.clock import Clock
from cc_platform.application.ports.ids import IdGenerator
from cc_platform.application.ports.security import PasswordHasher
from cc_platform.application.ports.unit_of_work import UnitOfWork, UnitOfWorkFactory
from cc_platform.domain.ai.copilot import CopilotThread
from cc_platform.domain.ai.maturity import (
    AgentStatus,
    CaseTypeMaturity,
    MaturityStage,
    StageRule,
    StageSignals,
)
from cc_platform.domain.ai.maturity_events import CopilotItemDecided, CopilotToolUsed
from cc_platform.domain.ai.session import AssistantSession
from cc_platform.domain.ai.suggestion import (
    DRAFT_TTL,
    CopilotSuggestion,
    EscalationSuggestion,
    ReplySuggestion,
    Suggestion,
    SuggestionTrigger,
    ToolSuggestion,
)
from cc_platform.domain.cases.assignment import Assignment
from cc_platform.domain.cases.case import Case
from cc_platform.domain.cases.values import (
    AssignmentReason,
    CaseChannel,
    CasePriority,
    CaseType,
    CloseReason,
    TurnAuthorRole,
    TurnKind,
)
from cc_platform.domain.customers.customer import CountryCode, CustomerLocale
from cc_platform.domain.people.staff import Language
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.ids import IdPrefix
from cc_platform.infrastructure.seed import volume_catalog as cat
from cc_platform.infrastructure.seed.cases import SLA, STRATEGY, _Story, seed_case_id
from cc_platform.infrastructure.seed.customers import CustomerSeed, seed_demo_customers
from cc_platform.infrastructure.seed.people import (
    DEMO_STAFF,
    seed_demo_availability,
    seed_demo_staff,
    seed_staff_id,
)
from cc_platform.infrastructure.seed.timeline import SeedTimeline

ES, PT = Language.SPANISH, Language.PORTUGUESE
CHATS = (CaseChannel.CHAT_APP, CaseChannel.CHAT_WEB)
#: Cases per Unit of Work (each one commits its turns and events in one transaction).
BATCH_SIZE = 100
_SEED = 2026

#: A point of a case's span: 0 = when it opened, 1 = when it closed (or now, if open).
type _At = Callable[[float], datetime]


class Kind(StrEnum):
    """Where a synthetic case is now."""

    CLOSED = "closed"
    """People handled and closed it (the assistant may have handed it over first)."""
    ASSISTANT_RESOLVED = "assistant_resolved"
    """The assistant resolved it on its own (no type: nobody classified it)."""
    QUEUED = "queued"
    ASSIGNED = "assigned"
    WITH_ASSISTANT = "with_assistant"


@dataclass(frozen=True, slots=True)
class Spec:
    """One planned case. Times are offsets before the anchor (``ago``)."""

    number: int
    kind: Kind
    case_type: CaseType
    channel: CaseChannel
    language: Language
    opened_ago: timedelta
    duration: timedelta
    customer: int
    analyst: int | None = None
    previous: int | None = None
    """The customer's earlier synthetic case (closed before this one opened)."""

    @property
    def case_id(self) -> str:
        return seed_case_id(self.number)

    @property
    def closed_ago(self) -> timedelta:
        return self.opened_ago - self.duration


@dataclass(frozen=True, slots=True)
class VolumePlan:
    specs: tuple[Spec, ...]
    customers: tuple[CustomerSeed, ...]

    def closed(self) -> list[Spec]:
        return [s for s in self.specs if s.kind is Kind.CLOSED]

    def cells(self) -> Counter[tuple[CaseType, CaseChannel, Language]]:
        """Closed cases per type x channel x language (open ones count for the route too)."""
        return Counter((s.case_type, s.channel, s.language) for s in self.closed())


def claimed_cells() -> list[tuple[CaseType, CaseChannel, Language]]:
    """The cells the volume promises at ``CELL_FLOOR`` closed cases or more: every dataset
    type x every channel x both languages (50 cells)."""
    return [
        (case_type, channel, language)
        for case_type in cat.DATASET_TYPES
        for channel in cat.CHANNEL_SHARE
        for language in cat.LANGUAGE_SHARE
    ]


# ============================================================================ the plan (pure)
def _weighted[T](rng: random.Random, table: Mapping[T, float]) -> T:
    return rng.choices(list(table), weights=list(table.values()), k=1)[0]


def _duration(rng: random.Random, channel: CaseChannel, kind: Kind) -> timedelta:
    if kind is Kind.ASSISTANT_RESOLVED:
        return timedelta(minutes=rng.randint(3, 10))
    if channel is CaseChannel.EMAIL:
        return timedelta(hours=rng.randint(20, 50))
    if channel is CaseChannel.PHONE_INBOUND:
        return timedelta(minutes=rng.randint(5, 16))
    if channel is CaseChannel.PHONE_OUTBOUND:
        return timedelta(minutes=rng.randint(4, 11))
    return timedelta(minutes=rng.randint(18, 120))


def _cell_count(channel: CaseChannel, language: Language) -> int:
    """Closed cases of one dataset type in one channel and language (every type gets the same
    mix: about equal shares)."""
    planned = round(cat.CLOSED_PER_TYPE * cat.LANGUAGE_SHARE[language] * cat.CHANNEL_SHARE[channel])
    return max(cat.CELL_FLOOR, planned)


def build_plan() -> VolumePlan:
    """The volume, deterministic (the same plan on every run and every database)."""
    rng = random.Random(_SEED)
    rows: list[tuple[Kind, CaseType, CaseChannel, Language, timedelta]] = []
    history = timedelta(days=cat.HISTORY_DAYS)

    def closed_ago(channel: CaseChannel) -> timedelta:
        earliest = timedelta(days=3) if channel is CaseChannel.EMAIL else timedelta(hours=4)
        span = (history - earliest).total_seconds()
        return earliest + timedelta(seconds=int(rng.random() * span))

    for case_type in cat.DATASET_TYPES:
        for channel in cat.CHANNEL_SHARE:
            for language in cat.LANGUAGE_SHARE:
                for _ in range(_cell_count(channel, language)):
                    rows.append((Kind.CLOSED, case_type, channel, language, closed_ago(channel)))
    for k in range(cat.VIRTUAL_CARD_CLOSED):  # a new product: the last 30 days only
        language = PT if k % 4 == 3 else ES
        ago = timedelta(hours=6) + timedelta(seconds=int(rng.random() * 30 * 86400))
        rows.append((Kind.CLOSED, CaseType.VIRTUAL_CARD, CHATS[k % 2], language, ago))
    for k in range(cat.UNTYPED_CLOSED):
        language = PT if k % 4 == 3 else ES
        channel = (*CHATS, CaseChannel.PHONE_INBOUND)[k % 3]
        rows.append((Kind.CLOSED, CaseType.NONE, channel, language, closed_ago(channel)))
    for k in range(20):  # the assistant's own resolutions, in the last 6 days
        language = PT if k % 3 == 2 else ES
        ago = timedelta(hours=2) + timedelta(seconds=int(rng.random() * 5.5 * 86400))
        rows.append((Kind.ASSISTANT_RESOLVED, CaseType.NONE, CHATS[k % 2], language, ago))
    for language, count in cat.QUEUED_OPEN.items():
        for k in range(count):
            channel = (*CHATS, CaseChannel.EMAIL)[k % 3]
            ago = timedelta(minutes=1 + (k * 13) % 14, seconds=k * 7 % 60)
            rows.append((Kind.QUEUED, CaseType.NONE, channel, language, ago))
    open_types = (*cat.DATASET_TYPES, CaseType.NONE)
    for k in range(cat.ASSIGNED_OPEN):
        language = PT if k % 4 == 1 else ES
        ago = timedelta(minutes=6 + (k * 37) % 170)
        case_type = open_types[k % len(open_types)]
        rows.append((Kind.ASSIGNED, case_type, CHATS[k % 2], language, ago))
    for k in range(cat.WITH_ASSISTANT_OPEN):
        language = PT if k == 2 else ES
        ago = timedelta(minutes=2 + 3 * k)
        rows.append((Kind.WITH_ASSISTANT, CaseType.NONE, CHATS[k % 2], language, ago))

    rows.sort(key=lambda row: (-row[4].total_seconds(), row[1].value, row[2].value))
    return _number(rows, rng)


def _number(
    rows: Sequence[tuple[Kind, CaseType, CaseChannel, Language, timedelta]], rng: random.Random
) -> VolumePlan:
    """Case numbers by opening time; customers (some come back: ``previous``); analysts."""
    specs: list[Spec] = []
    customers: list[CustomerSeed] = []
    #: language -> (customer number, case number, closed_ago) of customers free to come back.
    returning: dict[Language, list[tuple[int, int, timedelta]]] = {ES: [], PT: []}
    analysts = {
        ES: [s.number for s in cat.VOLUME_STAFF],
        PT: [s.number for s in cat.VOLUME_STAFF if PT in s.languages],
    }
    open_turn = 0
    for index, (kind, case_type, channel, language, ago) in enumerate(rows):
        number = cat.VOLUME_BASE + 1 + index
        duration = _duration(rng, channel, kind)
        previous: int | None = None
        customer: int | None = None
        free = [entry for entry in returning[language] if entry[2] > ago]
        if kind is Kind.CLOSED and free and rng.random() < cat.REPEAT_CUSTOMER_SHARE:
            entry = rng.choice(free)
            returning[language].remove(entry)
            customer, previous = entry[0], entry[1]
        if customer is None:
            customer = cat.VOLUME_BASE + 1 + len(customers)
            customers.append(_customer(customer, language, rng))
        analyst: int | None = None
        if kind is Kind.ASSIGNED:
            pool = analysts[language]
            analyst = pool[open_turn % len(pool)]
            open_turn += 1
        elif kind in (Kind.CLOSED, Kind.ASSISTANT_RESOLVED):
            analyst = rng.choice(analysts[language])  # the assistant's: if no agent served it
        spec = Spec(
            number=number,
            kind=kind,
            case_type=case_type,
            channel=channel,
            language=language,
            opened_ago=ago,
            duration=duration,
            customer=customer,
            analyst=analyst,
            previous=previous,
        )
        specs.append(spec)
        if kind in (Kind.CLOSED, Kind.ASSISTANT_RESOLVED):
            returning[language].append((customer, number, spec.closed_ago))
    return VolumePlan(specs=tuple(specs), customers=tuple(customers))


def _customer(number: int, language: Language, rng: random.Random) -> CustomerSeed:
    if language is PT:
        locale, country = CustomerLocale.PT_BR, CountryCode.BR
    else:
        weights = [w for _l, _c, w in cat.ES_LOCALES]
        locale, country, _w = rng.choices(cat.ES_LOCALES, weights=weights, k=1)[0]
    return CustomerSeed(
        number=number,
        name=cat.customer_name(language, number - cat.VOLUME_BASE),
        locale=locale,
        city=rng.choice(cat.CITIES[country]),
        country=country,
    )


# ============================================================================ stages over time
@dataclass(frozen=True, slots=True)
class TypeTimeline:
    """When a case type reached each stage (from its ``case_type_maturity`` row)."""

    reached: Mapping[int, datetime] = field(default_factory=dict)
    agent_since: datetime | None = None
    """When an agent started serving the type (only while it serves it now)."""
    agent_id: str | None = None
    """agent-core's id of that agent (the type's ``case_type_maturity.agent_id``)."""
    current: int = 0

    def stage_at(self, at: datetime) -> int:
        return max((stage for stage, since in self.reached.items() if since <= at), default=0)

    def agent_at(self, at: datetime) -> bool:
        return self.agent_since is not None and self.agent_since <= at

    def current_since(self) -> datetime | None:
        return self.reached.get(self.current)

    @classmethod
    def of(cls, maturity: CaseTypeMaturity | None) -> TypeTimeline:
        if maturity is None:
            return cls()
        active = maturity.agent is AgentStatus.ACTIVE
        return cls(
            reached=dict(maturity.stage_since),
            agent_since=maturity.agent_since if active else None,
            agent_id=maturity.agent_id if active else None,
            current=int(maturity.stage),
        )


class _Rate:
    """A deterministic share: the ``n``-th hit happens so that hits/attempts never exceed it."""

    def __init__(self, share: float) -> None:
        self._share = share
        self._attempts = 0

    def hit(self) -> bool:
        before = int(self._attempts * self._share)
        self._attempts += 1
        return int(self._attempts * self._share) > before


@dataclass(frozen=True, slots=True)
class ClosedFact:
    """What ``MaturityProjector`` would count when the case closed."""

    at: datetime
    case_type: CaseType
    resolved: bool
    asked: bool
    tools_proposed: bool
    tool_used: bool


@dataclass(frozen=True, slots=True)
class DraftFact:
    at: datetime
    case_type: CaseType
    decision: str
    distance: int | None


@dataclass
class _Signals:
    """The AI decisions taken so far (the rates and the caps that keep the rule honest)."""

    timelines: Mapping[CaseType, TypeTimeline]
    rule: StageRule
    ask: dict[CaseType, _Rate] = field(default_factory=dict)
    tool: dict[CaseType, _Rate] = field(default_factory=dict)
    asked_in_current: Counter[CaseType] = field(default_factory=Counter)
    closed: list[ClosedFact] = field(default_factory=list)
    drafts: list[DraftFact] = field(default_factory=list)

    def timeline(self, case_type: CaseType) -> TypeTimeline:
        return self.timelines.get(case_type, TypeTimeline())

    def serving(self, at: datetime) -> tuple[CaseType, str] | None:
        """The type with an agent at ``at`` and that agent's id: ``recepcion`` routes the
        conversations it classifies as that type to it (ADR 0009)."""
        for case_type, tl in self.timelines.items():
            if tl.agent_id is not None and tl.agent_at(at):
                return case_type, tl.agent_id
        return None

    def asks(self, case_type: CaseType, at: datetime) -> bool:
        tl = self.timeline(case_type)
        if case_type is CaseType.NONE or tl.stage_at(at) < MaturityStage.ANALYST_ASKS:
            return False
        rate = self.ask.setdefault(case_type, _Rate(cat.ASK_SHARE.get(case_type, 0.3)))
        if not rate.hit():
            return False
        since = tl.current_since()
        if tl.current == MaturityStage.ANALYST_ASKS and since is not None and at >= since:
            # Still at stage 1: stay below the rule's step (otherwise the next close moves it).
            if self.asked_in_current[case_type] >= self.rule.asked_cases_to_propose_tools - 1:
                return False
            self.asked_in_current[case_type] += 1
        return True

    def uses_tool(self, case_type: CaseType) -> bool:
        tl = self.timeline(case_type)
        share = (
            cat.TOOL_USE_SHARE_STAYING
            if tl.current == MaturityStage.PROPOSES_TOOLS
            else cat.TOOL_USE_SHARE_CLIMBING
        )
        return self.tool.setdefault(case_type, _Rate(share)).hit()


# ============================================================================ one case
@dataclass
class _VolumeStory(_Story):
    """``_Story`` plus the AI side of a case (assistant session, copilot thread, suggestions)."""

    sessions: list[AssistantSession] = field(default_factory=list)
    threads: list[CopilotThread] = field(default_factory=list)
    suggestions: list[CopilotSuggestion] = field(default_factory=list)
    loose: list[CopilotToolUsed | CopilotItemDecided] = field(default_factory=list)
    type_agent: str = cat.type_agent("disputas")
    """``id@version`` of the agent of the case's type that answers the assistant's turns."""
    asked: bool = False
    tools_proposed: bool = False
    tool_used: bool = False
    tool_decided: bool = False
    pending: CopilotSuggestion | None = None
    """A draft nobody decided yet (``ignored`` when the case closes)."""
    recommended_escalation: CopilotSuggestion | None = None
    drafts: list[tuple[datetime, str, int | None]] = field(default_factory=list)
    """Decided drafts: when, the decision, the edit distance."""

    def aggregates(self) -> tuple[AggregateRoot, ...]:
        return (self.case, *self.escalations, *self.calls, *self.sessions, *self.threads,
                *self.suggestions)  # fmt: skip

    def _tag(self) -> str:
        return self.case.id[-6:]

    # ------------------------------------------------------------------ the assistant
    def assistant_answers(self, at: datetime, text: str, *, status: str, n: int) -> None:
        """agent-core answered the customer's last message (``AssistantEngine._apply``)."""
        session, last = self.sessions[-1], self.turns[-1]
        chosen = session.select_input(
            [(last.sequence, last.id)], now=at, claim_timeout=timedelta(minutes=2)
        )
        if chosen is None:
            return
        session.claim_input(chosen, now=at)
        session.link_run(
            agent_session_id=f"ses-vol-{self._tag()}",
            run_id=f"run-vol-{self._tag()}",
            agent=self.type_agent,
            at=at,
            release=cat.ASSISTANT_RELEASE,
        )
        self._turn(
            at, text, kind=TurnKind.MESSAGE, role=TurnAuthorRole.ASSISTANT, author=self.type_agent
        )
        session.apply_answer(
            turn_id=chosen.turn_id,
            at=at,
            awaiting="input" if status == "open" else "none",
            status=status,
            trace_id=f"trace-vol-{self._tag()}-{n}",
            messages=1,
            run_id=session.run_id,
            agent=self.type_agent,
            outcome=None if status == "open" else "resolved",
            confirmation=None,
            step_up=None,
        )

    def assistant_resolves(self, at: datetime) -> None:
        self.sessions[-1].resolve(at=at)
        self._turn(at, copy.NOTICE_CLOSED[self.case.language], kind=TurnKind.NOTICE,
                   role=TurnAuthorRole.SYSTEM, author=None)  # fmt: skip
        self.case.close_by_assistant(actor=ActorRef(ActorRole.ASSISTANT, self.type_agent), at=at)

    def assistant_hands_over(self, at: datetime, staff: int) -> None:
        """The agent escalates with its handoff and the case reaches an analyst, as
        ``AssistantHandover.to_people`` and ``AssignCase`` (``assistant_handoff``) do."""
        ref = f"handoff-{self._tag()}"
        self.sessions[-1].escalate(handoff_ref=ref, at=at)
        self.case.release_from_assistant(
            actor=ActorRef(ActorRole.ASSISTANT, self.type_agent),
            at=at,
            sla_due_at=SLA.due_at(opened_at=at),
            reason="escalated",
            handoff_ref=ref,
        )
        self.banner(at, staff_lines.assistant_released("escalated", ref=ref))
        assignment = Assignment(
            id=self.ids.new_id(IdPrefix.ASSIGNMENT),
            case_id=self.case.id,
            staff_id=seed_staff_id(staff),
            reason=AssignmentReason.ASSISTANT_HANDOFF,
            policy_rule_id=language_rule(self.case.language),
            open_cases_at_assignment=0,
            strategy=STRATEGY,
            assigned_at=at,
            assigned_by=ActorRef.system(),
        )
        self.case.assign(assignment)
        self.assignments.append(assignment)
        self.banner(at, staff_lines.assigned_from_assistant(self._name(staff), self.case.language))

    # ------------------------------------------------------------------ the copilot
    def ask_copilot(self, at: datetime, question: str) -> None:
        """The analyst asks the copilot (``AskCopilot``) and it answers."""
        thread = CopilotThread.start(
            thread_id=self.ids.new_id(IdPrefix.COPILOT_THREAD),
            case_id=self.case.id,
            analyst_id=self._analyst_ref().actor_id,
            agent=cat.COPILOT_AGENT,
            at=at,
        )
        asked, _new = thread.ask(
            message_id=self.ids.new_id(IdPrefix.COPILOT_MESSAGE),
            text=question,
            client_message_id=f"vol-{self._tag()}",
            at=at,
        )
        thread.link_run(agent_session_id=f"cpt-vol-{self._tag()}", run_id="run-1", at=at)
        thread.record_answer(
            question_id=asked.id,
            texts=[cat.COPILOT_ANSWER],
            message_ids=[self.ids.new_id(IdPrefix.COPILOT_MESSAGE)],
            trace_id=f"trace-cpt-{self._tag()}",
            status="open",
            at=at + timedelta(seconds=9),
        )
        self.threads.append(thread)
        self.asked = True

    def suggest(
        self,
        at: datetime,
        items: Sequence[Suggestion],
        *,
        trigger: SuggestionTrigger,
        release: str,
        outcome: str,
    ) -> CopilotSuggestion:
        """A suggestion is requested and agent-core answers (``ready``, ``none`` or failed)."""
        suggestion = CopilotSuggestion.request(
            suggestion_id=self.ids.new_id(IdPrefix.COPILOT_SUGGESTION),
            case_id=self.case.id,
            analyst_id=self._analyst_ref().actor_id,
            agent=cat.SUGGESTIONS_AGENT,
            trigger=trigger,
            based_on_sequence=self.case.last_sequence,
            request_key=None,
            at=at,
        )
        answered, n = at + timedelta(seconds=7), len(self.suggestions)
        if outcome == "failed":
            suggestion.record_failure(code="agent_core_unavailable", at=answered)
        else:
            suggestion.record_answer(
                raw=() if outcome == "none" else items,
                run_id=f"run-sug-{self._tag()}-{n}",
                trace_id=f"trace-sug-{self._tag()}-{n}",
                at=answered,
                release=release,
            )
        self.suggestions.append(suggestion)
        if "tool" in suggestion.kinds:
            self.tools_proposed = True
        return suggestion

    def use_tool(self, at: datetime, suggestion: CopilotSuggestion) -> None:
        """ "Usar" in Herramientas (``RecordToolUsed`` records it loose, like here)."""
        self.loose.append(
            CopilotToolUsed(
                occurred_at=at,
                actor=self._analyst_ref(),
                entity_id=suggestion.id,
                case_id=self.case.id,
                tool=suggestion.tool_ids[0],
            )
        )
        self.tool_used = True

    def dismiss_item(
        self, at: datetime, suggestion: CopilotSuggestion, item: str, ref: str
    ) -> None:
        """She set aside a tool or the escalation recommendation (``RecordItemDecision``:
        ``copilot.item_decided``, a record next to the suggestion that changes nothing in it)."""
        self.loose.append(
            CopilotItemDecided(
                occurred_at=at,
                actor=self._analyst_ref(),
                entity_id=suggestion.id,
                case_id=self.case.id,
                item=item,
                ref=ref,
                decision="dismissed",
            )
        )

    def decide(
        self, at: datetime, suggestion: CopilotSuggestion, decision: str, *, sent: str = ""
    ) -> None:
        """What the analyst did with the draft (the turn she sent is the last one)."""
        if decision in ("used", "minor", "major"):
            suggestion.reply_sent(sent_text=sent, at=at, turn_id=self.turns[-1].id)
        elif decision == "discarded":
            suggestion.discard_reply(at=at)
        else:
            self.pending = suggestion
            return
        if suggestion.reply_decision is not None:
            self.drafts.append(
                (at, suggestion.reply_decision.value, suggestion.edit_distance_permille)
            )

    def ignore_pending(self, at: datetime) -> None:
        if self.pending is not None and self.pending.ignore_reply(at=at):
            self.drafts.append((at, "ignored", None))
        self.pending = None

    def purge_old(self, now: datetime) -> None:
        """Drafts are kept 24 hours (the platform's purge): older ones keep no text."""
        for suggestion in self.suggestions:
            if suggestion.created_at + DRAFT_TTL <= now:
                suggestion.purge(at=suggestion.created_at + DRAFT_TTL)

    async def save(self, uow: UnitOfWork) -> None:
        await super().save(uow)
        for session in self.sessions:
            await uow.assistant_sessions.add(session)
        for thread in self.threads:
            await uow.copilot_threads.add(thread)
        for suggestion in self.suggestions:
            await uow.copilot_suggestions.add(suggestion)


class _Builder:
    """Turns a ``Spec`` into a story through the domain, at the anchor's absolute times."""

    def __init__(
        self,
        *,
        ids: IdGenerator,
        anchor: datetime,
        customers: Mapping[int, CustomerSeed],
        signals: _Signals,
    ) -> None:
        self.ids = ids
        self.t = anchor
        self.customers = customers
        self.signals = signals
        names = {s.id: s.name for s in (*DEMO_STAFF, *cat.VOLUME_STAFF)}
        self.staff_name: Callable[[str], str] = names.__getitem__
        self.closed_at: dict[int, tuple[datetime, CloseReason]] = {}

    # ------------------------------------------------------------------ helpers
    def _story(self, spec: Spec, opened: datetime, *, session_id: str | None) -> _VolumeStory:
        customer = self.customers[spec.customer]
        outbound = spec.channel is CaseChannel.PHONE_OUTBOUND and spec.analyst is not None
        actor = (
            ActorRef(ActorRole.ANALYST, seed_staff_id(spec.analyst or 0))
            if outbound
            else ActorRef(ActorRole.CUSTOMER, customer.id)
        )
        case = Case.open(
            case_id=spec.case_id,
            customer_id=customer.id,
            customer_name=customer.name,
            channel=spec.channel,
            language=spec.language,
            priority=CasePriority.NONE,  # staff set it (slice 8)
            opened_at=opened,
            sla_due_at=SLA.due_at(opened_at=opened),
            actor=actor,
            previous_case_id=seed_case_id(spec.previous) if spec.previous else None,
            assistant=None if session_id is None else (session_id, cat.ENTRY_AGENT),
        )
        serving = self.signals.serving(opened)
        return _VolumeStory(
            ids=self.ids,
            case=case,
            customer_first_name=customer.name.split()[0],
            staff_name=self.staff_name,
            type_agent=cat.type_agent(serving[1]) if serving else cat.type_agent("disputas"),
        )

    def _release(self, at: datetime) -> str:
        for days, release in cat.SUGGESTION_RELEASES:
            if self.t - at >= timedelta(days=days):
                return release
        return cat.SUGGESTION_RELEASES[-1][1]

    def _greeting(self, story: _VolumeStory, staff: int) -> str:
        return cat.GREETING[story.case.language].format(
            customer=story.customer_first_name, analyst=self.staff_name(seed_staff_id(staff))
        )

    # ------------------------------------------------------------------ build
    def build(self, spec: Spec) -> _VolumeStory:
        rng = random.Random(spec.number)
        opened = self.t - spec.opened_ago
        agent_serves = self.signals.serving(opened) is not None
        if spec.kind is Kind.QUEUED or (spec.kind is Kind.WITH_ASSISTANT and not agent_serves):
            story = self._queued(spec, opened, rng)
        elif spec.kind is Kind.WITH_ASSISTANT:
            story = self._start_assistant(spec, opened, rng)
        elif spec.kind is Kind.ASSISTANT_RESOLVED and agent_serves:
            story = self._assistant_resolved(spec, opened, rng)
        else:  # no agent served it then: people did
            story = self._handled(replace(spec, kind=_people_kind(spec.kind)), opened, rng)
        for when, decision, distance in story.drafts:
            self.signals.drafts.append(DraftFact(when, spec.case_type, decision, distance))
        return story

    def _arrive(self, story: _VolumeStory, spec: Spec, at: datetime, rng: random.Random) -> None:
        """The first contact, the platform's notice and "Volvió a escribir"."""
        opener = _pick(rng, cat.OPENERS[spec.case_type][spec.language])
        if spec.channel is CaseChannel.PHONE_INBOUND:
            story.ring_in(at)
        elif spec.channel is CaseChannel.EMAIL:
            story.email_in(at, cat.EMAIL_SUBJECTS[spec.language], opener)
        elif spec.channel.is_chat:
            story.customer(at, opener)
        if spec.channel is not CaseChannel.PHONE_OUTBOUND:
            story.opened_notice(at)
        if spec.previous is not None and spec.previous in self.closed_at:
            closed_at, reason = self.closed_at[spec.previous]
            story.wrote_again(at, closed_at, reason)

    def _queued(self, spec: Spec, opened: datetime, rng: random.Random) -> _VolumeStory:
        story = self._story(spec, opened, session_id=None)
        self._arrive(story, spec, opened, rng)
        story.wait_in_queue(opened)
        return story

    def _start_assistant(self, spec: Spec, opened: datetime, rng: random.Random) -> _VolumeStory:
        session_id = self.ids.new_id(IdPrefix.ASSISTANT_SESSION)
        story = self._story(spec, opened, session_id=session_id)
        story.sessions.append(
            AssistantSession.start(
                session_id=session_id,
                case_id=spec.case_id,
                customer_id=story.case.customer_id,
                entry_agent=cat.ENTRY_AGENT,
                at=opened,
            )
        )
        served = self.signals.serving(opened)
        topic = served[0] if served else CaseType.UNRECOGNIZED_CHARGE
        story.customer(opened, _pick(rng, cat.OPENERS[topic][spec.language]))
        story.assistant_answers(
            opened + timedelta(seconds=6), cat.ASSISTANT_REPLY[spec.language], status="open", n=1
        )
        return story

    def _assistant_resolved(self, spec: Spec, opened: datetime, rng: random.Random) -> _VolumeStory:
        story = self._start_assistant(spec, opened, rng)
        end = opened + spec.duration
        story.customer(end - timedelta(minutes=2), _pick(rng, cat.FOLLOW_UPS[spec.language]))
        story.assistant_answers(
            end - timedelta(seconds=30), cat.ASSISTANT_RESOLVED[spec.language], status="closed", n=2
        )
        story.assistant_resolves(end)
        self.closed_at[spec.number] = (end, CloseReason.RESOLVED)
        if rng.random() < cat.RATED_SHARE:
            story.rate(end + timedelta(minutes=2), _weighted(rng, cat.SCORES_RESOLVED))
        return story

    # ------------------------------------------------------------------ people
    def _handled(self, spec: Spec, opened: datetime, rng: random.Random) -> _VolumeStory:
        """A case people handle: arrival, priority and type, the conversation by channel (with
        the copilot of the type's stage at the time), maybe an escalation, then (if closed) the
        close and the customer's rating."""
        staff = spec.analyst or cat.VOLUME_STAFF[0].number
        closing = spec.kind is Kind.CLOSED
        end = opened + spec.duration if closing else self.t - timedelta(minutes=1)
        span = end - opened

        def at(fraction: float) -> datetime:
            return opened + span * fraction

        served = self.signals.serving(opened)
        via_assistant = served is not None and spec.case_type is served[0] and spec.channel.is_chat
        if via_assistant:
            story = self._start_assistant(spec, opened, rng)
            story.assistant_hands_over(opened + timedelta(seconds=40), staff)
        else:
            story = self._story(spec, opened, session_id=None)
            if spec.channel is CaseChannel.PHONE_OUTBOUND:
                story.follow_up(opened, staff)
                story.call_customer(opened, cat.FOLLOW_UP_REASON)
            self._arrive(story, spec, opened, rng)
            if spec.channel is not CaseChannel.PHONE_OUTBOUND:
                story.assign(opened, staff, open_cases=rng.randint(0, 3))

        stage = 0
        if spec.case_type is not CaseType.NONE:
            stage = self._classify(story, spec, at(0.05), staff, rng)
        if self.signals.asks(spec.case_type, at(0.1)):
            story.ask_copilot(at(0.1), cat.COPILOT_QUESTIONS[spec.case_type])
        escalates = closing and rng.random() < cat.ESCALATED_SHARE
        ctx = _Ctx(spec=spec, stage=stage, rng=rng)
        if spec.channel in (CaseChannel.PHONE_INBOUND, CaseChannel.PHONE_OUTBOUND):
            self._call(story, ctx, at)
        elif spec.channel is CaseChannel.EMAIL:
            self._emails(story, ctx, at)
        else:
            self._chat(story, ctx, at, staff, escalates=escalates)
        if escalates:
            self._escalate(story, at, rng)
        elif not closing and spec.number % 7 == 0:  # waiting for supervision now
            story.escalate(at(0.5), cat.ESCALATION_MOTIVE)
        if closing:
            self._close(story, spec, end, rng)
        story.purge_old(self.t)
        return story

    def _classify(
        self, story: _VolumeStory, spec: Spec, when: datetime, staff: int, rng: random.Random
    ) -> int:
        """The analyst sets the priority and the type (sometimes correcting a first guess);
        returns the type's stage then."""
        story.prioritize(when, _weighted(rng, _PRIORITY_SHARE), by=staff)
        if rng.random() < cat.RECLASSIFIED_SHARE:
            wrong = _pick(rng, [t for t in cat.DATASET_TYPES if t is not spec.case_type])
            story.classify(when, wrong, by=staff)
            when += timedelta(minutes=1)
        story.classify(when, spec.case_type, by=staff)
        return self.signals.timeline(spec.case_type).stage_at(when)

    def _proposal(
        self,
        story: _VolumeStory,
        ctx: _Ctx,
        when: datetime,
        draft: str | None,
        *,
        trigger: SuggestionTrigger,
        escalate: bool = False,
    ) -> CopilotSuggestion | None:
        """The copilot's automatic suggestion at this stage (nothing below stage 2; drafts from
        stage 3), and whether the analyst used the tool it proposed."""
        spec, stage, rng = ctx.spec, ctx.stage, ctx.rng
        if stage < MaturityStage.PROPOSES_TOOLS:
            return None
        items: list[Suggestion] = []
        if draft is not None and stage >= MaturityStage.SHADOWS:
            items.append(ReplySuggestion(text=draft, language=spec.language.value))
        tools = cat.TOOLS.get(spec.case_type, ())
        if tools and (stage == MaturityStage.PROPOSES_TOOLS or rng.random() < 0.5):
            items.append(ToolSuggestion(tool=_pick(rng, tools)))
        if escalate:
            items.append(EscalationSuggestion(reason_code="customer_requests_supervisor"))
        roll = rng.random()
        if roll < cat.SUGGESTION_FAILED_SHARE:
            outcome = "failed"
        elif not items or (draft is None and roll < cat.SUGGESTION_NONE_SHARE):
            outcome = "none"
        else:
            outcome = "ready"
        suggestion = story.suggest(
            when, items, trigger=trigger, release=self._release(when), outcome=outcome
        )
        if "tool" in suggestion.kinds and not story.tool_decided:
            # Whether she uses the proposed tools is decided once per case (the rule counts
            # cases), on the first proposal.
            story.tool_decided = True
            if self.signals.uses_tool(spec.case_type):
                story.use_tool(when + timedelta(seconds=40), suggestion)
            elif spec.number % 2 == 0:  # half of the others say so (the rest just ignore it)
                story.dismiss_item(
                    when + timedelta(seconds=40), suggestion, "tool", suggestion.tool_ids[0]
                )
        if escalate and suggestion.recommends_escalation:
            story.recommended_escalation = suggestion
        return suggestion

    def _analyst_writes(
        self,
        story: _VolumeStory,
        ctx: _Ctx,
        when: datetime,
        draft: str,
        *,
        trigger: SuggestionTrigger,
        escalate: bool = False,
        email: bool = False,
    ) -> None:
        """The analyst answers; from stage 3 the copilot drafted it first and she decides."""
        spec, rng = ctx.spec, ctx.rng
        suggestion = self._proposal(
            story, ctx, when - timedelta(minutes=1), draft, trigger=trigger, escalate=escalate
        )
        decision = "none"
        if suggestion is not None and suggestion.reply_pending:
            decision = _weighted(rng, cat.DRAFT_DECISION_SHARE)
        sent = draft
        if decision == "minor":
            sent = draft + cat.MINOR_EDIT[spec.language]
        elif decision in ("major", "discarded"):
            sent = (
                _pick(rng, cat.CLOSINGS[spec.language])
                + " "
                + draft.split(".", maxsplit=1)[0]
                + "."
            )
        if suggestion is not None and decision == "discarded":
            story.decide(when - timedelta(seconds=20), suggestion, decision)
        if email:
            story.email_out(when, sent)
        else:
            story.analyst(when, sent)
        if suggestion is not None and decision not in ("none", "discarded"):
            story.decide(when, suggestion, decision, sent=sent)

    def _chat(
        self, story: _VolumeStory, ctx: _Ctx, at: _At, staff: int, *, escalates: bool
    ) -> None:
        spec, rng = ctx.spec, ctx.rng
        language, closing = spec.language, spec.kind is Kind.CLOSED
        if not closing and spec.number % 4 == 0:
            return  # "Nuevo": nobody answered yet
        first = (
            self._greeting(story, staff) + " " + _pick(rng, cat.REPLIES[spec.case_type][language])
        )
        trigger = (
            SuggestionTrigger.HANDOVER if story.sessions else SuggestionTrigger.CUSTOMER_MESSAGE
        )
        # A few conversations get the recommendation to escalate without ending up escalated.
        recommend = escalates or spec.number % 17 == 0
        self._analyst_writes(story, ctx, at(0.2), first, trigger=trigger, escalate=recommend)
        story.customer(at(0.4), _pick(rng, cat.FOLLOW_UPS[language]))
        if not closing and spec.number % 4 == 1:
            return  # "Por responder"
        self._analyst_writes(
            story, ctx, at(0.5), _pick(rng, cat.PROGRESS[language]),
            trigger=SuggestionTrigger.CUSTOMER_MESSAGE,
        )  # fmt: skip
        story.customer(at(0.6), _pick(rng, cat.FOLLOW_UPS[language]))
        if not closing and spec.number % 4 == 2:
            return  # "Por responder" again, one exchange later
        self._analyst_writes(
            story, ctx, at(0.7), _pick(rng, cat.CLOSINGS[language]),
            trigger=SuggestionTrigger.CUSTOMER_MESSAGE,
        )  # fmt: skip
        if closing and rng.random() < 0.7:
            story.customer(at(0.8), _pick(rng, cat.THANKS[language]))

    def _emails(self, story: _VolumeStory, ctx: _Ctx, at: _At) -> None:
        spec, rng = ctx.spec, ctx.rng
        language = spec.language
        body = _pick(rng, cat.REPLIES[spec.case_type][language])
        self._analyst_writes(
            story, ctx, at(0.01), body, trigger=SuggestionTrigger.CUSTOMER_MESSAGE, email=True
        )
        if rng.random() < 0.5:
            subject = copy.reply_subject(cat.EMAIL_SUBJECTS[language])
            story.email_in(at(0.55), subject, _pick(rng, cat.FOLLOW_UPS[language]))
            self._analyst_writes(
                story, ctx, at(0.8), _pick(rng, cat.CLOSINGS[language]),
                trigger=SuggestionTrigger.CUSTOMER_MESSAGE, email=True,
            )  # fmt: skip

    def _call(self, story: _VolumeStory, ctx: _Ctx, at: _At) -> None:
        spec, rng = ctx.spec, ctx.rng
        outbound = spec.channel is CaseChannel.PHONE_OUTBOUND
        story.answer(at(0.02))
        self._proposal(story, ctx, at(0.1), None, trigger=SuggestionTrigger.MANUAL)
        for k, line in enumerate(cat.CALL_LINES[spec.language]):
            story.say(at(0.15 + 0.12 * k), line, by_customer=(k % 2 == 0) != outbound)
        if rng.random() < 0.2:
            story.hold(at(0.66))
            story.resume(at(0.7))
        story.hang_up(at(0.78), by_customer=rng.random() < 0.3)
        if rng.random() < 0.3:
            story.note(at(0.82), cat.CALL_NOTE)

    def _escalate(self, story: _VolumeStory, at: _At, rng: random.Random) -> None:
        story.escalate(at(0.45), cat.ESCALATION_MOTIVE)
        if story.recommended_escalation is not None:
            story.recommended_escalation.escalation_taken(at=at(0.45))
        story.answer_escalation(at(0.5), by=_pick(rng, cat.SUPERVISORS), note=cat.ESCALATION_ANSWER)

    def _close(self, story: _VolumeStory, spec: Spec, end: datetime, rng: random.Random) -> None:
        reason = (
            _weighted(rng, cat.CLOSE_REASON_SHARE)
            if spec.case_type is not CaseType.NONE
            else _pick(rng, (CloseReason.OUT_OF_SCOPE, CloseReason.DUPLICATE))
        )
        story.ignore_pending(end)
        recommended = story.recommended_escalation
        if recommended is not None and not recommended.escalation_accepted:
            story.dismiss_item(end - timedelta(minutes=1), recommended, "escalate", "")
        story.close(end, reason)
        if story.sessions:
            # The analyst labels the assistant's handoff when she closes (``CloseCase``). Today
            # the label only travels to agent-core; P5 (catalog 1.3.0) adds a handoff-quality
            # event: emit it here, with ``handoff_quality(rng)`` as its label, once it exists.
            story.sessions[-1].mark_handoff_resolved(at=end)
        self.closed_at[spec.number] = (end, reason)
        if rng.random() < cat.RATED_SHARE and end + timedelta(minutes=3) < self.t:
            scores = cat.SCORES_RESOLVED if reason is CloseReason.RESOLVED else cat.SCORES_OTHER
            story.rate(end + timedelta(minutes=3), _weighted(rng, scores))
        if spec.case_type is not CaseType.NONE:
            self.signals.closed.append(
                ClosedFact(
                    at=end,
                    case_type=spec.case_type,
                    resolved=reason is CloseReason.RESOLVED,
                    asked=story.asked,
                    tools_proposed=story.tools_proposed,
                    tool_used=story.tool_used,
                )
            )


@dataclass(frozen=True, slots=True)
class _Ctx:
    """What the steps of one case share: its plan, its type's stage and its random source."""

    spec: Spec
    stage: int
    rng: random.Random


_PRIORITY_SHARE = {
    CasePriority.LOW: 0.25,
    CasePriority.MEDIUM: 0.45,
    CasePriority.HIGH: 0.22,
    CasePriority.CRITICAL: 0.08,
}


def _pick[T](rng: random.Random, options: Sequence[T]) -> T:
    return options[rng.randrange(len(options))]


def _people_kind(kind: Kind) -> Kind:
    return Kind.CLOSED if kind is Kind.ASSISTANT_RESOLVED else kind


def handoff_quality(rng: random.Random) -> str:
    """The analyst's label of an assistant handoff (``useful``, ``incomplete``, ``unnecessary``)."""
    return _weighted(rng, cat.HANDOFF_QUALITY_SHARE)


# ============================================================================ signals
def recompute_signals(
    maturity: CaseTypeMaturity,
    closed: Iterable[ClosedFact],
    drafts: Iterable[DraftFact],
    rule: StageRule,
) -> StageSignals:
    """What ``MaturityProjector`` counts for the type since it reached its current stage: the
    closed cases (with the type they had then) and the decided drafts, in time order."""
    since = maturity.stage_since.get(int(maturity.stage)) if maturity.stage else None
    stream: list[tuple[datetime, int, ClosedFact | DraftFact]] = [
        (fact.at, 0, fact) for fact in closed if fact.case_type is maturity.case_type
    ]
    stream += [(fact.at, 1, fact) for fact in drafts if fact.case_type is maturity.case_type]
    signals = StageSignals()
    for when, _order, fact in sorted(stream, key=lambda item: (item[0], item[1])):
        if since is not None and when < since:
            continue
        if isinstance(fact, ClosedFact):
            signals = signals.with_closed_case(
                resolved=fact.resolved,
                asked=fact.asked,
                tools_proposed=fact.tools_proposed,
                tool_used=fact.tool_used,
            )
        else:
            outcome = rule.draft_outcome(fact.decision, fact.distance)
            if outcome is not None:
                signals = signals.with_draft(outcome, rule.draft_window)
    return signals


# ============================================================================ the seed
@dataclass(frozen=True, slots=True)
class VolumeResult:
    created: int
    """Cases added by this run (0 on a database that already has the volume)."""
    planned: int
    staff: int
    customers: int
    signals_updated: int


async def seed_volume(
    uow: UnitOfWorkFactory,
    ids: IdGenerator,
    clock: Clock,
    *,
    hasher: PasswordHasher,
    rule: StageRule,
    batch_size: int = BATCH_SIZE,
) -> VolumeResult:
    """Add the synthetic volume (after the demo seed: it reuses its supervisors and stages).

    ``uow`` must publish to no subscriber (see the module docstring). Idempotent."""
    plan = build_plan()
    staff = await seed_demo_staff(uow, hasher, now=clock.now(), seeds=cat.VOLUME_STAFF, teams=())
    await seed_demo_availability(
        uow, clock, seeds=cat.VOLUME_STAFF, available=frozenset(), paused_before={}
    )
    customers = await seed_demo_customers(uow, plan.customers)
    first = plan.specs[0]
    async with uow() as unit:
        stored_first = await unit.cases.get(first.case_id)
        maturity = {m.case_type: m for m in await unit.case_type_maturity.list()}
    anchor = (
        stored_first.opened_at + first.opened_ago
        if stored_first is not None
        else clock.now().replace(microsecond=0)
    )
    signals = _Signals(timelines={t: TypeTimeline.of(m) for t, m in maturity.items()}, rule=rule)
    builder = _Builder(
        ids=ids,
        anchor=anchor,
        customers={c.number: c for c in plan.customers},
        signals=signals,
    )
    stories = [builder.build(spec) for spec in plan.specs]  # all of them: same facts every run
    created = 0
    for start in range(0, len(stories), batch_size):
        created += await _save_batch(uow, stories[start : start + batch_size])
    updated = await _update_signals(uow, signals, rule) if created else 0
    return VolumeResult(
        created=created,
        planned=len(plan.specs),
        staff=staff,
        customers=customers,
        signals_updated=updated,
    )


async def _save_batch(uow: UnitOfWorkFactory, batch: Sequence[_VolumeStory]) -> int:
    """One Unit of Work: the batch's missing cases, their events in story-time order."""
    timeline = SeedTimeline()
    created = 0
    async with uow() as unit:
        existing = await unit.cases.get_many([story.case.id for story in batch])
        for story in batch:
            if story.case.id in existing:
                continue
            await story.save(unit)
            timeline.take(*story.aggregates())
            timeline.add(*story.loose)
            created += 1
        timeline.record_into(unit)
        await unit.commit()
    return created


async def _update_signals(uow: UnitOfWorkFactory, signals: _Signals, rule: StageRule) -> int:
    """Each type's signals as the volume makes them (the stages stay as the story has them)."""
    updated = 0
    async with uow() as unit:
        for maturity in await unit.case_type_maturity.list():
            maturity.signals = recompute_signals(maturity, signals.closed, signals.drafts, rule)
            await unit.case_type_maturity.save(maturity)
            updated += 1
        await unit.commit()
    return updated
