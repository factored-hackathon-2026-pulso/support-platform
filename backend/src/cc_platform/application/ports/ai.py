"""Index of the AI-team extension points (docs/platform/AI_INTEGRATION.md).

Each port is declared in the bounded context that owns it (brief §4.2); this module only
re-exports them so there is one place to discover what can be plugged in.
"""

from cc_platform.application.audit.ports import EventExporter, ExportWindow
from cc_platform.application.automation.ports import (
    ComponentKind,
    ComponentRegistry,
    ComponentStatus,
    ComponentVersion,
    StopCondition,
)
from cc_platform.application.copilot.events import CopilotEvent
from cc_platform.application.copilot.ports import CopilotEngine, CopilotRunContext
from cc_platform.application.routing.ports import (
    ComponentRef,
    Handoff,
    Responder,
    ResponderRegistry,
    RoutingContext,
    RoutingDecision,
    RoutingOutcome,
    Tier,
)
from cc_platform.application.tools.ports import (
    PermissionLevel,
    ToolCallStatus,
    ToolDefinition,
    ToolHandler,
    ToolInvocation,
    ToolKind,
    ToolRegistry,
    ToolResult,
)

__all__ = [
    "ComponentKind",
    "ComponentRef",
    "ComponentRegistry",
    "ComponentStatus",
    "ComponentVersion",
    "CopilotEngine",
    "CopilotEvent",
    "CopilotRunContext",
    "EventExporter",
    "ExportWindow",
    "Handoff",
    "PermissionLevel",
    "Responder",
    "ResponderRegistry",
    "RoutingContext",
    "RoutingDecision",
    "RoutingOutcome",
    "StopCondition",
    "Tier",
    "ToolCallStatus",
    "ToolDefinition",
    "ToolHandler",
    "ToolInvocation",
    "ToolKind",
    "ToolRegistry",
    "ToolResult",
]
