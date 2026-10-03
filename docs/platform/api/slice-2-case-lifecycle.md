# Slice 2 contract · scope cut and case lifecycle

**Status:** implemented and integrated (2026-10-03). Integration notes in §12.
**Date:** 2026-10-03.

**Scope.** The user decided on 2026-10-03 that the platform is **only** a chat support platform between staff and customers, end to end. This slice has two parts:

1. **Removes** everything that belonged to the old scope: AI, routing tiers, copilot, tools, customer file, identity, approvals, automation, calls, email, and the extra statuses.
2. **Completes the case lifecycle:**
   - four inbox statuses, with the counters as the filters;
   - close with a required reason;
   - a new linked case when the customer writes after a close;
   - the customer's case history;
   - a first-response SLA;
   - a customer simulator that shows past conversations.

Read first:
- `../ENGINEERING_BRIEF.md` (it wins over this file);
- `../adr/0001-architecture.md`;
- `slice-1-cases.md`. Everything there that this file does not change still holds: idempotent messages, sequence and gap rules, dedupe, reconnect, the customer token, search, unread counts, availability.

Extend the slice 0/1 foundations (UoW + event log, `retry_on_conflict`, the `ProblemCode` registry, `CaseRealtimeProjector`/`TopicMapper`, `RealtimeClient`, the handler registry, `Schemas[...]`). Never fork them.

**Conventions** (same as slice 1):
- JSON is camelCase; Python is snake_case.
- `datetime` = ISO-8601 UTC with `Z`.
- `T | null` = the member is always present and may be null.
- Names in **bold** are Pydantic class names, which the frontend reads as `Schemas['…']`.
- "Team-generated" marks a synthetic value we chose (not from the dataset). It is named as such in code comments.

---

## 0. Parallel-work protocol

1. **Backend, first milestone (before any logic):**
   - change the enums and schemas of §2, §5 and §6;
   - add the new routes with their final signatures (they may raise `NotImplementedError`);
   - drop the removed members;
   - run `uv run python -m cc_platform.scripts.export_openapi`.

   From then on `backend/openapi.json` is the contract. Tell the frontend agent when it lands.
2. **Frontend:** run `pnpm gen:api` as soon as the new `openapi.json` exists, and again whenever it changes. Until then, start with the pure removals of §1.2 and with `model.ts` work against the names in this file. Never hand-edit `schema.gen.ts`. Tests mock each feature's `api.ts`.
3. **Frozen for the slice:** the field names, enum values, slugs, topic names, envelope types, query keys and public exports below. A change needs this file updated first.
4. **Data reset:** the SQLite schema changes and there are no migrations. Delete `backend/cc_platform.db`, or run with `CC_PERSISTENCE=memory`, after pulling this slice. Say so in `backend/README.md`.

---

## 1. Removal list (what goes, and what replaces it)

The paths are relative to `backend/src/cc_platform/`, `backend/tests/` and `frontend/src/`. "Delete" means delete the file and every import of it. A symbol in a kept file is removed with its tests.

### 1.1 Backend

| # | Path · symbols | Action | Replaced by |
|---|---|---|---|
| B1 | `application/ports/ai.py` (the index of AI ports) | Delete | Nothing. |
| B2 | `application/copilot/` (`events.py`: `CopilotEvent` and the AG-UI event dataclasses; `ports.py`: `CopilotEngine`, `CopilotRunContext`) | Delete the package | Nothing. |
| B3 | `application/tools/` (`ports.py`: `ToolKind`, `PermissionLevel`, `ToolCallStatus`, `ToolDefinition`, `ToolInvocation`, `ToolResult`, `ToolHandler`, `ToolRegistry`) | Delete the package | Nothing. |
| B4 | `application/automation/` (`ports.py`: `ComponentKind`, `ComponentStatus`, `StopCondition`, `ComponentVersion`, `ComponentRegistry`) | Delete the package | Nothing. |
| B5 | `application/audit/ports.py` (`EventExporter`, `ExportWindow`) | Delete the file. Keep `application/audit/__init__.py` as the empty audit context for slice 3. | Slice 3 audit queries. |
| B6 | `application/routing/ports.py` (`Responder`, `ResponderRegistry`, `RoutingContext`, `RoutingDecision`, the re-exports of `Tier`/`RoutingOutcome`/`ComponentRef`/`Handoff`) | Delete | Nothing (no tiers). |
| B7 | `application/routing/route_case.py`: `RouteCase` (chain), `HumanTier`, `DrainQueue`, `RecoverRouting`, `REASON_NOT_CONNECTED`, `REASON_COMPONENT_ERROR`, `_step`, `_Decided` | Delete the file | **`AssignCase`** + **`DrainQueue`** in `application/cases/assignment.py` (§3). `RecoverRouting` disappears: there is no `routing` status to recover, and the queue drains on availability. |
| B8 | `application/routing/assignment.py`: `AssignmentPolicy`, `LanguageLeastLoadedPolicy`, `AssignmentRequest`, `AssignmentChoice`, `AnalystCandidate`, `AnalystDirectory`, `RepositoryAnalystDirectory`, `language_rule`, `RULE_REGULATOR_FOLLOWUP` | Move into `application/cases/assignment.py`. Rename `AssignmentPolicy` → **`AssignmentStrategy`** and `LanguageLeastLoadedPolicy` → **`LanguageLeastLoadedStrategy`** (`strategy = "language_least_loaded@1"`, unchanged). `AssignmentRequest` loses `origin`. Delete `RULE_REGULATOR_FOLLOWUP` (`A2`). | Same behaviour (rule 3, least loaded). |
| B9 | `application/routing/process_manager.py`: `RoutingProcessManager`, `SUBSCRIBED_EVENTS` (`case.opened` → route) | Delete | **`QueueDrainer`** (`application/cases/assignment.py`). It subscribes only to `staff.availability_changed` with `to_status = available` and spawns `DrainQueue` through `BackgroundTasks`. |
| B10 | `application/routing/repositories.py` (`RoutingStepRepository`); `application/routing/__init__.py` | Delete the `routing` package | Nothing. |
| B11 | `domain/routing/` (`values.py`: `Tier`, `RoutingOutcome`, `RouteStopKind`, `ComponentRef`, `Handoff`; `routing_step.py`: `RoutingStep`; `events.py`: `RoutingStepRecorded`) | Delete the package | Nothing. "Cómo llegó a ti" is built from the `Assignment` (§4.6). |
| B12 | `infrastructure/routing/` (`null_responders.py`: `NullResponder`, `null_judge/tree/ai_agent`; `registry.py`: `InMemoryResponderRegistry`, `ROUTING_ORDER`) | Delete the package | Nothing. |
| B13 | Persistence: `routing_steps` table (`sqlalchemy/tables.py`); `InMemoryRoutingStepRepository` and `store.routing_steps` (memory); the SQL routing-step repository; `UnitOfWork.routing_steps` (`application/ports/unit_of_work.py`) | Delete | Nothing. |
| B14 | `bootstrap/container.py`: the responder registry, `null_*` registration, `HumanTier`, `RouteCase`, `RoutingProcessManager`, `recover_routing` / `RecoverRouting` and its startup call | Delete | Wire `LanguageLeastLoadedStrategy`, `RepositoryAnalystDirectory`, `AssignCase`, `DrainQueue` and `QueueDrainer`. Startup runs **no** drain (see §8.3). |
| B15 | `domain/cases/values.py`: `CaseChannel.PHONE/EMAIL` and `is_chat`; `ChannelSessionKind` (all); `CaseOrigin` (all, incl. `is_outbound`); `CaseTopic` (all); `CaseStatus.ROUTING/IN_CALL/TO_CALL/AWAITING_APPROVAL`; `InboxStatus.LIVE/TO_CALL`; `TurnAuthorRole.TREE/JUDGE/AI_AGENT/COPILOT` and `is_bot`; `AssignmentReason.OUTBOUND_FOLLOWUP`; `ContactReason`, `ResolutionCode`, `FollowUp`; `CustomerTurnAuthor.BOT` | Remove | The final enums of §2.1. Also add `InboxStatus.CLOSED` and `CloseReason`. |
| B16 | `domain/cases/case.py`: fields `channel_session`, `origin`, `topic`, `queue_summary`, `entry_label`, `entry_summary`, `live_since`; methods `require_callback` (`to_call`), `start_call` (`in_call`); `CaseClosure.resolved/contact_reason/resolution_code/followup_at/csat_requested` | Remove | Case fields and methods of §2.2. `CaseClosure` becomes `{closed_at, closed_by_id, closed_by_role, reason, note}`. |
| B17 | `domain/cases/turn.py` / `Turn`: `evidence_ids`, `from_suggestion_id` (rule 9 / copilot seams); `TurnCreated.evidence_ids/from_suggestion_id` | Remove | Nothing. |
| B18 | `domain/cases/events.py`: the `CaseOpened` fields `channel_session/origin/topic`; the `CaseClosed` contract `case_close` payload | Change | Events of §2.4. |
| B19 | `application/cases/sla.py` `SyntheticSlaPolicy`: `email`, `outbound` targets and the `origin` parameter | Remove | First-response SLA (§4.5). |
| B20 | `application/cases/read_model.py`: `route_summary`, `RouteStopView` usage; `inbox_order` live-call branch; the `_INBOX_STATUS` entries for `in_call`/`to_call`/`awaiting_approval`; `_author_names` bot/component lookup via routing steps; `profile_of` (segment, customer since, document type) | Remove / rewrite | §4.1 `inbox_status`, §4.2 order, `customer_of` (§5.2 **`CaseCustomer`**). |
| B21 | `application/cases/dto.py`: `RouteStopView`, `RoutingSummaryView`, `ChannelIdentityView`, `CustomerProfileView` (→ `CaseCustomerView`); `ReplyBlockedReason.CHANNEL_NOT_SUPPORTED`; `CaseSummaryView.origin/topic/live_since`; `TurnView.evidence_ids/from_suggestion_id`; `CloseCaseCommand` fields | Remove / change | §5.2 schemas. |
| B22 | `application/cases/commands.py`: `ChannelNotSupportedError` check in `PostAnalystTurn`; `FOLLOW_UP_DELAY`, `_followup_at`; close from `in_call`/`to_call` | Remove | §4.4 close rules. |
| B23 | `domain/cases/errors.py` `ChannelNotSupportedError`; `api/problems.py` `ProblemCode.CHANNEL_NOT_SUPPORTED` | Remove | Nothing (every case is a chat). |
| B24 | `application/cases/copy.py`: `assigned_after_null_chain`, `assigned_after_chain`, queue labels "Cola de disputas…" | Rewrite | §3.3 texts. |
| B25 | `api/schemas/cases.py`: `RouteStop`, `RoutingSummary`, `ChannelIdentity`, `CustomerProfile`; `CaseDetail.routing/channelIdentity/customer`; `CaseSummary.origin/topic/liveSince`; `InboxCounts.live/toCall`; `Turn.evidenceIds/fromSuggestionId`; `CloseCaseRequest` (old shape); `CaseClosure` (old shape) | Remove / change | §5.2. |
| B26 | `api/schemas/customer.py`: `DemoCustomer.segment`; `CreateCustomerSessionRequest` "open case is not a chat" 404 branch | Remove | §6. |
| B27 | `domain/customers/customer.py`: `CustomerSegment`, `segment`, `customer_since`, `document_type` (customer file data) | Remove (also the table columns and seed values) | `Customer {id, display_name, country, city, locale, simulator, suggestions}` (language from the locale). |
| B28 | `domain/people/staff.py`: `StaffRole.AUTOMATION`, `ROLE_PRECEDENCE` automation entry, `StaffLevel` (only drove abono limits), `Staff.level`, `Staff.requires_four_eyes` | Remove (also `staff.level` column, `StaffView.level/requires_four_eyes`, `StaffOut.level/requiresFourEyes`, the `domain/people/__init__` exports) | Roles `analyst`, `supervisor`, `admin`. `ROLE_PRECEDENCE = (ANALYST, SUPERVISOR, ADMIN)`. |
| B29 | `domain/shared/actor.py` `ActorRole.AUTOMATION/JUDGE/TREE/AI_AGENT/COPILOT` | Remove | `ActorRole`: `analyst`, `supervisor`, `admin`, `customer`, `system`. |
| B30 | `domain/shared/ids.py` `IdPrefix.TOOL_CALL (CALL)`, `APPROVAL (APR)`, `IDENTITY_CHECK (IDC)`, `ROUTING_STEP (RST)`, `COPILOT_QUERY (CPQ)`, `COPILOT_THREAD (CPT)`, `SUGGESTION (SUG)`, `SIGNAL (SIG)`, `COMPONENT (CMP)` | Remove | Nothing. |
| B31 | `application/realtime/topics.py` `TopicKind.APPROVALS`, `Topic.approvals()`, the approvals branch of `TopicAccessPolicy`; docstrings that mention tool calls and approvals | Remove | Topics `case:`, `inbox:`, `customer:`. Slice 3 adds supervision topics. |
| B32 | `infrastructure/seed/cases.py`: stories 101–107 as written (bot/tree turns, `ComponentRef`s `judge.entrada@ejemplo`, `tree.disputas@ejemplo`, `agent.disputas@ejemplo`, `COMPONENT_NAMES`, `_Story.step`, `_Story.bot`, phone/email/regulator stories 104–106) | Rewrite | Chat-only seed of §8. |
| B33 | `infrastructure/seed/people.py`: `AU`, `TEAM_AUTOMATION`, the roles of Valeria (AU+AD), Tomás (AU), Renata (S+AU); `StaffLevel` values; the docstring on four-eyes and canvas note `au3` | Change | Staff seed of §8.1. |
| B34 | Tests | Delete: `tests/unit/application/test_routing.py`. Rewrite: `test_assignment.py` (strategy + `AssignCase` + `DrainQueue`); `test_read_model.py`; `test_case.py` (no `start_call`/`require_callback`); `test_cases_use_cases.py`; `test_seed_cases.py`; `test_people.py` (no four-eyes/automation); `test_auth_use_cases.py`, `test_auth_api.py`, `test_people_api.py`, `tests/support.py` (`AUTOMATION_ADMIN` → `ADMIN_ONLY` Valeria; `SUPERVISOR_AUTOMATION` → `SECOND_SUPERVISOR` Renata); every test that posts `phone`/`email`, reads `routing`, `liveSince`, `evidenceIds` or the old close body. | §10. |
| B35 | Docstrings that cite `AI_INTEGRATION.md`, ADR 0002, the AI team, rules 1/2/5–11, abonos, tool calls or approvals (`bootstrap/container.py`, `application/cases/*`, `domain/cases/*`, `domain/customers/customer.py`, `application/realtime/topics.py`, `domain/shared/aggregate.py`) | Rewrite | Text that matches this scope. |
| B36 | `backend/README.md`: the seed accounts table (levels, automation roles, four-eyes) and the "Datos de ejemplo" section | Update | §8. Add the "delete `cc_platform.db`" note. |

