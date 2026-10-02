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

### 1. Routing tiers: `Responder` + `ResponderRegistry` (implemented in slice 1)

Files: `application/routing/ports.py` (port), `application/routing/route_case.py` (the chain),
`infrastructure/routing/` (registry + null responders), wired in `bootstrap/container.py`.
Pattern: Chain of Responsibility (judge → tree → ai_agent → human), each automated tier a
Strategy behind the `Responder` port; the human tier is the terminal handler.

```python
class Responder(Protocol):
    @property
    def tier(self) -> Tier: ...                    # judge | tree | ai_agent
    @property
    def component(self) -> ComponentRef: ...       # component_id + component_version
    async def respond(self, context: RoutingContext) -> RoutingDecision: ...
```

How a case is routed today (no AI connected):

1. The customer's first message opens the case (`routing`) and the customer gets a
   "Recibimos tu mensaje" notice. The POST never waits for routing.
2. `RoutingProcessManager` (bus subscriber on `case.opened`) runs `RouteCase` in the
   background. Cases left in `routing` by a crash are re-routed at startup (`RecoverRouting`).
3. `RouteCase` builds a `RoutingContext` and calls every responder of
   `ResponderRegistry.chain()` in order, **outside** any database transaction (a responder may
   call a remote model). The chain stops at the first decision that is not `abstained`.
4. In one Unit of Work it records **every** decision as a `routing_step` row plus a
   `routing_step.recorded` event (contract `routing_step`: tier, component id/version,
   outcome, reason_code, policy_rule_id, confidence, inputs_used, handoff), then runs the
   human tier.
5. Human tier (`HumanTier`, Strategy `AssignmentPolicy`, today `LanguageLeastLoadedPolicy`):
   only analysts who are **available**, rule 3 (a Portuguese case goes only to a
   Portuguese speaker, `policy_rule_id = H1`), then fewest open cases, then longest since
   their last assignment. It records an `Assignment` and `case.assigned`, plus a staff-only
   `routing` turn explaining it. Nobody eligible → `case.queued` ("Cola de disputas" /
   "Cola de disputas en portugués"); `DrainQueue` assigns queued cases when an analyst
   becomes available and at startup.

The three registered responders are `NullJudge`, `NullTree`, `NullAiAgent`
(`null_judge@0.1.0`, `null_tree@0.1.0`, `null_ai_agent@0.1.0`): each returns
`RoutingDecision(outcome=abstained, reason_code="component_not_connected", inputs_used=())`,
so every case reaches a person while the full chain is already in the event log and in the
analyst's "Cómo llegó a ti".

What a responder receives and returns:

- `RoutingContext`: `case_id`, `customer_ref` (pseudonymous customer id), `channel`,
  `language`, `origin`, `transcript` (customer-visible **message** turns only, as
  `{sequence, author_role, text}`), `facts` (empty today; masked facts arrive with the
  customer file).
- `RoutingDecision`: `outcome` (`resolved` | `mitigated` | `handed_off` | `abstained`),
  `tier`, `component`, `reason_code`, `policy_rule_id`, `confidence` (0–1), `inputs_used`
  (source names: `customers`, `transactions`, `complaints`, `interactions`, `products`,
  `digital_events`, `turn`), optional `topic` (judge taxonomy), optional `component_name`
  (display name for "Cómo llegó a ti", e.g. "Agente de disputas") and a structured `Handoff`
  (`request`, `verified_facts`, `actions_taken` = verified tool call ids, `evidence`,
  `open_questions`, `summary`). The `summary` is the Spanish line the analyst reads.
- A responder that raises is recorded as `abstained` with `reason_code = component_error`
  and the case continues down the chain (a broken component never blocks a customer).

Not wired yet (later slices): applying the judge's `topic`/priority to the case
(`case.classified`; live cases show "Sin clasificar"), a `resolved` outcome closing the case
(today any non-abstained outcome stops the chain and the case still goes to a person),
automated tiers writing turns (they will go through the turn/tool use cases), and a human
`routing_step` at close.

How to plug in: implement `Responder` in-process, or a `RemoteResponder` that POSTs the
context to your HTTP service and parses a `RoutingDecision`; register it for its tier in
`bootstrap/container.py` (`responders.register(...)` replaces the null one). No other code
changes. The assignment strategy is also replaceable (`AssignmentPolicy`, e.g. skills or a
capacity cap).

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
| `AssignmentPolicy` (human tier) | `routing/assignment.py` | `choose(request, candidates) -> AssignmentChoice \| None` | `AssignmentRequest`, `AnalystCandidate`, `AnalystDirectory` |
| `CopilotEngine` | `copilot/ports.py` | `run(context) -> AsyncIterator[CopilotEvent]` | `CopilotRunContext`, `CopilotEvent` and subclasses (`copilot/events.py`) |
| `ToolHandler` | `tools/ports.py` | `definition` (property), `async execute(invocation) -> ToolResult` | `ToolDefinition`, `ToolInvocation`, `ToolResult`, `ToolKind`, `PermissionLevel`, `ToolCallStatus` |
| `ToolRegistry` | `tools/ports.py` | `register(handler)`, `get(tool_id)`, `definitions()` | |
| `ComponentRegistry` | `automation/ports.py` | `async register`, `get`, `active_versions`, `activate`, `retire` | `ComponentVersion`, `ComponentKind`, `ComponentStatus`, `StopCondition` |
| `EventExporter` | `audit/ports.py` | `export(window) -> AsyncIterator[JsonObject]` | `ExportWindow` |
| `EventLogRepository` (raw log, implemented) | `ports/event_log.py` | `async page(after=, limit=, case_id=, entity_id=)` | |

## What exists today (slice 1)

| Piece | State |
|---|---|
| Event log table + Unit of Work that appends events atomically (in recording order) | implemented |
| In-process event bus + realtime projection to WebSocket topics | implemented |
| Actor model (`actor_role`, `actor_id`) shared by people and components | implemented |
| Routing chain: `ResponderRegistry`, null judge/tree/agent, `RouteCase`, human tier (`LanguageLeastLoadedPolicy`), queue + drain, `routing_step` rows and events | implemented |
| Cases, turns (`turn.created` with `author_role`/`author_id`), assignments, `case_close` events | implemented |
| `CopilotEngine` (+ AG-UI event types), `ToolHandler`/`ToolRegistry`, `ComponentRegistry`, `EventExporter` | Protocols declared, no implementation |
| Mock copilot, tool catalog, components registry, masked exporter, judge classification | next slices |

## Checklist for a new automated component

1. Pick the port and implement it (in-process class or remote adapter).
2. Give it a `component_id` and `component_version`; register it in the `ComponentRegistry`
   in `testing`.
3. Use only tools from `tools_allowed`; never claim an action without a verified tool call.
4. Run the sandbox evaluation on exported history (filter by `event_time`).
5. Ask for activation with a rollout percentage and stop conditions (four-eyes).
6. Wire it in `bootstrap/container.py`. Nothing else in the core changes.
