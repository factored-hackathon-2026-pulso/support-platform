"""``CaseTypeMaturity``: how far the AI has matured for one case type (slice 21, ADR 0006 §1).

Each case type (the dataset's complaint subcategory, ``CaseType``; never ``none``) goes through
stages. The stage belongs to the type, not to a case:

====== ====================================================================================
Stage  What the analyst gets for a case of the type (``copilot_mode``)
====== ====================================================================================
0      People only: no copilot (``None``).
1      She asks the copilot (``answer``: the Q&A thread).
2      The copilot proposes tools (``tools``: "Herramientas").
3      The copilot shadows: drafts above the composer (``drafts``).
====== ====================================================================================

After stage 3 the system proposes an autonomous agent to Supervisión (``agent`` ``ready``);
Supervisión tests and activates it (``active``, slice 22). Neither changes the copilot mode.

**Signals** (``StageSignals``) come only from what the platform records, counted since the type
reached its current stage, so every stage is earned with its own evidence and a type moved back
earns its stage again: cases of the type resolved (stage 0), closed cases in which someone asked
the copilot (stage 1), closed cases in which the copilot proposed tools and one was used
(stage 2), and the last drafts and what happened to them (stage 3).

**The rule** (``StageRule``) is a **team rule**: example thresholds the team chose for the demo
(the canvas values where the design states them), not learned from data. Advancing is automatic
and audited; moving back is Supervisión's, audited too.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import IntEnum, StrEnum

from cc_platform.domain.ai.maturity_events import (
    CaseTypeAgentActivated,
    CaseTypeAgentAvatarSet,
    CaseTypeAgentPaused,
    CaseTypeAgentReady,
    CaseTypeAgentRenamed,
    CaseTypeAgentResumed,
    CaseTypeStageAdvanced,
    CaseTypeStageMovedBack,
)
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.aggregate import AggregateRoot
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError


class MaturityStage(IntEnum):
    PEOPLE_ONLY = 0
    ANALYST_ASKS = 1
    PROPOSES_TOOLS = 2
    SHADOWS = 3


class CopilotMode(StrEnum):
    """ADR 0005's ``copilot_mode``: what the copilot offers for a case of the type."""

    ANSWER = "answer"
    TOOLS = "tools"
    DRAFTS = "drafts"


#: The photos Supervisión can give an agent (the frontend ships one picture per key).
AGENT_AVATARS: tuple[str, ...] = (
    "star", "circle", "hexagon", "drop", "triangle", "rhombus", "cloud", "square", "flame", "ring",
)  # fmt: skip


class AgentStatus(StrEnum):
    NONE = "none"
    READY = "ready"
    """The drafts met the rule: the system proposes an agent to Supervisión."""
    ACTIVE = "active"
    """An agent serves the type (the assistant hands over what it cannot resolve)."""


class StageChange(StrEnum):
    """What the last change of the type was."""

    ADVANCED = "advanced"
    MOVED_BACK = "moved_back"
    AGENT_READY = "agent_ready"
    AGENT_ACTIVE = "agent_active"


class DraftOutcome(StrEnum):
    """One draft of the copilot, once decided (``ignored`` drafts are not counted)."""

    AS_IS = "a"
    """Sent as proposed, or with minor changes (edit distance ≤ the rule's limit)."""
    EDITED = "e"
    """Sent after larger changes."""
    DISCARDED = "d"


_MODE: dict[MaturityStage, CopilotMode | None] = {
    MaturityStage.PEOPLE_ONLY: None,
    MaturityStage.ANALYST_ASKS: CopilotMode.ANSWER,
    MaturityStage.PROPOSES_TOOLS: CopilotMode.TOOLS,
    MaturityStage.SHADOWS: CopilotMode.DRAFTS,
}


def copilot_mode_of(stage: MaturityStage) -> CopilotMode | None:
    return _MODE[stage]


#: The types that mature: every case type but ``none`` ("Sin tipo" is not a kind of case; a case
#: without a type gets no copilot, like stage 0).
MATURING_TYPES: tuple[CaseType, ...] = tuple(t for t in CaseType if t is not CaseType.NONE)