### 1.2 Frontend

| # | Path · symbols | Action | Replaced by |
|---|---|---|---|
| F1 | `features/workspace/components/SupportPanel.tsx`, `CopilotPlaceholder.tsx`, `ToolsPlaceholder.tsx`, `ClientPlaceholder.tsx` | Delete | Nothing. The conversation takes the width (§9.2). |
| F2 | `features/workspace/model.ts`: `SupportPanelTab`, `SUPPORT_PANEL_TABS`, `DEFAULT_PANEL_TAB`, `isPanelTab`, `WorkspaceUrlState.panelTab/panelCollapsed`, the `panel`/`apoyo` URL params, `CustomerHeaderSource`, `formatMonthYear`, `customerHeaderLine`, `customerHeaderId`; `emptyWorkspaceCopy` text "Cuando un agente escale un contacto…" | Remove / change | `WorkspaceUrlState.history` (`?historial=`) and new empty copy (§9.2). `features/workspace/index.ts` stops exporting `SupportPanelTab`. |
| F3 | `features/conversation/components/CallBar.tsx`, `CallTranscript.tsx`, `EmailThread.tsx`, `RoutingSummary.tsx` (+ `RoutingSummary.test.tsx`) | Delete | `ArrivalNote` (one line, §9.3) and `CaseHistorySheet` (§9.4). |
| F4 | `features/conversation/model.ts`: `ConversationLayout`, `conversationLayout`, `CallBarState`, `callBarState`, `callOffset`, `emailSnippet`, `routeLine`, `RouteStepView`, `routeSteps`, `inputsSentence`, input-name copy, `CONTACT_REASON_OPTIONS`, `FOLLOW_UP_OPTIONS`, `RESOLUTION_OPTIONS`, the old `CloseCaseForm`/`INITIAL_CLOSE_FORM`/`validateCloseForm`/`toCloseRequest`; `TranscriptVariant 'bot'` and its author copy; `REPLY_BLOCKED_COPY.channel_not_supported` | Remove / rewrite | `arrivalLine`, `closureLine`, the new close form (§9.5), `historyItemLine`. `formatWait` and `joinSpanish` stay if still used. |
| F5 | `features/conversation/index.ts`: `RoutingSummary`, `RoutingSummaryProps`, `RouteStop`, `RoutingSummaryData`, `CustomerProfile` type exports | Remove | §9.7 public API. |
| F6 | `features/conversation/components/ConversationPane.tsx`: layout switch (call/email), `CallBar`, `startedAt={summary.liveSince}`; `CaseHeader.tsx`: `topicLabel` | Change | One chat layout; header of §9.3. |
| F7 | `features/conversation/components/CloseCaseDialog.tsx` (Resultado, Motivo del contacto, Seguimiento, Qué se hizo, CSAT checkbox) | Rewrite | Close dialog of §9.5. |
| F8 | `features/cases/model.ts`: `INBOX_FILTERS` (En curso, Por llamar, En espera), `COUNT_FIELD.live/toCall`, the `inboxStatusMeta` cases `live`/`to_call`/`awaiting_approval`, `CHANNEL_LABELS`/`CHANNEL_PHRASES` `phone`/`email`, `TOPIC_LABELS`, `topicLabel`, `caseCardLine` topic part, the `in_call` branch of `formatSla`, `SLA_AT_RISK_MS = 15 min` | Remove / change | §9.1. |
| F9 | `features/cases/components/tone-classes.ts` `callout` entry; `CaseCard.tsx` (topic, live timer); `CaseListPanel.tsx` (six tiles) | Change | Five tiles, new card (§9.1). |
| F10 | `components/ui/tones.ts` `Tone 'callout'` (all maps); `styles/index.css` `--color-callout*` tokens; `--color-agent` (bot bubbles) | Remove if nothing else uses them after F8/F9 (`grep` first) | New tone **`closed`** (§9.1), built on the existing `--color-offline` / `--color-muted` tokens (no new color). |
| F11 | `routes/automation/*` (`panorama`, `tree`, `agents`, `agent-detail`, `proposal`, `sandbox`, `activate`) | Delete | Nothing. |
| F12 | `routes/supervision/approvals.tsx`; `routes/admin/tools.tsx`, `rules.tsx`, `retention.tsx` | Delete | Nothing. |
| F13 | `app/router.tsx`: the `automation` section; `aprobaciones`, `herramientas`, `reglas`, `retencion` routes | Remove | Routes of §9.8. |
| F14 | `app/roles.ts`: `RoleId 'automation'`, `ROLES.automation`, the `ROLE_ORDER` entry, nav items "Por aprobar", "Herramientas y permisos", "Políticas y reglas", "Retención de datos", the icons `Bot`, `GitBranch`, `LayoutDashboard`, `SquareCheckBig`, `Wrench`, `Scale`, `Archive`; `RailIndicatorKey` `pendingApprovals`, `pendingAdminChanges`, `automationNews` | Remove | `RoleId = 'analyst' \| 'supervisor' \| 'admin'`. `RailIndicatorKey = 'queuedCases'` (reserved for slice 3; nobody feeds it yet). |
| F15 | `app/session.tsx`: `staff.level` in the user summary | Remove | "{team} · {languages}". |
| F16 | `lib/realtime/types.ts`: `KnownRealtimeEventType` `identity_check.updated`, `tool_call.completed`, `approval.updated`, `copilot.message`; topic `'approvals'`, `topics.approvals` | Remove | Event types of §7. |
| F17 | `features/customer-chat`: author `'bot'` and "Asistente automático"; `DemoCustomer.segment` in `DemoCustomerPicker` | Remove | §9.6. |
| F18 | Placeholder copy that mentions removed scope: `routes/admin/users.tsx` subtitle "Personas, roles y límites de abono" and the four-eyes sentence; `routes/supervision/audit.tsx` "con qué herramienta", "personas y agentes"; `routes/supervision/team.tsx` stays | Change | Users: "Personas, roles, idiomas y equipos" / "Llega en una próxima entrega." Audit: "Quién hizo qué, en qué caso y cuándo". |
| F19 | Tests and fixtures: `test/fixtures.ts`, `test/case-fixtures.ts`, `test/conversation-fixtures.ts`, `routes/analyst/workspace.test.tsx`, `app/guards.test.tsx` (Políticas y reglas, Panorama), `components/layout/Rail.test.tsx`, `RoleSwitcher.test.tsx`, `app/roles.test.ts`, `routes/auth/auth.test.tsx`, `ConversationPane.test.tsx`, `features/*/model.test.ts`, `realtime*.test.ts` | Update | New shapes. Keep coverage. |
| F20 | `frontend/ARCHITECTURE.md` (route table rows `/automatizacion…`, the AG-UI/copilot note in the realtime section, the role order); `frontend/README.md` line 4 ("automatización") | Update | Three roles; no copilot. |

