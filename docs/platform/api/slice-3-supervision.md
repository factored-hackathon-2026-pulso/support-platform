# Slice 3 contract · supervision

**Status:** ready to implement (2026-10-03).
**Date:** 2026-10-03.

**Scope.** Supervision of a **people-only** chat support platform (brief §8, S3):

1. **Team and queues**: who is connected, available, paused or offline; each analyst's load (open cases by inbox status, the longest wait, cases at first-response SLA risk); the language queues with their wait and SLA; team counters.
2. **Manual assignment**: assign a queued case and reassign an open case to another analyst. Rule 3 is enforced (a Portuguese case only to a Portuguese speaker); a paused target needs an explicit confirmation. Each change leaves a staff-only banner, events, and realtime updates for both analysts and, when what it sees changes, the customer.
3. **Supervisor read-only view of any case** (transcript, header, "Casos anteriores"), audited as an event.
4. **Audit**: event-log queries (who did what, on which case, when) with filters, cursor pagination, a Spanish description per event, and an expandable, redacted payload.
5. **Realtime**: supervision topics for team and queues, a supervisor notice when a case enters a queue, and the rail badge with the queued count.

Not in this slice (and not built anywhere): AI, agents, tiers, automation, approvals, tools, customer/bank data, identity checks, calls, email, analyst-to-analyst transfers, "Siguiente paso" recommendations, exporting the audit, pausing an analyst on her behalf (the canvas has no control for it), a supervisor close, capacity caps, presence beyond sessions.

Read first:
- `../ENGINEERING_BRIEF.md` (it wins over this file);
- `../adr/0001-architecture.md`;
- `slice-2-case-lifecycle.md` (everything there that this file does not change still holds);
- design boards (read-only): `warehouse/design/source/project/SuTeam.dc.html` (team and queues), `SuAudit.dc.html` (audit), `SuAvisoNueva.dc.html` (supervisor notice), `Workspace.dc.html` (case look). Take layout, density, copy and states; drop the "Siguiente paso" strip content, "Por aprobar", "Agente IA", tiers, "Datos que usó", "Canal" (Teléfono/Híbrido), "Vacaciones", "Exportar".

Extend the slice 0–2 foundations (UoW + event log, `retry_on_conflict`, the `ProblemCode` registry, `ApiContext` routers, `CaseReader`, `CaseRealtimeProjector`/`TopicMapper`/`TopicAccessPolicy`, `RealtimeClient`, the handler registry, `Schemas[...]`, `QueryState`, `ConversationPane`). Never fork them.

**Conventions** (same as slices 1–2): JSON camelCase, Python snake_case; `datetime` = ISO-8601 UTC with `Z`; `T | null` = always present, may be null; **bold** names are Pydantic classes (`Schemas['…']` in the SPA); "team-generated" marks a synthetic value we chose (say so in code comments; label it "Política de ejemplo" if the UI shows it as policy).

---

## 0. Parallel-work protocol

1. **Backend, first milestone (before any logic):**
   - add the enums, schemas, problem codes and `ProblemDetails` extensions of §2, §4, §5, §6;
   - add the routes of §4.1 and §6.1 with their final signatures (they may raise `NotImplementedError`);
   - add the `AssignmentOut`/`CaseCapabilities` members of §3.6;
   - run `uv run python -m cc_platform.scripts.export_openapi`.

   From then on `backend/openapi.json` is the contract. Tell the frontend agent when it lands.
2. **Frontend:** run `pnpm gen:api` as soon as the new `openapi.json` exists, and again whenever it changes. Until then, build `model.ts` work, URL state and pure components against the names in this file. Never hand-edit `schema.gen.ts`. Tests mock each feature's `api.ts`.
3. **Frozen for the slice:** field names, enum values, URL slugs, topic names, envelope types, query keys and public exports below. A change needs this file updated first.
4. **Data reset:** the SQLite schema changes (§3.2: two `assignments` columns). Delete `backend/cc_platform.db` (or run with `CC_PERSISTENCE=memory`) after pulling this slice; say so in `backend/README.md`.

---

## 1. Vocabulary

### 1.1 New and changed enums (OpenAPI names)

| Enum | Values | Notes |
|---|---|---|
| `AssignmentReason` | `language_least_loaded`, `queue_drained`, **`manual`** | `manual` = a supervisor chose the analyst (from the queue or by reassignment). |
| **`AnalystActivity`** (new) | `busy`, `available`, `paused`, `offline` | Derived, never stored (§2.2). |
| **`AuditFamily`** (new) | `conversation`, `assignment`, `lifecycle`, `availability`, `access`, `other` | Event-type families (§5.3). |
| **`AuditActorKind`** (new) | `staff`, `customer`, `system` | Filter on `actor_role` (§5.1). |
| `ActorRole`, `StaffRole`, `CaseStatus`, `InboxStatus`, `Language`, … | unchanged | |

### 1.2 Team-generated constants

| Constant | Value | Where |
|---|---|---|
| `SLA_AT_RISK` | 5 min before `slaDueAt` (or past it) while the first response is pending | Backend `application/cases/supervision.py` (`SLA_AT_RISK = timedelta(minutes=5)`); frontend keeps `SLA_AT_RISK_MS` in `features/cases/model.ts` (same value, already there). |
| `HIGH_LOAD_OPEN_CASES` | 5 open cases | Frontend `features/supervision/model.ts` ("Carga alta" tag). |
| `SUPERVISOR_VIEW_AUDIT_WINDOW` | 15 min | Backend: a supervisor re-reading the same case inside the window records no new `case.viewed` (§3.8). |
| Queue labels | `es` "Cola en español" · `pt` "Cola en portugués" | Unchanged (slice 2 §3.3). The frontend gets them from `LanguageQueue.label`; `features/supervision/model.ts` also has `QUEUE_LABEL: Record<Language, string>` pinned by a test to the same text (for the case view of a queued case). |

---

## 2. Team and queues (read models)

Both live in `application/cases/supervision.py` (queries `GetTeamOverview`, `GetQueueOverview`), read through one Unit of Work and `CaseReader`, so every case row is the slice 2 **`CaseSummary`**.

### 2.1 Who is on the team

- The **analysts** are active staff holding the `analyst` role (Felipe, Analista + Supervisora, is one). Supervisors and admins without `analyst` are not listed.
- **Teams** are the distinct `Staff.team` names of those analysts (today "Disputas · Equipo Andes" and "Disputas · Equipo Pacífico"; "Administración de la plataforma" has no analyst, so it is not listed). Slice 4 turns teams into records; until then a team is identified by `key` = a slug of its name: lower-case, accents stripped, every run of non-alphanumerics → `-`, trimmed (`disputas-equipo-andes`). Clients treat `key` as opaque.
- **Queues** are global, one per language (`es`, `pt`), never per team. Both are always returned, even empty.

### 2.2 `AnalystActivity` ("Ahora" column)

`signedIn` = the analyst has at least one **active staff session** (`ended_at IS NULL` and `expires_at > now`). Add `StaffSessionRepository.active_staff_ids(now) -> set[str]` (SQL + memory).

| `availability` | `signedIn` | open cases | `activity` | Label (UI) | Tone |
|---|---|---|---|---|---|
| `available` | any | ≥ 1 | `busy` | "Atendiendo" | `success` |
| `available` | any | 0 | `available` | "Disponible" | `accent` |
| `paused` | true | any | `paused` | "En pausa" | `warn` |
| `paused` | false | any | `offline` | "Sin conexión" | `neutral` (offline dot) |

- Per-person labels are gender-neutral ("Sin conexión", never "Desconectada": the team has men and women). The plural filter pills of §8.4 imply "personas" and may stay feminine.
- A missing availability row counts as `paused` (slice 1 rule).
- `available` without a session is **not** offline: cases keep landing on her (known gap, no presence). The row shows the hint "sin sesión abierta" (§8.4).
- A session that expires emits no event: the screen refetches every 60 s (§8.6).

### 2.3 Per-analyst numbers

Over the analyst's open cases (`assigned | in_progress`):
- `counts`: `open`, `new`, `toReply`, `waiting` (slice 2 `inbox_status`).
- `oldestWaitingSince`: the minimum `lastInteractionAt` over cases whose `inboxStatus ∈ {new, to_reply}` (the customer wrote last and waits for her); `null` if none.
- **At SLA risk** is time-dependent, so it is **not** a stored counter: the frontend counts `openCases` where `formatSla(summary, now)?.atRisk` (first response pending and `slaDueAt − now ≤ 5 min`, overdue included). The backend computes the same rule only for `TeamSummary.atRiskCases` and `LanguageQueue.atRisk` at `serverTime` (for API consumers); the UI recomputes them from the rows with its ticking clock.

