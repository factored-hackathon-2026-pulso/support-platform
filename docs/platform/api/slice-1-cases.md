# Slice 1 contract · cases, live chat and the customer simulator

> **Partly superseded (2026-10-03).** The product scope was cut to a chat-only support platform
> (no AI, no routing tiers, no copilot, no tools, no customer file, no calls or email, no
> automation role). `slice-2-case-lifecycle.md` §1 lists every part of this contract that is
> removed and what replaces it, and its §2–§7 replace the enums, the state machine, the inbox
> statuses, the close request and the seed. Where the two files disagree, slice 2 wins. This
> file is kept as the record of slice 1.

Status: **implemented and integrated** (backend agent + FE agent `inbox` + FE agent `conversation`, in parallel;
integration notes in §11).
Scope: the analyst ↔ customer chat works for real with **no AI**: a customer opens `/cliente`, picks a seeded
customer and writes; a case is created, routed through judge → tree → ai_agent (null responders that abstain) →
human, assigned to an available analyst who speaks the language (rule 3, policy id `H1`), shows up live in that
analyst's **Casos** list; the analyst opens it and replies; the customer sees the reply live. Reloads restore
everything. The Workspace also shows a seeded inbox with every status of the canvas.

Read first: `../ENGINEERING_BRIEF.md` (wins over this file), `../adr/0001-architecture.md`,
`backend/README.md`, `frontend/ARCHITECTURE.md`. (`AI_INTEGRATION.md` was deleted on 2026-10-03.) Extend slice 0 foundations (UoW + event log, `retry_on_conflict`,
`ProblemCode` registry, `RealtimeProjector`/`TopicMapper`, `RealtimeClient`, handler registry, `Schemas[...]`);
never fork them.

Conventions in this file: JSON is camelCase; Python is snake_case; `datetime` = ISO-8601 UTC with `Z`; `?` = optional
member; `T | null` = member always present, may be null. Schema names in **bold monospace** are the Pydantic class
names, so the frontend reads them as `Schemas['CaseSummary']` after `pnpm gen:api`.

---

## 0. Parallel-work protocol

1. **Backend, first milestone (before any logic):** add the schemas of §3/§4 (`api/schemas/cases.py`,
   `api/schemas/customer.py`, `api/schemas/availability.py`), the routes with their final signatures (they may
   raise `NotImplementedError` → 500 at first), the new `ProblemCode` members, then
   `uv run python -m cc_platform.scripts.export_openapi`. From then on `backend/openapi.json` is the contract.
2. **FE agents:** run `pnpm gen:api` as soon as `backend/openapi.json` has these schemas (re-run whenever it
   changes). Until then, write code against the names in this file (`Schemas['CaseSummary']`…); never hand-edit
   `schema.gen.ts`. Tests mock each feature's `api.ts`, so they do not need the backend.
3. Field names, enum values, topic names, envelope types, query keys and public exports below are **frozen**
   for the slice. A change needs this file updated first.

---

## 1. Domain

### 1.1 Enums (shared vocabulary, aligned with `contracts/synthetic-sample/platform_history.json`)

| Enum (Python / OpenAPI name) | Values | Notes |
|---|---|---|
| `CaseChannel` | `app_chat`, `web_chat`, `phone`, `email` | Contract `case.channel` subset (`whatsapp`, `video` out of scope). Only `app_chat`/`web_chat` are functional; `phone`/`email` exist in seeds and render read-only. |
| `Language` (exists, people) | `es`, `pt` | Reused for cases and turns. |
| `CaseOrigin` | `customer`, `regulator`, `branch` | Contract `case.origin`. `regulator`/`branch` = the bank must call the customer (outbound follow-up). Never a "sucursal" channel. |
| `CaseTopic` | `consultar_movimientos`, `consultar_cargo`, `disputar_cargo`, `cobro_duplicado`, `estado_disputa`, `fraude_urgente`, `hablar_con_humano`, `fuera_de_alcance`, `problema_app` | Contract `case.topic` (judge taxonomy). **Nullable in slice 1**: the null judge cannot classify, so live cases have `topic: null` ("Sin clasificar"). Known gap vs the contract's `required`. |
| `CasePriority` | `low`, `medium`, `high` | New live cases: `medium` (no judge yet). |
| `CaseStatus` | `routing`, `queued`, `assigned`, `in_progress`, `in_call`, `to_call`, `awaiting_approval`, `closed` | Stored state machine, §1.3. `awaiting_approval` is declared now but only produced in slice 3. |
| `InboxStatus` | `new`, `to_reply`, `live`, `to_call`, `waiting` | Derived canvas bucket, §1.4. |
| `TurnAuthorRole` | `customer`, `analyst`, `system`, `tree`, `judge`, `ai_agent`, `copilot` | Contract `turn.author_role`. Slice 1 writes `customer`, `analyst`, `system`; seeds also use `tree`/`ai_agent` ("bot" turns). `copilot` never authors a chat turn. |
| `TurnKind` | `message`, `routing`, `notice` | `message` = conversational; `routing` = staff-only banner explaining how the case reached the analyst; `notice` = platform note (e.g. "Recibimos tu mensaje"). Slice 3 adds `action` (verified tool-call cards). |
| `TurnAudience` | `everyone`, `staff` | `staff` turns never reach the customer (REST or socket). |
| `Tier` (exists, routing) | `judge`, `tree`, `ai_agent`, `human`, `supervisor` | Move `Tier`/`RoutingOutcome` to `domain/routing/values.py` and re-export from `application/routing/ports.py` (domain cannot import application). |
| `RoutingOutcome` (exists) | `resolved`, `mitigated`, `handed_off`, `abstained` | |
| `RouteStopKind` | `entry`, `tier`, `queue`, `assignee` | Read model of "Cómo llegó a ti", §3.4. |
| `AssignmentReason` | `language_least_loaded`, `queue_drained`, `outbound_followup` | |
| `ChannelSessionKind` | `app_session`, `web_session`, `caller_number`, `email_address`, `outbound_call` | Contract `identity_check.channel_session` subset. |
| `AvailabilityStatus` | `available`, `paused` | Canvas "Disponible" / "En pausa". |
| `ContactReason` | `Transaccional`, `Queja`, `Producto`, `Retención`, `Técnico`, `Comercial` | Contract `case_close.contact_reason` (values are the Spanish literals). |
| `ResolutionCode` | `adjustment`, `escalated_to_area`, `explained`, `compensation`, `correction` | Contract `case_close.resolution_code`. |
| `FollowUp` | `none`, `tomorrow`, `in_two_days` | Close dialog "Seguimiento"; server turns it into `followupAt` (+24 h / +48 h from close). |
| `CustomerConversationStatus` | `waiting_agent`, `with_agent`, `closed` | Customer-facing projection of `CaseStatus`. |
| `CustomerTurnAuthor` | `customer`, `analyst`, `bot`, `system` | Customer-facing author (`tree`/`judge`/`ai_agent` → `bot`). |
| `CustomerSegment` | `Basic`, `Plus`, `Premium` | |
| `CountryCode` | `CO`, `MX`, `AR`, `BR` | |
| `CustomerLocale` | `es-CO`, `es-MX`, `es-AR`, `pt-BR` | |

New id prefixes in `IdPrefix`: `ASSIGNMENT = "ASG"`, `CUSTOMER_SESSION = "CSN"`. Existing: `CASE`, `TRN`, `RST`
(routing step), `CUS`, `STF`, `EVT`.

### 1.2 Aggregates and entities (bounded contexts `cases`, `routing`, `customers`, `people`)

All aggregates extend `AggregateRoot` (optimistic `version`, repositories with compare-and-set, in-memory +
SQLAlchemy adapters, added to the `UnitOfWork` protocol). Every command below runs inside
`retry_on_conflict` and re-checks its rules on fresh state.

**`Case`** (aggregate, `cases`). Fields (contract names in parentheses):

| Field | Type | Notes |
|---|---|---|
| `id` (`case_id`) | `CASE-…` | |
| `customer_id` | `CUS-…` | |
| `channel` | `CaseChannel` | |
| `channel_session` | `ChannelSessionKind` | `app_chat`→`app_session`, `web_chat`→`web_session`; seeds set phone/email ones. |
| `language` | `Language` | From the customer's profile language (no detection in slice 1). |
| `origin` | `CaseOrigin` | |
| `topic` | `CaseTopic \| None` | |
| `priority` | `CasePriority` | |
| `status` | `CaseStatus` | §1.3 |
| `opened_at` | datetime | First customer message (seeds: story time). |
| `sla_due_at` | datetime | `SlaPolicy` (§1.5). |
| `assigned_analyst_id` | `STF-… \| None` | Contract `case.assigned_analyst_id`. |
| `assigned_at`, `queued_at` | datetime \| None | |
| `queue_label` | str \| None | e.g. "Cola de disputas", "Cola de disputas en portugués", "Cola regulatoria". |
| `entry_label`, `entry_summary` | str \| None | Entry point shown in "Cómo llegó a ti" for non-chat origins ("IVR", "CONDUSEF"). Seeds only in slice 1. |
| `last_sequence` | int | Highest turn sequence (0 = no turns). The case CAS makes it gap-free. |
| `last_message_at`, `last_message_author_role`, `last_message_preview` | | Updated by every `kind=message` turn; preview ≤ 140 chars. |
| `assignee_read_sequence` | int | Assignee's read cursor. |
| `live_since` | datetime \| None | Only while `in_call` (seeded). |
| `closed_at` | datetime \| None | |
| `search_text` | str | Lower-cased, accent-stripped `"<customer name> <case id>"` (portable `LIKE` search). |