### 1.3 Docs (done by the tech lead in this change)

- `docs/platform/AI_INTEGRATION.md` is deleted, and every link to it is fixed.
- `adr/0002-ai-ui-frameworks.md` is marked superseded.
- `adr/0001-architecture.md` is amended.
- `ENGINEERING_BRIEF.md` is rewritten.
- `slice-1-cases.md` is marked partly superseded.

**Done check.** After §1.1 and §1.2, this search returns nothing outside `docs/` and the generated OpenAPI:

```
grep -rniE "copilot|copiloto|responder|routing_step|RoutingStep|ToolRegistry|ToolHandler|ComponentRegistry|EventExporter|four.?eyes|requiresFourEyes|automation|automatizaci|in_call|to_call|awaiting_approval|liveSince|live_since|channel_not_supported|null_judge|ai_agent|ag-ui|AG-UI|aprende" backend/src backend/tests frontend/src | grep -viE "por[ -]responder|vai te responder" | grep -v "backend/tests/test_architecture.py"
```

(`schema.gen.ts` and `openapi.json` are regenerated, so they pass too. The filters keep text this slice requires: `responder` alone is meant to catch the removed `Responder` chain.
- the status label "Por responder" and its slug `por-responder`;
- the pt opened notice of §3.3 ("…vai te responder.");
- `backend/tests/test_architecture.py`, which names the deleted packages on purpose to check that they stay deleted (§10).)

---

## 2. Domain after the cut

### 2.1 Enums (final values; OpenAPI enum names in parentheses)

| Enum | Values | Notes |
|---|---|---|
| `CaseChannel` | `app_chat`, `web_chat` | Every case is a chat. |
| `Language` | `es`, `pt` | |
| `CasePriority` | `low`, `medium`, `high` | Live cases: `medium`. Seeds may vary. Drives the SLA target. |
| `CaseStatus` | `queued`, `assigned`, `in_progress`, `closed` | Stored state machine, §2.3. |
| `InboxStatus` | `new`, `to_reply`, `waiting`, `closed` | Derived, never stored (§4.1). |
| `TurnAuthorRole` | `customer`, `analyst`, `system` | |
| `TurnKind` | `message`, `routing`, `notice` | `routing` = a **staff-only assignment banner** (value kept from slice 1); `notice` = a platform note. |
| `TurnAudience` | `everyone`, `staff` | |
| `AssignmentReason` | `language_least_loaded`, `queue_drained` | Slice 3 adds `manual`. |
| `AvailabilityStatus` | `available`, `paused` | Unchanged. |
| **`CloseReason`** (new) | `resolved`, `customer_unresponsive`, `duplicate`, `out_of_scope`, `other` | Team-generated list. Labels in §4.4. |
| `ReplyBlockedReason` | `not_assignee`, `closed` | |
| `CustomerConversationStatus` | `waiting_agent`, `with_agent`, `closed` | `queued` → `waiting_agent`; `assigned`/`in_progress` → `with_agent`. |
| `CustomerTurnAuthor` | `customer`, `analyst`, `system` | |
| `CountryCode` | `CO`, `MX`, `AR`, `BR` | |
| `CustomerLocale` | `es-CO`, `es-MX`, `es-AR`, `pt-BR` | |
| `StaffRole` | `analyst`, `supervisor`, `admin` | |
| `ActorRole` | `analyst`, `supervisor`, `admin`, `customer`, `system` | |

Removed enums: `CaseOrigin`, `CaseTopic`, `ChannelSessionKind`, `Tier`, `RoutingOutcome`, `RouteStopKind`, `ContactReason`, `ResolutionCode`, `FollowUp`, `CustomerSegment`, `StaffLevel`.

### 2.2 `Case` (aggregate, `cases`)

| Field | Type | Notes |
|---|---|---|
| `id` | `CASE-…` | |
| `customer_id` | `CUS-…` | |
| `channel` | `CaseChannel` | From the customer session. |
| `language` | `Language` | From the customer's locale. |
| `priority` | `CasePriority` | |
| `status` | `CaseStatus` | |
| `opened_at` | datetime | The first customer message. |
| `sla_due_at` | datetime | **First-response due time** = `opened_at` + target (§4.5). |
| `first_response_at` | datetime \| None | **New.** Set by the first `analyst` message. Never changes after that. |
| `assigned_analyst_id`, `assigned_at` | | Unchanged. |
| `queued_at`, `queue_label` | | `queued_at` = `opened_at`. `queue_label` from the language (§3.3). |
| `previous_case_id` | `CASE-… \| None` | **New.** The customer's most recent closed case when this one opened (§4.6). |
| `last_sequence`, `last_public_sequence`, `last_message_*`, `last_turn_*`, `assignee_read_sequence`, `unread_sequences`, `search_text` | | Unchanged. |
| `closure` | `CaseClosure \| None` | `{closed_at, closed_by_id, closed_by_role, reason: CloseReason, note: str \| None}`. |

Behaviour:
- `Case.open(...)` creates the case in **`queued`** and records `case.opened`. In the same Unit of Work, `AssignCase` either assigns it or leaves it queued (§3.1).
- `mark_waiting_in_queue(reason_code, policy_rule_id, at)` records `case.queued` (no transition: the status is already `queued`). It is called only when nobody is eligible.
- `assign(assignment)`: `queued → assigned`.
- `mark_read(...)` and `start_progress(...)`: `assigned → in_progress` (unchanged).
- `append_turn(...)` (unchanged). An `analyst` `message` with `first_response_at is None` sets `first_response_at` and records `case.first_responded`.
- `close(actor, at, reason, note)`: `assigned | in_progress → closed`.

The `Assignment` entity is unchanged, except `policy_rule_id` (now only `H1`) and a new `waited_seconds: int | None` (queue wait, for `queue_drained`). `CustomerCaseSlot` and `AnalystAvailability` are unchanged.

### 2.3 `CaseStatus` state machine

```
   customer's first message (no open case)
                 │  Case.open + AssignCase, one Unit of Work
                 ▼
           ┌──────────┐  eligible analyst (same UoW, or later DrainQueue)  ┌──────────┐
           │  queued  │ ─────────────────────────────────────────────────▶ │ assigned │
           └──────────┘                                                    └──────────┘
                 ▲ (slice 3: a supervisor assigns by hand)                        │ assignee opens (read) or replies
                 │                                                                ▼
                                                                          ┌─────────────┐
                                                                          │ in_progress │
                                                                          └─────────────┘
   close (assignee): assigned | in_progress ──▶ closed   (terminal; the next customer message opens a NEW case)
```

| From → To | Trigger (use case) | Events |
|---|---|---|
| ∅ → `queued` | `PostCustomerTurn` (no open case) → `Case.open` | `case.opened` |
| `queued` → `assigned` | `AssignCase` (same UoW as the open) or `DrainQueue` | `case.assigned` |
| `queued` stays | `AssignCase` finds nobody eligible | `case.queued` |
| `assigned` → `in_progress` | `MarkCaseRead` or `PostAnalystTurn` by the assignee | `case.status_changed` (`reason: opened_by_assignee`) |
| `assigned`/`in_progress` → `closed` | `CloseCase` | `case.closed` + `case.status_changed` (`reason: closed`) |
| anything else | — | `InvalidTransitionError` → 409 `invalid_transition` (`currentStatus`). Closing a closed case → 409 `case_closed`. |

Slice 3 seams (not built now): `queued → assigned` by a supervisor (`reason: manual`); `assigned | in_progress → assigned` to another analyst (reassignment).

### 2.4 Domain events (append-only `event_log`, snake_case payloads)

| `event_type` | `entity` / id | Actor | Payload (besides the envelope) |
|---|---|---|---|
| `case.opened` | `case` | customer | `customer_id, channel, language, priority, sla_due_at, previous_case_id` |
| `turn.created` | `turn` / turn id | the author (customer, staff, or system) | `sequence, kind, audience, author_role, author_id, text, language, client_message_id` |
| `case.queued` | `case` | system | `queue_label, reason_code` (`no_available_analyst`), `language, policy_rule_id` (`H1` for pt) |
| `case.assigned` | `case` | system | `assignment_id, assigned_analyst_id, previous_analyst_id, reason, policy_rule_id, open_cases_at_assignment, strategy, waited_seconds` |
| `case.status_changed` | `case` | staff or system | `from_status, to_status, reason` |
| `case.read` | `case` | analyst | `staff_id, read_sequence` |
| **`case.first_responded`** (new) | `case` | analyst | `first_response_at, response_seconds, sla_due_at, sla_met` |
| `case.closed` | `case` / case id | analyst | `closed_at, closed_by_role, closed_by_id, reason, note` |
| `staff.availability_changed` | `staff` | analyst | `from_status, to_status` |
| `customer.session_started` | `customer` | customer | `session_id, channel` |

`routing_step.recorded` is gone. Seeds record their events with the story's `occurred_at`.

---

## 3. Assignment (`application/cases/assignment.py`)

### 3.1 `AssignCase` (one use case, two callers)

```python
class AssignmentStrategy(Protocol):
    def choose(self, request: AssignmentRequest, candidates: Sequence[AnalystCandidate]) -> AssignmentChoice | None: ...

@dataclass(frozen=True, slots=True)
class AssignCase:
    clock: Clock; ids: IdGenerator; strategy: AssignmentStrategy; directory: AnalystDirectory
    async def place(self, uow: UnitOfWork, case: Case, *, reason: AssignmentReason) -> bool: ...
```

- **Contract of `place`.** It runs **inside the caller's Unit of Work** and never commits. It reads the candidates through `AnalystDirectory.candidates(uow)`: active analysts, availability `available`, `open_case_count` over `assigned | in_progress`, `last_assigned_at`.
- **Assigned.** If the strategy picks someone: `Case.assign` + an `Assignment` row (`waited_seconds` = `now − queued_at` for `queue_drained`, else `None`) + a staff-only `routing` banner. Returns True.
- **Nobody eligible.** Only when the case has no `case.queued` yet: `mark_waiting_in_queue` + the queued banner. Returns False. A drain attempt that still finds nobody changes nothing.
- **First in, first out per language queue (slice 3 review fix).** For a new arrival (`language_least_loaded`), `place` first assigns the cases already waiting in that language's queue, oldest first (`queue_drained`, same Unit of Work, the chosen analyst's load updated after each pick), and only then the new case. Normally the queue is empty when someone eligible is available (it drains on availability); this covers a new case racing the background drain. A drain committing first makes the arrival retry on fresh state.
- **`LanguageLeastLoadedStrategy`** (rule 3, unchanged from slice 1). It keeps the candidates who speak `case.language`, then takes `min(open_case_count, last_assigned_at or epoch, staff_id)`. `policy_rule_id = "H1"` when `pt`, else `None`.
- **Callers:**
  1. **`PostCustomerTurn`**, when it opens a case. Steps in **one** Unit of Work: CAS the customer slot; `Case.open`; the customer message (seq 1); the opened notice (seq 2); the "volvió a escribir" banner if `previous_case_id` (§4.6); then `assign_case.place(reason=language_least_loaded)`; commit. The POST response therefore already says `with_agent` or `waiting_agent`. No background routing job exists.
  2. **`DrainQueue.execute()`**: queued cases, oldest `opened_at` first, each in its own UoW with `retry_on_conflict`, `reason=queue_drained`. It returns how many were assigned.