### 2.4 Order

- `analysts`: `activity` in the order `busy`, `available`, `paused`, `offline`; then `name` (accent-insensitive); then `id`.
- `openCases` of an analyst: the slice 2 open-inbox order (`new`/`to_reply` first, then `waiting`, each by oldest `lastInteractionAt`).
- Queue `cases`: oldest `openedAt` first (= the drain order).
- `teams`: by `name`.

---

## 3. Manual assignment (commands)

### 3.1 Domain changes (`domain/cases`)

- `AssignmentReason.MANUAL = "manual"`.
- `Assignment` gains `previous_staff_id: str | None = None` (who held the case before; `None` from the queue) and `paused_override: bool = False` (the target was paused and the supervisor confirmed). `assigned_by` is the supervisor's `ActorRef` for `manual`, `system` otherwise. `strategy = "manual"` for manual rows.
- `Case.assign(assignment)` (unchanged guard `queued → assigned`) accepts any reason, including `manual`.
- **New `Case.reassign(assignment)`**: `assigned | in_progress → assigned` to **another** analyst.
  - closed → `CaseClosedError`; `queued` → `invalid_transition` (use `assign`); same analyst → `InvalidValueError` (the use case returns a no-op before calling it).
  - From `in_progress`: records `case.status_changed` (`in_progress → assigned`, `reason: "reassigned"`, actor = the supervisor) first.
  - Sets `assigned_analyst_id`, `assigned_at`; `assignee_read_sequence = 0`; `unread_sequences` is kept (the customer messages nobody has read yet). The case is **Nuevo** for the new analyst until she opens it.
  - Records `case.assigned` with `previous_analyst_id` = the old assignee.
- `CaseAssigned` payload gains `paused_override: bool` (every existing emitter sends `false`).
- **New event `CaseViewed`** (`case.viewed`, entity `case`, §3.8). It is **not** in `CASE_EVENTS` and never reaches a socket (`TopicMapper.suppress(CaseViewed)`).
- New error `LanguageMismatchError(DomainError)`, code `language_mismatch` (rule 3, `H1`).

State machine additions (slice 2 §2.3):

| From → To | Trigger | Events |
|---|---|---|
| `queued` → `assigned` | `SetCaseAssignee` (supervisor) | `case.assigned` (`reason: manual`, `previous_analyst_id: null`) |
| `assigned` → `assigned` (other analyst) | `SetCaseAssignee` | `case.assigned` (`manual`, `previous_analyst_id` set) |
| `in_progress` → `assigned` (other analyst) | `SetCaseAssignee` | `case.status_changed` (`reason: reassigned`) + `case.assigned` |
| `closed` → anything | — | 409 `case_closed` |

### 3.2 Persistence

`assignments` table: add `previous_staff_id String(40) NULL` and `paused_override Boolean NOT NULL default false`. Memory store: same fields. `OutdatedSchemaError` must list them on an old database.

### 3.3 `SetCaseAssignee` (`application/cases/manual_assignment.py`)

```python
@dataclass(frozen=True, slots=True)
class SetAssigneeCommand:
    analyst_id: str
    expected_analyst_id: str | None   # who the supervisor saw holding it (None = queued)
    confirm_paused: bool = False

@dataclass(frozen=True, slots=True)
class SetCaseAssignee:
    uow: UnitOfWorkFactory; clock: Clock; ids: IdGenerator
    async def execute(self, actor: Actor, case_id: str, command: SetAssigneeCommand) -> AssignmentResultView: ...
    # whole body inside retry_on_conflict; every rule re-evaluated on fresh state
```

Rules, **in this order**, on the freshly loaded case:

| # | Check | Result |
|---|---|---|
| 1 | caller holds `supervisor` | else 403 `forbidden` (router) |
| 2 | case exists (valid `CASE-` id) | else 404 `not_found` |
| 3 | case not closed | else 409 `case_closed` (`currentStatus: closed`) |
| 4 | target exists, is active, holds `analyst` | else 422 `analyst_not_eligible` (`analystId`) |
| 5 | target speaks `case.language` (rule 3, `H1`) | else 422 `language_mismatch` (`policyRuleId: "H1"`, `caseLanguage`, `analystId`) |
| 6 | target **is** the current assignee | **200 no-op**: `changed: false`, no events, no turns, no save |
| 7 | current assignee == `expectedAnalystId` (both may be `null` = queued) | else 409 `assignment_changed` (`currentAnalystId`) |
| 8 | target availability is `available`, or `confirmPaused = true` | else 409 `analyst_paused` (`analystId`) |
| 9 | apply (§3.4), save (CAS), commit | 200 `changed: true` |

Notes:
- Rule 6 before 7 makes a retried request (network retry after success) and two supervisors choosing the same person harmless. No `Idempotency-Key` is needed: the command is a `PUT` that sets a state.
- Rule 5 before 8: the dialog never asks to confirm a pause for someone who cannot take the case anyway.
- `confirmPaused` is ignored when the target is available. "Offline" (paused, no session) is just paused for this rule.
- The supervisor may assign to herself only if she also holds `analyst` (Felipe).
- No capacity cap (seam `max_open_cases`, unchanged).

### 3.4 Effects in one Unit of Work

