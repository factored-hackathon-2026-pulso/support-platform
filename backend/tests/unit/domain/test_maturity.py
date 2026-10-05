"""``CaseTypeMaturity`` (slice 21): the team rule, one step at a time, moving back, the agent."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_platform.domain.ai.maturity import (
    AgentStatus,
    CaseTypeMaturity,
    CopilotMode,
    DraftOutcome,
    MaturityStage,
    StageChange,
    StageRule,
    StageSignals,
    copilot_mode_of,
)
from cc_platform.domain.ai.maturity_events import (
    CaseTypeAgentActivated,
    CaseTypeAgentReady,
    CaseTypeStageAdvanced,
    CaseTypeStageMovedBack,
)
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.domain.shared.errors import InvalidTransitionError, InvalidValueError

T = datetime(2026, 10, 4, 12, tzinfo=UTC)
RULE = StageRule()
LUCIA = ActorRef(ActorRole.SUPERVISOR, "STF-" + "0" * 25 + "5")


def closed(m: CaseTypeMaturity, n: int, **facts: bool) -> None:
    flags = {"resolved": True, "asked": False, "tools_proposed": False, "tool_used": False}
    flags.update(facts)
    for _ in range(n):
        m.record_closed_case(**flags)


def test_the_copilot_mode_follows_the_stage() -> None:
    assert [copilot_mode_of(s) for s in MaturityStage] == [
        None,
        CopilotMode.ANSWER,
        CopilotMode.TOOLS,
        CopilotMode.DRAFTS,
    ]
    assert CaseTypeMaturity(case_type=CaseType.VIRTUAL_CARD).copilot_mode is None


def test_a_case_without_a_type_does_not_mature() -> None:
    with pytest.raises(InvalidValueError):
        CaseTypeMaturity(case_type=CaseType.NONE)


def test_the_rule_rejects_impossible_thresholds() -> None:
    for bad in (
        {"draft_window": 0},
        {"tool_use_percent_to_shadow": 0},
        {"draft_as_is_percent_for_agent": 101},
        {"minor_edit_permille": 1001},
    ):
        with pytest.raises(InvalidValueError):
            StageRule(**bad)


def test_resolved_cases_take_a_type_from_people_only_to_the_copilot() -> None:
    m = CaseTypeMaturity(case_type=CaseType.VIRTUAL_CARD)
    closed(m, 9)
    closed(m, 3, resolved=False)
    assert not m.evaluate(RULE, at=T)
    closed(m, 1)
    assert m.evaluate(RULE, at=T)
    assert m.stage is MaturityStage.ANALYST_ASKS
    assert m.signals == StageSignals()  # each stage is earned with its own evidence
    assert m.stage_since == {1: T}
    assert (m.last_change, m.changed_by_id, m.changed_at) == (StageChange.ADVANCED, None, T)
    (event,) = m.pull_events()
    assert isinstance(event, CaseTypeStageAdvanced)
    assert event.payload() == {"case_type": "virtual_card", "from_stage": 0, "to_stage": 1}
    assert event.actor == ActorRef.system()


def test_cases_with_questions_lead_to_tools() -> None:
    m = CaseTypeMaturity(case_type=CaseType.SERVICE_QUALITY, stage=MaturityStage.ANALYST_ASKS)
    closed(m, 19, asked=True)
    closed(m, 10)
    assert not m.evaluate(RULE, at=T)
    closed(m, 1, asked=True)
    assert m.evaluate(RULE, at=T)
    assert m.stage is MaturityStage.PROPOSES_TOOLS


def test_tools_used_in_seven_of_ten_cases_lead_to_drafts() -> None:
    m = CaseTypeMaturity(case_type=CaseType.APP_ISSUE, stage=MaturityStage.PROPOSES_TOOLS)
    closed(m, 6, tools_proposed=True, tool_used=True)
    closed(m, 3, tools_proposed=True)
    assert not m.evaluate(RULE, at=T)  # 9 cases: under the minimum of 10
    closed(m, 1, tools_proposed=True)
    assert not m.evaluate(RULE, at=T)  # 6 of 10
    closed(m, 2)  # no tools proposed: not counted either way
    assert m.signals.tool_cases == 10
    closed(m, 4, tools_proposed=True, tool_used=True)
    assert (m.signals.tool_used_cases, m.signals.tool_cases) == (10, 14)  # 71 %
    assert m.evaluate(RULE, at=T)
    assert m.stage is MaturityStage.SHADOWS


def test_a_tool_used_without_a_proposal_is_not_counted() -> None:
    m = CaseTypeMaturity(case_type=CaseType.APP_ISSUE, stage=MaturityStage.PROPOSES_TOOLS)
    closed(m, 1, tool_used=True)
    assert (m.signals.tool_cases, m.signals.tool_used_cases) == (0, 0)


def test_drafts_sent_as_is_make_the_type_ready_for_an_agent() -> None:
    m = CaseTypeMaturity(case_type=CaseType.UNDUE_CHARGE, stage=MaturityStage.SHADOWS)
    for _ in range(79):
        m.record_draft(DraftOutcome.AS_IS, RULE)
    assert not m.evaluate(RULE, at=T)  # the window is not full yet
    for _ in range(21):
        m.record_draft(DraftOutcome.DISCARDED, RULE)
    assert not m.evaluate(RULE, at=T)  # 79 of 100
    m.record_draft(DraftOutcome.AS_IS, RULE)  # the oldest (as is) leaves the window
    assert len(m.signals.recent_drafts) == 100
    assert m.signals.drafts_as_is == 79
    assert not m.evaluate(RULE, at=T)
    m.signals = StageSignals(recent_drafts="d" * 20 + "a" * 79)
    m.record_draft(DraftOutcome.AS_IS, RULE)
    assert (m.signals.drafts_as_is, m.signals.drafts_discarded) == (80, 20)
    assert m.evaluate(RULE, at=T)
    assert (m.stage, m.agent, m.agent_since) == (MaturityStage.SHADOWS, AgentStatus.READY, T)
    assert m.copilot_mode is CopilotMode.DRAFTS
    assert m.signals.drafts_as_is == 80  # the evidence stays
    assert isinstance(m.pull_events()[-1], CaseTypeAgentReady)
    assert not m.evaluate(RULE, at=T)  # once


def test_minor_edits_count_as_sent_as_is() -> None:
    assert RULE.draft_outcome("used", 0) is DraftOutcome.AS_IS
    assert RULE.draft_outcome("edited", 150) is DraftOutcome.AS_IS
    assert RULE.draft_outcome("edited", 151) is DraftOutcome.EDITED
    assert RULE.draft_outcome("edited", None) is DraftOutcome.EDITED
    assert RULE.draft_outcome("discarded", None) is DraftOutcome.DISCARDED
    assert RULE.draft_outcome("ignored", None) is None


def climbed() -> CaseTypeMaturity:
    m = CaseTypeMaturity(case_type=CaseType.UNDUE_CHARGE)
    for k, stage in enumerate(MaturityStage):
        if stage is MaturityStage.SHADOWS:
            break
        m.stage = stage
        m.signals = StageSignals(
            resolved_cases=99, asked_cases=99, tool_cases=99, tool_used_cases=99
        )
        assert m.evaluate(RULE, at=T + timedelta(days=k))
    m.pull_events()
    return m


def test_supervision_moves_a_type_back_and_it_earns_the_stages_again() -> None:
    m = climbed()
    assert m.stage is MaturityStage.SHADOWS
    assert sorted(m.stage_since) == [1, 2, 3]
    m.signals = StageSignals(recent_drafts="a" * 40)
    assert m.move_back(to_stage=MaturityStage.ANALYST_ASKS, actor=LUCIA, at=T)
    assert m.stage is MaturityStage.ANALYST_ASKS
    assert sorted(m.stage_since) == [1]
    assert m.signals == StageSignals()
    assert (m.last_change, m.changed_by_id) == (StageChange.MOVED_BACK, LUCIA.actor_id)
    (event,) = m.pull_events()
    assert isinstance(event, CaseTypeStageMovedBack)
    assert event.payload() == {
        "case_type": "undue_charge",
        "from_stage": 3,
        "to_stage": 1,
        "agent_cleared": False,
    }
    assert not m.move_back(to_stage=MaturityStage.ANALYST_ASKS, actor=LUCIA, at=T)  # no-op
    with pytest.raises(InvalidTransitionError):
        m.move_back(to_stage=MaturityStage.SHADOWS, actor=LUCIA, at=T)  # only the rule moves up


def test_back_to_stage_three_withdraws_the_agent_proposal() -> None:
    m = climbed()
    m.signals = StageSignals(recent_drafts="a" * 100)
    assert m.evaluate(RULE, at=T)
    assert m.move_back(to_stage=MaturityStage.SHADOWS, actor=LUCIA, at=T)
    assert (m.stage, m.agent, m.agent_since) == (MaturityStage.SHADOWS, AgentStatus.NONE, None)
    assert m.pull_events()[-1].payload()["agent_cleared"] is True


def test_an_agent_is_activated_only_once_ready_and_then_blocks_moving_back() -> None:
    m = climbed()
    with pytest.raises(InvalidTransitionError):
        m.activate_agent(agent_id="cobros", actor=LUCIA, at=T)
    m.signals = StageSignals(recent_drafts="a" * 100)
    m.evaluate(RULE, at=T)
    with pytest.raises(InvalidValueError):
        m.activate_agent(agent_id="  ", actor=LUCIA, at=T)
    assert m.check_activation("cobros")
    assert m.activate_agent(agent_id="cobros", actor=LUCIA, at=T + timedelta(days=1))
    assert not m.activate_agent(agent_id="cobros", actor=LUCIA, at=T)  # the same agent: a no-op
    assert not m.check_activation("cobros")
    with pytest.raises(InvalidTransitionError):  # another agent while one serves the type
        m.check_activation("otro")
    assert (m.agent, m.agent_id, m.last_change) == (
        AgentStatus.ACTIVE,
        "cobros",
        StageChange.AGENT_ACTIVE,
    )
    event = m.pull_events()[-1]
    assert isinstance(event, CaseTypeAgentActivated)
    assert event.payload()["agent_id"] == "cobros"
    with pytest.raises(InvalidTransitionError):
        m.move_back(to_stage=MaturityStage.PEOPLE_ONLY, actor=LUCIA, at=T)