Behaviour (each records the event in §1.6):
`Case.open(...)` → `routing`; `append_turn(turn_fields)` → assigns `sequence = last_sequence + 1`, updates the
`last_message_*` fields for `message` turns; `queue(label)`; `assign(analyst_id, at)`; `mark_read(staff_id, up_to)`
(monotonic, clamped to `last_sequence`; `assigned → in_progress` when the assignee opens it); `close(...)`.

**`Turn`** (entity, `cases`; append-only, own repository, never updated): `id (TRN-…)`, `case_id`, `sequence`,
`kind`, `audience`, `author_role`, `author_id` (`STF-…` / `CUS-…` / `component_id@component_version` / `None` for
system), `text`, `language`, `created_at` (`event_time`), `client_message_id: str | None`,
`evidence_ids: tuple[str, ...]` (always empty in slice 1), `from_suggestion_id: None` (slice 2 seam).
Unique `(author_id, client_message_id)` when `client_message_id` is set. A turn is created only through
`Case.append_turn` in the same Unit of Work as the case save, so the case CAS serialises sequence numbers.

**`Assignment`** (entity, `cases`): `id (ASG-…)`, `case_id`, `staff_id`, `reason: AssignmentReason`,
`policy_rule_id: str | None` (`H1` when the case is Portuguese; `A2` for regulator follow-ups),
`open_cases_at_assignment: int`, `strategy: str` (`"language_least_loaded@1"`), `assigned_at`, `assigned_by`
(actor `system`). One row per assignment (slice 1 never reassigns).

**`RoutingStep`** (entity, `routing`), contract `routing_step`: `id (RST-…)`, `case_id`, `tier`, `component_id`,
`component_version`, `component_name: str | None` (display, e.g. "Agente de disputas"), `outcome`, `reason_code`,
`policy_rule_id`, `confidence`, `inputs_used: tuple[str, ...]`, `handoff` (`request`, `verified_facts`,
`actions_taken`, `evidence`, `open_questions`, `summary`), `occurred_at` (when the step ended).

**`CustomerCaseSlot`** (aggregate, `cases`): `customer_id` (PK), `open_case_id: CASE-… | None`, `version`.
Invariant: **at most one open case per customer**. Opening a case and closing it both CAS the slot, so two
concurrent "first messages" create one case (the loser retries and appends to it).

**`AnalystAvailability`** (aggregate, `people`): `staff_id` (PK), `status: AvailabilityStatus`, `since`,
`version`. Missing row = `paused` (safe default).