- **`QueueDrainer`** (process manager, bus subscriber on `staff.availability_changed`, `to_status = available`). It spawns `DrainQueue` through the `BackgroundTasks` port.
- **Known limits (documented, accepted).** Two cases opened at the same instant may both pick the same least-loaded analyst. An analyst who pauses at the same instant may still get one case. A new case may be assigned while an older queued case of **another** language waits, if the new one's language has an available speaker and the old one's does not (never one of its own language: see the FIFO rule above). Slice 3 shows the queue to supervisors.

### 3.2 Startup

No startup recovery. The `routing` status no longer exists, and the queue drains on availability changes (and, in slice 3, by hand). The seeded queued case (§8.3) therefore stays queued until an eligible analyst switches to "Disponible".

### 3.3 Server-written texts

**Queue labels** (team-generated): `es` "Cola en español" · `pt` "Cola en portugués". Inside sentences they are lower-cased: "la cola en portugués".

**Staff-only `routing` banners** (author `system`, Spanish):
- Assigned on arrival: "Asignado a {Nombre Apellido} porque está disponible y habla {español|portugués}." A `pt` case ends with " (regla 3)." before the final period, as in slice 1.
- Queued: "No hay personas disponibles que hablen {español|portugués}: el caso espera en la {cola}."
- Assigned from the queue: "Asignado a {Nombre Apellido} después de {n} min en la {cola}." Minutes are rounded up, minimum 1.
- New case after a close, before the assignment banner: "{Primer nombre} volvió a escribir. Su caso anterior se cerró el {d mmm, HH:mm} hora Bogotá ({motivo})." The banner is stored text, so its time cannot follow the viewer's zone like every other time in the UI (brief §5.3); it is written in the display zone `America/Bogota` (team-generated) and always names it ("hora Bogotá"), so an analyst in Buenos Aires or Ciudad de México never reads it as her own clock. The reason uses the labels of §4.4, lower-cased.

**Customer-visible `notice` turns** (author `system`, audience `everyone`, case language):

| Notice | es | pt |
|---|---|---|
| Opened | "Recibimos tu mensaje. En unos minutos te responde una persona del equipo." | "Recebemos sua mensagem. Em poucos minutos uma pessoa da equipe vai te responder." |
| Closed (replaces the slice 1 text) | "La conversación terminó. Si necesitas algo más, escríbenos y te atendemos en una nueva conversación." | "A conversa foi encerrada. Se precisar de algo mais, escreva para nós e abrimos uma nova conversa." |

The close reason and note are **never** sent to the customer.

---

## 4. Case lifecycle rules

### 4.1 Inbox status (derived server-side, `inbox_status(case)`, unit-tested table)

| `status` | Condition | `inboxStatus` | Tile | Card `title` / rail `aria-label` sub-label | Tone |
|---|---|---|---|---|---|
| `assigned` | — | `new` | Nuevos | "Nuevo" | `accent` |
| `in_progress` | last `message` turn by `customer` | `to_reply` | Por responder | "Por responder" | `warn` |
| `in_progress` | last `message` turn by `analyst` | `waiting` | Esperando al cliente | "Esperando al cliente" | `waiting` |
| `closed` | — | `closed` | Cerrados | "Cerrado" | `closed` |
| `queued` | — | `null` | (no analyst inbox; slice 3 queue) | | |

