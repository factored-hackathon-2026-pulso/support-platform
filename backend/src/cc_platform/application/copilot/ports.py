"""``CopilotEngine`` port (Strategy) — AI extension point.

The copilot answers the analyst's questions about the case and the customer, with sources,
and may *propose* tools (never execute them). The engine streams ``CopilotEvent`` values whose
types match AG-UI 1.0 (see ADR 0002), so an LLM agent that speaks AG-UI (e.g. LangGraph via
``ag-ui-langgraph``) can replace the deterministic mock without frontend changes.

Implementations:

- ``MockCopilotEngine`` (copilot slice): deterministic answers from the customer read model.
- ``RemoteAgUiCopilotEngine`` (AI team): POSTs ``RunAgentInput`` to an AG-UI endpoint and
  re-parses the events.

The run use case around the engine owns auth, audit (``copilot.*`` domain events), rule 9
checks and the ``copilot_query`` record; the engine only produces the stream.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol

from cc_platform.application.copilot.events import CopilotEvent
from cc_platform.domain.shared.json import JsonObject, JsonValue


@dataclass(frozen=True, slots=True)
class CopilotRunContext:
    case_id: str
    analyst_id: str
    thread_id: str
    run_id: str
    messages: Sequence[JsonObject]
    """Conversation so far (AG-UI message shape)."""
    customer_facts: Mapping[str, JsonValue] = field(default_factory=dict)
    """Masked read model of the customer; fields hidden by an open identity check are absent."""
    available_tools: Sequence[str] = ()
    resume: Sequence[JsonObject] = ()


class CopilotEngine(Protocol):
    def run(self, context: CopilotRunContext) -> AsyncIterator[CopilotEvent]:
        """Stream one run. Must start with ``RunStarted`` and end with ``RunFinished`` or
        ``RunError``; text messages must respect start → content* → end ordering."""
        ...