**`Customer`** (read model, `customers`; masked, seeded, never written by use cases in slice 1): `id (CUS-…)`,
`display_name`, `segment`, `country`, `city`, `locale`, `language`, `customer_since: date`,
`document_type: str` ("CC", "CE", "Pasaporte", "DNI", "INE"), `simulator: bool` (listed in the picker),
`suggestions: tuple[str, ...]` (simulator opener chips, written in the customer's locale). Slice 2 adds the file
(products, complaints, contacts, who-saw-what).

### 1.3 `CaseStatus` state machine

```
            open (customer first message)
                 │
                 ▼
            ┌─────────┐  no eligible analyst   ┌────────┐
            │ routing │ ─────────────────────▶ │ queued │
            └─────────┘                        └────────┘
                 │ assign                          │ assign (queue drain)
                 ▼                                 ▼
            ┌──────────┐  assignee opens (read) or replies   ┌─────────────┐
            │ assigned │ ──────────────────────────────────▶ │ in_progress │◀─┐
            └──────────┘                                     └─────────────┘  │ slice 3: approval decided
                                                               │   │   ▲      │
                     slice 3: request approval ────────────────┘   │   └──────┤ awaiting_approval
                     later slice: start/end call (in_call ⇄ in_progress) ────┘
   seeds / back office (origin regulator|branch) ──▶ to_call ──(later: call)──▶ in_call

   close: assigned | in_progress | in_call | to_call ──▶ closed   (terminal; a new customer message opens a new case)
```

| From → To | Trigger (use case) | Event |
|---|---|---|
| ∅ → `routing` | `PostCustomerTurn` (no open case) | `case.opened` |
| `routing` → `assigned` | `RouteCase` (eligible analyst) | `case.assigned` |
| `routing` → `queued` | `RouteCase` (nobody eligible) | `case.queued` |
| `queued` → `assigned` | `DrainQueue` | `case.assigned` |
| `assigned` → `in_progress` | `MarkCaseRead` or `PostAnalystTurn` by the assignee | `case.status_changed` (`reason: opened_by_assignee`) |
| `assigned`/`in_progress`/`in_call`/`to_call` → `closed` | `CloseCase` | `case.closed` + `case.status_changed` (`reason: closed`) |
| anything else | — | `InvalidTransitionError` → 409 `invalid_transition` (extension `currentStatus`); closing a closed case → 409 `case_closed` |

`in_call`, `to_call`, `awaiting_approval` are only produced by seeds in slice 1 (layout seams).

### 1.4 Canvas statuses (`InboxStatus`) — derived, never stored

Computed server-side in the read model (one pure function in `application/cases`, unit-tested) and returned as
`inboxStatus`; the frontend never re-derives it.

| `status` | Condition | `inboxStatus` | Canvas tile | Sub-label (card `title`, list rail `aria-label`) | Tone token |
|---|---|---|---|---|---|
| `assigned` | — | `new` | Nuevos | "Nuevo" | `accent` |
| `in_progress` | last `message` turn author is `customer` | `to_reply` | Por responder | "Por responder" | `warn` |
| `in_progress` | last `message` turn author is anyone else (analyst, bot), or no message | `waiting` | En espera | "Esperando al cliente" | `waiting` |
| `in_call` | — | `live` | En curso | "En llamada" | `success` |
| `to_call` | — | `to_call` | Por llamar | "Por llamar" | `callout` |
| `awaiting_approval` | — | `waiting` | En espera | "Esperando aprobación" | `waiting` |
| `routing`, `queued`, `closed` | — | `null` | (not in any inbox) | | |

Movements in slice 1: customer writes → `to_reply`; assignee replies → `waiting`; customer writes again →
`to_reply`; assignee opens a `new` case → `to_reply`/`waiting`; close → leaves the inbox.

### 1.5 SLA and last interaction

- `slaDueAt` is stored. `SlaPolicy` (Strategy, `application/cases/sla.py`, synthetic policy): chat
  (`app_chat`/`web_chat`) `high` 30 min · `medium` 60 min · `low` 4 h from `opened_at`; `email` 24 h; outbound
  (`regulator`/`branch`) 48 h. Seeds set `slaDueAt` explicitly.
- **"SLA x" is computed in the frontend** (`formatSla(summary, now)` in `features/cases/model.ts`, ticking every
  30 s with the real clock):
  - `status === 'in_call'` → `"En llamada · " + formatTimer(now − liveSince)`, not at risk.
  - remaining = `slaDueAt − now`. `≤ 0` → `"SLA vencido"` (at risk). `< 60 min` → `"SLA {ceil(min)} min"`.
    `< 48 h` → `"SLA {floor(h)} h"`. Otherwise `"SLA {floor(days)} días"`.
  - At risk (orange `warn` text) when remaining `≤ 15 min`.
- `lastInteractionAt` = `last_message_at` (fallback `opened_at`); card shows `formatRelativeTime(lastInteractionAt, now)`
  ("hace 2 min"); `in_call` shows "ahora".

### 1.6 Domain events (append-only `event_log`, contract-shaped, snake_case payloads)

| `event_type` | `entity` / `entity_id` | Actor | Payload (besides the envelope fields) |
|---|---|---|---|
| `case.opened` | `case` / case id | customer | `customer_id, channel, channel_session, language, origin, topic, priority, sla_due_at` |
| `turn.created` | `turn` / turn id | author (customer, staff, component or system) | `sequence, kind, audience, author_role, author_id, text, language, client_message_id, evidence_ids, from_suggestion_id` |
| `routing_step.recorded` | `routing_step` / step id | the component (`judge`/`tree`/`ai_agent`, id `component@version`) | contract `routing_step` fields (`tier, component_id, component_version, outcome, reason_code, policy_rule_id, confidence, inputs_used, handoff`) |
| `case.queued` | `case` | system | `queue_label, reason_code` (`no_available_analyst`), `language, policy_rule_id` |
| `case.assigned` | `case` | system | `assignment_id, assigned_analyst_id, previous_analyst_id, reason, policy_rule_id, open_cases_at_assignment, strategy` |
| `case.status_changed` | `case` | staff or system | `from_status, to_status, reason` |
| `case.read` | `case` | analyst | `staff_id, read_sequence` (only when the cursor moves) |
| `case.closed` | `case_close` / case id | analyst | contract `case_close`: `closed_at, closed_by_role, closed_by_id, resolved, contact_reason, resolution_code, followup_at`, plus `csat_requested` |
| `staff.availability_changed` | `staff` / staff id | analyst | `from_status, to_status` |
| `customer.session_started` | `customer` / customer id | customer | `session_id, channel, channel_session` |

Seeds record their events with the story's `occurred_at` (so the log and "Cómo llegó a ti" agree).

---

## 2. Routing and assignment

### 2.1 Flow

1. `PostCustomerTurn` (customer has no open case): in one UoW — CAS the `CustomerCaseSlot`, `Case.open`
   (`routing`, `SlaPolicy`), append the customer `message` turn (seq 1) and a `notice` turn for everyone (seq 2,
   case language, copy §2.4). Commit.
2. `RoutingProcessManager` (bus subscriber on `case.opened`) schedules `RouteCase(case_id)` through a
   `BackgroundTasks` port (in-process adapter: `asyncio.create_task` with kept references; tests: an inline adapter
   or `await runner.drain()`). The POST response never waits for routing; clients must not assume a status.
3. `RouteCase`: build a `RoutingContext` (masked: customer ref, channel, language, origin, customer-visible
   transcript), call each `Responder` of `ResponderRegistry.chain()` **outside** the UoW, then in one UoW
   (`retry_on_conflict`): reload the case; if `status != routing` → no-op (idempotent); record every decision as a
   `RoutingStep`; stop at the first `resolved`/`mitigated`/`handed_off` (none in slice 1); then the **human tier**:
   `AssignmentPolicy.choose(...)` → `Case.assign` + `Assignment` + staff-only `routing` turn, or `Case.queue` +
   staff-only `routing` turn. Commit.
4. Null responders (`infrastructure/routing/null_responders.py`, registered in `bootstrap/container.py`):
   `NullJudge`, `NullTree`, `NullAiAgent`, components `null_judge@0.1.0`, `null_tree@0.1.0`, `null_ai_agent@0.1.0`.
   Each returns `RoutingDecision(outcome=abstained, reason_code="component_not_connected", inputs_used=(),
   handoff=None)`. Every one is recorded as a `routing_step` + `routing_step.recorded` event, so the AI team sees
   the full chain. The human tier is the terminal handler, not a `Responder` (it records an `Assignment`, not a
   routing step; a human `routing_step` at close is a later decision).
5. Recovery at startup (after seeding): re-run `RouteCase` for cases left in `routing`, then `DrainQueue`.

### 2.2 `AssignmentPolicy` (Strategy, `application/routing/assignment.py`)

```python
class AssignmentPolicy(Protocol):
    def choose(self, request: AssignmentRequest, candidates: Sequence[AnalystCandidate]) -> AssignmentChoice | None: ...
```

- Candidates (`AnalystDirectory.candidates()` query port): active staff holding `analyst`, availability
  `available`, with `open_case_count` (cases assigned to them in `assigned|in_progress|in_call|to_call|awaiting_approval`)
  and `last_assigned_at`.
- `LanguageLeastLoadedPolicy`: keep candidates that speak `case.language` (**rule 3**: `pt` only to a Portuguese
  speaker; an available Spanish-only analyst never gets a `pt` case); pick the minimum of
  `(open_case_count, last_assigned_at or epoch, staff_id)`. Result `reason=language_least_loaded`,
  `policy_rule_id="H1"` if `language == pt` else `None`.
- Nobody eligible → `Case.queue(label)` with `queue_label` "Cola de disputas" (es) / "Cola de disputas en
  portugués" (pt), event `case.queued` (`reason_code=no_available_analyst`, `policy_rule_id="H1"` for pt).
  The customer still sees the "Recibimos tu mensaje" notice; its conversation stays `waiting_agent`.
- **`DrainQueue`** runs when an analyst becomes `available` (subscriber on `staff.availability_changed`, via
  `BackgroundTasks`) and at startup: oldest `queued` first (`opened_at`), same policy per case
  (`reason=queue_drained`), each case in its own UoW.
- Paused analysts get no new cases ("Los que ya tienes siguen contigo"). Availability persists across sign-ins
  (no presence in slice 1; documented gap).
- No capacity cap in slice 1 (seam: `max_open_cases` in the policy).

### 2.3 Seeded availability (so the demo lands on Daniela)

Daniela Ríos `available`; Julián Ortega, Paula Medina, Sebastián Cárdenas, Felipe Echeverri `paused`. Signing in as
Sebastián (es, pt, 0 cases) and switching to "Disponible" demonstrates least-loaded balancing.

### 2.4 Server-written texts (backend templates; Spanish for staff, case language for customers)

Staff-only `routing` turns (author `system`, always Spanish):
- assigned after the null chain: "Ningún nivel automático está conectado todavía: el juez, el árbol y el agente
  de IA pasaron el caso sin atenderlo. Asignado a {Nombre Apellido} porque está disponible y habla {español|portugués}."
  (pt cases append " (regla 3)").
- queued: "No hay personas disponibles que hablen {español|portugués}: el caso espera en la {cola}."
- assigned from the queue: "Asignado a {Nombre Apellido} después de {n} min en la {cola}."

Customer-visible `notice` turns (author `system`, audience `everyone`, case language):
- opened — es: "Recibimos tu mensaje. En unos minutos te responde una persona del equipo." · pt: "Recebemos sua
  mensagem. Em poucos minutos uma pessoa da equipe vai te responder."
- closed — es: "La conversación terminó. Gracias por comunicarte con LATAM Bank." · pt: "A conversa foi encerrada.
  Obrigado por falar com o LATAM Bank."

---

## 3. REST API · analyst side

Auth: staff session (`Authorization: Bearer`, scheme `SessionToken`). Visibility rule for a case: the
**assignee** (analyst) or any **supervisor** may read; only the assignee may write. Unknown or malformed
`caseId` → 404 `not_found`; existing case not visible to an analyst → 403 `case_not_assigned`.
Declare `/cases/inbox` before `/cases/{caseId}` (and validate `caseId` with the `CASE-` pattern).

### 3.1 Endpoints

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/cases/inbox?status=&q=` | analyst | `status?: InboxStatus` (omit = Todos); `q?: string` (1–80 chars, trimmed; matches customer name, accent/case-insensitive, or case id, contains) | 200 **`InboxResponse`** | 401, 403 `forbidden`, 422 `validation_error` |
| `GET /api/v1/cases/{caseId}` | assignee analyst, supervisor | — | 200 **`CaseDetail`** | 401, 403 `case_not_assigned`, 404 |
| `GET /api/v1/cases/{caseId}/turns?cursor=&afterSequence=&limit=` | assignee analyst, supervisor | `limit` 1–200 (default 50). No params → latest page. `cursor` (opaque, from `olderCursor`) → the page before it. `afterSequence` (int) → the **first** `limit` turns with `sequence > n`, ascending (catch-up after reconnect/gap; the client pages with the last sequence it got until a page has fewer than `limit` items). `cursor` and `afterSequence` are mutually exclusive (422). | 200 **`TurnPage`** | 401, 403 `case_not_assigned`, 404, 422 |
| `POST /api/v1/cases/{caseId}/turns` | assignee analyst | header `Idempotency-Key` (required, = `clientMessageId`); body **`PostAnalystTurnRequest`** | 201 **`PostTurnResponse`** (200 + `Idempotent-Replayed: true` on replay) | 401, 403 `case_not_assigned`, 404, 409 `case_closed`, 409 `channel_not_supported`, 409 `idempotency_conflict`, 422 `validation_error` |
| `POST /api/v1/cases/{caseId}/read` | assignee analyst | **`MarkReadRequest`** | 200 **`CaseSummary`** | 401, 403 `case_not_assigned`, 404, 422 |
| `POST /api/v1/cases/{caseId}/close` | assignee analyst | **`CloseCaseRequest`** | 200 **`CaseDetail`** | 401, 403 `case_not_assigned`, 404, 409 `case_closed`, 409 `invalid_transition`, 422 |
| `GET /api/v1/me/availability` | analyst | — | 200 **`Availability`** | 401, 403 |
| `PUT /api/v1/me/availability` | analyst | **`UpdateAvailabilityRequest`** | 200 **`Availability`** (same status = no event) | 401, 403, 422 |

Rules enforced in the use cases (not in routers):
- `PostAnalystTurn`: case `status ∈ {assigned, in_progress}` (`assigned` is moved to `in_progress` and the read
  cursor to the new turn); `channel ∈ {app_chat, web_chat}` else 409 `channel_not_supported`; closed → 409
  `case_closed`; text trimmed, 1–4000 chars, newlines kept; `language = case.language`;
  dedupe on `(author_id, clientMessageId)`: same id + same text → replay (200, original turn); same id + other
  text → 409 `idempotency_conflict`; header ≠ body id → 422 `validation_error`.
  `evidenceIds`/`fromSuggestionId` are **not** accepted in slice 1 (`extra="forbid"` → 422); slice 2/3 add them
  with rule 9 checks.
- `MarkCaseRead`: monotonic, clamped to `lastSequence`; `assigned → in_progress`.
- `CloseCase`: from `assigned|in_progress|in_call|to_call`; appends the customer `notice` turn, frees the
  `CustomerCaseSlot`, emits `case.closed`. `awaiting_approval`/`routing`/`queued` → 409 `invalid_transition`.
- Inbox: cases with `assigned_analyst_id = me` and `inboxStatus != null`. Sort: `live` first (`liveSince` asc),
  then `slaDueAt` asc, then `openedAt` asc. **`counts` always cover the whole inbox** (ignore `status` and `q`):
  the counters are the filters. Max 200 items (an inbox is small; no pagination).

### 3.2 Schemas

```ts
InboxResponse      { items: CaseSummary[]; counts: InboxCounts; serverTime: datetime }
InboxCounts        { all: int; new: int; toReply: int; live: int; toCall: int; waiting: int; computedAt: datetime }

CaseSummary {
  id: string                         // CASE-…
  version: int                       // realtime: apply only when newer than the cached one
  customer: CustomerRef              // { id: string; displayName: string }
  channel: CaseChannel
  language: Language
  origin: CaseOrigin
  topic: CaseTopic | null
  priority: CasePriority
  status: CaseStatus
  inboxStatus: InboxStatus | null
  openedAt: datetime
  slaDueAt: datetime
  lastInteractionAt: datetime
  liveSince: datetime | null         // in_call only
  preview: string | null             // last message text (≤140) or, with no messages, the last staff-visible turn
  previewAuthorRole: TurnAuthorRole | null
  assignedAnalystId: string | null
  unreadCount: int                   // customer messages with sequence > assignee read cursor
  lastSequence: int
  closedAt: datetime | null
}

CaseDetail {
  case: CaseSummary
  customer: CustomerProfile
  channelIdentity: ChannelIdentity
  assignment: AssignmentOut | null
  routing: RoutingSummary            // "Cómo llegó a ti"
  closure: CaseClosure | null
  capabilities: CaseCapabilities     // computed for the caller
}
CustomerProfile    { id; displayName; segment: CustomerSegment; country: CountryCode; city: string;
                     locale: CustomerLocale; language: Language; customerSince: date; documentType: string }
ChannelIdentity    { kind: ChannelSessionKind; verified: boolean }     // app/web/caller (IVR) true; email/outbound false
AssignmentOut      { id: string; analystId: string; analystName: string; reason: AssignmentReason;
                     policyRuleId: string | null; assignedAt: datetime }
RoutingSummary     { stops: RouteStop[]; inputsUsed: string[] }      // union of the tiers' inputs_used
RouteStop {
  kind: RouteStopKind               // entry | tier | queue | assignee, in chronological order
  label: string | null              // entry/queue: "IVR", "CONDUSEF", "Cola de disputas"; tier: componentName ("Agente de disputas") or null; assignee: analyst name
  tier: Tier | null                 // kind = tier
  componentId: string | null
  componentVersion: string | null
  outcome: RoutingOutcome | null
  reasonCode: string | null         // e.g. component_not_connected, R4_amount_over_limit, language_pt
  policyRuleId: string | null       // e.g. H1, R4, A2
  summary: string | null            // what the stop did (Spanish, from the tier/seed); null → FE default copy
  staffId: string | null            // kind = assignee
  waitedSeconds: int | null         // kind = queue
  occurredAt: datetime
}
CaseClosure        { closedAt; closedById: string; resolved: boolean; contactReason: ContactReason;
                     resolutionCode: ResolutionCode | null; followupAt: datetime | null; csatRequested: boolean }
CaseCapabilities   { canReply: boolean; replyBlockedReason: 'not_assignee' | 'closed' | 'channel_not_supported' | null;
                     canClose: boolean }

Turn {
  id: string                        // TRN-…
  caseId: string
  sequence: int                     // 1-based, gap-free per case (includes staff-only turns)
  kind: TurnKind
  audience: TurnAudience
  authorRole: TurnAuthorRole
  authorId: string | null           // STF-…, CUS-…, component@version, null for system
  authorName: string | null         // customer/analyst display name, component name; null for system
  text: string
  language: Language
  createdAt: datetime
  clientMessageId: string | null
  evidenceIds: string[]             // [] in slice 1
  fromSuggestionId: string | null   // null in slice 1
}
TurnPage           { items: Turn[] /* ascending sequence */; olderCursor: string | null; lastSequence: int }

PostAnalystTurnRequest { text: string; clientMessageId: string /* UUID v4 */ }
PostTurnResponse       { turn: Turn; case: CaseSummary }
MarkReadRequest        { upToSequence: int }
CloseCaseRequest       { resolved: boolean; contactReason: ContactReason; resolutionCode: ResolutionCode | null;
                         followUp: FollowUp; sendCsatSurvey: boolean }
Availability               { status: AvailabilityStatus; since: datetime }
UpdateAvailabilityRequest  { status: AvailabilityStatus }
```

### 3.3 New problem codes (`api/problems.py`, with Spanish default detail)

| Code | Status | Default detail |
|---|---|---|
| `case_not_assigned` | 403 | "Este caso no está asignado a ti." |
| `case_closed` | 409 | "Este caso ya está cerrado." |
| `channel_not_supported` | 409 | "Por ahora solo puedes escribir en casos de chat." |
| `idempotency_conflict` | 409 | "Ese mensaje ya se envió con otro texto." |

`ProblemDetails` gains the typed optional extension `currentStatus: CaseStatus | null` (set on
`invalid_transition` and `case_closed`). Reused: `not_found`, `forbidden`, `validation_error`,
`invalid_transition`, `unauthenticated`, `concurrent_update` (should not surface: commands retry).

### 3.4 "Cómo llegó a ti" for a live case (null chain)

`stops`: `tier judge (abstained, component_not_connected)` → `tier tree (abstained)` → `tier ai_agent (abstained)` →
[`queue` with `waitedSeconds`, only if it was queued] → `assignee`. `inputsUsed: []`. FE copy (conversation
`model.ts`): line "Juez → árbol → agente de IA → tú"; abstained/component_not_connected → "Todavía no hay uno
conectado: pasó el caso sin atenderlo."; queue → "Esperó {formatDuration}."; assignee →
"Te llegó porque estás disponible y hablas {español|portugués}{ (regla 3)}" + "Desde {fecha, hora}"; empty inputs →
"Ningún nivel automático leyó datos del cliente." Input names → copy: `customers` "su ficha", `transactions`
"sus movimientos", `complaints` "sus reclamos", `interactions` "sus contactos anteriores", `products`
"sus productos", `digital_events` "su actividad digital", `turn` "la conversación".

---

## 4. REST API · customer side (simulator)

Auth: customer token (`Authorization: Bearer`, OpenAPI scheme `CustomerToken`). HMAC JWT like staff tokens but
`aud = "cc-customer"`, `sub = CUS-…`, `sid = CSN-…`, `channel`, TTL `CC_CUSTOMER_SESSION_TTL_MINUTES` (default 480).
Stateless (no revocation; documented gap). Staff tokens are rejected on customer routes and vice versa (401
`unauthenticated`). The payload must stay a standard base64url JWT payload with `sub`, `aud` and `exp` (seconds): the
simulator reads them, without checking the signature, to restore the chat after a reload (`customer:<sub>` topic,
query key) and to drop an expired token; the server remains the only verifier. The customer can only ever see **their own** cases and only `audience = everyone` turns
(rule 2, policy `R3`).

| Method · path | Auth | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/customer/demo-customers` | none (dev tool) | — | 200 **`DemoCustomerList`** (empty when `CC_SEED_DEMO_DATA=false`) | — |
| `POST /api/v1/customer/sessions` | none | **`CreateCustomerSessionRequest`** | 201 **`CustomerSessionResponse`**; records `customer.session_started` | 404 `not_found` (unknown id, or a customer whose open case is not a chat), 422 |
| `GET /api/v1/customer/conversation?afterSequence=` | customer | `afterSequence?` → only turns after it | 200 **`CustomerConversationResponse`** | 401 |
| `POST /api/v1/customer/conversation/turns` | customer | header `Idempotency-Key` (= `clientMessageId`); body **`PostCustomerTurnRequest`** | 201 **`PostCustomerTurnResponse`** (200 + `Idempotent-Replayed: true` on replay) | 401, 409 `idempotency_conflict`, 422 |

Rules:
- "Current conversation" = the customer's open case; if none, their most recent closed case (so the simulator keeps
  showing the ended chat); `null` if they never wrote. `turns` = up to the latest 200 `everyone` turns, ascending.
