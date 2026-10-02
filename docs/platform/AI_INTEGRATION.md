# AI integration guide (v0.1)

How the AI team plugs automated components into the platform without touching its core.
Status: **ports declared, no AI connected**. Every case is handled by a person today; the
platform already records everything an automated tier will need (event log in the
`platform_history` shape).

- Architecture: `docs/platform/adr/0001-architecture.md`
- Copilot wire protocol (AG-UI 1.0): `docs/platform/adr/0002-ai-ui-frameworks.md`
- Data contract: `contracts/platform_history.json` · labels: `contracts/evaluation.json`
  (never available to runtime components)
- All ports are indexed in `backend/src/cc_platform/application/ports/ai.py`.

## Ground rules (apply to every extension point)

1. **Tools are the only way to act.** Automated tiers never write to the database or call the
   bank directly; they call the same execute-tool use case as analysts, with the same RBAC,
   policies, identity checks and approvals (brief §4.2).
2. **Only verified actions can be claimed** (rule 9): a message may say "bloqueé tu tarjeta"
   only when a verified `tool_call` backs it (`evidenceIds`).
3. **Hard limits** (synthetic policy): no automated tier decides an abono (rule 6), resolves a
   charge over 1.000.000 COP or equivalent, or keeps a case when the customer asks for a person
   (rule 10). Portuguese cases go to a Portuguese-speaking person (rule 3).
4. **Identify yourself.** Every automated actor is `component_id@component_version`; events
   carry it as `actor_id` with `actor_role` = `judge` | `tree` | `ai_agent` | `copilot`.
5. **No secrets, no raw PII.** Components receive masked customer data. Security-question
   answers are never exposed (the identity service validates them itself).

## Extension points

### 1. Routing tiers: `Responder` + `ResponderRegistry`

File: `application/routing/ports.py`. Pattern: Chain of Responsibility (judge → tree →
ai_agent → human), each tier a Strategy.

```python
class Responder(Protocol):
    @property
    def tier(self) -> Tier: ...                    # judge | tree | ai_agent | human | supervisor
    @property
    def component(self) -> ComponentRef: ...       # component_id + component_version
    async def respond(self, context: RoutingContext) -> RoutingDecision: ...
```

- `RoutingContext`: case id, pseudonymous customer ref, channel, language, origin, transcript,
  masked facts.
- `RoutingDecision`: `outcome` (`resolved` | `mitigated` | `handed_off` | `abstained`),
  `reason_code`, `policy_rule_id`, `confidence`, `inputs_used`, optional `topic` (judge
  taxonomy) and a structured `Handoff` (`verified_facts`, `actions_taken` = tool call ids,
  `open_questions`, `summary`).
- Each decision becomes a `routing_step` record. `abstained` passes the case to the next tier;
  the human tier always accepts.
- Planned for the routing slice: null judge/tree/ai_agent responders that abstain, so every
  case reaches a person.
- How to plug in: implement `Responder` in-process, or a `RemoteResponder` that POSTs the
  context to your HTTP service and parses a `RoutingDecision`; register it in the composition
  root (`bootstrap/container.py`). No other code changes.

### 2. Copilot: `CopilotEngine`

Files: `application/copilot/ports.py`, `application/copilot/events.py`. Pattern: Strategy.
Decision record: **ADR 0002** (`docs/platform/adr/0002-ai-ui-frameworks.md`).

```python
class CopilotEngine(Protocol):
    def run(self, context: CopilotRunContext) -> AsyncIterator[CopilotEvent]: ...
```

What ADR 0002 decided, and what it means for an engine author:

- **AG-UI 1.0 is the copilot wire contract.** The stream is an AG-UI event stream; we keep our
  own UI components (no chat-UI framework). The frontend consumes it with `@ag-ui/client`
  `HttpAgent`, wrapped inside `features/copilot`.
- **Engines emit application events, not SDK objects.** `CopilotEvent` subclasses in
  `application/copilot/events.py` carry a `type` equal to the AG-UI name. Only the API adapter
  imports `ag-ui-protocol` (pinned `~=1.0`) to encode them as SSE and validate them; domain and
  application never import it. A contract test will check every emitted event is valid AG-UI.
- Event classes that exist today (AG-UI name → class): `RUN_STARTED` `RunStarted`,
  `RUN_FINISHED` `RunFinished` (`outcome` = `{type: "success"}` or
  `{type: "interrupt", interrupts: [...]}`), `RUN_ERROR` `RunError`, `STEP_STARTED` /
  `STEP_FINISHED`, `TEXT_MESSAGE_START` / `_CONTENT` / `_END`, `ACTIVITY_SNAPSHOT`
  `ActivitySnapshot` (the answer table with its "Fuente" line, `activityType` =
  `answer_table`), `TOOL_CALL_START` / `_ARGS` / `_END` / `_RESULT`, `STATE_SNAPSHOT`,
  `STATE_DELTA`, `MESSAGES_SNAPSHOT`.
- Ordering rules (from the port docstring): a run starts with `RunStarted` and ends with
  `RunFinished` or `RunError`; text messages go start → content* → end.
- **Proposals pause the run.** A tool proposal is `TOOL_CALL_START/ARGS/END` followed by
  `RUN_FINISHED` with an interrupt (`reason: "tool_call"`); there is no separate "pause" event.
  When the analyst approves, the normal execute-tool use case runs (RBAC, policies, identity,
  approvals, rule 9); the panel then starts a resume run on the same `threadId` and the engine
  emits `TOOL_CALL_RESULT` built from the **verified** `tool_call` record. **Descartar** resumes
  with `status: "cancelled"`.