@dataclass(frozen=True, slots=True)
class StageRule:
    """**Team rule** (example thresholds chosen for the demo, not learned from data; the UI says
    "Regla del equipo (ejemplo)"). Configurable (``CC_STAGE_*``); the defaults are the canvas
    values (``IaAutomatizacion``) where the design states one, else team-generated."""

    resolved_cases_to_ask: int = 10
    """0 → 1: cases of the type resolved by people. Team-generated (the canvas states none)."""
    asked_cases_to_propose_tools: int = 20
    """1 → 2: closed cases in which the analyst asked the copilot. Canvas: "una misma pregunta se
    repite en 20 casos" (the platform keeps no question text, so it counts cases with
    questions)."""
    tool_use_percent_to_shadow: int = 70
    """2 → 3: of the closed cases where the copilot proposed tools, the share in which one was
    used. Canvas: "7 de cada 10 casos"."""
    tool_cases_minimum: int = 10
    """2 → 3: at least this many such cases before the share counts. Team-generated."""
    draft_window: int = 100
    """3 → agent: the last drafts looked at. Canvas: "100 casos seguidos"."""
    draft_as_is_percent_for_agent: int = 80
    """3 → agent: of those, the share sent as is or with minor changes. Canvas: "8 de cada 10"."""
    minor_edit_permille: int = 150
    """An edited draft counts as "minor changes" up to this edit distance (0-1000, slice 15b).
    Team-generated."""

    def __post_init__(self) -> None:
        counts = (
            self.resolved_cases_to_ask,
            self.asked_cases_to_propose_tools,
            self.tool_cases_minimum,
            self.draft_window,
        )
        if any(value < 1 for value in counts):
            raise InvalidValueError("The stage thresholds must be at least 1.", field="rule")
        percents = (self.tool_use_percent_to_shadow, self.draft_as_is_percent_for_agent)
        if any(not 0 < value <= 100 for value in percents):
            raise InvalidValueError("The stage shares are percentages (1-100).", field="rule")
        if not 0 <= self.minor_edit_permille <= 1000:
            raise InvalidValueError("The minor edit limit is 0-1000.", field="rule")

    def draft_outcome(
        self, decision: str, edit_distance_permille: int | None
    ) -> DraftOutcome | None:
        """The window's outcome of a decided draft (``used``, ``edited``, ``discarded``);
        ``None`` for anything else (``ignored``: nobody decided)."""
        if decision == "used":
            return DraftOutcome.AS_IS
        if decision == "edited":
            distance = edit_distance_permille if edit_distance_permille is not None else 1000
            return (
                DraftOutcome.AS_IS if distance <= self.minor_edit_permille else DraftOutcome.EDITED
            )
        if decision == "discarded":
            return DraftOutcome.DISCARDED
        return None


@dataclass(frozen=True, slots=True)
class StageSignals:
    """What the platform recorded for the type since it reached its current stage."""

    closed_cases: int = 0
    resolved_cases: int = 0
    asked_cases: int = 0
    """Closed cases in which someone asked the copilot."""
    tool_cases: int = 0
    """Closed cases in which the copilot proposed tools."""
    tool_used_cases: int = 0
    """…and the analyst used one of them."""
    recent_drafts: str = ""
    """The last decided drafts, oldest first, one ``DraftOutcome`` letter each."""

    @property
    def drafts_as_is(self) -> int:
        return self.recent_drafts.count(DraftOutcome.AS_IS.value)

    @property
    def drafts_edited(self) -> int:
        return self.recent_drafts.count(DraftOutcome.EDITED.value)

    @property
    def drafts_discarded(self) -> int:
        return self.recent_drafts.count(DraftOutcome.DISCARDED.value)

    def with_closed_case(
        self, *, resolved: bool, asked: bool, tools_proposed: bool, tool_used: bool
    ) -> StageSignals:
        return replace(
            self,
            closed_cases=self.closed_cases + 1,
            resolved_cases=self.resolved_cases + int(resolved),
            asked_cases=self.asked_cases + int(asked),
            tool_cases=self.tool_cases + int(tools_proposed),
            tool_used_cases=self.tool_used_cases + int(tools_proposed and tool_used),
        )

    def with_draft(self, outcome: DraftOutcome, window: int) -> StageSignals:
        return replace(self, recent_drafts=(self.recent_drafts + outcome.value)[-window:])