- Posting: no open case → opens one (§2.1, `channel` from the session, `caseCreated: true`); otherwise appends to
  the open case whatever its status (`routing`, `queued`, `assigned`, `in_progress`; status never changes because
  of a customer message). Same dedupe and text rules as the analyst side.

```ts
DemoCustomerList   { items: DemoCustomer[] }   // simulator customers first, then customers with an open chat case
DemoCustomer {
  id: string; displayName: string; locale: CustomerLocale; language: Language; country: CountryCode; city: string;
  segment: CustomerSegment
  suggestions: string[]                         // opener chips in the customer's own voice/locale
  openConversation: { caseId: string; channel: CaseChannel; status: CustomerConversationStatus } | null
}
CreateCustomerSessionRequest { customerId: string; channel?: 'app_chat' | 'web_chat' /* default app_chat; ignored while a case is open */ }
CustomerSessionResponse      { token: string; expiresAt: datetime; customer: CustomerSelf; channel: CaseChannel }
CustomerSelf                 { id: string; displayName: string; locale: CustomerLocale; language: Language }

CustomerConversation {
  caseId: string
  status: CustomerConversationStatus  // routing|queued → waiting_agent; assigned|in_progress|in_call|to_call|awaiting_approval → with_agent; closed
  channel: CaseChannel; language: Language
  openedAt: datetime; closedAt: datetime | null
  agentName: string | null            // assignee first name ("Daniela") while with_agent
  lastSequence: int                   // highest sequence among customer-visible turns
}
CustomerTurn {
  id: string; sequence: int           // case sequence (customer-visible turns may skip numbers)
  kind: 'message' | 'notice'
  authorRole: CustomerTurnAuthor      // customer | analyst | bot | system
  authorName: string | null           // analyst first name; bot → null (FE: "Asistente automático")
  text: string; language: Language; createdAt: datetime
  clientMessageId: string | null      // only on the customer's own messages
}
CustomerConversationResponse { conversation: CustomerConversation | null; turns: CustomerTurn[] }
PostCustomerTurnRequest      { text: string; clientMessageId: string }
PostCustomerTurnResponse     { turn: CustomerTurn; conversation: CustomerConversation; caseCreated: boolean }
```