- **Endpoint (copilot slice):** `POST /api/v1/cases/{caseId}/copilot/runs` takes an AG-UI
  `RunAgentInput` and answers `text/event-stream`; `GET /api/v1/cases/{caseId}/copilot/thread`
  restores the panel. The run use case around the engine owns auth, audit
  (`copilot.question_asked`, `copilot.answered`, `copilot.tool_proposed` in the event log) and
  rule 9 checks; the SSE stream is a view, the event log is the record.
- **Stays off AG-UI:** the human chat with the customer, identity checks and supervisor
  approvals use REST plus the platform WebSocket (`/api/v1/ws`).
- Planned for the copilot slice: a deterministic `MockCopilotEngine` that answers from the
  customer read model, with sources.
- How to plug in: implement `CopilotEngine` in-process (e.g. a LangGraph graph adapted to
  `CopilotEvent`), or a `RemoteAgUiCopilotEngine` that POSTs `RunAgentInput` to an AG-UI
  endpoint (e.g. `ag-ui-langgraph`) and re-parses the events. The API stays the single front
  door, so the frontend does not change.

### 3. Tools: `ToolHandler` + `ToolRegistry`

File: `application/tools/ports.py`. Pattern: Command + Registry.

- `ToolDefinition` states, as data: `tool_id`, `version`, `kind` (action/query),
  `permission_level` (`read` | `confirm` | `human_only`), customer confirmation, identity
  check trigger (`abono` | `cambio_de_datos` | `canal_sin_identidad`), `policy_rule_ids`, and a
  JSON Schema of the parameters (usable as an LLM tool signature).
- `ToolHandler.execute(invocation) -> ToolResult` performs the effect against the bank gateway
  and reports `verified` only when the system of record confirmed it.
- The execute-tool use case runs the guards (RBAC → policy → identity → approval) **before**
  the handler and records a `tool_call` after it. Agents get exactly the same checks.

### 4. Self-improvement: `ComponentRegistry`

File: `application/automation/ports.py`.

- Every automated piece is a versioned `component` (`tool`, `suggestion_rule`, `tree_branch`,
  `judge`, `ai_agent`) with scope, allowed tools, origin signal, rollout percentage, stop
  conditions and an evaluation summary.
- Lifecycle: `register` (testing) → sandbox evaluation against historical cases →
  `activate(rollout_percent, approved_by)` (four-eyes applies) → automatic stop when a
  `StopCondition` trips → `retire`.
- Signals (`repeated_query`, `consistent_sequence`, `high_acceptance`, `drift`) are detected
  from the event log and feed proposals that become new component versions.

### 5. Learning and evaluation data: `EventExporter`

File: `application/audit/ports.py`.

- `export(ExportWindow) -> AsyncIterator[row]` yields the event log in the `platform_history`
  shape, filtered by `event_time`, with `customer_id` pseudonymised and personal data masked.
- **Filter by `event_time`, not `ingested_at`,** when building training or evaluation sets, to
  avoid leakage (contract principle).
- Today the raw log is available through `EventLogRepository.page(after, limit, case_id)`
  (cursor = ingestion sequence); the masked exporter arrives with the audit slice.

## Ports in code

Every Protocol below is declared in its context package and re-exported from
`backend/src/cc_platform/application/ports/ai.py`. Paths are relative to
`backend/src/cc_platform/application/`.

| Port | File | Methods | Value types |
|---|---|---|---|
| `Responder` | `routing/ports.py` | `tier`, `component` (properties), `async respond(context) -> RoutingDecision` | `Tier`, `RoutingOutcome`, `ComponentRef`, `RoutingContext`, `RoutingDecision`, `Handoff` |
| `ResponderRegistry` | `routing/ports.py` | `register(responder)`, `chain() -> Sequence[Responder]` | |
| `CopilotEngine` | `copilot/ports.py` | `run(context) -> AsyncIterator[CopilotEvent]` | `CopilotRunContext`, `CopilotEvent` and subclasses (`copilot/events.py`) |
| `ToolHandler` | `tools/ports.py` | `definition` (property), `async execute(invocation) -> ToolResult` | `ToolDefinition`, `ToolInvocation`, `ToolResult`, `ToolKind`, `PermissionLevel`, `ToolCallStatus` |
| `ToolRegistry` | `tools/ports.py` | `register(handler)`, `get(tool_id)`, `definitions()` | |
| `ComponentRegistry` | `automation/ports.py` | `async register`, `get`, `active_versions`, `activate`, `retire` | `ComponentVersion`, `ComponentKind`, `ComponentStatus`, `StopCondition` |
| `EventExporter` | `audit/ports.py` | `export(window) -> AsyncIterator[JsonObject]` | `ExportWindow` |
| `EventLogRepository` (raw log, implemented) | `ports/event_log.py` | `async page(after=, limit=, case_id=, entity_id=)` | |

## What exists today (slice 0)

| Piece | State |
|---|---|
| Event log table + Unit of Work that appends events atomically | implemented |
| In-process event bus + realtime projection to WebSocket topics | implemented |
| Actor model (`actor_role`, `actor_id`) shared by people and components | implemented |
| `Responder`, `CopilotEngine` (+ AG-UI event types), `ToolHandler`/`ToolRegistry`, `ComponentRegistry`, `EventExporter` | Protocols declared, no implementation |
| Null responders, mock copilot, tool catalog, components registry, masked exporter | next slices |

## Checklist for a new automated component

1. Pick the port and implement it (in-process class or remote adapter).
2. Give it a `component_id` and `component_version`; register it in the `ComponentRegistry`
   in `testing`.
3. Use only tools from `tools_allowed`; never claim an action without a verified tool call.
4. Run the sandbox evaluation on exported history (filter by `event_time`).
5. Ask for activation with a rollout percentage and stop conditions (four-eyes).
6. Wire it in `bootstrap/container.py`. Nothing else in the core changes.
