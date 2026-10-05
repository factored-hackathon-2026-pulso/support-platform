"""Schemas of the AI stages per case type (slice 21, ADR 0006)."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import Field, StringConstraints

from cc_platform.api.schemas.builder import AliasChange, StepUpCode
from cc_platform.api.schemas.common import ApiModel, RequestModel
from cc_platform.application.ai.agents import AgentsView
from cc_platform.application.ai.maturity import (
    ActivateAgentResultView,
    AiStagesView,
    CaseTypeStageView,
    MoveStageResultView,
    stage_since,
)
from cc_platform.domain.ai.maturity import AgentStatus, CopilotMode, StageChange
from cc_platform.domain.ai.maturity import StageRule as DomainStageRule
from cc_platform.domain.ai.maturity import StageSignals as DomainStageSignals
from cc_platform.domain.cases.values import CaseType


class ToolDecision(StrEnum):
    """What the analyst did with a ``tool`` the copilot proposed (only ``used`` for now)."""

    USED = "used"


class StageRule(ApiModel):
    """**Team rule** (example thresholds for the demo, not learned from data; show it as "Regla
    del equipo (ejemplo)"). Configurable with ``CC_STAGE_*``."""

    resolved_cases_to_ask: int = Field(description="0 → 1: cases of the type resolved by people.")
    asked_cases_to_propose_tools: int = Field(
        description="1 → 2: closed cases of the type in which the analyst asked the copilot."
    )
    tool_use_percent_to_shadow: int = Field(
        description="2 → 3: % of the closed cases with tool proposals in which one was used."
    )
    tool_cases_minimum: int = Field(description="2 → 3: …once there are at least this many.")
    draft_window: int = Field(description="3 → agent: the last drafts looked at.")
    draft_as_is_percent_for_agent: int = Field(
        description="3 → agent: % of them sent as is or with minor changes."
    )
    minor_edit_permille: int = Field(
        description="An edited draft counts as minor changes up to this edit distance (0-1000)."
    )

    @classmethod
    def from_rule(cls, rule: DomainStageRule) -> StageRule:
        return cls(
            resolved_cases_to_ask=rule.resolved_cases_to_ask,
            asked_cases_to_propose_tools=rule.asked_cases_to_propose_tools,
            tool_use_percent_to_shadow=rule.tool_use_percent_to_shadow,
            tool_cases_minimum=rule.tool_cases_minimum,
            draft_window=rule.draft_window,
            draft_as_is_percent_for_agent=rule.draft_as_is_percent_for_agent,
            minor_edit_permille=rule.minor_edit_permille,
        )


class StageSignals(ApiModel):
    """What the platform recorded for the type **since it reached its current stage**."""

    closed_cases: int
    resolved_cases: int
    asked_cases: int = Field(description="Closed cases in which someone asked the copilot.")
    tool_cases: int = Field(description="Closed cases in which the copilot proposed tools.")
    tool_used_cases: int = Field(description="…and the analyst used one.")
    drafts: int = Field(description="Decided drafts in the window (at most `rule.draftWindow`).")
    drafts_as_is: int = Field(description="Sent as is or with minor changes.")
    drafts_edited: int
    drafts_discarded: int

    @classmethod
    def from_signals(cls, signals: DomainStageSignals) -> StageSignals:
        return cls(
            closed_cases=signals.closed_cases,
            resolved_cases=signals.resolved_cases,
            asked_cases=signals.asked_cases,
            tool_cases=signals.tool_cases,
            tool_used_cases=signals.tool_used_cases,
            drafts=len(signals.recent_drafts),
            drafts_as_is=signals.drafts_as_is,
            drafts_edited=signals.drafts_edited,
            drafts_discarded=signals.drafts_discarded,
        )


class StageReached(ApiModel):
    stage: int = Field(ge=1, le=3)
    since: datetime


class StageLastChange(ApiModel):
    kind: StageChange
    at: datetime
    by_name: str | None = Field(description="Who did it; null: the system, by the team rule.")


class CaseTypeStage(ApiModel):
    case_type: CaseType
    stage: int = Field(
        ge=0,
        le=3,
        description="0 people only · 1 the analyst asks the copilot · 2 it proposes tools · "
        "3 it shadows (drafts above the composer).",
    )
    agent: AgentStatus = Field(
        description="`ready`: the drafts met the rule, the system proposes an agent to "
        "Supervisión (slice 22). `active`: an agent serves the type."
    )
    copilot_mode: CopilotMode | None = Field(
        description="What the copilot offers a case of the type (ADR 0005's `copilot_mode`); "
        "null at stage 0: no copilot."
    )
    signals: StageSignals
    reached: list[StageReached] = Field(description="The stages reached (1-3) and since when.")
    agent_since: datetime | None
    agent_id: str | None = Field(
        description="agent-core's id of the agent that serves the type (set while `agent` is "
        "`active`, slice 22)."
    )
    agent_name: str | None = Field(
        description="The name Supervisión gave the agent (ADR 0009); null: show the humanized id."
    )
    last_change: StageLastChange | None
    version: int

    @classmethod
    def from_view(cls, view: CaseTypeStageView) -> CaseTypeStage:
        m = view.maturity
        last = (
            StageLastChange(kind=m.last_change, at=m.changed_at, by_name=view.changed_by_name)
            if m.last_change is not None and m.changed_at is not None
            else None
        )
        return cls(
            case_type=m.case_type,
            stage=int(m.stage),
            agent=m.agent,
            copilot_mode=m.copilot_mode,
            signals=StageSignals.from_signals(m.signals),
            reached=[StageReached(stage=s, since=at) for s, at in stage_since(m)],
            agent_since=m.agent_since,
            agent_id=m.agent_id,
            agent_name=m.agent_name,
            last_change=last,
            version=m.version,
        )


class AiStages(ApiModel):
    available: bool = Field(
        description="false while the AI switch is off: hide every stage (`types` is empty)."
    )
    rule: StageRule
    types: list[CaseTypeStage] = Field(
        description="Every case type but `none` (a case without a type gets no copilot)."
    )

    @classmethod
    def from_view(cls, view: AiStagesView) -> AiStages:
        return cls(
            available=view.available,
            rule=StageRule.from_rule(view.rule),
            types=[CaseTypeStage.from_view(t) for t in view.types],
        )


class MoveStageBackRequest(RequestModel):
    to_stage: int = Field(ge=0, le=3, description="An earlier stage (or 3 to withdraw `ready`).")


class MoveStageBackResult(ApiModel):
    changed: bool = Field(description="false: the type was already there (nothing recorded).")
    type: CaseTypeStage

    @classmethod
    def from_view(cls, view: MoveStageResultView) -> MoveStageBackResult:
        return cls(changed=view.changed, type=CaseTypeStage.from_view(view.type))


class ToolUsedRequest(RequestModel):
    tool: str = Field(min_length=1, max_length=120, examples=["leer_movimientos@1"])
    decision: ToolDecision = ToolDecision.USED


class AgentResults(ApiModel):
    sessions: int = Field(description="Assistant sessions whose last answering agent it was.")
    active: int = Field(description="…still open.")
    resolved: int
    handed_to_people: int = Field(
        description="Escalated, ended without a resolution, failed or taken by Supervisión."
    )


class AgentRow(ApiModel):
    agent_id: str
    display_name: str = Field(description="Supervisión's name for it, or the id humanized.")
    case_type: CaseType | None = Field(description="The type it serves; null: serves none.")
    results: AgentResults


class AiAgents(ApiModel):
    available: bool = Field(description="false while the AI switch is off (`agents` is empty).")
    agents: list[AgentRow]

    @classmethod
    def from_view(cls, view: AgentsView) -> AiAgents:
        return cls(
            available=view.available,
            agents=[
                AgentRow(
                    agent_id=a.agent_id,
                    display_name=a.display_name,
                    case_type=a.case_type,
                    results=AgentResults(
                        sessions=a.results.sessions,
                        active=a.results.active,
                        resolved=a.results.resolved,
                        handed_to_people=a.results.handed_to_people,
                    ),
                )
                for a in view.agents
            ],
        )


class RenameAgentRequest(RequestModel):
    name: Annotated[str, StringConstraints(min_length=1, max_length=80, strip_whitespace=True)]


class ActivateAgentRequest(RequestModel):
    agent_id: Annotated[
        str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_/-]*$", max_length=120)
    ] = Field(description="agent-core's id of the agent that will serve the type.")
    release_id: Annotated[str, StringConstraints(min_length=1, max_length=120)] = Field(
        description="The published release `prod` will point at (the proposal's publication)."
    )
    step_up_code: StepUpCode


class ActivateAgentResult(ApiModel):
    changed: bool = Field(
        description="false: that agent already served the type (nothing promoted or recorded)."
    )
    type: CaseTypeStage
    alias: AliasChange | None = Field(description="The registry's `prod` change; null if none.")

    @classmethod
    def from_view(cls, view: ActivateAgentResultView) -> ActivateAgentResult:
        return cls(
            changed=view.changed,
            type=CaseTypeStage.from_view(view.type),
            alias=AliasChange.model_validate(view.alias) if view.alias is not None else None,
        )