@dataclass(eq=False)
class CaseTypeMaturity(AggregateRoot):
    case_type: CaseType
    stage: MaturityStage = MaturityStage.PEOPLE_ONLY
    agent: AgentStatus = AgentStatus.NONE
    signals: StageSignals = field(default_factory=StageSignals)
    stage_since: dict[int, datetime] = field(default_factory=dict)
    """When each reached stage (1-3) was reached; a stage left by moving back is removed."""
    agent_since: datetime | None = None
    agent_id: str | None = None
    """The agent-core agent that serves the type (set when Supervisión activates it, slice 22)."""
    agent_paused: bool = False
    """The agent is out of ``recepcion``'s directory (ADR 0009 §2): new cases do not reach it."""
    agent_name: str | None = None
    """The name shown for that agent (ADR 0009; ``None``: the screens humanize the id)."""
    agent_avatar: str | None = None
    """The photo shown for that agent, one of ``AGENT_AVATARS`` (``None``: none picked yet)."""
    changed_at: datetime | None = None
    changed_by_id: str | None = None
    """Who made the last change (``None``: the system, by the rule)."""
    last_change: StageChange | None = None

    def __post_init__(self) -> None:
        if self.case_type is CaseType.NONE:
            raise InvalidValueError("A case without a type does not mature.", field="case_type")

    @property
    def copilot_mode(self) -> CopilotMode | None:
        return copilot_mode_of(self.stage)

    # ------------------------------------------------------------------ signals
    def record_closed_case(
        self, *, resolved: bool, asked: bool, tools_proposed: bool, tool_used: bool
    ) -> None:
        self.signals = self.signals.with_closed_case(
            resolved=resolved, asked=asked, tools_proposed=tools_proposed, tool_used=tool_used
        )

    def record_draft(self, outcome: DraftOutcome, rule: StageRule) -> None:
        self.signals = self.signals.with_draft(outcome, rule.draft_window)

    # ------------------------------------------------------------------ the rule
    def rule_met(self, rule: StageRule) -> bool:
        """Whether the signals of the current stage meet the team rule for the next step."""
        s = self.signals
        if self.stage is MaturityStage.PEOPLE_ONLY:
            return s.resolved_cases >= rule.resolved_cases_to_ask
        if self.stage is MaturityStage.ANALYST_ASKS:
            return s.asked_cases >= rule.asked_cases_to_propose_tools
        if self.stage is MaturityStage.PROPOSES_TOOLS:
            return (
                s.tool_cases >= rule.tool_cases_minimum
                and s.tool_used_cases * 100 >= rule.tool_use_percent_to_shadow * s.tool_cases
            )
        return (
            self.agent is AgentStatus.NONE
            and len(s.recent_drafts) >= rule.draft_window
            and s.drafts_as_is * 100 >= rule.draft_as_is_percent_for_agent * rule.draft_window
        )

    def evaluate(self, rule: StageRule, *, at: datetime) -> bool:
        """Advance one step when the rule is met (stage up, or "ready for an agent" at stage 3).
        Records the change; returns whether anything changed."""
        if not self.rule_met(rule):
            return False
        system = ActorRef.system()
        if self.stage is MaturityStage.SHADOWS:
            self.agent = AgentStatus.READY
            self.agent_since = at
            self._changed(StageChange.AGENT_READY, None, at)
            self._record(
                CaseTypeAgentReady(
                    occurred_at=at,
                    actor=system,
                    entity_id=self.case_type.value,
                    case_type=self.case_type.value,
                )
            )
            return True
        previous = self.stage
        self.stage = MaturityStage(previous + 1)
        self.stage_since[int(self.stage)] = at
        self.signals = StageSignals()
        self._changed(StageChange.ADVANCED, None, at)
        self._record(
            CaseTypeStageAdvanced(
                occurred_at=at,
                actor=system,
                entity_id=self.case_type.value,
                case_type=self.case_type.value,
                from_stage=int(previous),
                to_stage=int(self.stage),
            )
        )
        return True

    def move_back(self, *, to_stage: MaturityStage, actor: ActorRef, at: datetime) -> bool:
        """Supervisión moves the type back to ``to_stage``: a desired state, so the same stage is
        a no-op (False). From "ready for an agent", back to stage 3 clears the proposal. A type an
        agent serves cannot be moved back here (deactivating the agent is slice 22). Moving up is
        never by hand: only the rule does it. The type earns every stage again from zero."""
        if self.agent is AgentStatus.ACTIVE:
            raise InvalidTransitionError(
                "Un agente atiende este tipo de caso: desactívalo antes de devolverlo de etapa."
            )
        clears_agent = self.agent is AgentStatus.READY
        if to_stage > self.stage:
            raise InvalidTransitionError("Solo se puede devolver a una etapa anterior.")
        if to_stage == self.stage and not clears_agent:
            return False
        previous = self.stage
        self.stage = to_stage
        self.agent = AgentStatus.NONE
        self.agent_since = None
        self.agent_id = None
        self.agent_name = None
        self.agent_avatar = None
        self.agent_paused = False
        self.stage_since = {k: v for k, v in self.stage_since.items() if k <= int(to_stage)}
        self.signals = StageSignals()
        self._changed(StageChange.MOVED_BACK, actor.actor_id, at)
        self._record(
            CaseTypeStageMovedBack(
                occurred_at=at,
                actor=actor,
                entity_id=self.case_type.value,
                case_type=self.case_type.value,
                from_stage=int(previous),
                to_stage=int(to_stage),
                agent_cleared=clears_agent,
            )
        )
        return True

    def check_activation(self, agent_id: str) -> bool:
        """Whether ``agent_id`` may start serving the type: True when it would change it, False
        when that agent already serves it (a no-op). Refused for a type not ready for an agent,
        or while another agent serves it."""
        if not agent_id.strip():
            raise InvalidValueError("An agent id is required.", field="agent_id")
        if self.agent is AgentStatus.ACTIVE:
            if self.agent_id in (None, agent_id.strip()):
                return False
            raise InvalidTransitionError("Another agent already serves this case type.")
        if self.agent is not AgentStatus.READY:
            raise InvalidTransitionError("El tipo de caso todavía no está listo para un agente.")
        return True

    def activate_agent(
        self, *, agent_id: str, actor: ActorRef, at: datetime, avatar: str | None = None
    ) -> bool:
        """``agent_id`` now serves the type (slice 22: Supervisión promoted its release to
        ``prod`` and activates it here; the seed tells the demo story with it). Only from "ready
        for an agent"; activating the same agent again is a no-op (False)."""
        if not self.check_activation(agent_id):
            return False
        self.agent = AgentStatus.ACTIVE
        self.agent_since = at
        self.agent_id = agent_id.strip()
        if avatar in AGENT_AVATARS:
            self.agent_avatar = avatar  # the photo picked while reviewing the agent
        self._changed(StageChange.AGENT_ACTIVE, actor.actor_id, at)
        self._record(
            CaseTypeAgentActivated(
                occurred_at=at,
                actor=actor,
                entity_id=self.case_type.value,
                case_type=self.case_type.value,
                agent_id=self.agent_id,
            )
        )
        return True

    def set_agent_paused(self, paused: bool, *, actor: ActorRef, at: datetime) -> bool:
        """The registry paused (or resumed) the type's agent. False: it already was."""
        if self.agent is not AgentStatus.ACTIVE or self.agent_id is None:
            raise InvalidTransitionError("The type has no agent to pause.")
        if paused == self.agent_paused:
            return False
        self.agent_paused = paused
        event = CaseTypeAgentPaused if paused else CaseTypeAgentResumed
        self._record(
            event(
                occurred_at=at,
                actor=actor,
                entity_id=self.case_type.value,
                case_type=self.case_type.value,
                agent_id=self.agent_id,
            )
        )
        return True

    def rename_agent(self, name: str, *, actor: ActorRef, at: datetime) -> bool:
        """Supervisión names the agent that serves the type (ADR 0009). False: nothing changed."""
        clean = " ".join(name.split())
        if not clean or len(clean) > 80:
            raise InvalidValueError("The agent's name takes 1 to 80 characters.", field="name")
        if self.agent is not AgentStatus.ACTIVE or self.agent_id is None:
            raise InvalidTransitionError("The type has no agent to name.")
        if clean == self.agent_name:
            return False
        self.agent_name = clean
        self._record(
            CaseTypeAgentRenamed(
                occurred_at=at,
                actor=actor,
                entity_id=self.case_type.value,
                case_type=self.case_type.value,
                agent_id=self.agent_id,
            )
        )
        return True

    def set_agent_avatar(self, avatar: str, *, actor: ActorRef, at: datetime) -> bool:
        """Supervisión picks the agent's photo. False: nothing changed."""
        if avatar not in AGENT_AVATARS:
            raise InvalidValueError("Unknown agent avatar.", field="avatar")
        if self.agent is not AgentStatus.ACTIVE or self.agent_id is None:
            raise InvalidTransitionError("The type has no agent to give a photo.")
        if avatar == self.agent_avatar:
            return False
        self.agent_avatar = avatar
        self._record(
            CaseTypeAgentAvatarSet(
                occurred_at=at,
                actor=actor,
                entity_id=self.case_type.value,
                case_type=self.case_type.value,
                agent_id=self.agent_id,
                avatar=avatar,
            )
        )
        return True

    def _changed(self, kind: StageChange, by: str | None, at: datetime) -> None:
        self.last_change = kind
        self.changed_by_id = by
        self.changed_at = at