**From the queue** (`status = queued`):
1. `Assignment` (`reason: manual`, `assigned_by` = supervisor, `previous_staff_id: None`, `waited_seconds = now − queued_at`, `policy_rule_id = "H1"` if `pt`, `open_cases_at_assignment` = target's open count, `strategy: "manual"`, `paused_override`).
2. `Case.assign(assignment)` → `case.assigned`.
3. Staff-only `routing` banner (§3.5).
4. No customer turn. The customer's header changes from "Buscando a una persona del equipo…" to "Te atiende {agentName}" through `conversation.updated` (already emitted after `case.assigned`).

**Reassignment** (`status ∈ {assigned, in_progress}`):
1. `Assignment` (`manual`, `previous_staff_id` = old assignee, `waited_seconds: None`, rest as above).
2. `Case.reassign(assignment)` → (`case.status_changed`) + `case.assigned`.
3. Staff-only `routing` banner (§3.5).
4. Customer-visible `notice` turn (audience `everyone`, author `system`, case language, §3.5): the customer sees a different name in the header, so the change is announced.
5. The SLA is untouched: `slaDueAt`/`firstResponseAt` stay; a pending first response is now the new analyst's.

The customer slot, the close and the history are unchanged. Events are committed in this order: (`case.status_changed`), `case.assigned`, `turn.created` (banner), (`turn.created` notice).

### 3.5 Server-written texts (`application/cases/copy.py`)

Staff-only `routing` banners (Spanish):

| Case | Text |
|---|---|
| From the queue | "{Supervisora} asignó el caso a {Analista} después de {n} min en la {cola en minúscula}." (`queue_wait_minutes`, min 1) |
| Reassignment | "{Supervisora} pasó el caso de {Anterior} a {Analista}." |
| Paused target (either) | the sentence above without its final period + " ({Primer nombre de Analista} estaba en pausa)." |

Examples: "Lucía Herrera asignó el caso a Sebastián Cárdenas después de 7 min en la cola en portugués." · "Lucía Herrera pasó el caso de Julián Ortega a Daniela Ríos." · "Renata Villalba pasó el caso de Daniela Ríos a Tomás Arango (Tomás estaba en pausa)."

Customer `notice` on reassignment (case language; first name of the new analyst):

| es | pt |
|---|---|
| "Ahora te atiende {Nombre}, de nuestro equipo." | "Agora quem te atende é {Nome}, da nossa equipe." |

Never sent to the customer: who reassigned, why, the previous analyst, the pause.

### 3.6 API members added to slice 2 schemas (additive)

```ts
AssignmentOut {                      // existing members unchanged
  …
  assignedByRole: ActorRole          // NEW: 'system' for language_least_loaded / queue_drained, 'supervisor' for manual
  assignedByName: string | null      // NEW: the supervisor's name; null for system
  previousAnalystId: string | null   // NEW: who held it before (reassignment)
  previousAnalystName: string | null // NEW
}
CaseCapabilities {                   // existing members unchanged
  …
  canAssign: boolean                 // NEW: caller holds supervisor and status ≠ closed ("Asignar"/"Reasignar")
}
```

`capabilities_for(case, staff_id)` becomes `capabilities_for(case, actor)` (it needs the roles). `canReply`/`canClose` are unchanged (assignee only), so a supervisor never writes or closes.

### 3.7 Who may read a case (slice 2 §4.3, changed)

`load_case_for` resolves the access path in this order and returns it (`CaseAccess.ASSIGNEE | HISTORY | SUPERVISOR`):
1. **assignee** (analyst role) → read + write;
2. **history** (analyst role): the analyst holds **or held** a case of the same customer. "Held" now includes past `Assignment` rows (`exists_for_customer_and_assignee` also joins `assignments` → `cases.customer_id`). So an analyst whose case was reassigned away still reads it, read-only;
3. **supervisor** → read-only;
4. else 403 `case_not_assigned`.

The `case:` socket topic stays assignee-or-supervisor (history readers use REST). An open `case:` subscription is not revoked when the case is reassigned away (the reader keeps read access anyway).

### 3.8 Supervisor view audit (`case.viewed`)

- `GetCaseDetail` records `case.viewed` when the access path is **SUPERVISOR** (not assignee, not history). It is the only read that writes: one `uow.record(CaseViewed(...))` + commit, no aggregate.
- Payload: `viewer_id`, `access: "supervisor"`, `case_status`, `assigned_analyst_id`. Actor: `ActorRef(supervisor, staff_id)`.
- Dedupe: none if the same actor already has a `case.viewed` for that case with `event_time ≥ now − 15 min` (`EventLogRepository.latest(event_type, actor_id, case_id)`). Two parallel first reads may both record (accepted).
- `/turns` and `/history` record nothing (every view opens the detail first).

### 3.9 Concurrency (CAS + retry)

`SetCaseAssignee` runs in `retry_on_conflict`; the case is saved with compare-and-set on `version`.

| Race | Outcome |
|---|---|
| Customer message arrives meanwhile (`PostCustomerTurn` bumps the case) | The loser retries on fresh state and succeeds. The transcript keeps sequence order (message before or after the banner). |
| Assignee closes meanwhile | Close first → the assignment retry sees `closed` → 409 `case_closed`. Assignment first → the close retry fails `load_case_for(write=True)` → 403 `case_not_assigned`. |
| Assignee replies or marks read meanwhile | Assignment first → the reply/read retry → 403 `case_not_assigned` (the SPA says "este caso ya no está asignado a ti"; a 403 on mark-read is silent). |
| `DrainQueue` assigns the same queued case | Drain first → manual retry: current ≠ expected (`null`) → 409 `assignment_changed`, unless the drain chose the same target → 200 no-op. Manual first → the drain's `_drain_one` re-reads `status ≠ queued` and skips. |
| Two supervisors | The second gets a no-op (same target) or `assignment_changed`. |
| Target pauses at the same instant | Availability is another aggregate (no shared CAS): she may still receive it. Accepted limit, documented (same as slice 2 §3.1). |

### 3.10 Realtime of an assignment

Per committed event, existing envelopes plus the new ones (§7):

| Who | Gets |
|---|---|
| New assignee (`inbox:<new>`) | `case.updated`, `case.assigned` (toast), `inbox.counts` |
| Previous assignee (`inbox:<previous>`), reassignment only | **`case.unassigned`** (payload `CaseSummary`, toast), `case.updated`, `inbox.counts` (her counts without the case) |
| `case:<id>` subscribers (whoever has it open) | `case.updated`, `turn.created` (banner, and the notice) |
| Customer (`customer:<id>`) | `conversation.updated` (new `agentName`; `with_agent` from the queue); on reassignment also `turn.created` (the notice) |
| Supervisors (`supervision:queues`) | `queue.updated` (from the queue only) |
| Supervisors (`supervision:team`) | `team.updated` (`staffIds` = new + previous) |

`CaseRealtimeProjector` change: on `CaseAssigned` with `previous_analyst_id`, also publish `case.unassigned` + `case.updated` + `inbox.counts` to `inbox:<previous>`.

---

## 4. REST API · supervision

### 4.1 Endpoints (router `api/routers/supervision.py`, tag `supervision`)

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/supervision/team` | supervisor | — | 200 **`TeamOverview`** | 401, 403 `forbidden` |
| `GET /api/v1/supervision/queues` | supervisor | — | 200 **`QueueOverview`** | 401, 403 |
| `PUT /api/v1/supervision/cases/{caseId}/assignee` | supervisor | **`SetAssigneeRequest`** | 200 **`AssignmentResult`** | 401, 403 `forbidden`, 404 `not_found`, 409 `case_closed` · `assignment_changed` · `analyst_paused` · `concurrent_update`, 422 `analyst_not_eligible` · `language_mismatch` · `validation_error` |
| `GET /api/v1/cases/{caseId}` (+ `/turns`, `/history`) | analyst (§3.7), supervisor | unchanged | unchanged (`CaseDetail` with the §3.6 members) | unchanged; a supervisor read records `case.viewed` (§3.8) |
| `GET /api/v1/staff` | supervisor, admin | unchanged | unchanged | unchanged (the audit "Persona" filter uses it) |

Operation ids: `supervision_get_team`, `supervision_get_queues`, `supervision_set_assignee`.

### 4.2 Schemas

```ts
TeamOverview { teams: TeamSummary[]; analysts: TeamAnalyst[]; serverTime: datetime }

TeamRef      { key: string; name: string }
TeamSummary  { key: string; name: string; analystCount: int
               activity: ActivityCounts            // analysts of the team by activity
               openCases: int                      // open cases of its analysts
               atRiskCases: int }                  // at serverTime (§2.3); the UI recomputes
ActivityCounts { busy: int; available: int; paused: int; offline: int }

TeamAnalyst {
  id: string; name: string; team: TeamRef
  languages: Language[]                            // sorted (es, pt)
  roles: StaffRole[]                               // canonical order
  availability: AvailabilityStatus                 // available | paused
  availabilitySince: datetime | null               // null when no row (never set)
  signedIn: boolean                                // §2.2
  activity: AnalystActivity                        // §2.2
  counts: AnalystCaseCounts
  oldestWaitingSince: datetime | null              // §2.3
  openCases: CaseSummary[]                         // assigned | in_progress, inbox order
}
AnalystCaseCounts { open: int; new: int; toReply: int; waiting: int }

QueueOverview { queues: LanguageQueue[]; counts: QueueCounts; serverTime: datetime }
LanguageQueue {
  language: Language                               // always es then pt
  label: string                                    // "Cola en español" | "Cola en portugués"
  waiting: int
  oldestQueuedAt: datetime | null
  atRisk: int                                      // at serverTime; the UI recomputes
  availableSpeakers: int                           // active analysts, available, who speak it
  speakers: int                                    // active analysts who speak it (any availability)
  cases: CaseSummary[]                             // status queued, oldest openedAt first
}
QueueCounts { total: int; byLanguage: QueueCount[]; computedAt: datetime }
QueueCount  { language: Language; waiting: int; oldestQueuedAt: datetime | null }   // es then pt

SetAssigneeRequest {
  analystId: string                  // STF-…
  expectedAnalystId: string | null   // required: who the caller saw holding it; null = queued
  confirmPaused?: boolean            // default false
}
AssignmentResult { changed: boolean; case: CaseSummary; assignment: AssignmentOut }
```

`CaseSummary`, `AssignmentOut` (with §3.6), `Language`, `AvailabilityStatus`, `StaffRole` are the existing schemas.

---

## 5. REST API · audit

### 5.1 Endpoints (router `api/routers/audit.py`, tag `audit`)

| Method · path | Roles | Query / path | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/audit/events` | supervisor, admin | `actorKind?: AuditActorKind` · `actorId?` (exact, ≤ 120) · `caseId?` (exact `CASE-…`) · `family?: AuditFamily` · `changesOnly?: bool` (default false) · `from?: datetime` (inclusive, on `event_time`) · `to?: datetime` (exclusive) · `q?` (1–80) · `cursor?` · `limit?` (1–100, default 50) | 200 **`AuditEventPage`** | 401, 403, 422 (`from ≥ to`, bad cursor, bad enum) |
| `GET /api/v1/audit/events/{eventId}` | supervisor, admin | `EVT-…` | 200 **`AuditEvent`** | 401, 403, 404 |

Operation ids: `audit_list_events`, `audit_get_event`. Admins may call it now; the admin UI for it is slice 4 (the S3 screen lives under `/supervision`).

Semantics:
- **Order: newest first** (`sequence` descending). `nextCursor` = the `sequence` of the last item when more exist; the next page reads `sequence < cursor`. Opaque to clients.
- `actorKind`: `staff` = `actor_role ∈ {analyst, supervisor, admin}`; `customer`; `system`.
- `family`: `event_type ∈` the catalog's types of that family (§5.3).
- `changesOnly`: only types flagged `changesState` in the catalog ("Solo acciones que cambian algo").
- `q`: case-insensitive **contains** on `event_id`, `entity_id`, `case_id`, `actor_id` (ids only, no names, no payload text). Portable SQL (`lower(col) LIKE`), no SQLite-only functions.
- Filters combine with AND.
- The audit list is not itself audited (no `case.viewed` for audit reads).

Port: `EventLogRepository.search(filters: AuditFilters, before: int | None, limit: int) -> list[StoredEvent]` and `get(event_id) -> StoredEvent | None`, plus `latest(event_type, actor_id, case_id)` (§3.8). SQL and memory adapters.

### 5.2 Schemas

```ts
AuditEventPage { items: AuditEvent[]; nextCursor: string | null }

AuditEvent {
  id: string                      // EVT-…
  type: string                    // event_type, e.g. "case.assigned"
  family: AuditFamily
  changesState: boolean           // "CAMBIO" tag
  description: string             // Spanish, from the backend catalog (§5.3)
  occurredAt: datetime            // event_time
  ingestedAt: datetime
  actor: AuditActor
  entity: string                  // case | turn | staff | staff_session | mfa_challenge | customer
  entityId: string
  caseRef: AuditCaseRef | null    // when case_id is set
  payload: Record<string, unknown>   // snake_case keys as stored, after redaction
  redactedFields: string[]        // payload keys removed by the PII policy (§5.4)
}
AuditActor   { role: ActorRole; id: string; name: string | null }   // name: staff or customer; null for system
AuditCaseRef { id: string; customerName: string | null }
```

### 5.3 Catalog (backend `application/audit/catalog.py`, the one place)

`describe(event, names) -> str`, `FAMILY: dict[str, AuditFamily]`, `CHANGES_STATE: frozenset[str]`. Names (`{A}`, `{P}`, actor) come from a name lookup (staff names; customer display names). `{idioma}` = "español"/"portugués"; `{cola}` lower-cased label. No times inside descriptions (the UI shows times in the viewer's zone).

| `event_type` | Family | Changes | Description (Spanish) |
|---|---|---|---|
| `case.opened` | lifecycle | yes | "Abrió un caso nuevo por {chat en la app \| chat web}"; with `previous_case_id`: "Volvió a escribir y abrió un caso nuevo por {…}" |
| `case.queued` | assignment | yes | "Dejó el caso en la {cola}: nadie disponible habla {idioma}" |
| `case.assigned` · `language_least_loaded` | assignment | yes | "Asignó el caso a {A}: estaba disponible y habla {idioma}" (+ " (regla 3)" for `pt`) |
| `case.assigned` · `queue_drained` | assignment | yes | "Asignó el caso a {A} desde la {cola} después de {n} min" |
| `case.assigned` · `manual`, no previous | assignment | yes | "Asignó el caso a {A} desde la {cola}" |
| `case.assigned` · `manual`, previous | assignment | yes | "Reasignó el caso de {P} a {A}" |
| (any `case.assigned` with `paused_override`) | | | + " ({A} estaba en pausa)" |
| `case.status_changed` | lifecycle | yes | by `reason`: `opened_by_assignee` "Abrió el caso por primera vez" · `closed` "El caso pasó a cerrado" · `reassigned` "El caso volvió a «sin abrir» por la reasignación" · other "Cambió el estado del caso" |
| `case.read` | conversation | no | "Leyó la conversación hasta el mensaje {read_sequence}" |
| `case.first_responded` | conversation | no | "Primera respuesta en {ceil(response_seconds/60)} min · SLA {cumplido \| vencido}" |
| `case.closed` | lifecycle | yes | "Cerró el caso · {motivo}" (labels of slice 2 §4.4) |
| `case.viewed` | access | no | "Abrió la conversación en modo supervisión (solo lectura)" |
| `turn.created` · `message` by customer | conversation | no | "Escribió un mensaje" |
| `turn.created` · `message` by analyst | conversation | no | "Respondió al cliente" |
| `turn.created` · `notice` | conversation | no | "La plataforma le envió un aviso al cliente" |
| `turn.created` · `routing` | conversation | no | "Dejó una nota de asignación para el equipo" |
| `staff.availability_changed` | availability | yes | "Pasó a Disponible" / "Pasó a En pausa" |
| `customer.session_started` | access | no | "Abrió el chat ({app \| web})" |
| `auth.password_accepted` | access | no | "Ingresó la contraseña correcta" |
| `auth.mfa_challenge_issued` | access | no | "Se le pidió el código de verificación" |
| `auth.login_failed` | access | no | "Intento de ingreso fallido ({contraseña \| código}) · quedan {remaining_attempts}" |
| `auth.mfa_failed` | access | no | "Código de verificación incorrecto · quedan {remaining_attempts}" |
| `auth.account_locked` | access | yes | "La cuenta quedó bloqueada por {lockout} min tras {failed_attempts} intentos" |
| `auth.session_started` | access | no | "Inició sesión" |
| `auth.session_ended` | access | no | `logout` "Cerró sesión" · `revoked` "Su sesión se revocó" |
| anything else | other | no | "Evento {event_type}" (slice 4 adds `staff.*` entries) |

A unit test runs `describe` over every event type the platform emits (from a seeded log) and fails on the fallback text.

### 5.4 PII and payload policy

- Event payloads never hold passwords, MFA codes, tokens or emails (slice 0 rule; a test already guards it).
- **Redacted in the audit API:** `turn.created.text` is removed and replaced by `text_length: int`; `redactedFields: ["text"]`. The content stays in the transcript, which a supervisor reads through the case view (itself audited, §3.8). Close notes (`case.closed.note`) are internal staff text and stay.
- Customer display names appear (staff already see them in cases). Customer ids appear in `actor`/`payload`.
- Who reads it: Supervisora and Administración only.

---

## 6. Problem codes

New members of `ProblemCode` (one registry, `api/problems.py`):

| Code | Status | Title | Default detail (Spanish) | Extensions |
|---|---|---|---|---|
| `analyst_not_eligible` | 422 | Analyst not eligible | "Esa persona no puede recibir casos." | `analystId` |
| `language_mismatch` | 422 | Language rule violated | "Ese caso necesita a alguien que hable su idioma (regla 3)." | `policyRuleId` (`"H1"`), `caseLanguage: Language`, `analystId` |
| `analyst_paused` | 409 | Analyst paused | "Esa persona está en pausa. Confirma para asignarle el caso igual." | `analystId` |
| `assignment_changed` | 409 | Assignment changed | "El caso cambió de manos mientras decidías." | `currentAnalystId: string \| null` |

`ProblemDetails` gains the typed optional members `analystId`, `policyRuleId`, `caseLanguage`, `currentAnalystId` (documented like `currentStatus`). Errors: `LanguageMismatchError` in `domain/cases/errors.py`; `AnalystNotEligibleError`, `AnalystPausedError`, `AssignmentChangedError` in `application/cases/errors.py`. Unchanged codes used here: `forbidden`, `not_found`, `case_closed` (+`currentStatus`), `case_not_assigned`, `concurrent_update`, `validation_error`, `invalid_value`.

---

## 7. Realtime

### 7.1 Topics and access

| Topic | Who may subscribe | Carries |
|---|---|---|
| `case:<CASE-id>`, `inbox:<STF-id>`, `customer:<CUS-id>` | unchanged (slice 2 §7) | + `case.unassigned` on `inbox:` |
| **`supervision:queues`** | staff holding `supervisor` | `queue.updated`, `queue.case_queued` |
| **`supervision:team`** | staff holding `supervisor` | `team.updated` |

`TopicKind.SUPERVISION` with key ∈ {`queues`, `team`} (any other key → `invalid_topic`); `Topic.supervision_queues()`, `Topic.supervision_team()`. `TopicAccessPolicy`: supervisor role only; customers never. Roles are checked at subscribe time (unchanged rule).

### 7.2 Envelopes

| `type` | Topic | `payload` | Emitted after |
|---|---|---|---|
| **`case.unassigned`** | `inbox:<previous assignee>` | `CaseSummary` | `case.assigned` with `previous_analyst_id` |
| **`queue.updated`** | `supervision:queues` | `QueueCounts` | any committed case event whose case is `queued` after commit; and a `case.assigned` that took the case **out of a queue**: `reason` `queue_drained`, or `manual` with `previous_analyst_id = null`. A new case assigned on arrival (`language_least_loaded`) never entered a queue and sends no `queue.updated` |
| **`queue.case_queued`** | `supervision:queues` | `CaseSummary` | `case.queued` (a case entered a queue) |
| **`team.updated`** | `supervision:team` | `{ staffIds: string[] }` (analysts whose row may have changed) | `turn.created` (kind `message`) of an assigned case, `case.assigned` (new + previous), `case.status_changed`, `case.first_responded`, `case.closed`, `staff.availability_changed`, `auth.session_started`, `auth.session_ended` |

- Producer: a new `SupervisionRealtimeProjector` (`application/cases/supervision_realtime.py`), subscribed to the bus, using the same presenter pattern as `CaseRealtimeProjector` (payloads = REST schemas; contract test validates them). Envelope `id` = source event id; `data = {entity, entityId, caseId, actor, payload}` as usual.
- `case.viewed` is suppressed on every socket. `auth.*` events still never reach a socket raw.
- On `customer:` topics the envelope `data.actor` never reveals a supervisor: the id is already hidden for staff (slice 2), and a `supervisor` or `admin` role is shown as `system` (the `conversation.updated` and the notice of a reassignment arrive as `{role: "system", id: null}`).
- Sockets only signal: `team.updated` carries ids, not rows; clients refetch.

---

## 8. Frontend

One agent owns all of `frontend/`. It may extend `components/ui`, `components/layout` and `styles/index.css` (tokens only), never fork them. Dependency direction: `routes/supervision/*` → `features/supervision` → `features/conversation` → `features/cases`; `features/audit` imports only `@/features/conversation` (for `shortCaseId`) and `@/app/roles`; the audit route module (not the feature) mounts `useQueueNotices()` from `@/features/supervision`. Every feature exports through `index.ts`.

### 8.1 Routes, roles and the rail

| Path | Screen | Guard |
|---|---|---|
| `/supervision/equipo?equipo=&estado=&analista=&asignar=` | Team and queues | supervisor |
| `/supervision/casos/:caseId?historial=&asignar=` | **New:** supervisor read-only case view | supervisor |
| `/supervision/auditoria?quien=&persona=&caso=&tipo=&desde=&hasta=&q=&cambios=&evento=` | Audit | supervisor |

- `/supervision/aprobaciones` is already gone (slice 2 F12); keep the test that it falls to the role's not-found page.
- `app/roles.ts`: the "Equipo y colas" item gets `indicator: 'queuedCases'` and `alsoActiveOn: ['/supervision/casos']`; add the path helper `supervisionCasePath(caseId: string): string` (`/supervision/casos/${caseId}`).
- `app/rail-indicators.ts`: `useQueuedCasesCount({ enabled: role === 'supervisor' })` from `@/features/supervision` → `queuedCases: { count }` when `count > 0` (the rail names it "Equipo y colas, 3 pendientes"). Felipe in the analyst role sees no badge and fetches nothing.
- Back navigation from the case view uses router `state.from` (one-shot hand-off with the full return URL, filters included); without it, "Volver a Equipo y colas".
- Felipe (Analista + Supervisora): the role switcher already lists both; nothing new beyond the badge rule. In supervision mode his own cases are read-only too (§8.5).

### 8.2 `src/lib/realtime` (types only)

- `KnownRealtimeEventType` += `'case.unassigned' | 'queue.updated' | 'queue.case_queued' | 'team.updated'`.
- `RealtimeTopic` += `` `supervision:${'queues' | 'team'}` ``; `topics.supervisionQueues()`, `topics.supervisionTeam()`.
- New reader `envelopeActor(envelope): { role: string; id: string | null } | null` (next to `envelopePayload`).

### 8.3 Changes in `features/cases` and `features/conversation`

- **cases** (`assignedToastCopy`, `useInboxLive`, `realtime.ts`):
  - `case.assigned` with `envelopeActor(...).role === 'supervisor'` → toast "Te asignaron un caso" / "{cliente} · desde supervisión" (else the slice 2 copy).
  - `case.unassigned` → `patchInbox` like `case.updated` (the case leaves her lists by refetch), and a toast once per envelope id: "Supervisión reasignó un caso" / "El caso de {cliente} pasó a otra persona del equipo. Puedes leerlo, pero ya no responder." (`unassignedToastCopy(summary)` in `model.ts`).
- **conversation**:
  - `ConversationPane` gains `mode?: 'workspace' | 'supervision'` (default `workspace`) and `headerActions?: ReactNode` (rendered in the header before `SampleDataTag`). `supervision` = never the composer, never mark-read, never "Cerrar caso" (even for an assignee holding both roles), the supervision arrival line and footer below.
  - `arrivalLine` (Workspace, me = assignee) for `manual`: from the queue (`previousAnalystId === null`) "{assignedByName} te asignó este caso después de {formatWait(waitedSeconds)} en la {cola} · {fecha, hora}"; reassignment "{assignedByName} te pasó este caso; antes lo atendía {previousAnalystName} · {fecha, hora}".
  - `arrivalNote(detail, meId)` returns `{ heading, line }` (replaces slice 2's `arrivalLine`): the heading is "Cómo llegó a ti" only when the viewer is the assignee. Someone else's case (history access, or supervision moved it away while it was open on her screen): open → heading "Quién lo atiende", line "{assignedByName} pasó este caso a {analystName} · {fecha, hora}" when `manual` with `previousAnalystId === meId`, "Lo atiende {analystName} · {assignedByName} {se lo asignó \| se lo pasó} el {fecha, hora}" for another `manual`, else "Lo atiende {analystName}"; closed → heading "Quién lo atendió", "Lo atendió {analystName}".
  - The composer's draft lives in `ConversationPane`: when the viewer loses the right to reply with text in the box, the read-only footer comes with a warn note "Tu borrador no se envió" (the text, selectable, and "Descartar borrador"), never a silent discard.
  - New `supervisionArrivalLine(detail)`: queued "Espera en la {cola} desde las {hora}: nadie disponible habla {idioma}"; `language_least_loaded` "Lo atiende {analystName}: le llegó al estar disponible y hablar {idioma}{' (regla 3)'} · {fecha, hora}"; `queue_drained` "Lo atiende {analystName}: le llegó desde la {cola} tras {espera} · {fecha, hora}"; `manual` "Lo atiende {analystName}: {se lo asignó \| se lo pasó} {assignedByName} · {fecha, hora}"; closed "Lo atendió {analystName}".
  - New `supervisionFooter(detail)`: queued "Vista de supervisión · El caso espera en la {cola}. Asígnalo para que alguien le responda."; open "Vista de supervisión · Solo lectura. Lo atiende {analystName}."; closed → `closureLine` (+ note), as today.
  - `describeCloseFailure` += `case_not_assigned` → "Ya no puedes cerrarlo: supervisión pasó este caso a otra persona."; `useMarkRead` ignores a 403.
  - `index.ts` also exports `shortCaseId` and the type `ConversationMode`.

### 8.4 `features/supervision` · team and queues screen (`TeamScreen`)

Layout (canvas SuTeam, 1440×900, must not break at 1280):
- **PageHeader** "Equipo y colas"; subtitle "{nombre del equipo | Todos los equipos} · {n} analistas"; right: team `SegmentedControl` (pills: "Todos los equipos", then each `TeamSummary.name` without the "Disputas · " prefix if all share it) and `SampleDataTag`.
- **Result strip** (the canvas "Listo ·" line, `role="status"`, dismissible, shown only after an action on this screen): "Listo · El caso de {cliente} pasó a {Analista}. La {cola} quedó en {n}." (reassignment: "Listo · El caso de {cliente} pasó de {Anterior} a {Analista}."). No "Siguiente paso" recommendation.
- **Left column (440 px) "Colas"**, heading aside "{total} en espera". One card per `LanguageQueue` (border `warn-border` when `atRisk > 0`):
  - name (`label`), risk text top right: "{n} en riesgo de SLA" (warn) or "Sin riesgo" (muted);
  - three figures: `{waiting}` "en espera" · oldest wait "el más antiguo" (`formatWait(now − oldestQueuedAt)`, warn when at risk, "—" when empty) · `{availableSpeakers}` "disponibles que hablan {idioma}" (canvas "atendiéndola");
  - the queued cases (all of them): customer name, "Espera {formatWait}", `formatSla` tag, preview, and a secondary "Asignar" button (`?asignar=<id>`); the row name links to the case view. Empty: "Sin casos en espera.".
- **Right "Analistas"** (white card): filter pills = native radios (`SegmentedControl` pills, canvas `role=tablist` replaced): "Conectadas {n}" (busy + available) · "En pausa {n}" · "Desconectadas {n}" (plural pills, "personas"; the per-person label is "Sin conexión", §2.2), counts after the team filter; heading aside "{open} casos abiertos · {atRisk} en riesgo de SLA".
  - `Table` columns (tighter side padding; the three long numeric headers wrap to two lines so all seven fit at 1280 without a horizontal scroll): **Nombre** (+ the team in muted text when "Todos los equipos", short like its pill, "Equipo Andes", full name in `title`) · **Ahora** (`StatusDot` + label of §2.2; available without session adds "sin sesión abierta" in muted, `title` "Le siguen llegando casos aunque no haya iniciado sesión.") · **Idiomas** ("español, portugués"; Portuguese speakers in `accent` semibold as in the canvas) · **Abiertos** (number; `Badge` warn "Carga alta" when ≥ 5; "—" when offline with 0) · **Por responder** (`new + toReply`) · **Espera más larga** (`formatWait(now − oldestWaitingSince)` or "—") · **SLA en riesgo** (count, warn when > 0, else "—").
  - Row select (`TRowSelect`) sets `?analista=`. Empty filter: "Nadie en este estado ahora.".
  - Footer `SourceNote`: "Personas, idiomas y equipos: directorio del equipo. Estado, colas y casos: datos de ejemplo."
- **Analyst sheet** (`Sheet` 600, `?analista=`): title the name; description "{Ahora} · {idiomas} · {equipo}"; four `Stat`s (Abiertos · Nuevos · Por responder · Esperando al cliente); her `openCases` as rows (left stripe = `inboxStatusMeta` tone, customer, `formatSla`, preview, "{prioridad} · {App|Web} · {idioma}", last interaction relative) with "Ver conversación" (link to the case view, `state.from`) and "Reasignar" (`?asignar=<id>`). Empty: "No tiene casos abiertos.". An unknown `analista` id closes the sheet.
- **States:** both queries through `QueryState` (skeleton cards/rows; danger `Callout` + "Reintentar"); team and queues load and fail independently.

### 8.5 `features/supervision` · case view (`SupervisorCaseScreen`)

- Top bar: back link ("Volver a Equipo y colas" | "Volver a Auditoría", from `state.from`), `Badge` neutral "Vista de supervisión · solo lectura", an `sr-only` h1 "Conversación de {cliente} (supervisión)", `DocumentTitle` "Caso {shortId} · Supervisión".
- Body: `ConversationPane mode="supervision"` with `headerActions` = primary "Asignar" (queued) or secondary "Reasignar" (open) when `capabilities.canAssign`, and `onOpenHistory` → `?historial=lista`; `CaseHistorySheet` exactly as the Workspace (`historial=lista|<id>`). Errors: `describeCaseLoadFailure`.
- `?asignar=1` opens the assign dialog for this case; success → toast "Listo · El caso de {cliente} pasó a {Analista}" and the pane refetches.

### 8.6 `features/supervision` · assign dialog (`AssignCaseDialog`)

- Opened from a queue row, the analyst sheet, the case view or the notice toast (`?asignar=`). Input: the `CaseSummary` (from the cached overview or detail) and the team overview's analysts.
- Title "Asignar caso" (queued) / "Reasignar caso" (open). Subtitle "{cliente} · {shortId} · {español | portugués} · {Espera {x} en la cola | Lo atiende {Analista}}".
- **"¿A quién?"** (`RadioGroup`, required): every listed analyst except the current assignee, ordered: speaks the language first; then `available`, `busy`, `paused`, `offline`; then fewer open cases; then name. Label = name; `description` (new optional `RadioOption.description`, extend the primitive + test) = "{Ahora} · {n} abiertos · {idiomas}". Non-speakers are **disabled** with the description "No habla portugués (regla 3)". The current assignee is not an option.
- **Paused or offline choice:** a warn `Callout` "{Nombre} está en pausa: no recibe casos nuevos. Si lo asignas igual, le llega a su lista." (offline adds " Tampoco tiene una sesión abierta.") and a required `Checkbox` "Asignar aunque esté en pausa" → `confirmPaused: true`.
- **What the customer sees** (neutral `Callout` "El cliente verá"): queued → "Que ya lo atiende {Nombre}." ; reassignment → the notice of §3.5 in the case language. `REASSIGNED_NOTICE: Record<Language, (firstName: string) => string>` in `model.ts`, pinned by a test to the backend text.
- Footer: "Cancelar" + primary "Asignar a {Nombre}" / "Reasignar a {Nombre}" (loading while pending). Request: `{ analystId, expectedAnalystId: summary.assignedAnalystId, confirmPaused }`.
- **Errors** (`describeAssignFailure`, form-level danger `Callout`, focus kept in the dialog):

  | Code | Copy | Then |
  |---|---|---|
  | `language_mismatch` | "Ese caso es en {idioma} y {Nombre} no lo habla (regla 3)." | — |
  | `analyst_paused` | "{Nombre} está en pausa. Marca «Asignar aunque esté en pausa» para seguir." | show the checkbox, focus it |
  | `assignment_changed` | "Alguien más movió este caso mientras decidías. Revisa a quién está asignado ahora." | refetch team + queues + detail; keep the dialog open with fresh data |
  | `case_closed` | "Este caso ya se cerró." | close the dialog, refetch |
  | `analyst_not_eligible` | "Esa persona ya no puede recibir casos." | refetch team |
  | other | "No pudimos asignar el caso. Inténtalo de nuevo." | |
- **On success:** `changed: false` → info toast "{Nombre} ya tenía este caso."; else the result strip (team screen) or toast (elsewhere); `setQueryData(conversationKeys.detail(id))` is not enough (capabilities, assignment): invalidate `conversationKeys.detail(id)`, `supervisionKeys.team()`, `supervisionKeys.queues()`; close the dialog (`asignar` removed, `replace`).

### 8.7 `features/supervision` · live data

- `useTeamOverview()` (`GET /supervision/team`, `refetchInterval` 60 s), `useQueueOverview({ enabled })` (`GET /supervision/queues`, 60 s), `useSetAssignee(caseId)`.
- `useQueuedCasesCount({ enabled })` = `useQueueOverview` + `select: (o) => o.counts.total`, and subscribes to `supervision:queues` while enabled.
- `TeamScreen` subscribes to `supervision:team` and `supervision:queues`; on reconnect (`reconnecting → open`) it refetches both.
- `registerSupervisionRealtime` (added to `FEATURE_REALTIME_REGISTRATIONS`):
  - `queue.updated` → patch `counts` in the cached `QueueOverview` when `computedAt` is newer, then invalidate `supervisionKeys.queues()`;
  - `queue.case_queued` → invalidate `supervisionKeys.queues()`;
  - `team.updated` → invalidate `supervisionKeys.team()`, throttled (at most once per 2 s, trailing; the throttle lives in the registration closure).
- **Supervisor notice** (canvas SuAvisoNueva, adapted): `useQueueNotices()` is called on the three supervision screens (by `TeamScreen` and `SupervisorCaseScreen`, and by the `routes/supervision/audit.tsx` module for the audit, so `features/audit` keeps its import rule). On `queue.case_queued` (once per envelope id): toast with tag "{cola}", title "Un caso espera en la {cola en minúscula}", description "{cliente} · nadie disponible habla {idioma}", actions "Asignar" (navigate to `/supervision/equipo?asignar=<id>`) and "Más tarde" (dismiss). No AI/approval wording.

### 8.8 `features/audit` · audit screen (`AuditScreen`)

Layout (canvas SuAudit):
- **PageHeader** "Auditoría", subtitle "Quién hizo qué, en qué caso y cuándo · Datos de ejemplo"; right: `SearchInput` (label "Buscar", placeholder "Buscar por id de caso, cliente o persona", ≤ 80, debounced 300 ms → `q`). No "Exportar".
- **Toolbar:** "Quién" pills (`SegmentedControl`): "Todos" · "Equipo" · "Clientes" · "Plataforma"; `Select` "Tipo": "Todos los tipos" · "Conversación" · "Asignación" · "Ciclo del caso" · "Disponibilidad" · "Accesos" · "Otros"; `Select` "Persona" (from `GET /staff`, shown when Quién is Todos or Equipo); "Desde" / "Hasta" (`Input type="date"`, viewer's zone; `from` = local start of Desde, `to` = local start of the day after Hasta, both sent as UTC; Hasta < Desde → inline field error, no request); `Checkbox` "Solo acciones que cambian algo"; when `caso` is set, a removable chip "Caso {shortId}"; ghost "Limpiar filtros" when any filter is set.
- **Log** (`section aria-label="Registro"`, native `Table`, sticky header, day separators "Hoy" / "Ayer" / "{d mmm}"): **Hora** (`HH:mm:ss`, viewer zone) · **Quién** (kind `Badge`: "Analista" / "Supervisora" / "Administración" / "Cliente" / "Plataforma", then the name, or "Plataforma") · **Qué hizo** (`description` + "CAMBIO" in warn when `changesState`) · **Caso** (mono `shortCaseId`, "—" without case). Row select (`TRowSelect`) sets `?evento=`. "Cargar más" at the bottom while `nextCursor` (TanStack `useInfiniteQuery`), with "Mostrando {n} eventos".
- **Detail aside** (380 px, `aside aria-label="Detalle del registro"`): kicker "{hora} · {TIPO EN MAYÚSCULAS}", the description, "{nombre} · {rol}"; `KeyValueList`: Evento (id, mono), Tipo (`type`, mono), Caso (id mono + customer name), Quién (actor id, mono), Ocurrió, Registrado; an `Accordion` "Datos del evento" with the payload as key/value lines (mono, JSON for nested values); when `redactedFields` includes `text`: muted note "El texto del mensaje no se muestra aquí: está en la conversación." Footer: "Ver la conversación" (link to `supervisionCasePath`, `state.from` = the current audit URL) and "Filtrar por este caso" (sets `caso`). With `?evento=` not in the loaded pages, the aside loads `GET /audit/events/{id}`; 404 → "No encontramos ese evento.". Nothing selected: "Elige un evento para ver el detalle.".
- **States:** skeleton rows; empty without filters "Todavía no hay eventos."; empty with filters "Ningún evento coincide con estos filtros." + "Limpiar filtros"; error danger `Callout` + "Reintentar". No realtime (the log is read on demand; "Actualizar" ghost button refetches).

### 8.9 URL state (frozen)

```ts
// features/supervision/model.ts
export interface TeamUrlState {
  team: string | null                              // ?equipo=<TeamSummary.key>; unknown → null (all)
  activity: 'connected' | 'paused' | 'offline'     // ?estado=conectadas|en-pausa|desconectadas (default conectadas)
  analystId: string | null                         // ?analista=STF-…
  assignCaseId: string | null                      // ?asignar=CASE-…
}
export interface CaseViewUrlState {
  history: 'lista' | string | null                 // ?historial=lista|CASE-…
  assign: boolean                                  // ?asignar=1
}
// features/audit/model.ts
export interface AuditUrlState {
  actorKind: AuditActorKind | null                 // ?quien=equipo|clientes|plataforma
  actorId: string | null                           // ?persona=
  caseId: string | null                            // ?caso=
  family: AuditFamily | null                       // ?tipo=conversacion|asignacion|ciclo|disponibilidad|accesos|otros
  fromDate: string | null                          // ?desde=YYYY-MM-DD (viewer's zone)
  toDate: string | null                            // ?hasta=YYYY-MM-DD (inclusive day)
  query: string                                    // ?q=
  changesOnly: boolean                             // ?cambios=1
  eventId: string | null                           // ?evento=EVT-…
}
```

Parse/serialize pairs: `parseTeamSearch`/`toTeamSearch`, `parseCaseViewSearch`/`toCaseViewSearch`, `parseAuditSearch`/`toAuditSearch`, plus `auditFiltersOf(state): AuditQuery` (dates → UTC instants). Filter changes `replace` the history entry; selecting an analyst, an event or opening a dialog pushes.

### 8.10 Public APIs and query keys (frozen)

```ts
// src/features/supervision/index.ts
export { TeamScreen } from './components/TeamScreen'                 // { state, onStateChange(next, opts?), onOpenCase(caseId) }
export { SupervisorCaseScreen } from './components/SupervisorCaseScreen' // { caseId, state, onStateChange, backTo, backLabel }
export { useQueuedCasesCount, useQueueNotices } from './hooks'
export { supervisionKeys } from './api'
export { registerSupervisionRealtime } from './realtime'
export { parseTeamSearch, toTeamSearch, parseCaseViewSearch, toCaseViewSearch } from './model'
export type { TeamUrlState, CaseViewUrlState, TeamOverview, TeamAnalyst, TeamSummary,
  QueueOverview, LanguageQueue, QueueCounts, AssignmentResult, AnalystActivity } from './types'

export const supervisionKeys = {
  all: ['supervision'] as const,
  team: () => ['supervision', 'team'] as const,
  queues: () => ['supervision', 'queues'] as const,
}
export const supervisionMutationKeys = { assign: (caseId: string) => ['supervision', caseId, 'assign'] as const }

// src/features/audit/index.ts
export { AuditScreen } from './components/AuditScreen'               // { state, onStateChange(next, opts?) }
export { auditKeys } from './api'
export { parseAuditSearch, toAuditSearch } from './model'
export type { AuditUrlState, AuditEvent, AuditEventPage, AuditFamily, AuditActorKind } from './types'

export const auditKeys = {
  all: ['audit'] as const,
  events: (query: AuditQuery) => ['audit', 'events', query] as const,
  event: (eventId: string) => ['audit', 'event', eventId] as const,
}
```

Route modules stay thin: `routes/supervision/team.tsx`, `routes/supervision/case.tsx` (new), `routes/supervision/audit.tsx` read the URL / `state.from` and render the screen.

---

## 9. Seed additions ("Datos de ejemplo", invented people)

Same rules as slice 2 §8: stable ids, times relative to the first seed (`T`), through the domain, events recorded with the story's time. Daniela's inbox does **not** change (Todos 5 · Por responder 2 · Nuevos 2 · Esperando 1 · Cerrados 3).

### 9.1 Customers

| n | Name | Locale · city | `suggestions` |
|---|---|---|---|
| 1009 | Rosa Elena Ibarra Méndez | es-MX · Puebla, MX | "¿Ya vieron lo de la suscripción?" · "Sigo esperando" |
| 1010 | Mauricio Achával Ríos | es-AR · Mendoza, AR | "¿Me pueden frenar el cobro doble?" · "Es urgente" |
| 1011 | Camila Torres Benavides | es-CO · Bucaramanga, CO | "¿Alguna novedad de la transferencia?" |
| 1012 | Esteban Morales Quiroga | es-CO · Pereira, CO | "Fue en el extracto de septiembre" · "Gracias" |

### 9.2 Cases

| # | Customer | Channel · lang · priority | Final state | Times | Assignment | Turns |
|---|---|---|---|---|---|---|
| 111 | 1009 Rosa | `app_chat` · es · medium | **queued** in "Cola en español", **at risk** | opened T−11m (the first case after Daniela paused); SLA due T+4m | none | c "Buenas, me llegó un cobro de una suscripción que cancelé hace meses." · notice · banner "No hay personas disponibles que hablen español: el caso espera en la cola en español." |
| 112 | 1010 Mauricio | `web_chat` · es · **high** | **queued**, **SLA vencido** | opened T−8m; SLA due T−3m | none | c "Me están cobrando dos veces el mismo pago del celular, necesito que lo frenen ya." (T−8m) · notice · queued banner · c "¿Alguien me puede atender?" (T−4m) |
| 113 | 1011 Camila | `app_chat` · es · medium | Julián, `in_progress` → **to_reply**, first response pending, **SLA vencido** | opened T−34m; SLA due T−19m; opened by Julián T−22m (read up to seq 3) | Julián, `language_least_loaded`, T−34m (0 open; Daniela and Paula held one each) | c "Hola, hice una transferencia y no le llegó a mi hermano." · notice · banner "Asignado a Julián Ortega porque está disponible y habla español." · c "¿Me ayudan por favor?" (T−12m) |
| 114 | 1012 Esteban | `web_chat` · es · low | Julián, `in_progress` → **waiting**; **reassigned** by Lucía from Paula | opened T−40m; SLA due T+20m; Paula assigned T−40m (tied with Julián at 0 open, assigned longer ago); Paula paused T−33m; reassigned T−32m; first response T−30m (met) | Paula (`language_least_loaded`, T−40m) → Julián (`manual`, `assigned_by` Lucía, `previous_staff_id` Paula, T−32m) | c "Quiero saber por qué me cobraron una comisión por manejo." · notice · banner "Asignado a Paula Medina porque está disponible y habla español." · banner "Lucía Herrera pasó el caso de Paula Medina a Julián Ortega." · notice "Ahora te atiende Julián, de nuestro equipo." · a (Julián) "Hola, Esteban. Soy Julián, de LATAM Bank. Ya reviso la comisión; ¿de qué mes es el cobro?" (T−30m) |

The queued cases (109, 111, 112) arrived after Daniela paused (T−12m), so nobody available spoke their language (rule 3); startup runs no drain, so supervisors assign them by hand (or Daniela switches to "Disponible" and gets all three, oldest first).

**Rule 3 consistency (review fix).** Every seeded arrival agrees with rule 3 and the least-loaded strategy at its time (a test replays the log): Daniela's slice 2 cases move before her pause, 101 opened T−19m (first response T−10m, met), 108 T−14m (SLA due T+1m), 102 T−13m (SLA due T+2m, "SLA 2 min") and 103 T−12m30s (SLA due T+2m30s). Her inbox counts are unchanged; her inbox order becomes Patricia, Larissa, Marcela, Beatriz, Joaquín.

**Event order.** The seed records every event (cases, sessions, pauses, Lucía's view) in one Unit of Work, sorted by story time (`infrastructure/seed/timeline.py`), so the audit (newest `sequence` first) lists them as they happened.

### 9.3 People state

- **Julián:** a seeded staff session (`seed session`, started T−45m, normal TTL; `auth.session_started` recorded) and availability `paused` since T−20m, with a `staff.availability_changed` (available → paused, actor Julián) at T−20m. He is the **"En pausa"** row with 2 open cases, one overdue.
- **Paula:** paused at T−33m (`staff.availability_changed`), before Lucía passed 114 to Julián.
- **Daniela:** paused at T−12m (`staff.availability_changed`), right after her last new case (103) and before the queued cases arrived. No session: she is **Desconectada**.
- **Lucía:** a `case.viewed` of case 113 at T−5m (supervisor access), so the audit shows the access family.
- **Nobody starts available.** Everyone else is paused without a session (**Desconectada**). Signing in as Daniela and switching to "Disponible" drains the queues to her; new chats then land on her.
- The seeded session expires after the TTL like any session (Julián then shows as Sin conexión); delete the database to re-anchor.

### 9.4 What the screens show on a fresh database (before anyone else signs in; Lucía signed in)

| Where | Expected |
|---|---|
| Queues | Cola en español: 2 en espera (111 at risk, 112 vencido), oldest 11 min, 0 disponibles que hablan español · Cola en portugués: 1 (109), oldest 6 min, 0 disponibles · header "3 en espera" · rail badge **3** |
| Analistas · Conectadas (0) | "Nadie en este estado ahora." (nobody is available: that is why the queues wait) |
| Analistas · En pausa (1) | Julián Ortega: En pausa · español · 2 abiertos · Por responder 1 · SLA en riesgo 1 (113) |
| Analistas · Desconectadas (5) | Daniela Ríos (español, portugués · 5 abiertos **Carga alta** · Por responder 4 · espera más larga ≈ 14 min · SLA en riesgo 3: 108, 102, 103), then Felipe Echeverri, Paula Medina, Sebastián Cárdenas, Tomás Arango (by name, §2.4; "—"). Felipe moves to En pausa once he signs in; Daniela moves to Conectadas when she signs in and switches to "Disponible" (the queues drain to her). |
| Teams | Equipo Andes: Daniela, Julián, Felipe · Equipo Pacífico: Paula, Sebastián, Tomás |
| Audit | Seeded events in time order (one "Hoy" run, then older days), incl. 114's "Reasignó el caso de Paula Medina a Julián Ortega", the "Pasó a En pausa" of Paula, Julián and Daniela, Julián's "Inició sesión", Lucía's "Abrió la conversación en modo supervisión". |

Update `backend/README.md` (accounts table: Julián's seeded session; seeded cases; supervision endpoints; the "delete `cc_platform.db`" note) and the slice 2 seed tests that count queued cases (now 3).

---

## 10. Tests and done criteria

**Backend.** Every gate of brief §6 passes, plus:
- **Domain:** `Case.reassign` (from `assigned`, from `in_progress` with `case.status_changed` `reassigned`, read cursor reset, unread kept, closed → `case_closed`, queued → `invalid_transition`, same analyst rejected); `Case.assign` with `manual`; `CaseAssigned.paused_override`.
- **`SetCaseAssignee`:** every rule of §3.3 in order (not found, closed, not eligible: unknown/inactive/non-analyst, pt to an es-only analyst → `language_mismatch`, same analyst → no-op without events, `assignment_changed`, `analyst_paused` then OK with `confirmPaused`); effects of §3.4 (Assignment fields, banners of §3.5 incl. the paused suffix, the customer notice only on reassignment, `waited_seconds` from the queue, SLA untouched); concurrency of §3.9 (a customer message between load and save → retried and committed; close-then-assign → `case_closed`; assign-then-reply → `case_not_assigned`; drain racing manual → `assignment_changed` or no-op).
- **Access:** the previous assignee keeps read-only access after a reassignment (history via `assignments`); `case.viewed` recorded for a supervisor, not for the assignee or a history reader, deduped within 15 min; `canAssign` per role and status.
- **Read models:** `activity` table of §2.2 (incl. available without session, paused with/without session, missing availability row); counts and `oldestWaitingSince`; `atRiskCases`/`atRisk` at a pinned clock; team keys and the team list (no admin team); queue order and both languages always present; `availableSpeakers`.
- **Audit:** every filter (kind, actor id, case id, family, changesOnly, from/to bounds, `q` on each id column, combined); newest-first cursor pagination without gaps or duplicates across pages; `from ≥ to` → 422; `get` 404; `turn.created` redaction (`text` removed, `text_length` set, `redactedFields`); a catalog test over every emitted event type (no fallback text); roles (analyst → 403; supervisor and admin → 200).
- **Realtime:** `case.unassigned` + counts to the previous inbox; `queue.updated` (enter, leave by drain, leave by manual) and `queue.case_queued`; `team.updated` triggers of §7.2 with `staffIds`; `supervision:*` subscription allowed for supervisors and refused for analysts and customers, unknown key → `invalid_topic`; `case.viewed` on no socket; the customer gets the reassignment notice and `conversation.updated`, never the banner, the supervisor or the previous analyst; envelope payloads validate against the REST schemas.
- **Seed:** §9 numbers (3 queued: 2 es + 1 pt; Julián 2 open; 114's assignment chain; Daniela unchanged).
- **OpenAPI:** the new codes and `ProblemDetails` members are published; `export_openapi --check` clean.

**Frontend.** Every gate passes, including `check:api` after `gen:api`, plus:
- **`model.test.ts` (supervision):** activity labels/tones; filter counts per team; at-risk and longest-wait from rows at a pinned `now`; high-load flag; candidate ordering and disabling (rule 3) in the assign dialog; `describeAssignFailure` per code; `REASSIGNED_NOTICE` and `QUEUE_LABEL` pinned to the backend texts; result-strip copy; URL parse/serialize (unknown values fall back).
- **`model.test.ts` (audit):** URL parse/serialize; `auditFiltersOf` date conversion (viewer zone pinned to `America/Bogota`, `hasta` inclusive); kind badge labels; day-separator labels.
- **`model.test.ts` (conversation, cases):** `arrivalLine` for `manual` (queue and reassignment); `supervisionArrivalLine`; `supervisionFooter`; `unassignedToastCopy`; supervisor toast copy on `case.assigned`.
- **Realtime:** `queue.updated` patches counts only when newer; `team.updated` throttled; `case.unassigned` patches inboxes and toasts once.
- **Render tests:** team screen (queues with cases and the empty queue, the three filters with counts, "Carga alta", the analyst sheet, loading/error per query); assign dialog (pt case: es-only analysts disabled with "(regla 3)"; paused target requires the checkbox; `assignment_changed` message; success strip); case view (read-only, no composer even for an assignee with both roles, "Reasignar" shown, history sheet); audit (rows, CAMBIO tag, detail aside with redaction note, "Cargar más", empty with filters + "Limpiar filtros", error); rail badge "Equipo y colas, 3 pendientes" for a supervisor and nothing in the analyst role; the notice toast with "Asignar".

**Done (live check on a fresh database, two or three browser windows):**
- Lucía sees 3 queued, the badge 3, Julián "En pausa" with an overdue case;
- she assigns Gabriela's pt case (109): Julián and Paula are disabled (regla 3); Sebastián (paused, offline) needs the confirmation; after confirming → the banner "(Sebastián estaba en pausa)", Sebastián's inbox gets it (toast "Te asignaron un caso" if signed in), the simulator shows "Te atiende Sebastián", badge 2;
- she reassigns 113 from Julián to Daniela (paused at seed: with «Asignar aunque esté en pausa», or after Daniela switched to "Disponible") → Daniela gets it as Nuevo (it stays Nuevo until she opens it: the Workspace never opens a case that arrives over the socket, it shows the toast), Julián's list drops it with the toast and he still reads it; the customer sees "Ahora te atiende Daniela, de nuestro equipo.";
- a customer message and a close racing a reassignment behave as §3.9;
- the audit shows every step with Spanish descriptions, filters and pagination work, "Ver la conversación" opens the read-only view and that view appears as an access event;
- Felipe switches Casos ↔ Equipo y colas; no console errors; nothing breaks at 1280 px.

## 11. Seams for later slices (do not build now)

- **Slice 4:** teams as records (`TeamRef.key` becomes the team id), `staff.*` events in the audit catalog, an admin entry to the audit, deactivation making `analyst_not_eligible` reachable from the UI.
- **Later / not planned:** pausing an analyst on her behalf, a supervisor close, capacity caps, real presence (socket-based), audit export, auditing history-access reads.