---

## 5. Realtime

One socket `/api/v1/ws?token=` for both kinds of principal. The server tells them apart by the token audience
(staff token → `Actor`; customer token → `CustomerActor`). Generalise `RealtimeHub.connect(staff_id=…)` to
`principal_id`. `welcome.data` = `{connectionId, staffId}` (staff) or `{connectionId, customerId}` (customer).

### 5.1 Topics and access

| Topic | Who may subscribe | Check |
|---|---|---|
| `inbox:<STF-id>` | that staff member; supervisors | existing sync policy |
| `case:<CASE-id>` | the assignee analyst; supervisors | **async** (needs the case): add a `SubscriptionAuthorizer` use case used by the WS router; `TopicAccessPolicy` keeps the role checks |
| `customer:<CUS-id>` | **only** the customer token whose `sub` is that id | new `TopicKind.CUSTOMER` (key prefix `CUS`); staff → `forbidden` |
| `approvals` | supervisors (unchanged) | |

A customer connection subscribing to anything else gets an `error` envelope with `code: forbidden`.

### 5.2 Envelopes

Shape (unchanged): `{ type, id, occurredAt, data: { entity, entityId, caseId, actor: { role, id }, payload } }`.
On `customer:` topics `actor.id` is `null` unless the actor is that customer.

The generic `RealtimeProjector` must **not** forward events of the `cases`, `routing` and `customers` contexts nor
`staff.availability_changed` (add an opt-out to `TopicMapper`, e.g. `suppress(event_types)`): a new
**`CaseRealtimeProjector`** (bus subscriber, `application/cases/realtime.py`) owns them and publishes only the
envelopes below, with camelCase payloads equal to the REST schemas. Envelope `id` = id of the source event
(unique per `type`). A contract test validates every payload against its schema.

| `type` | Topic(s) | `payload` | Emitted after |
|---|---|---|---|
| `turn.created` | `case:<id>` | `Turn` | every `turn.created` |
| `turn.created` | `customer:<customerId>` | `CustomerTurn` | `turn.created` with `audience=everyone` |
| `case.updated` | `case:<id>` and `inbox:<assignee>` (if any) | `CaseSummary` (fresh read) | `turn.created`, `case.assigned`, `case.status_changed`, `case.read`, `case.closed` |
| `case.assigned` | `inbox:<assignee>` | `CaseSummary` | `case.assigned` |
| `inbox.counts` | `inbox:<assignee>` | `InboxCounts` | each `case.updated` sent to an inbox |
| `availability.updated` | `inbox:<staffId>` | `Availability` | `staff.availability_changed` |
| `conversation.updated` | `customer:<customerId>` | `CustomerConversation` | `case.opened`, `case.queued`, `case.assigned`, `case.status_changed`, `case.closed` |

An envelope bound to several topics (`case.updated` → `case:<id>` + `inbox:<assignee>`) is published **once per
connection** (`RealtimeHub.publish_many`): the assignee with the case open, subscribed to both, receives it once.
Within one kind of principal (staff or customer) a `(type, id)` pair always carries the same payload.

`routing_step.recorded`, `case.queued`, `case.opened` produce no staff envelope of their own (nobody holds the case
yet; "Cómo llegó a ti" is read through REST).

### 5.3 Ordering, dedupe, reconnect (both FE agents follow this)

- **Turns:** merge by `id` (dedupe), reconcile optimistic messages by `clientMessageId`, render sorted by
  `sequence` (pending optimistic ones last). Staff side: if an incoming `turn.created` has
  `sequence > lastSequence + 1`, fetch `?afterSequence=lastSequence` and merge (gap fill). Customer side has no gap
  detection (visible sequences may skip): it refetches on reconnect.
- **`case.updated`:** apply only when `payload.version > cached.version`.
- **`inbox.counts`:** apply only when `computedAt ≥` the cached `counts.computedAt`.
- Handlers are idempotent (the same `type`+`id` can arrive twice). `RealtimeClient` also drops a repeated
  `(type, id)` before any handler runs (bounded window of recent keys, kept across reconnects; control envelopes
  pass through), so the cache work and the refetches it triggers run once per event.
- **Reconnect:** when `useRealtimeStatus()` goes `reconnecting → open`, invalidate the feature's active queries
  (inbox, case detail, turns / customer conversation). `RealtimeClient` already replays subscriptions.
- Subscribe while mounted (`useRealtimeSubscription`) in parallel with the first fetch; the dedupe merge makes the
  overlap harmless and the gap rule catches a turn committed in between.
- No typing indicators, no presence, no read receipts to the customer in slice 1.

---

## 6. Seed ("Datos de ejemplo", invented people)

Stable ids with helpers like `seed_staff_id`: customers `seed_customer_id(n)` → `CUS-` + `n` zero-padded to 26;
cases `seed_case_id(n)` → `CASE-…`. Times are relative to the clock at **first** seed (`T`); seeding is idempotent
per id (an existing DB keeps its old times: delete `backend/cc_platform.db` or use `CC_PERSISTENCE=memory` to
re-anchor). Seeds go through the domain factories/repositories and record their events with the story's
`occurred_at`; bot turns use seed components (`tree.disputas@ejemplo`, `agent.disputas@ejemplo`,
`judge.entrada@ejemplo`). All analyst turns are by Daniela Ríos (`seed_staff_id(1)`). Stories follow the canvas
with new names; no action cards (slice 3).

### 6.1 Daniela's inbox (7 cases → Todos 7 · Por responder 3 · En curso 1 · Nuevos 1 · Por llamar 1 · En espera 1)

| # | Customer (id n) | Canvas story | Channel · origin · lang | Topic · priority | Status → inbox | Times | Route stops (summary) | Turns (seq order) |
|---|---|---|---|---|---|---|---|---|
| 101 | Marcela Quintana Pardo (1001), Barranquilla CO, Plus, es-CO | Ana: web dispute, withdrawal over the limit | `web_chat` · customer · es | `disputar_cargo` · medium | `in_progress` → **to_reply** (read up to last) | opened T−14m, last msg T−2m, assigned T−1m50s, SLA T+5h | judge "Lo clasificó como disputa de un cargo con tarjeta." → tree (mitigated) "Rama «cargo no reconocido»: encontró el retiro y abrió el reclamo con su confirmación. No cierra: le pasó al agente el cargo verificado." → ai_agent "Agente de disputas" (handed_off, `R4_amount_over_limit`, `R4`) "Escaló porque el retiro supera $1.000.000 y el abono provisional lo decide una persona." → assignee; inputs customers, transactions, interactions | c "hola buenas, hay un cargo en mi tarjeta q no reconozco, me colaboran?" · tree "¿El cargo que no reconoce es el de un retiro en cajero por $1.585.208 COP, del 9 ene?" · c "si, ese es" · tree "Para proteger su cuenta, le propongo bloquear la tarjeta terminada en 8501. ¿Me confirma si está de acuerdo?" · c "si, bloqueela porfa" · routing "Escalado por el agente de disputas: el retiro supera $1.000.000 (regla 10) y el abono lo decide una persona (regla 6)." |
| 102 | Beatriz Salcedo Prieto (1002), Cali CO, Basic, es-CO | Mercedes: live app chat, impatient | `app_chat` · customer · es | `disputar_cargo` · medium | `in_progress` → **to_reply**, SLA at risk, `unreadCount` 3 | opened T−7m, last T−1m, SLA T+9m | judge "Lo clasificó como cargo no reconocido y detectó molestia." → tree (handed_off) "Rama «cargo no reconocido»: no encontró el cargo en sus movimientos, así que no hay nada que bloquear ni reclamar todavía." → assignee; inputs customers, transactions | c "no reconozco un cargo en mi tarjeta y estoy muy molesta" · notice · routing "Lo pasó el árbol: no encontró el cargo en sus movimientos y la clienta escribe molesta." · c "hola?" (T−5m) · c "hola?? hay alguien??" (T−3m) · c "contesten!! qué mal servicio" (T−1m) |
| 103 | Larissa Monteiro Alves (1003), Medellín CO, Plus, pt-BR | Fernanda: Portuguese | `web_chat` · customer · **pt** | `consultar_cargo` · medium | `assigned` → **new** | opened T−2m, SLA T+58m | judge (handed_off, `language_pt`, `H1`) "Detectó portugués: ninguna rama ni agente de IA atiende en portugués todavía (regla 3)." → assignee (`language_least_loaded`, `H1`); inputs customers | c "Oi, cobraram uma coisa que não corresponde, já estou no limite com isso!" · notice (pt) · routing "Asignado a Daniela Ríos porque habla portugués (regla 3)." |
| 104 | Patricia Lozano Vega (1004), Guadalajara MX, Basic, es-MX | Angélica: email, asked for a supervisor | `email` · customer · es | `disputar_cargo` · medium | `in_progress` → **to_reply** (read-only layout) | opened T−22h, last T−1h31m, SLA T+22h | judge → tree "No encontró el cargo en sus movimientos: sin el cargo no hay nada que bloquear ni reclamar todavía." → assignee; inputs customers, transactions | c (T−22h) "Buenas tardes:\n\nEscribo porque hay un cargo en mi tarjeta que no reconozco. No sé decir el comercio ni cuánto fue.\n\nQuedo al pendiente" · routing "Llegó por correo. El árbol no encontró el cargo en sus movimientos." · a (T−21h24m) "Hola, Patricia:\n\nSoy Daniela, de LATAM Bank. Agradezco su mensaje; en este momento estoy revisando su caso." · c (T−18h) "Hola:\n\nAntes de seguir, quiero hablar con un supervisor. No tengo mucha confianza en que esto se resuelva por este medio.\n\nSaludos" · a (T−17h) "Hola, Patricia:\n\nEntiendo su preocupación. Puedo atender su caso con calma y, si llega a hacer falta, mi supervisora lo revisará. Le pido la oportunidad de ayudarle." · c (T−1h31m) "Hola:\n\nBueno, adelante. Veamos si pueden resolverlo.\n\nSaludos" |
| 105 | Claudia Restrepo Varela (1005), Barranquilla CO, Premium, es-CO | Rocío: inbound call, live transcript | `phone` · customer · es (`caller_number`, verified) | `disputar_cargo` · medium | `in_call` → **live** (read-only layout) | `liveSince` T−4m06s, SLA T+1h | entry "IVR" "Verificó su identidad con documento y clave." → queue "Cola de disputas" (`waitedSeconds` 133) → assignee | a "Buenas tardes, gracias por llamar a LATAM Bank. Le saluda Daniela. Claudia, con mucho gusto, ¿en qué le puedo colaborar?" · c "Buenas tardes. Eh, llamo porque no reconozco un cargo de Cable TV por $223.690, yo no tengo nada contratado con ellos." · a "Claro que sí, señora. Permítame un momento en línea mientras reviso su caso." · notice (staff) "En espera · 1 min 15 s" · a "Gracias por esperar. Le consulto, ¿el cargo que no reconoce es Cable TV por $223.690 del 13 de diciembre?" · c "Sí, ese, ese es." · a "Gracias. Para proteger su cuenta le propongo bloquear la tarjeta terminada en 7560. ¿Me confirma si está de acuerdo?" · c "Sí, claro, bloquéela." |
| 106 | Héctor Villarreal Garza (1006), Monterrey MX, Basic, es-MX | Fernando: regulator (CONDUSEF), outbound | `phone` · **regulator** · es (`outbound_call`, not verified) | `disputar_cargo` · low | `to_call` → **to_call** | opened T−2d, SLA T+2d | entry "CONDUSEF" "Recibió el reclamo y lo envió al banco." → queue "Cola regulatoria" "Lo asignó para llamar al cliente." → assignee (`outbound_followup`, `A2`) | routing "Reclamo que llegó por la CONDUSEF. Después de la llamada, la respuesta a la CONDUSEF la firma tu supervisora (regla 11)." |
| 107 | Joaquín Ferreyra Paz (1007), Rosario AR, Plus, es-AR | (new) waiting on the customer | `app_chat` · customer · es | `estado_disputa` · medium | `in_progress` → **waiting** ("Esperando al cliente") | opened T−50m, analyst reply T−25m, SLA T+3h | judge "Lo clasificó como consulta por el estado de una disputa." → tree (handed_off) "Rama «estado de la disputa»: no encontró un reclamo abierto con los datos que dio." → assignee; inputs customers, complaints | c "Hola, ¿me podés decir cómo va el reclamo que hice por un cobro en un súper? Ya pasaron como dos semanas y no sé nada." · notice · routing "Lo pasó el árbol: no encontró un reclamo abierto con esos datos." · a "Hola, Joaquín. Soy Daniela, de LATAM Bank. Para encontrar su reclamo, ¿me podría decir la fecha aproximada del cobro y el monto?" |

