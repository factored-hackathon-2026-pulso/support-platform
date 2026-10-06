"""Domain events of the AI maturity per case type (slice 21, ADR 0006).

``entity`` is ``case_type`` and ``entity_id`` the case type value (``undue_charge``); there is no
``case_id``. Payloads carry the type and the stages only. ``copilot.tool_used`` is the platform's
own record of a ``tool`` suggestion the analyst used (``entity`` ``copilot``, ``entity_id`` the
suggestion id, ``case_id`` set): it does not change the suggestion aggregate (ADR 0005), it sits
next to it in the event log.
"""

from __future__ import annotations

from dataclasses import dataclass

from cc_platform.domain.shared.events import DomainEvent


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeStageAdvanced(DomainEvent):
    """The team rule was met: the type moved up one stage (always the system)."""

    event_type = "ai.stage_advanced"
    entity = "case_type"

    case_type: str
    from_stage: int
    to_stage: int


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeStageMovedBack(DomainEvent):
    """Supervisión moved the type back (``agent_cleared``: it was ready for an agent)."""

    event_type = "ai.stage_moved_back"
    entity = "case_type"

    case_type: str
    from_stage: int
    to_stage: int
    agent_cleared: bool


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeAgentReady(DomainEvent):
    """At stage 3 the drafts met the team rule: the system proposes an agent to Supervisión
    (slice 22 builds the proposal; nothing is activated here)."""

    event_type = "ai.agent_ready"
    entity = "case_type"

    case_type: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeAgentActivated(DomainEvent):
    """An agent serves the type (Supervisión activated it, slice 22; the seed uses it to tell the
    demo story). ``agent_id`` is agent-core's id of the agent (``disputas``)."""

    event_type = "ai.agent_activated"
    entity = "case_type"

    case_type: str
    agent_id: str | None = None


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeAgentRenamed(DomainEvent):
    """Supervisión changed the name the platform shows for the agent of the type (ADR 0009). The
    name itself is not in the payload (free text); ``agent_id`` is agent-core's id."""

    event_type = "ai.agent_renamed"
    entity = "case_type"

    case_type: str
    agent_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeAgentAvatarSet(DomainEvent):
    """Supervisión picked the photo (avatar) the platform shows for the agent of the type.
    ``avatar`` is one of the fixed keys, not free text."""

    event_type = "ai.agent_avatar_set"
    entity = "case_type"

    case_type: str
    agent_id: str
    avatar: str


@dataclass(frozen=True, kw_only=True, slots=True)
class AgentAvatarChosen(DomainEvent):
    """Supervisión picked the photo of an agent that serves no type yet (while reviewing it).
    ``entity_id`` is the agent id; for an agent that serves a type the type records
    ``ai.agent_avatar_set`` instead."""

    event_type = "ai.agent_avatar_chosen"
    entity = "agent"

    agent_id: str
    avatar: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeAgentPaused(DomainEvent):
    """Supervisión paused the agent of the type (out of ``recepcion``'s directory, ADR 0009 §2)."""

    event_type = "ai.agent_paused"
    entity = "case_type"

    case_type: str
    agent_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CaseTypeAgentResumed(DomainEvent):
    event_type = "ai.agent_resumed"
    entity = "case_type"

    case_type: str
    agent_id: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotToolUsed(DomainEvent):
    """The analyst used a ``tool`` the copilot proposed ("Usar" in Herramientas)."""

    event_type = "copilot.tool_used"
    entity = "copilot"

    tool: str


@dataclass(frozen=True, kw_only=True, slots=True)
class CopilotItemDecided(DomainEvent):
    """What the analyst did with one item of a suggestion beyond a sent draft: she used or
    dismissed a ``tool``, an ``action`` or the ``escalate`` recommendation (``ref`` is empty for
    ``escalate``). A platform-side record next to the suggestion, which it does not change."""

    event_type = "copilot.item_decided"
    entity = "copilot"

    item: str
    ref: str
    decision: str


#: The stage changes of a case type: audited and signalled on ``ai:stages``.
STAGE_EVENTS: tuple[type[DomainEvent], ...] = (
    CaseTypeStageAdvanced,
    CaseTypeStageMovedBack,
    CaseTypeAgentReady,
    CaseTypeAgentActivated,
    CaseTypeAgentRenamed,
    CaseTypeAgentAvatarSet,
    AgentAvatarChosen,
    CaseTypeAgentPaused,
    CaseTypeAgentResumed,
)

#: Every event of the maturity model (the stage changes and the tool feedback).
MATURITY_EVENTS: tuple[type[DomainEvent], ...] = (
    *STAGE_EVENTS,
    CopilotToolUsed,
    CopilotItemDecided,
)