Movements:
- the customer writes → `to_reply`;
- the assignee replies → `waiting`;
- the assignee opens a `new` case → `to_reply` (its first message is the customer's);
- close → `closed`, which leaves the open filters and enters Cerrados.

### 4.2 Inbox list, counters and order

`GET /cases/inbox?status=&q=` returns the caller's cases.

**Lists:**
- **Todos** (no `status`) = the **open** inbox: `assigned_analyst_id = me` and `inboxStatus ∈ {new, to_reply, waiting}`.
- `status=new | to_reply | waiting` filters the open inbox.
- `status=closed` = `assigned_analyst_id = me`, `status = closed`, `closed_at ≥ now − 7 days`. The 7-day window is team-generated: the constant `CLOSED_INBOX_WINDOW = timedelta(days=7)` in `application/cases/queries.py`.
- `q` filters within the selected list (customer name or case id, accent/case-insensitive, contains).

**Order:**
- open lists: `new` and `to_reply` first, then `waiting`; within each group `lastInteractionAt` ascending (who has waited longest first); then `openedAt`, then `id`;
- `closed`: `closedAt` descending.

**Size:** at most 200 items; no pagination.

**Counters:** `counts` **always** cover the whole inbox (they ignore `status` and `q`):
- `all` = open cases (`new + toReply + waiting`);
- `closed` = closed cases inside the window.

### 4.3 Who may see a case (`load_case_for`)

| Caller | Read (`GET /cases/{id}`, `/turns`, `/history`) | Write (`/turns` POST, `/read`, `/close`) |
|---|---|---|
| Analyst who is the **assignee** | yes | yes (closed → 409 `case_closed`) |
| Analyst who is the assignee of **another case of the same customer** (any status) | yes, read-only (**history access**) | 403 `case_not_assigned` |
| Supervisor | yes, read-only | 403 `case_not_assigned` (slice 3 adds supervisor actions) |
| Anyone else | 403 `case_not_assigned` | 403 `case_not_assigned` |

Unknown or malformed ids → 404 `not_found`.

The WebSocket `case:<id>` topic stays assignee-or-supervisor. History viewers do not subscribe: a history case is closed and does not change. The repository needs `cases.exists_for_customer_and_assignee(customer_id, staff_id) -> bool`.

### 4.4 Close

- **Who and from where:** the assignee only, from `assigned` or `in_progress`.
  - `queued` → 409 `invalid_transition` in the domain (`Case.close`). Through the API a queued case has no
    assignee, so the caller gets 403 `case_not_assigned` first; the 409 becomes reachable when slice 3 adds
    supervisor actions.
  - `closed` → 409 `case_closed`.
- **Body:** **`CloseCaseRequest`** `{ reason: CloseReason; note: string | null }`.
  - The note is trimmed; blank → `null`; at most 500 characters. Longer → 422 `validation_error`.
  - Unknown members → 422.
  - The note is optional for every reason, including `other`.
- **Effects in one Unit of Work:**
  - append the closed `notice` (§3.3, case language);
  - `Case.close` (records `case.closed`, then `case.status_changed`);
  - free the `CustomerCaseSlot`.
- **Response:** 200 **`CaseDetail`** (closed, `capabilities.canReply = false`).
- **Labels** (Spanish UI, team-generated):

  | `CloseReason` | Label |
  |---|---|
  | `resolved` | "Resuelto" |
  | `customer_unresponsive` | "El cliente no respondió" |
  | `duplicate` | "Duplicado" |
  | `out_of_scope` | "Fuera de alcance" |
  | `other` | "Otro" |

### 4.5 First-response SLA

- **Due time:** `sla_due_at = opened_at + target(priority)`. `SlaPolicy` (Strategy) uses team-generated targets: `high` 5 min · `medium` 15 min · `low` 60 min.
- **Met or missed:** the first `analyst` message sets `first_response_at` and records `case.first_responded` (`sla_met = first_response_at ≤ sla_due_at`). The SLA then **stops** for the case. A customer who writes again later starts no new SLA.
- **"SLA x" is computed in the frontend** (`formatSla(summary, now)`, ticking every 30 s):
  - It returns `null` (no tag) when `firstResponseAt` is set or the case is closed.
  - Otherwise: remaining = `slaDueAt − now`.
    - `≤ 0` → "SLA vencido";
    - `< 60 min` → "SLA {ceil(min)} min";
    - `< 48 h` → "SLA {floor(h)} h";
    - else "SLA {floor(días)} días".
  - **At risk** (`warn` text) when remaining `≤ 5 min`.
- **Last interaction:** `lastInteractionAt` = `last_message_at` (fallback `opened_at`). The card shows `formatRelativeTime`.

### 4.6 A customer writes after a close (new linked case)

- **New case.** The customer has no open case (the slot is free), so `PostCustomerTurn` opens a **new** case. `previous_case_id` = that customer's most recently **closed** case, whatever its age; `None` if they have none. The new case is assigned normally (§3.1). It does not prefer the previous analyst.
- **Old case.** The old case stays closed and read-only. Its transcript is not touched.
- **Analyst side:**
  - the new card shows "Volvió a escribir";
  - the header shows "Casos anteriores (n)";
  - the staff banner of §3.3 explains the link.
- **Customer side.** `conversation.updated` carries the **new** `caseId`. The simulator moves the closed conversation to the past list (§9.6).

### 4.7 "Casos anteriores de este cliente" (conversation history, not bank data)

- **Endpoint:** `GET /cases/{caseId}/history` returns the customer's **other** cases (any status, excluding `caseId`), newest `openedAt` first. At most 20 items; `total` is the full count.
- **Who:** the caller needs read access to `caseId` (§4.3). With that access, every listed case is readable through `GET /cases/{id}` and `/turns` (history access).
- **Count:** `CaseDetail.previousCaseCount` gives the header button its count without loading the list.

---

## 5. REST API · analyst side

The auth is the staff session (`SessionToken`). Problems are as in slice 1, except `channel_not_supported`, which is removed.

### 5.1 Endpoints

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/cases/inbox?status=&q=` | analyst | `status?: InboxStatus` (omit = Todos, open); `q?` 1–80 chars | 200 **`InboxResponse`** | 401, 403 `forbidden`, 422 |
| `GET /api/v1/cases/{caseId}` | analyst (§4.3), supervisor | — | 200 **`CaseDetail`** | 401, 403 `case_not_assigned`, 404 |
| `GET /api/v1/cases/{caseId}/turns?cursor=&afterSequence=&limit=` | analyst (§4.3), supervisor | unchanged | 200 **`TurnPage`** | 401, 403, 404, 422 |
| **`GET /api/v1/cases/{caseId}/history`** (new) | analyst (§4.3), supervisor | — | 200 **`CaseHistory`** | 401, 403 `case_not_assigned`, 404 |
| `POST /api/v1/cases/{caseId}/turns` | assignee analyst | `Idempotency-Key` + **`PostAnalystTurnRequest`** (unchanged) | 201 **`PostTurnResponse`** (200 + `Idempotent-Replayed` on replay) | 401, 403 `case_not_assigned`, 404, 409 `case_closed`, 409 `idempotency_conflict`, 422 |
| `POST /api/v1/cases/{caseId}/read` | assignee analyst | **`MarkReadRequest`** (unchanged) | 200 **`CaseSummary`** | 401, 403, 404, 422 |
| `POST /api/v1/cases/{caseId}/close` | assignee analyst | **`CloseCaseRequest`** (new shape) | 200 **`CaseDetail`** | 401, 403, 404, 409 `case_closed`, 409 `invalid_transition`, 422 |
| `GET/PUT /api/v1/me/availability` | analyst | unchanged | 200 **`Availability`** | unchanged |

Declare `/cases/inbox` before `/cases/{caseId}`. `/history` is a sub-path of `{caseId}`.

### 5.2 Schemas

```ts
InboxResponse  { items: CaseSummary[]; counts: InboxCounts; serverTime: datetime }
InboxCounts    { all: int; new: int; toReply: int; waiting: int; closed: int; computedAt: datetime }
// removed: live, toCall

CaseSummary {
  id: string
  version: int
  customer: CustomerRef                 // { id; displayName }
  channel: CaseChannel                  // app_chat | web_chat
  language: Language
  priority: CasePriority
  status: CaseStatus                    // queued | assigned | in_progress | closed
  inboxStatus: InboxStatus | null       // new | to_reply | waiting | closed; null while queued
  openedAt: datetime
  slaDueAt: datetime                    // first-response due time
  firstResponseAt: datetime | null      // NEW
  lastInteractionAt: datetime
  preview: string | null
  previewAuthorRole: TurnAuthorRole | null
  assignedAnalystId: string | null
  unreadCount: int
  lastSequence: int
  previousCaseId: string | null         // NEW: "Volvió a escribir"
  closedAt: datetime | null
  closeReason: CloseReason | null       // NEW
}
// removed: origin, topic, liveSince

CaseDetail {
  case: CaseSummary
  customer: CaseCustomer                // NEW shape (no customer-file data)
  assignment: AssignmentOut | null      // "Cómo llegó a ti"
  closure: CaseClosure | null
  capabilities: CaseCapabilities
  previousCaseCount: int                // NEW: other cases of this customer (any status)
}
// removed: channelIdentity, routing
CaseCustomer   { id: string; displayName: string; locale: CustomerLocale; language: Language;
                 country: CountryCode; city: string }
AssignmentOut  { id: string; analystId: string; analystName: string; reason: AssignmentReason;
                 policyRuleId: string | null; assignedAt: datetime;
                 queueLabel: string | null;     // NEW: set when the case waited in a queue
                 waitedSeconds: int | null }    // NEW: queue wait (queue_drained), else null
CaseClosure    { closedAt: datetime; closedById: string; closedByName: string | null;
                 reason: CloseReason; note: string | null }
CaseCapabilities { canReply: boolean; replyBlockedReason: ReplyBlockedReason | null; canClose: boolean }
// canReply = caller is the assignee and status ∈ {assigned, in_progress}
// replyBlockedReason: 'not_assignee' (history viewer, supervisor) | 'closed' | null

CaseHistory     { items: CaseHistoryItem[]; total: int }
CaseHistoryItem {
  id: string; status: CaseStatus; channel: CaseChannel
  openedAt: datetime; closedAt: datetime | null; closeReason: CloseReason | null
  analystId: string | null; analystName: string | null   // who held it (assignee)
  preview: string | null                                 // last message text (≤140)
}

Turn {                                 // removed: evidenceIds, fromSuggestionId
  id; caseId; sequence: int; kind: TurnKind; audience: TurnAudience; authorRole: TurnAuthorRole
  authorId: string | null; authorName: string | null; text; language; createdAt; clientMessageId: string | null
}
TurnPage, PostAnalystTurnRequest, PostTurnResponse, MarkReadRequest, Availability, UpdateAvailabilityRequest: unchanged

CloseCaseRequest { reason: CloseReason; note: string | null }   // note ≤ 500 chars after trim
```

### 5.3 Problem codes

- **Removed:** `channel_not_supported`.
- **Unchanged:** `case_not_assigned` (403; default detail changes to "No tienes acceso a este caso."), `case_closed`, `idempotency_conflict`, `invalid_transition` (with `currentStatus: CaseStatus`), `not_found`, `forbidden`, `validation_error`, `invalid_value`, `unauthenticated`, `concurrent_update`.
- **New:** none.

### 5.4 Staff schema (people)

**`StaffOut`** `{ id; name; email; roles: StaffRole[]; languages: Language[]; team: string }`. `level` and `requiresFourEyes` are removed. This affects `GET /staff`, `GET /auth/me`, and the login/MFA session responses.

---

## 6. REST API · customer side (simulator)

The auth and the token are unchanged. A customer only ever sees **their own** cases and only `everyone` turns.

| Method · path | Auth | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/customer/demo-customers` | none | — | 200 **`DemoCustomerList`** | — |
| `POST /api/v1/customer/sessions` | none | **`CreateCustomerSessionRequest`** (unchanged) | 201 **`CustomerSessionResponse`** | 404 `not_found` (unknown id only), 422 |
| `GET /api/v1/customer/conversation?afterSequence=` | customer | unchanged | 200 **`CustomerConversationResponse`** | 401 |
| `POST /api/v1/customer/conversation/turns` | customer | unchanged | 201/200 **`PostCustomerTurnResponse`** | 401, 409 `idempotency_conflict`, 422 |
| **`GET /api/v1/customer/conversations`** (new) | customer | — | 200 **`CustomerConversationList`** | 401 |
| **`GET /api/v1/customer/conversations/{caseId}`** (new) | customer | — | 200 **`CustomerConversationDetail`** | 401, 404 `not_found` (unknown, or someone else's case) |

Rules:
- **Current conversation** (unchanged): the open case; else the most recent closed one; `null` if the customer never wrote.
- **`pastConversationCount`:** the customer's closed cases other than the current conversation.
- **`GET /customer/conversations`:** the customer's closed cases **other than the current conversation**, newest `openedAt` first, at most 20.
- **`GET /customer/conversations/{caseId}`:** any own case, with up to the latest 200 `everyone` turns, ascending.
- **Writing after a close:** a post when the current conversation is closed opens a new case (§4.6). `caseCreated: true`, and `conversation.previousCaseId` = the closed one.

```ts
DemoCustomerList { items: DemoCustomer[] }   // simulator customers first, then every other seeded customer by name
DemoCustomer {
  id; displayName; locale: CustomerLocale; language: Language; country: CountryCode; city: string
  suggestions: string[]
  openConversation: DemoConversation | null       // { caseId; channel; status }
  closedConversationCount: int                    // NEW
}
// removed: segment

CustomerConversation {
  caseId; status: CustomerConversationStatus; channel: CaseChannel; language: Language
  openedAt: datetime; closedAt: datetime | null
  agentName: string | null           // assignee first name while with_agent; on a closed case, who attended it
  lastSequence: int
  previousCaseId: string | null      // NEW
}
CustomerTurn { id; sequence; kind: 'message' | 'notice'; authorRole: CustomerTurnAuthor /* customer|analyst|system */;
               authorName: string | null; text; language; createdAt; clientMessageId: string | null }
CustomerConversationResponse { conversation: CustomerConversation | null; turns: CustomerTurn[];
                               pastConversationCount: int }     // NEW member
CustomerConversationList     { items: CustomerConversationSummary[] }
CustomerConversationSummary  { caseId: string; status: CustomerConversationStatus; channel: CaseChannel;
                               openedAt: datetime; closedAt: datetime | null;
                               agentName: string | null; preview: string | null }
CustomerConversationDetail   { conversation: CustomerConversation; turns: CustomerTurn[] }
```

Note one deliberate change: `agentName` on a **closed** conversation now carries the first name of the analyst who attended it. In slice 1 it was `null`. The simulator shows "Te atendió {agentName}".

---

## 7. Realtime

Topics: `case:<CASE-id>` (assignee, supervisors), `inbox:<STF-id>` (that staff member, supervisors) and `customer:<CUS-id>` (only that customer). The `approvals` topic is removed. A subscription to it is answered with `error` / `invalid_topic`.

| `type` | Topic(s) | `payload` | Emitted after |
|---|---|---|---|
| `turn.created` | `case:<id>` | `Turn` | every `turn.created` |
| `turn.created` | `customer:<customerId>` | `CustomerTurn` | `turn.created` with `audience = everyone` |
| `case.updated` | `case:<id>` and `inbox:<assignee>` | `CaseSummary` | `turn.created`, `case.assigned`, `case.status_changed`, `case.read`, **`case.first_responded`**, `case.closed` |
| `case.assigned` | `inbox:<assignee>` | `CaseSummary` | `case.assigned` |
| `inbox.counts` | `inbox:<assignee>` | `InboxCounts` (new shape, incl. `closed`) | each `case.updated` sent to an inbox |
| `availability.updated` | `inbox:<staffId>` | `Availability` | `staff.availability_changed` |
| `conversation.updated` | `customer:<customerId>` | `CustomerConversation` | `case.opened`, `case.queued`, `case.assigned`, `case.status_changed`, `case.closed` |

- **Ordering, dedupe and reconnect:** slice 1 §5.3 rules, unchanged.
- **One close, two envelopes:** a close sends `case.updated` with `inboxStatus: 'closed'` (the card moves to Cerrados) and a fresh `inbox.counts`.
- **A new case after a close:** it emits `conversation.updated` with a **different** `caseId` on `customer:<id>`. The simulator treats a different `caseId` as a conversation switch (§9.6).
- **Projector:** the `CaseRealtimeProjector` owns `CASE_EVENTS` + `CaseFirstResponded`.
- **Contract test:** every payload still validates against its REST schema.

---

## 8. Seed ("Datos de ejemplo", invented people)

The ids are stable (`seed_staff_id(n)`, `seed_customer_id(n)`, `seed_case_id(n)`). Times are relative to the clock at the first seed (`T`), and seeding is idempotent per id. The seed goes through the domain factories (`Case.open`, `append_turn`, `assign`, `mark_read`, `close`) and records its events with the story's `occurred_at`. There are no bot turns. Every case is a chat.

### 8.1 Staff (levels removed)

| n | Name | Roles | Languages | Team | Availability |
|---|---|---|---|---|---|
| 1 | Daniela Ríos | Analista | es, pt | Disputas · Equipo Andes | **available** (slice 3 §9.3: paused since T−12m) |
| 2 | Julián Ortega | Analista | es | Disputas · Equipo Andes | paused |
| 3 | Paula Medina | Analista | es | Disputas · Equipo Pacífico | paused |
| 4 | Sebastián Cárdenas | Analista | es, pt | Disputas · Equipo Pacífico | paused |
| 5 | Lucía Herrera | Supervisora | es, pt | Disputas · Equipo Andes | — |
| 6 | Martín Salazar | Supervisora | es | Disputas · Equipo Pacífico | — |
| 7 | Valeria Quintero | **Administración** (was Automatización + Administración) | es | Administración de la plataforma | — |
| 8 | Tomás Arango | **Analista** (was Automatización only; kept so his id stays valid) | es, pt | Disputas · Equipo Pacífico | paused |
| 9 | Carolina Peña | Administración | es | Administración de la plataforma | — |
| 10 | Renata Villalba | **Supervisora** (was Supervisora + Automatización) | es, pt | Disputas · Equipo Pacífico | — |
| 11 | Felipe Echeverri | **Analista + Supervisora** (team lead) | es | Disputas · Equipo Andes | paused |

The team "Automatización" is removed. The role switcher is exercised by Felipe (Casos ↔ Equipo y colas).

**Existing databases.** The seed is idempotent per id and never updates existing staff rows, so a database seeded before this slice keeps the old roles. Delete `cc_platform.db` (§0.4).

### 8.2 Customers (no segment, document or "customer since")

| n | Name | Locale · city | Simulator | `suggestions` (own voice) |
|---|---|---|---|---|
| 1001 | Marcela Quintana Pardo | es-CO · Barranquilla, CO | listed | "¿Ya me pueden decir algo del retiro?" · "Gracias, quedo atenta" |
| 1002 | Beatriz Salcedo Prieto | es-CO · Cali, CO | listed | "¿Hay alguien ahí?" · "Llevo un buen rato esperando" |
| 1003 | Larissa Monteiro Alves | pt-BR · Medellín, CO | listed | "Alguém pode me ajudar?" · "Foi uma compra de ontem" |
| 1004 | Patricia Lozano Vega | es-MX · Guadalajara, MX | listed | "¿Ya pudieron revisarlo?" · "Gracias por la ayuda" |
| 1005 | Claudia Restrepo Varela | es-CO · Barranquilla, CO | listed | "Hola, sigo con el problema del cargo" |
| 1006 | Héctor Villarreal Garza | es-MX · Monterrey, MX | listed | "Hola de nuevo, tengo otra duda" |
| 1007 | Joaquín Ferreyra Paz | es-AR · Rosario, AR | listed | "Fue a mediados de mes, unos $48.300" · "¿Lo pudiste encontrar?" |
| **1008** (new) | Gabriela Duarte Melo | pt-BR · São Paulo, BR | listed | "Alguém aí?" · "Ainda estou esperando" |
| 2001–2005 | unchanged from slice 1 §6.2 | | listed, no case | unchanged |

"Listed" means it appears in `DemoCustomerList`. All seeded customers are chat customers now.

### 8.3 Cases

Daniela's inbox:

| Todos | Por responder | Nuevos | Esperando al cliente | Cerrados |
|---|---|---|---|---|
| 5 | 2 | 2 | 1 | 3 |

There is one queued case (in no inbox), and one closed case of Julián outside the window.

Shorthand in this table: **c** = a customer message; **a** = a message by the case's analyst (Daniela, or Julián for case 110); **notice** = the opened notice; **banner** = the assignment banner of §3.3; **closed-notice** = the closed notice of §3.3.

| # | Customer | Channel · lang · priority | Final status → inbox | Times | Assignment | Turns (in order) |
|---|---|---|---|---|---|---|
| 101 | 1001 Marcela | `web_chat` · es · medium | `in_progress` → **to_reply** (read up to seq 4, unread 1) | opened T−14m; SLA due T+1m; first response T−10m (met) | Daniela, `language_least_loaded`, T−14m | c "hola buenas, hay un cargo en mi tarjeta q no reconozco, me colaboran?" (T−14m) · notice · banner · a "Hola, Marcela. Soy Daniela, de LATAM Bank. Con gusto le ayudo. ¿Me cuenta de qué fecha es el cargo y por qué valor?" (T−10m) · c "es un retiro en cajero del 9 de enero por $1.585.208, yo no lo hice" (T−2m) |
| 102 | 1002 Beatriz | `app_chat` · es · medium | `in_progress` → **to_reply**, first response **pending**, **SLA at risk** ("SLA 3 min"), unread 3 | opened T−12m; SLA due T+3m; opened by Daniela T−9m (read up to seq 3) | Daniela, T−12m | c "no reconozco un cargo en mi tarjeta y estoy muy molesta" (T−12m) · notice · banner · c "hola?" (T−8m) · c "hola?? hay alguien??" (T−5m) · c "contesten!! qué mal servicio" (T−1m) |
| 103 | 1003 Larissa | `web_chat` · **pt** · medium | `assigned` → **new** | opened T−2m; SLA due T+13m | Daniela, `H1` | c "Oi, cobraram uma coisa que não corresponde, já estou no limite com isso!" · notice (pt) · banner "…habla portugués (regla 3)." |
| 107 | 1007 Joaquín | `app_chat` · es · medium | `in_progress` → **waiting** | opened T−50m; SLA due T−35m; first response T−40m (met) | Daniela, T−50m | c "Hola, ¿me podés decir cómo va el reclamo que hice por un cobro en un súper? Ya pasaron como dos semanas y no sé nada." · notice · banner · a "Hola, Joaquín. Soy Daniela, de LATAM Bank. Para encontrar su reclamo, ¿me podría decir la fecha aproximada del cobro y el monto?" (T−40m) |
| 108 | 1004 Patricia | `app_chat` · es · medium, **`previousCaseId` = 104** | `assigned` → **new** | opened T−4m; SLA due T+11m | Daniela, T−4m | c "Hola, otra vez yo. El reembolso que me dijeron todavía no aparece en mi cuenta." · notice · banner "Patricia volvió a escribir. Su caso anterior se cerró el … (resuelto)." · banner "Asignado a Daniela Ríos…" |
| 104 | 1004 Patricia | `app_chat` · es · medium, `previousCaseId` = 110 | **closed** → Cerrados | opened T−2d−30m; first response T−2d−27m; closed T−2d | Daniela | c "Buenas tardes, me cobraron dos veces la misma compra en una farmacia." · notice · banner "Patricia volvió a escribir. Su caso anterior se cerró el … (resuelto)." (it follows 110, §4.6) · banner "Asignado a Daniela Ríos…" · a "Hola, Patricia. Soy Daniela, de LATAM Bank. Ya veo los dos cobros: uno se reversa en un plazo de 5 días hábiles." · c "Perfecto, muchas gracias." · closed-notice. Close: `resolved`, note "Se explicó el plazo del reverso (5 días hábiles)." |
| 105 | 1005 Claudia | `web_chat` · es · medium | **closed** → Cerrados | opened T−1d−3h; first response T−1d−2h50m; closed T−1d | Daniela | c "Hola, necesito ayuda con un cargo" · notice · banner · a "Hola, Claudia. Soy Daniela, de LATAM Bank. ¿Me cuenta qué cargo es y de qué fecha?" · closed-notice. Close: `customer_unresponsive`, no note |
| 106 | 1006 Héctor | `app_chat` · es · low | **closed** → Cerrados | opened T−4h; first response T−3h50m; closed T−3h | Daniela | c "Buen día, quiero saber cuánto me prestan para una casa." · notice · banner · a "Hola, Héctor. Soy Daniela, de LATAM Bank. Por este chat atendemos dudas de cargos y movimientos; para créditos hipotecarios lo atienden en la línea de créditos." · c "Ah ok, gracias" · closed-notice. Close: `out_of_scope`, note "Pregunta por un crédito hipotecario." |
| 110 | 1004 Patricia | `web_chat` · es · medium | **closed** (Julián Ortega, outside the 7-day window) | opened T−20d; first response T−20d+3m; closed T−20d+15m | **Julián** (`seed_staff_id(2)`) | c "Hola, no reconozco un cargo de una suscripción." · notice · banner "Asignado a Julián Ortega…" · a (Julián) "Hola, Patricia. Soy Julián, de LATAM Bank. Ese cargo es de su suscripción de música, contratada en marzo." · c "Ah, es cierto. Gracias." · closed-notice. Close: `resolved`, no note |
| 109 | 1008 Gabriela | `web_chat` · **pt** · medium | **queued** in "Cola en portugués" (no inbox) | opened T−6m; SLA due T+9m | none | c "Olá, preciso de ajuda com uma compra que não reconheço." · notice (pt) · banner "No hay personas disponibles que hablen portugués: el caso espera en la cola en portugués." |

Notes:
- **Superseded by slice 3 §9.** Rule 3 forbids a queued case while an eligible analyst is available, so slice 3 seeds Daniela **paused** (since T−12m, before 109, 111 and 112 arrived) and moves her new cases 101, 108, 102 and 103 before that pause. Her inbox counts are unchanged.
- **Case 109 is deliberately queued**: nobody available speaks Portuguese (Daniela paused before it arrived); startup runs no drain (§3.2). Two ways to drain it:
  - Daniela: "En pausa" → "Disponible", and she gets it;
  - sign in as Sebastián or Tomás (es, pt, 0 cases) and switch to "Disponible", and he gets it (least loaded).

  Slice 3 also lets a supervisor assign it.
- **History demo.** Open 108 (Patricia). "Casos anteriores (2)" lists 104 (Daniela, Resuelto) and 110 (Julián, Resuelto). Daniela can read 110 through history access.
- **Reopen demo.** In the simulator, write as Claudia (1005) or Héctor (1006). A new case opens with `previousCaseId`, is assigned to Daniela and shows "Volvió a escribir".
- **Fresh customers.** 2001–2005 behave as in slice 1. Rafael (2004, pt) → Daniela. With Daniela paused → queued; Daniela back → assigned from the queue, along with 109.

---

## 9. Frontend changes

One agent owns all of `frontend/`. It may extend `components/ui` and `styles/index.css`, and must not fork them. Feature dependency direction is unchanged: `routes/analyst/workspace` → `features/workspace` → `features/conversation` → `features/cases`. `features/customer-chat` imports no feature.

### 9.1 `features/cases` (list, tiles, cards)

- **Filters (`INBOX_FILTERS`, canvas order):**

  | Label | Status | Slug (`?estado=`) | Tone |
  |---|---|---|---|
  | Todos | `null` | none | `neutral` |
  | Por responder | `to_reply` | `por-responder` | `warn` |
  | Nuevos | `new` | `nuevos` | `accent` |
  | Esperando al cliente | `waiting` | `esperando` | `waiting` |
  | Cerrados | `closed` | `cerrados` | `closed` |

  - A grid of 3 columns, two rows. The tile labels may wrap to two lines.
  - Unknown slugs (including the old `en-curso`, `por-llamar`, `en-espera`) fall back to Todos.
  - `countForFilter` maps `closed → counts.closed`.
- **New tone `closed`** in `components/ui/tones.ts`, using **existing** tokens only:

  | Map | Classes |
  |---|---|
  | `toneFill` | `bg-offline` |
  | `toneSoft` | `bg-panel text-muted` |
  | `toneSolid` | `bg-muted text-white` |
  | `toneText` | `text-muted` |
  | `toneBorderLeft` | `border-l-offline` |

  Add the matching entry to `features/cases/components/tone-classes.ts`.
- **`inboxStatusMeta(summary)`**, following §4.1:
  - `new` → `{label: 'Nuevos', subLabel: 'Nuevo', tone: 'accent'}`;
  - `to_reply` → `'Por responder'`;
  - `waiting` → `{label: 'Esperando al cliente', subLabel: 'Esperando al cliente', tone: 'waiting'}`;
  - `closed` → `{label: 'Cerrados', subLabel: 'Cerrado', tone: 'closed'}`;
  - `null` (queued) → `{label: 'Sin asignar', subLabel: 'En la cola', tone: 'neutral'}`.
- **Case card:**
  - **Open:**
    - left stripe = tone;
    - name;
    - top right `formatSla` (nothing when it returns `null`);
    - the preview line;
    - bottom: "{Prioridad media} · {App|Web}". If `previousCaseId`, add a small `Badge` "Volvió a escribir" (tone `neutral`, `title` "Escribió de nuevo después de que se cerró su caso anterior").
    - right: the relative last interaction.
  - **Closed:**
    - stripe `closed`;
    - top right "Cerrado {formatRelativeTime(closedAt)}";
    - the preview;
    - bottom: `closeReasonLabel(closeReason)`.
- **Labels:**
  - `channelLabel`: `app_chat` "App", `web_chat` "Web".
  - `channelPhrase`: "chat en la app" / "chat web".
  - `priorityLabel` and `countryName` stay.
  - New: `CLOSE_REASONS` (§4.4 order and labels), `closeReasonLabel(reason)`.
  - Removed: `topicLabel` and the topic part of `caseCardLine`.
- **`formatSla(summary: Pick<CaseSummary, 'status' | 'slaDueAt' | 'firstResponseAt'>, now): SlaDisplay | null`** (§4.5). `SLA_AT_RISK_MS = 5 * MINUTE`.
- **Collapsed rail:** unchanged (count of `to_reply` in warn, initials with a status ring). Closed cases are not shown in the collapsed rail.
- **Inbox realtime (`patchInbox`).** A query is refetched (`exact`) when a patched summary changes `inboxStatus`, `status`, `lastInteractionAt`, `assignedAnalystId` or `closedAt`, or when an unknown id fits the query's filter. These keys replace `slaDueAt`/`liveSince`.
- **Toast on `case.assigned`:**
  - `previousCaseId ? '{Nombre} volvió a escribir'`;
  - else `'Te llegó un caso nuevo'` (with the customer name as the description).
- **Empty list per filter:**
  - Todos/open filters: "Nada pendiente.";
  - Cerrados: "No cerraste casos en los últimos 7 días.".

### 9.2 `features/workspace`

- **Layout:** **two columns**: `CaseListPanel` (fixed width, collapsible to the rail) and `ConversationPane`, which fills the rest. The transcript content keeps a readable max width (bubbles at most 70% of the column). The `SupportPanel` and its icon rail are removed.
- **URL state:** `?caso=&estado=&q=&lista=&historial=`.
  - `historial=lista` opens the "Casos anteriores" sheet on its list;
  - `historial=<CASE-id>` opens it on that transcript.
  - `panel` and `apoyo` are ignored.

  ```ts
  export interface WorkspaceUrlState {
    caseId: string | null; filter: InboxStatus | null; query: string; listCollapsed: boolean
    history: 'lista' | string | null      // null = sheet closed
  }
  ```
- **Auto-select:** the first case of the current filter when `caso` is missing (unchanged, also in Cerrados), once per loaded list (the screen opening, or the analyst picking another filter). Never for a case that arrives over the socket afterwards (slice 3 review fix): opening it would mark it read and record an open the analyst never made, and the "Te asignaron un caso" / "Te llegó un caso nuevo" toast with "Ver caso" is how she opens it.
- **After a close:** the case moves to Cerrados, and the Workspace selects the next open case as today (`nextCaseAfterClose`).
- **Empty state (`emptyWorkspaceCopy`):**
  - Available: "No tienes casos abiertos" / "Estás disponible. Cuando un cliente escriba y te corresponda, aparece aquí."
  - Paused: "No tienes casos abiertos" / "Estás en pausa: no te llegan casos nuevos. Vuelve a disponible para recibir el siguiente."

### 9.3 `features/conversation` · header, arrival note, read-only states

- **Header.**
  - Content: name; the short id (copy button); meta "{país} · {ciudad} · {channelPhrase} · {prioridad x | 'en portugués' when `pt`}" (`caseHeaderMeta`); `SampleDataTag`.
  - When `previousCaseCount > 0`: a secondary button **"Casos anteriores ({n})"** that sets `history: 'lista'`.
  - "Cerrar caso" when `capabilities.canClose`.
  - A closed case shows a `Badge` "Cerrado" (tone `closed`) instead of "Cerrar caso".
- **`ArrivalNote`.** One muted line under the header, labelled "Cómo llegó a ti", built by `arrivalLine(detail, meId)` from `assignment` only:
  - Assignee is me, `language_least_loaded`: "Te llegó porque estás disponible y hablas {español|portugués}{' (regla 3)' if pt} · {fecha, hora}".
  - Assignee is me, `queue_drained`: "Esperó {formatWait(waitedSeconds)} en la {queueLabel en minúscula} y te llegó cuando quedaste disponible · {fecha, hora}".
  - Assignee is someone else (history or supervisor view): "Lo atendió {analystName}". Superseded in slice 3 §8.3 (`arrivalNote`: "Quién lo atiende" / "Quién lo atendió").
  - `assignment === null`: nothing.
- **Transcript:**
  - variants `customer`, `own`, `analyst` (another analyst, e.g. Julián in a history case), `routing` (centred accent banner, staff only) and `notice` (centred muted);
  - no `bot`;
  - "Cargar mensajes anteriores" unchanged.
- **Composer and the read-only footer:**
  - `canReply` → the composer as today.
  - Otherwise a read-only footer replaces it:
    - **closed:** `closureLine(closure)` → "Caso cerrado el {fecha, hora} · {motivo}". If the note is set, a second line "Nota: {note}". When `closedById ≠ me`, also "por {closedByName}".
    - **not_assignee:** "Solo lectura: este caso es de {analystName}."
  - `REPLY_BLOCKED_COPY`: `{ not_assignee: …, closed: … }`.
- **Mark-read:** only for the assignee on an open case (unchanged).

### 9.4 `features/conversation` · `CaseHistorySheet`

- **Container:** the existing `Sheet` primitive (right side), title "Casos anteriores de {primer nombre}". Subtitle: "Conversaciones que tuvo con el equipo. Solo lectura."
- **List** (`history: 'lista'`, `useCaseHistory(caseId)` → `GET /cases/{id}/history`). One row per item:
  - "{fecha de apertura} · {closeReasonLabel | 'Abierto'} · {analystName | 'Sin asignar'}";
  - the preview line;
  - the whole row is a button that sets `history: item.id`.
  - Empty: "No tiene otros casos." When `total > items.length`: "Se muestran los 20 más recientes."
- **Transcript view** (`history: <id>`):
  - header "Caso {shortId} · {closureLine}" and a back button "Todos los casos anteriores";
  - the read-only transcript through `useCaseDetail(id)` + `useCaseTurns(id)`, reusing `ChatTranscript`/`TranscriptMessage` (no composer, no mark-read, no `case:` subscription).
  - Errors: `describeCaseLoadFailure`.
- **Closing:** the sheet sets `history: null`. Focus returns to the "Casos anteriores" button.

### 9.5 `features/conversation` · close dialog (`CloseCaseDialog`)

- **Title:** "Cerrar caso". Subtitle: "{nombre} · {shortId}".
- **"Motivo" (required):** a radio group with the 5 options of §4.4. Add a `RadioGroup` primitive to `components/ui` built on native `input type="radio"`, with `role="radiogroup"`, arrow-key navigation via the existing `roving-focus.ts`, and a visible focus ring.
- **"Nota interna (opcional)":** a `Textarea` with at most 500 characters, a counter "{n}/500" and the hint "Solo la ve el equipo.".
- **Customer preview:** a `Callout` (tone `neutral`) titled "El cliente verá" with the closed notice of §3.3 in the **case language**. A model constant `CLOSED_NOTICE: Record<Language, string>` must stay identical to the backend text; a model test pins it.
- **Footer:** "Cancelar" and the primary "Cerrar caso" (loading while pending).
- **Validation:** `validateCloseForm` → `{ reason: 'Elige un motivo.' }`; note > 500 → "La nota puede tener hasta 500 caracteres.".
- **Request:** `toCloseRequest(form)` → `{ reason, note: trimmed || null }`.
- **Errors:** `describeCloseFailure` keeps `case_closed` ("Este caso ya estaba cerrado.") and `invalid_transition`.
- **On success:** apply the returned `CaseDetail` to the detail cache, `applyCaseSummaryToInboxes(queryClient, detail.case)`, invalidate `caseKeys.inboxes()` (the counts change), then call `onClosed(caseId)`.

### 9.6 `features/customer-chat` (simulator)

- **Picker:**
  - cards with name, locale label, city;
  - the badge "Conversación abierta" when `openConversation` is set (only open cases fill it);
  - when `openConversation.status === 'waiting_agent'`, the badge text is "Esperando a una persona" instead;
  - when `closedConversationCount > 0`, a muted line "{n} conversaciones anteriores".
  - Segment is removed.
- **Header state line** (`conversationStatusLine`):
  - `waiting_agent` "Buscando a una persona del equipo…";
  - `with_agent` "Te atiende {agentName} · LATAM Bank";
  - `closed` "Conversación terminada".
- **Closed current conversation:**
  - The input stays enabled, with placeholder "Escribe para empezar una nueva conversación".
  - A muted note above the input: "Esta conversación terminó. Si escribes, empezamos una nueva."
  - Sending → `caseCreated: true`. The closed conversation becomes the first past block, and the chat continues on the new case.
- **Past conversations:**
  - When `pastConversationCount > 0`, a button **"Ver conversaciones anteriores ({n})"** sits at the top of the transcript.
  - Pressing it loads `GET /customer/conversations` and renders one collapsed block per item, oldest at the top: "Conversación del {fecha} · Terminada · Te atendió {agentName}" plus the preview.
  - Expanding a block loads `GET /customer/conversations/{caseId}` and shows its bubbles read-only, with a divider between blocks.
- **Realtime:** `conversation.updated` with a `caseId` different from the cached conversation → keep the old one as a past block (if closed), then refetch `customerChatKeys.conversation(customerId)`.
- **Authors:** `customer` (right), `analyst` (left, first name), `system` (centred note). No bot.
- **Query keys (added):**

  ```ts
  pastConversations: (customerId: string) => ['customer-chat', customerId, 'past'] as const,
  pastConversation: (customerId: string, caseId: string) => ['customer-chat', customerId, 'past', caseId] as const,
  ```

### 9.7 Public APIs (frozen)

```ts
// src/features/cases/index.ts
export { CaseListPanel } from './components/CaseListPanel'          // props unchanged
export { useInbox, useAvailability, useUpdateAvailability, useNow } from './hooks'
export { caseKeys, availabilityKeys } from './api'                   // keys unchanged
export { registerCasesRealtime, applyCaseSummaryToInboxes, readCaseSummary } from './realtime'
export {
  INBOX_FILTERS, inboxStatusFromSlug, slugFromInboxStatus, inboxStatusMeta,
  channelLabel, channelPhrase, priorityLabel, countryName,
  CLOSE_REASONS, closeReasonLabel,                                   // NEW
  formatSla,                                                         // (summary, now) => SlaDisplay | null
} from './model'
export type { CaseSummary, InboxResponse, InboxCounts, InboxStatus, CaseStatus, CaseChannel, CasePriority,
  CloseReason, Availability, AvailabilityStatus } from './types'     // removed: CaseTopic

// src/features/conversation/index.ts
export { ConversationPane } from './components/ConversationPane'   // + prop onOpenHistory?(): void
export { CaseHistorySheet } from './components/CaseHistorySheet'
export interface CaseHistorySheetProps {
  caseId: string; customerName: string
  selected: 'lista' | string               // list or a past case id
  onSelect(selected: 'lista' | string): void
  onClose(): void
}
export { useCaseDetail } from './hooks/use-case-detail'
export { conversationKeys } from './api'   // + history: (caseId) => ['conversation', caseId, 'history']
export { registerConversationRealtime } from './realtime'
export type { CaseDetail, CaseCustomer, CaseHistory, CaseHistoryItem, Turn } from './types'
// removed: RoutingSummary, RoutingSummaryProps, RouteStop, RoutingSummaryData, CustomerProfile

// src/features/workspace/index.ts
export { WorkspaceScreen } from './components/WorkspaceScreen'
export { parseWorkspaceSearch, toWorkspaceSearch } from './model'
export type { WorkspaceStateChangeOptions, WorkspaceUrlState } from './model'   // removed: SupportPanelTab

// src/features/customer-chat/index.ts: unchanged exports (CustomerSimulatorScreen, customerChatKeys, registerCustomerChatRealtime, types)
// src/app/realtime-handlers.ts: unchanged composition
```

### 9.8 App shell, roles, routes

- **`ROLES`:**
  - `analyst` (`/analista`, nav "Casos");
  - `supervisor` (`/supervision`, nav "Equipo y colas", "Auditoría"; both stay `ScreenPlaceholder`s until slice 3);
  - `admin` (`/administracion`, nav "Usuarios y roles"; a placeholder until slice 4).
- **Order:** `ROLE_ORDER = ['analyst', 'supervisor', 'admin']`.
- **Routes:**
  - `/` redirect; `/login` (+ `verificacion`, `bloqueada`); `/cliente`;
  - `/analista`;
  - `/supervision` → `equipo` | `auditoria`;
  - `/administracion` → `usuarios`;
  - `*` → not found.
  - Old automation, approvals, tools, rules and retention URLs fall to the role's not-found page (or the global one for `/automatizacion`).
- **Realtime types:** `KnownRealtimeEventType` = `turn.created | case.updated | case.assigned | inbox.counts | availability.updated | conversation.updated`. `RealtimeTopic` = `` `case:${string}` | `inbox:${string}` | `customer:${string}` ``.

---

## 10. Tests and done criteria

**Backend.** Every gate of brief §6 passes. The tests below are required:

- **Domain and read model:**
  - the `Case` state machine table (§2.3), including `queued → closed` rejected and a reply on a queued case rejected;
  - the `inbox_status` table (§4.1);
  - `first_response_at` set once, plus `case.first_responded` with `sla_met` true and false.
- **Assignment:**
  - `LanguageLeastLoadedStrategy`: pt only to a pt speaker, paused excluded, least loaded, tie-breaks;
  - `AssignCase` assigns in the open's Unit of Work (the POST response already says `with_agent`);
  - queued with the banner when nobody is eligible, and no duplicate `case.queued` on a failed drain;
  - `QueueDrainer` drains on `available` only, oldest first, with `waited_seconds` set.
- **Close:**
  - every `CloseReason`; the note trimmed, null when blank, 501 characters → 422;
  - the closed notice in `es` and `pt`; the slot released;
  - `case_closed` and `invalid_transition`;
  - the reason never reaches the customer (neither REST nor `customer:` socket).
- **Linked cases and history:**
  - a customer message after a close opens a new case with `previousCaseId`, assigned normally, with the "volvió a escribir" banner;
  - history access: an analyst with a case of the same customer can read another analyst's closed case and cannot write to it; an unrelated analyst → 403;
  - `/history` excludes the case itself, orders newest first, caps at 20 with `total`.
- **Inbox:**
  - `status=closed` window (6 days in, 8 days out);
  - `counts` include `closed` and ignore `status`/`q`;
  - ordering per §4.2.
- **Customer side:** `/customer/conversations` (excludes the current conversation) and `/customer/conversations/{id}` (404 on someone else's case); `pastConversationCount`; `agentName` on a closed conversation.
- **Realtime:** `case.updated` after `case.first_responded`; `inbox.counts` with `closed`; `conversation.updated` with a new `caseId` after the reopen; the `approvals` topic rejected; envelope payloads validate against the schemas.
- **Seed:** the counts of §8.3 (Todos 5 · Por responder 2 · Nuevos 2 · Esperando 1 · Cerrados 3; one queued; 110 outside the window); seed staff roles per §8.1 (no `automation` anywhere).
- **Architecture test:** `application/ports/ai.py`, `application/{copilot,tools,automation,routing}` and `domain/routing` no longer exist.

**Frontend.** Every gate passes, including `check:api` after `gen:api`. The tests below are required:

- **`model.test.ts` (cases):** filters, slugs (old slugs → Todos), `countForFilter`, `inboxStatusMeta`, `formatSla` (null after the first response, at risk ≤ 5 min, vencido), `closeReasonLabel`.
- **`model.test.ts` (conversation):** `arrivalLine` (each reason, someone else's case), `closureLine`, `validateCloseForm`/`toCloseRequest`, `CLOSED_NOTICE` texts, `turnVariant` (no bot).
- **`model.test.ts` (workspace):** URL parse/serialize with `historial` and without `panel`/`apoyo`.
- **`model.test.ts` (customer-chat):** conversation switch on a new `caseId`, past blocks, status lines.
- **Render tests:**
  - Workspace: two columns, no support panel, the five tiles with counts, a Cerrados card, the empty states;
  - `ConversationPane`: the closed read-only footer, the not-assignee footer, the "Casos anteriores" button;
  - `CaseHistorySheet`: list → transcript → back;
  - `CloseCaseDialog`: required reason, note counter, the customer preview in pt for a pt case;
  - simulator: past conversations and writing after a close.
- **Realtime:** the `patchInbox` refetch keys, the toast copy for `previousCaseId`, and `inbox.counts` with `closed`.

**Done:**
- the §1 grep is clean;
- both apps run against a fresh database;
- a live check covers: the two-window chat; closing 101 with "Resuelto" → it appears in Cerrados and the customer sees the notice; the customer writes again → a new case with "Volvió a escribir" and "Casos anteriores (1)"; the Rafael queue → drain; Patricia's history shows Julián's case read-only;
- no console errors.

## 11. Seams for later slices (do not build now)

- **Slice 3 (supervision):**
  - `AssignmentReason.manual`; `AssignCase` with a chosen analyst (rule 3 enforced); reassignment `assigned | in_progress → assigned`;
  - supervision topics (`team`, `queue:<language>`); the `queuedCases` rail indicator;
  - the supervisor read-only Workspace view of any case;
  - audit queries over `event_log`;
  - an optional supervisor close.
- **Slice 4 (administration):** staff CRUD, roles, languages, teams, unlock, and `staff.*` events.
- **Slice 5:** Playwright e2e of every flow above.
- **Not planned:** capacity caps, presence, typing indicators, read receipts to the customer, customer session revocation, CSAT.

## 12. Integration notes (2026-10-03)

- **Contract.** `backend/openapi.json` re-exported and `frontend/src/lib/api/schema.gen.ts` regenerated
  (`export_openapi --check` and `pnpm check:api` both clean). Every frontend API type is an alias of
  `Schemas[...]`, and every call goes through the typed `openapi-fetch` clients. Socket payloads are cast
  to the same schema types (the contract test checks that they validate against them).
- **Final truths that differ from the first draft of this file:**
  - closing a queued case through the API answers 403 `case_not_assigned`, not 409 (§4.4);
  - `CloseCaseRequest.note` is required and nullable, exactly as §5.2 writes it: a body without `note`
    is a 422, and the frontend always sends it (`toCloseRequest`);
  - case 104 also carries the "volvió a escribir" banner, because it follows 110 (§8.3);
  - the §1 done-check grep filters "Por responder", the pt opened notice and `test_architecture.py`.
- **Live check** (real uvicorn server on a fresh SQLite file, scripted over REST and the WebSocket):
  seed counts 5/2/2/1/3 → a fresh customer writes (assigned to Daniela in the same request, `case.assigned`
  and `inbox.counts` on her socket, Nuevos 3) → she opens it (Por responder 3) → she replies
  (`firstResponseAt` set, Esperando 2, the customer socket gets the turn) → the customer answers
  (Por responder 3) → she closes with `resolved` and a padded note (trimmed; a second close and a write
  are 409 `case_closed`; Todos 5, Cerrados 4, the case first in Cerrados) → the customer gets the es
  closing notice over the socket and REST, never the reason or the note → the customer writes again (new
  case with `previousCaseId`, `with_agent`, `conversation.updated` with the new `caseId`, `case.assigned`
  with `previousCaseId`, Nuevos 3 / Cerrados 4, the "volvió a escribir … (resuelto)" banner before the
  assignment banner, `previousCaseCount` 1, `/history` lists the closed case) → the customer's past list
  and detail work, another customer's case is 404 → Patricia's 108 history lists 104 and 110, Daniela reads
  110 read-only and gets 403 on writing, an unrelated analyst gets 403 → Daniela pauses, Rafael (pt) waits
  in the queue, Daniela back to available drains Rafael's case and 109 (`queue_drained`, "Cola en
  portugués", `waitedSeconds`). 56/56 checks passed, no error lines in the server log.
- **Not yet done:** a real browser pass (two windows, console errors, 1280 px). It belongs to slice 5's
  Playwright scenarios unless someone runs it by hand first.