Chat customers 1002, 1003, 1007 (and 1001) appear in the simulator with `openConversation`: writing as them moves
their case live (e.g. Joaquín replies → `waiting` → `to_reply`). Email/phone customers are not listed.

### 6.2 Simulator customers (no case; a first message opens a fresh one)

| n | Name | Locale · city | Segment | `suggestions` |
|---|---|---|---|---|
| 2001 | Natalia Guzmán Rincón | es-CO · Bogotá, CO | Premium | "No reconozco un cargo en mi tarjeta" · "Me cobraron dos veces la misma compra" · "Quiero saber cómo va mi reclamo" |
| 2002 | Ximena Robles Treviño | es-MX · Ciudad de México, MX | Basic | "Me aparece un cargo que no hice" · "Me cobraron de más en una compra" · "¿Me ayudan con un cargo que no reconozco?" |
| 2003 | Lucas Benítez Sosa | es-AR (voseo) · Córdoba, AR | Plus | "Hola, ¿me podés ayudar? Tengo un cargo que no reconozco" · "Me cobraron dos veces y necesito que me lo devuelvan" · "¿En qué quedó mi reclamo? Avisame, porfa" |
| 2004 | Rafael Nogueira Costa | pt-BR · Buenos Aires, AR | Plus | "Olá, não reconheço uma compra no meu cartão" · "Fui cobrado duas vezes pela mesma compra" · "Quero falar com uma pessoa" |
| 2005 | Andrés Felipe Cardona | es-CO · Medellín, CO | Basic | "Hay un cargo en mi tarjeta que no reconozco" · "Necesito hablar con una persona" |

Expected demo: Rafael (pt) → Daniela (only available pt speaker); with Daniela paused → queued; Daniela back to
"Disponible" → assigned from the queue, appears live.

---

## 7. Frontend ownership and public APIs

Dependency direction (no cycles): `routes/analyst/workspace` → `features/workspace` → `features/conversation` →
`features/cases`. `features/cases` imports no feature. `features/customer-chat` imports no feature (it may import
label helpers from `@/features/cases`).

### 7.1 Agent `inbox`

Owns: `src/features/cases/**`, `src/features/workspace/**`, `src/routes/analyst/workspace.tsx`,
`src/test/case-fixtures.ts`. Uses existing tokens and primitives only (does **not** edit `styles/index.css`,
`components/ui`, `lib/**`, `app/**`).

