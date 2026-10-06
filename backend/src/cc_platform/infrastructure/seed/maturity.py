"""Seeded AI maturity per case type (slice 21): **sample values**, consistent with the canvas story
(``IaAutomatizacion``), not measured.

Each type climbs through the domain (``CaseTypeMaturity.evaluate`` with the team rule, so the
audit holds "Subió … a la etapa N" on the story's dates), then keeps the sample signals of its
current stage:

- Tarjeta virtual (team-generated product): stage 0, two cases resolved by people.
- Atención en sucursal and Calidad de servicio: stage 1 (questions to the copilot in 3 and 7 of
  every 10 cases).
- Problema con app: stage 2 (the proposed tools are used in 6 of every 10 cases).
- Cobro indebido: stage 3 and ready for an agent (84 of the last 100 drafts sent as is or with
  minor changes), proposed today.
- Cargo no reconocido: served by an agent since T−6d (Lucía activated it).

Idempotent per type: a type that already has a row keeps it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from cc_platform.application.ports.unit_of_work import UnitOfWork
from cc_platform.domain.ai.maturity import (
    CaseTypeMaturity,
    MaturityStage,
    StageRule,
    StageSignals,
)
from cc_platform.domain.cases.values import CaseType
from cc_platform.domain.shared.actor import ActorRef, ActorRole
from cc_platform.infrastructure.seed.people import seed_staff_id
from cc_platform.infrastructure.seed.timeline import SeedTimeline

LUCIA = 5
#: The agent that serves "Cargo no reconocido" in the story (agent-core's demo disputes agent).
SEED_TYPE_AGENT = "disputas"
#: The name the ``volume`` profile gives it (sample, team-generated; ADR 0009 / slice 25).
SEED_TYPE_AGENT_NAME = "Asistente de disputas"
#: …and its photo, so the demo shows one (the agents proposed later get none: Supervisión picks).
SEED_TYPE_AGENT_AVATAR = "triangle"


@dataclass(frozen=True, slots=True)
class _Story:
    case_type: CaseType
    climbed: tuple[timedelta, ...]
    """When it reached stages 1, 2, 3 (ago), then "ready for an agent"."""
    signals: StageSignals
    """The sample signals of its current stage."""
    agent_active_ago: timedelta | None = None


def _drafts(as_is: int, edited: int, discarded: int) -> str:
    """A sample window: the edited and discarded drafts spread among the accepted ones."""
    window = ["a"] * as_is
    for k in range(edited):
        window.insert((k * 7 + 3) % (len(window) + 1), "e")
    for k in range(discarded):
        window.insert((k * 11 + 5) % (len(window) + 1), "d")
    return "".join(window)


DAY = timedelta(days=1)

DEMO_MATURITY: tuple[_Story, ...] = (
    _Story(CaseType.VIRTUAL_CARD, (), StageSignals(closed_cases=2, resolved_cases=2)),
    _Story(
        CaseType.BRANCH_SERVICE,
        (40 * DAY,),
        StageSignals(closed_cases=10, resolved_cases=8, asked_cases=3),
    ),
    _Story(
        CaseType.SERVICE_QUALITY,
        (27 * DAY,),
        StageSignals(closed_cases=10, resolved_cases=9, asked_cases=7),
    ),
    _Story(
        CaseType.APP_ISSUE,
        (52 * DAY, 12 * DAY),
        StageSignals(
            closed_cases=19, resolved_cases=17, asked_cases=15, tool_cases=10, tool_used_cases=6
        ),
    ),
    _Story(
        CaseType.UNDUE_CHARGE,
        (61 * DAY, 32 * DAY, 19 * DAY, timedelta(hours=2)),
        StageSignals(
            closed_cases=21,
            resolved_cases=19,
            asked_cases=18,
            tool_cases=17,
            tool_used_cases=15,
            recent_drafts=_drafts(84, 10, 6),
        ),
    ),
    _Story(
        CaseType.UNRECOGNIZED_CHARGE,
        (70 * DAY, 48 * DAY, 30 * DAY, 9 * DAY),
        StageSignals(),
        agent_active_ago=6 * DAY,
    ),
)


def _meets(stage: MaturityStage, rule: StageRule) -> StageSignals:
    """Signals that meet the rule at ``stage`` (the evidence of a past step)."""
    if stage is MaturityStage.PEOPLE_ONLY:
        return StageSignals(resolved_cases=rule.resolved_cases_to_ask)
    if stage is MaturityStage.ANALYST_ASKS:
        return StageSignals(asked_cases=rule.asked_cases_to_propose_tools)
    if stage is MaturityStage.PROPOSES_TOOLS:
        return StageSignals(
            tool_cases=rule.tool_cases_minimum, tool_used_cases=rule.tool_cases_minimum
        )
    return StageSignals(recent_drafts="a" * rule.draft_window)


def _build(story: _Story, t: datetime, rule: StageRule) -> CaseTypeMaturity:
    maturity = CaseTypeMaturity(case_type=story.case_type)
    for ago in story.climbed:
        maturity.signals = _meets(maturity.stage, rule)
        maturity.evaluate(rule, at=t - ago)
    maturity.signals = story.signals
    if story.agent_active_ago is not None:
        lucia = ActorRef(ActorRole.SUPERVISOR, seed_staff_id(LUCIA))
        maturity.activate_agent(
            agent_id=SEED_TYPE_AGENT, actor=lucia, at=t - story.agent_active_ago
        )
    return maturity


async def add_demo_maturity(
    unit: UnitOfWork, t: datetime, timeline: SeedTimeline, rule: StageRule | None = None
) -> int:
    """Add the seeded types missing from ``unit``; their events go to ``timeline``. Returns how
    many types."""
    rule = rule or StageRule()
    added = 0
    for story in DEMO_MATURITY:
        if await unit.case_type_maturity.get(story.case_type) is not None:
            continue
        maturity = _build(story, t, rule)
        await unit.case_type_maturity.add(maturity)
        timeline.take(maturity)
        added += 1
    return added
