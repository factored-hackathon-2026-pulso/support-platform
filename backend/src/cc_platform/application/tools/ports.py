"""Tools: Command pattern + registry — the only way anyone (person or AI) acts on a case.

Each tool is a ``ToolHandler`` registered by id with a ``ToolDefinition`` that states its
permission level, confirmation, identity and approval requirements as **data** (contract:
permissions and policies are recorded as data, never as model-generated text).

Executing a tool always goes through one use case (tools slice) that: checks RBAC → asks the
policy engine → requires an identity check when the rule says so (R1) → requests a
supervisor approval when over the analyst's abono limit (R7/R8) → calls the handler →
verifies the result → records a ``tool_call``. Automated tiers call the same use case with
their component as the actor, so they get exactly the same guard rails.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from cc_platform.domain.shared.actor import ActorRef
from cc_platform.domain.shared.json import JsonObject, JsonValue


class ToolKind(StrEnum):
    ACTION = "action"
    QUERY = "query"


class PermissionLevel(StrEnum):
    READ = "read"
    CONFIRM = "confirm"
    HUMAN_ONLY = "human_only"


class ToolCallStatus(StrEnum):
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout"
    DENIED = "denied"


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    tool_id: str
    version: str
    kind: ToolKind
    permission_level: PermissionLevel
    label: str
    """Spanish label shown in the Herramientas tab."""
    requires_customer_confirmation: bool = False
    identity_check_trigger: str | None = None
    """``abono`` | ``cambio_de_datos`` | ``canal_sin_identidad`` (identity_check.trigger)."""
    policy_rule_ids: tuple[str, ...] = ()
    params_schema: JsonObject = field(default_factory=dict)
    """JSON Schema of the parameters (also given to LLM agents as the tool signature)."""


@dataclass(frozen=True, slots=True)
class ToolInvocation:
    call_id: str
    case_id: str
    actor: ActorRef
    params: Mapping[str, JsonValue]
    approval_id: str | None = None
    confirmed_by: str | None = None


@dataclass(frozen=True, slots=True)
class ToolResult:
    status: ToolCallStatus
    verified: bool
    """True only when the handler confirmed the effect with the system of record (rule 9)."""
    data: JsonObject = field(default_factory=dict)
    state_change: JsonObject | None = None
    error_code: str | None = None


class ToolHandler(Protocol):
    @property
    def definition(self) -> ToolDefinition: ...

    async def execute(self, invocation: ToolInvocation) -> ToolResult:
        """Perform the action against the bank gateway. Guards already ran in the use case."""
        ...


class ToolRegistry(Protocol):
    def register(self, handler: ToolHandler) -> None: ...

    def get(self, tool_id: str) -> ToolHandler:
        """Raise ``NotFoundError`` for unknown tools."""
        ...

    def definitions(self) -> Sequence[ToolDefinition]: ...