- `features/cases`: list column (h1 "Casos", availability pill "Disponible"/"En pausa", collapse button
  "Contraer la lista", six `FilterTile`s Todos · Por responder · En curso · Nuevos · Por llamar · En espera in a
  3-column grid, `SearchInput` "Buscar por cliente o número", paused callout "En pausa · no te llegan casos
  nuevos" / "Los que ya tienes siguen contigo." / "Volver a disponible", case cards, empty "Nada pendiente."),
  collapsed rail (count of `to_reply` in warn, round initials buttons with status ring, `aria-label`
  "{nombre}, {sub-label}"), realtime for inbox/availability.
  Card: left stripe = `inboxStatus` tone; name; top-right "SLA x" (`formatSla`); preview; bottom
  "{Prioridad media} · {App|Web|Teléfono|Correo} · {topic label}" and relative last interaction.
- `features/workspace`: `WorkspaceScreen` (three-column layout, empty state "No tienes contactos abiertos" /
  "Estás disponible. Cuando un agente escale un contacto que te corresponde, aparece aquí."; paused variant),
  auto-selects the first case of the current filter when `caso` is missing (URL `replace`), and the **support panel
  shell**: tabs Copiloto · Herramientas · Cliente (`Tabs`), collapse to an icon rail (`aria-label` "Panel de apoyo,
  contraído", buttons "Mostrar el panel", "Copiloto", "Herramientas", "Cliente"). Content = designed placeholders:
  Copiloto (canvas intro "Pregúntale lo que necesites sobre este cliente…" + disabled "Pregúntale al copiloto" input,
  note "Llega en la próxima entrega"), Herramientas (Acciones · Consultas · Hechas sub-tabs with empty states),
  Cliente (header from `useCaseDetail`: initials, name, "{segment} · cliente desde {mes año} · {city}, {country}",
  mono `{id} · {documentType}`; then `<RoutingSummary caseId />`; then collapsed accordion placeholders Productos ·
  Reclamos · Contactos recientes · Contacto · Quién vio qué).
- URL state (`?caso=&estado=&q=&panel=&lista=&apoyo=`): `estado` slugs `por-responder|en-curso|nuevos|por-llamar|en-espera`
  (absent = Todos), `panel` `copiloto|herramientas|cliente` (default `copiloto`), `lista=contraida`,
  `apoyo=contraido`.

```ts
// src/features/cases/index.ts
export { CaseListPanel } from './components/CaseListPanel'
export interface CaseListPanelProps {
  selectedCaseId: string | null
  filter: InboxStatus | null            // null = Todos
  query: string
  collapsed: boolean
  onSelectCase(caseId: string): void
  onFilterChange(filter: InboxStatus | null): void
  onQueryChange(query: string): void
  onCollapsedChange(collapsed: boolean): void
}
export { useInbox, useAvailability, useUpdateAvailability, useNow } from './hooks'
//   useInbox({ status, q }): UseQueryResult<InboxResponse, ApiProblem>
//   useAvailability(): UseQueryResult<Availability, ApiProblem>
//   useNow(intervalMs, enabled = true): number   // the real clock, shared with the conversation's call timer
export { caseKeys, availabilityKeys } from './api'
export { registerCasesRealtime } from './realtime'   // case.updated, case.assigned, inbox.counts, availability.updated
export { applyCaseSummaryToInboxes } from './realtime' // (queryClient, summary): patch + refetch only on a move
export {
  INBOX_FILTERS,            // [{ status: InboxStatus | null; label; slug; tone }] in canvas order
  inboxStatusFromSlug, slugFromInboxStatus,
  inboxStatusMeta,          // (summary) => { label: 'Por responder'…; subLabel: 'Esperando aprobación'…; tone }
  channelLabel,             // app_chat 'App' · web_chat 'Web' · phone 'Teléfono' · email 'Correo'
  channelPhrase,            // 'chat en la app' · 'chat web' · 'teléfono' · 'correo' (header meta)
  priorityLabel,            // 'Prioridad baja|media|alta'
  topicLabel,               // disputar_cargo 'Cargo no reconocido', cobro_duplicado 'Cobro duplicado', consultar_cargo 'Consulta de un cargo', consultar_movimientos 'Consulta de movimientos', estado_disputa 'Estado de la disputa', fraude_urgente 'Fraude urgente', hablar_con_humano 'Pide una persona', fuera_de_alcance 'Fuera de alcance', problema_app 'Problema con la app', null 'Sin clasificar'
  countryName,              // CO Colombia · MX México · AR Argentina · BR Brasil
  formatSla,                // (summary, now) => { text: string; atRisk: boolean }
} from './model'
export type {
  CaseSummary, InboxResponse, InboxCounts, InboxStatus, CaseStatus, CaseChannel, CaseTopic, CasePriority,
  Availability, AvailabilityStatus,
} from './types'                                     // aliases of Schemas['…']

// src/features/cases/api.ts (query keys)
export const caseKeys = {
  all: ['cases'] as const,
  inboxes: () => ['cases', 'inbox'] as const,
  inbox: (params: { status: InboxStatus | null; q: string }) => ['cases', 'inbox', params] as const,
}
export const availabilityKeys = { me: () => ['availability', 'me'] as const }

// src/features/workspace/index.ts
export { WorkspaceScreen } from './components/WorkspaceScreen'
export interface WorkspaceUrlState {
  caseId: string | null; filter: InboxStatus | null; query: string
  panelTab: 'copiloto' | 'herramientas' | 'cliente'; panelCollapsed: boolean; listCollapsed: boolean
}
export interface WorkspaceStateChangeOptions { replace?: boolean }  // replace the history entry (auto-select, typing, toggles)
export interface WorkspaceScreenProps {
  state: WorkspaceUrlState
  onStateChange(patch: Partial<WorkspaceUrlState>, options?: WorkspaceStateChangeOptions): void
}
export { parseWorkspaceSearch, toWorkspaceSearch } from './model'   // URLSearchParams ⇄ WorkspaceUrlState
export type { SupportPanelTab, WorkspaceStateChangeOptions, WorkspaceUrlState } from './model'
```

Inbox realtime handlers: `case.updated`/`case.assigned` → `applyCaseSummaryToInboxes` (exported): for each cached
inbox query, a newer card (`version`) is patched in place, and that query alone is refetched (`exact`) only when
membership or order can change (`patchInbox` in `model.ts`): an unknown id whose `inboxStatus` fits the query's
filter, or a change to `inboxStatus`, `status`, `slaDueAt`, `liveSince` or `assignedAnalystId` (the server's
`inbox_order` keys). A query with no data yet is refetched. A new message or a read cursor alone costs no request;
the counters come with `inbox.counts`. `case.assigned` also toasts "Te llegó un caso nuevo" with the customer name; `inbox.counts` →
`setQueriesData(caseKeys.inboxes(), …counts)` when newer; `availability.updated` → `setQueryData(availabilityKeys.me())`.
`WorkspaceScreen` subscribes `inbox:<me>`. `WorkspaceScreen` renders the page's only `<main>` landmark and mounts
`ConversationPane` inside it, so the pane uses `<section>`s, never another `<main>`. A patch is applied as one URL
change (two `setSearchParams` calls in a row would drop the first), so "open the panel on Cliente" is
`{ panelTab: 'cliente', panelCollapsed: false }`.

### 7.2 Agent `conversation`

Owns: `src/features/conversation/**`, `src/features/customer-chat/**`, `src/routes/customer/simulator.tsx`,
`src/app/realtime-handlers.ts` (+ its test), `src/lib/realtime/types.ts` (add topic `` `customer:${string}` ``,
`topics.customer(id)`, and the new event types `inbox.counts`, `availability.updated`, `conversation.updated` to
`KnownRealtimeEventType`), `src/lib/session-token.ts` (`createSessionTokenStore(storageKey = 'cc.session.token')`
and `export const customerSessionToken = createSessionTokenStore('cc.customer.token')`), new tokens in
`src/styles/index.css` (customer-app palette of `AppSupportChat`, e.g. `app-brand`), `src/test/conversation-fixtures.ts`.

- `features/conversation`: case header (name; mono id · topic label · "{country} · {city} · {channelPhrase} ·
  {prioridad x | 'en portugués' when pt}"; `SampleDataTag`; "Cerrar caso"), transcript (customer bubbles left;
  own analyst bubbles right dark; bot turns right tinted; `routing` turns as the centred accent banner; `notice`
  turns as centred muted notes; "Tú" for `authorId === me`), "Cargar mensajes anteriores" via `olderCursor`,
  composer ("Escribe al cliente", Enter sends, Shift+Enter new line, "Enviar"; send states pending → sent / failed
  "No se envió · Reintentar" re-posting the **same** `clientMessageId`; disabled with copy per
  `replyBlockedReason`, e.g. `channel_not_supported` → "Por ahora solo el chat funciona en vivo. Llamadas y correo
  llegan en una próxima entrega."), read-only layouts for `phone`/`email` (transcript as list, call bar state + timer
  only, no actions), mark-read (on open and on new customer turns while visible, debounced ~1 s,
  `upToSequence = lastSequence`), close dialog ("Cerrar caso": Resultado Resuelto/Sin resolver, Motivo del contacto,
  Seguimiento Mañana/En 2 días/Sin seguimiento, Qué se hizo with the 5 canvas phrases → `ResolutionCode`, checkbox
  "Enviarle la encuesta de satisfacción al cerrar", footer "Se guarda en el histórico de la plataforma"; no copilot
  suggestion yet), "Cómo llegó a ti".
- `features/customer-chat`: `/cliente` simulator. Picker ("Elige un cliente de ejemplo", cards with name, locale
  label, city, segment, badge "Conversación abierta"; "Datos de ejemplo"); chat in the `AppSupportChat` frame
  (header "Soporte" + state line: `waiting_agent` "Buscando a una persona del equipo…", `with_agent`
  "Te atiende {agentName} · LATAM Bank", `closed` "Conversación terminada"; suggestion chips prefill the input;
  input "Escribe aquí", send button `aria-label` "Enviar"; "Cambiar de cliente" drops the token). Own API client
  `createApiClient({ tokenStore: customerSessionToken })`, own `RealtimeClient` (`getToken:
  customerSessionToken.get`, `onAuthError: customerSessionToken.clear`) and a nested `<RealtimeProvider>` with its
  own registry (`registerCustomerChatRealtime`: `turn.created`, `conversation.updated`), subscribed to
  `customer:<id>`. Reload restores the session from `sessionStorage`.

```ts
// src/features/conversation/index.ts
export { ConversationPane } from './components/ConversationPane'
export interface ConversationPaneProps { caseId: string; onClosed?(caseId: string): void }  // onClosed: workspace selects the next case
export { RoutingSummary } from './components/RoutingSummary'
export interface RoutingSummaryProps { caseId: string; defaultOpen?: boolean }   // "CÓMO LLEGÓ A TI" + route line + Ver/Ocultar
export { useCaseDetail } from './hooks/use-case-detail'   // (caseId: string | null) => UseQueryResult<CaseDetail, ApiProblem>
export { conversationKeys } from './api'
export { registerConversationRealtime } from './realtime'  // turn.created, case.updated (detail cache)
export type { CaseDetail, Turn, CustomerProfile, RouteStop, RoutingSummary as RoutingSummaryData } from './types'

// src/features/conversation/api.ts
export const conversationKeys = {
  all: ['conversation'] as const,
  detail: (caseId: string) => ['conversation', caseId, 'detail'] as const,
  turns: (caseId: string) => ['conversation', caseId, 'turns'] as const,
}

// src/features/customer-chat/index.ts
export { CustomerSimulatorScreen } from './components/CustomerSimulatorScreen'   // no props
// src/features/customer-chat/api.ts
export const customerChatKeys = {
  all: ['customer-chat'] as const,
  demoCustomers: () => ['customer-chat', 'demo-customers'] as const,
  conversation: (customerId: string) => ['customer-chat', customerId, 'conversation'] as const,
}

// src/app/realtime-handlers.ts
export const FEATURE_REALTIME_REGISTRATIONS = [registerCasesRealtime, registerConversationRealtime]
```

After a successful send or mark-read, the conversation applies the `CaseSummary` the command returns with
`applyCaseSummaryToInboxes(queryClient, summary)` (imported from `@/features/cases`) instead of invalidating the
inboxes: the card updates at once, and the pushed `case.updated` of the same version is then a no-op. After a close
(the response is a `CaseDetail`), it invalidates `caseKeys.inboxes()`: the case leaves the inbox.
`inbox` must export `registerCasesRealtime` (even as a stub) early, so the composition file typechecks.

### 7.3 Canvas states → owner (Workspace `view` prop)

| View | Slice 1 | Owner |
|---|---|---|
| `copiloto`, `herramientas`, `cliente`, `recorrido`, `panelContraido` | shell + placeholders; `recorrido` = Cliente tab with `RoutingSummary defaultOpen` | inbox (RoutingSummary: conversation) |
| `contraida`, `vacia`, `pausa` | functional | inbox |
| `envivo` | functional (seed 102 / any live chat) | conversation |
| `cerrar` | functional (no copilot suggestion) | conversation |
| `llamada`, `espera`, `saliente`, `correo` | read-only layout seams (seeds 105, 106, 104) | conversation |
| `borrador` | seam (slice 2: copilot draft, "Siguiente paso") | — |
| `verificar`, `verificada`, `abono`, `esperando`, `aprobado`, `rechazado`, `errorHerramienta` | seam (slice 3) | — |

---

## 8. Backend layout (guidance)

`domain/cases/` (case, turn, assignment, customer_case_slot, values, events, errors), `domain/routing/` (values,
routing_step, events), `domain/customers/customer.py`, `domain/people/availability.py`;
`application/cases/` (use_cases bundle `CasesUseCases`, ports, queries/read model incl. `inbox_status()`, dto,
`sla.py`, `realtime.py`), `application/routing/` (`route_case.py`, `assignment.py`, process manager),
`application/customers/` (directory port, `StartCustomerSession`, `ListDemoCustomers`, `AuthenticateCustomer`);
`infrastructure/routing/null_responders.py` + an in-memory `ResponderRegistry`, `infrastructure/background.py`,
`infrastructure/security/customer_tokens.py`, `infrastructure/seed/{customers,cases}.py`, SQLAlchemy tables
(`cases`, `turns`, `assignments`, `routing_steps`, `customers`, `customer_case_slots`, `analyst_availability`) and
memory adapters; `api/routers/{cases,customer,availability}.py`. `UseCases` gains `cases`, `customers`
(availability use cases live in `people`). Settings: `customer_session_ttl_minutes`.

Tests expected (brief §6): state machine and `inbox_status()` tables; `LanguageLeastLoadedPolicy` (pt→pt speaker,
paused excluded, least loaded, tie-breaks); queue + drain; concurrent first messages → one case; idempotent replay
and `idempotency_conflict`; sequence under concurrent posts; API happy paths + every problem code above; WS: customer
may only subscribe to its own `customer:` topic, staff-only turns never reach it, analyst cannot subscribe to a case
not assigned; envelope payloads validate against the REST schemas; seed counts per inbox status.

## 9. Seams for later slices (do not build now)

- **Slice 2:** copilot (`POST /cases/{id}/copilot/runs`, AG-UI), "Siguiente paso" + draft in the composer
  (`fromSuggestionId`), customer file (accordion data, signals dot on the Cliente tab, "Quién vio qué").
- **Slice 3:** identity checks (`idBadge`, masked rows), tools (`kind: action` turns with `evidenceIds`, rule 9
  validation on analyst turns), approvals (`awaiting_approval`, "Esperando aprobación"), tool error state.
- **Later:** functional calls and email (call bar actions, `in_call ⇄ in_progress`, outbound `to_call → in_call`),
  judge classification (`topic`, `priority` via `case.classified`), human `routing_step` at close, CSAT capture,
  presence/"En llamada · no te llegan casos nuevos", capacity cap, customer session revocation. Out of scope
  entirely: transfers/reassignment, requesting hidden data.

## 10. Backend implementation notes (clarifications, no frozen name changed)

Recorded by the backend agent so the FE agents can reconcile at integration. Where the
contract left a detail open, this is what `backend/openapi.json` and the server do.

- **Schema names not spelled out above:** `DemoCustomer.openConversation` is
  **`DemoConversation`** `{caseId, channel, status}`; `CaseCapabilities.replyBlockedReason` is
  the enum **`ReplyBlockedReason`** (`not_assignee` | `closed` | `channel_not_supported`).
  Every response member is present in the schema (`T | null`, never optional).
- **Request validation:** `text` is trimmed by the schema, then 1–4000 chars (blank → 422
  `validation_error`). `clientMessageId` and `Idempotency-Key`: 8–64 chars of
  `[A-Za-z0-9-]` (a UUID v4 fits). Unknown body members → 422 (`extra="forbid"`), so
  `evidenceIds`/`fromSuggestionId` are rejected in slice 1 as specified.
- **Problems:** a malformed `cursor` on `GET /cases/{id}/turns` answers 422 `invalid_value`
  (cursor + `afterSequence` together → 422 `validation_error`). `channel_not_supported`
  also carries an untyped `channel` extension. `currentStatus` is typed `CaseStatus`.
- **`caseCreated` on a replay:** a customer retry of the message that opened the case answers
  200 + `Idempotent-Replayed: true` with `caseCreated: true` (true iff the replayed turn is
  sequence 1). The analyst side has no such flag.
- **`CustomerTurn.authorName`:** analyst first name for analyst turns; `null` for the
  customer's own messages, bots and system notices.
- **Server texts (§2.4):** Portuguese cases put the rule before the final period: "…habla
  portugués (regla 3)." The queue name is lower-cased inside sentences ("…espera en la cola
  de disputas en portugués.", "…después de 2 min en la cola de disputas."); minutes are
  rounded up, minimum 1. If any automated tier did **not** abstain with
  `component_not_connected`, the assignment banner is the short form "Asignado a {Nombre} porque
  está disponible y habla {idioma}{ (regla 3)}." (the null-chain sentence would be false).
- **Routing:** the first non-`abstained` decision stops the chain and the case still goes to
  the human tier (a `resolved` outcome closing the case is a later slice). A responder that
  raises is recorded as `abstained` with `reason_code = component_error`.
- **Event log order:** events of one transaction are appended in the order they were
  recorded across aggregates (new `AggregateRoot` recording stamp; loose `uow.record`
  events included), so routing steps precede the `case.assigned` they led to.
- **Realtime:** a staff subscription to `case:<id>` of an unknown case answers `forbidden`
  (same as someone else's case: no existence leak). `inbox:` / `case:` envelopes keep the
  real `actor.id`; on `customer:` it is `null` unless the actor is that customer. Closing a
  case emits two `case.updated`/`inbox.counts`/`conversation.updated` (one per source event,
  `case.closed` then `case.status_changed`); the version rule makes the second a no-op.
  A reply on an `in_progress` case sends the customer only `turn.created` (no status change).
- **Availability:** `GET /me/availability` for an analyst without a row answers
  `paused` with `since` = now. Every seeded analyst (incl. the team lead) has a row.
- **Seed details (§6):** component display names "Juez de entrada", "Árbol de disputas",
  "Agente de disputas" (ids `judge.entrada@ejemplo`, `tree.disputas@ejemplo`,
  `agent.disputas@ejemplo`); judge steps that pass to the tree are `handed_off` with
  `reason_code = routed_to_tree`. The chat customers 1001, 1002, 1003, 1007 also have two
  follow-up chips each (their own voice). Document types: CC (CO), INE (MX), DNI (AR), CE
  (Larissa, pt-BR in CO), Pasaporte (Rafael, pt-BR in AR).
- **Close:** the "La conversación terminó" notice is appended on every close (also phone and
  email seeds), as §3.1 says.

## 11. Integration notes (final state of slice 1)

- **Types:** every feature type (`features/cases/types.ts`, `features/conversation/types.ts`,
  `features/customer-chat/types.ts`) is now a plain alias of the generated `Schemas['X']`, and every
  slice 1 call goes through the typed `api` / `customerApi` clients (paths, path/query params, the
  `Idempotency-Key` header and bodies are checked at compile time). The `FromContract` fallbacks and
  the untyped client views are gone; drift from `backend/openapi.json` is a `pnpm typecheck` error.
- **Reconciled:** the backend already implements `afterSequence` as "the first `limit` turns after
  `n`, ascending" (§3.1) and issues customer tokens as standard JWTs with `sub`/`aud`/`exp` (§4), as
  the conversation agent's clarifications require. No frozen name changed.
- **One clock hook:** `useNow` lives in `features/cases` (exported, see §7.1); the conversation's
  call timer imports it instead of keeping a copy.
- **Sockets that close right after the handshake:** `RealtimeClient.disconnect()` closes a socket
  that is still connecting once it opens, instead of mid-handshake (React StrictMode remounts the
  `/cliente` provider in dev, which made browsers log "WebSocket is closed before the connection is
  established"). The server treats a client that leaves before or during the `welcome` as a normal
  end and always releases its hub connection (before, it raised an ASGI error and the connection
  stayed registered).
- **Rail badge:** the canvas shows no badge on the analyst's "Casos" rail item, so
  `app/rail-indicators.ts` feeds nothing for the analyst (the list's collapsed rail already shows the
  `toReply` count).
- **Live check** (fresh SQLite file, real uvicorn + Vite): a scripted customer and Daniela
  (login + MFA) exercised every rule of this contract end to end over REST and both sockets: case
  opened and routed (judge → tree → ai_agent `abstained` / `component_not_connected` in the event log,
  then `case.assigned` with `H1`), `case.assigned` + `inbox.counts` on `inbox:<me>`, the reply on
  `customer:<id>` with no staff-only turn, idempotent replays (200 `Idempotent-Replayed`) and
  `idempotency_conflict`, gap-free ordered reloads, close → customer notice, rule 3 (a `pt` case with
  only a Spanish-speaking analyst available is queued, then drained to Daniela when she is
  available), least-loaded balancing, and the 403 / forbidden-topic checks. A headless-browser pass
  over `/analista` and `/cliente` (two windows, live reply, reloads) showed no console errors.
