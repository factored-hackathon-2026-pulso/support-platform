# Slice 18 contract · AI foundation: the AI switch and the case type

**Status:** implemented (2026-10-04). Gates in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-04.

**Scope.** The base the AI slices (S19–S22, ADR 0006) build on: one platform-wide switch,
"Funciones de IA", and the case type (the dataset's complaint subcategory) on every case. With
the switch off the platform is exactly the people-only one. The frontend types are regenerated
(they were stale after the S14–S16 merges).

Read first: `../ENGINEERING_BRIEF.md` (it wins), `../adr/0006-ai-maturity-by-case-type.md`
(the model), `../adr/0003-agent-core-integration.md`, `slice-8-priority.md` (the case type
mirrors it), `slice-14-assistant.md`, `slice-15-copilot.md`, `slice-16-agent-builder.md`.

---

## 1. Vocabulary

| `CaseType` | Staff word | Source |
|---|---|---|
| `none` | Sin tipo | the dataset's `(null)` subcategory; every case opens with it |
| `unrecognized_charge` | Cargo no reconocido | `complaints.subcategory` (Transactions) |
| `undue_charge` | Cobro indebido | `complaints.subcategory` (Fees) |
| `app_issue` | Problema con app | `complaints.subcategory` (Technical) |
| `branch_service` | Atención en sucursal | `complaints.subcategory` (Branch) |
| `service_quality` | Calidad de servicio | `complaints.subcategory` (Service) |
| `virtual_card` | Tarjeta virtual | **team-generated** (a new product; not in the dataset) |

Names come from data-lab's aggregate report `reports/demand/complaints_by_subcategory.csv`
(names only). The words live in one map in the frontend (`CASE_TYPE`, `features/cases/model.ts`;
menu order: Sin tipo, then the dataset's order by share, then Tarjeta virtual) and in the audit
catalog (`CASE_TYPE_LABEL`). The API carries only the value.

"Funciones de IA" is the AI switch: `aiEnabled` in the API.

## 2. The AI switch

### 2.1 Domain and storage (`domain/platform`, `application/platform`)

- `PlatformSettings`: a singleton aggregate (`id = "default"`, table `platform_settings`:
  `ai_enabled`, `updated_at`, `updated_by_id`, `version`), saved with its compare-and-set.
  The row does not exist until the first change: until then `CC_AI_ENABLED` (default `true`)
  applies. A stored value always wins over the deployment default.
- `PlatformSettings.set_ai_enabled(enabled, actor, at) -> bool`: the same value is a no-op
  (False, no event); otherwise records **`platform.ai_toggled`** `{"enabled": bool}` (entity
  `platform`, entity id `default`).
- `SetAiEnabled` (Administración): a `PUT` of the desired state, safe to repeat, run in
  `retry_on_conflict` (a race on the first insert retries on fresh state: one change, one
  event). `GetPlatformSettings` reads it. `AiSwitch.is_on()` / `is_on_in(uow)` is what every
  AI entry point asks; it reads the database each time (no process cache).

### 2.2 What the switch turns off

| Entry point | Switch off | On, agent-core not configured |
|---|---|---|
| New chat (`AssistantGate`) | the case goes to people (queue + rule 3), never `with_assistant` | people (as before) |
| `GET /cases/{caseId}/copilot` | `available: false`, no messages (200) | same |
| `POST /cases/{caseId}/copilot/messages` | 404 `assistant_disabled` | same |
| `GET /builder/status`, `GET /builder/chat` | `available: false` (200) | same |
| every other `/builder/*` route | 404 `assistant_disabled` | same |
| The SPA | hides every AI element (S18: the case type) | shows the case type |

Not affected (a conversation the assistant already holds can finish): the customer's
confirmation, step-up and "ask for a person", `GET /cases/{caseId}/handoff`, Supervisión's
`POST /supervision/cases/{caseId}/assistant/release`, the assistant sweep and agent-core's
`GET /internal/grants/{grantRef}`. Turning AI off does not hand the assistant's open
conversations to people; S19 decides whether its screens offer that.

### 2.3 REST

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/admin/platform` | admin | — | 200 **`AdminPlatformSettings`** | 401, 403 `forbidden` |
| `PUT /api/v1/admin/platform/ai` | admin | **`SetAiEnabledRequest`** | 200 **`SetAiEnabledResult`** | 401, 403 `forbidden`, 422 `validation_error` |
| `GET /api/v1/customer/platform` | customer token | — | 200 **`PlatformSettings`** | 401 |
| `GET /api/v1/auth/me` | any staff | — | `MeResponse.platform` (**`PlatformSettings`**) | (unchanged) |

```ts
PlatformSettings      { aiEnabled: boolean }
AdminPlatformSettings { aiEnabled: boolean; agentCoreConfigured: boolean; version: int /* 0 = the default applies */;
                        updatedAt: datetime | null; updatedByName: string | null }
SetAiEnabledRequest   { enabled: boolean }
SetAiEnabledResult    { changed: boolean /* false: already in that state, no event */; settings: AdminPlatformSettings }
```

No new problem code: the gated AI routes answer the existing `assistant_disabled` (the switch
off behaves as "agent-core not configured").

### 2.4 Realtime

| Event | Envelope · topic |
|---|---|
| `platform.ai_toggled` | `platform.updated` (`PlatformSettings`) → **`platform:settings`** |

`platform:settings` is a new topic: every staff member (whatever her roles) and every customer
simulator session may subscribe. The envelope's actor id is null (customers listen too). The
raw event is never forwarded (`PLATFORM_EVENTS` are suppressed in the generic mapper).

### 2.5 Audit

`platform.ai_toggled` → family **administration** (changes state). Description next to the
actor: "Activó las funciones de IA" / "Desactivó las funciones de IA". Payload `{"enabled"}`.

## 3. The case type (mirrors slice 8 in every respect)

### 3.1 Domain (`Case.change_type`)

- `Case.case_type: CaseType` (column `cases.case_type`, default `none`); every case opens with
  `none`.
- `Case.change_type(actor, case_type, at) -> bool`: a closed case → `CaseClosedError`; the same
  type → False, no event; otherwise records **`case.type_changed`** `{"from", "to"}`; no status
  transition, the SLA does not move.

### 3.2 Use case (`ChangeCaseType`, `application/cases/case_type.py`)

The priority's rules, in the same order, in `retry_on_conflict`: (1) the case exists (404
`not_found`); (2) the caller is its assignee with Analista, or holds Supervisión (any case,
queued included), else 403 `case_not_assigned`; (3) it is not closed (409 `case_closed`); (4)
the same type is a no-op (`changed: false`) whatever `expectedVersion` says; (5) the case is
still at `expectedVersion`, else 409 `version_conflict` with `currentVersion` and `current` (the
`CaseSummary` now). Actor role: `analyst` for the assignee, else `supervisor`.

Capability: `CaseCapabilities.canChangeType`, the same rule as `canChangePriority`.

**The type does not depend on the switch**: the API accepts it with AI off (the SPA does not
show it); turning AI off and on never loses the team's classification.

### 3.3 REST

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `PUT /api/v1/cases/{caseId}/type` | analyst, supervisor | **`ChangeCaseTypeRequest`** | 200 **`CaseTypeResult`** | 401 · 403 `forbidden` (`requiredRoles`), `case_not_assigned` · 404 `not_found` · 409 `case_closed` (`currentStatus`), `version_conflict` (`currentVersion`, `current`) · 422 `validation_error` |

```ts
ChangeCaseTypeRequest { caseType: CaseType; expectedVersion: int /* ≥ 0 */ }
CaseTypeResult        { changed: boolean; case: CaseSummary }
```

Members added: `CaseType` (enum), `CaseSummary.caseType`, `CaseCapabilities.canChangeType`.

### 3.4 Realtime and audit

Like the priority: `case.type_changed` → `case.updated` (`CaseSummary`) on `case:<id>` and
`inbox:<assignee>` (+ `inbox.counts`), `team.updated` `{staffIds: [assignee]}` on
`supervision:team`, and `queue.updated` for a queued case. The customer never sees it. Audit:
family **lifecycle**, changes state; "Cambió el tipo de caso a Cobro indebido"; to `none`:
"Quitó el tipo de caso".

### 3.5 Seed

Set by staff through the domain (`case.type_changed`), like the priority: Cargo no reconocido
101, 102, 110, 115, 116; Cobro indebido 104, 107, 112 (Lucía, while queued), 114, 117; Problema
con app 113; the rest (new, queued or unclear: 103, 105, 106, 108, 109, 111) none. The audit
shows these rows whatever the switch says.

## 4. Frontend

- **`app/platform.ts`** (features may import it, like `app/session`): `platformKeys`,
  `usePlatformSettings`, **`useAiEnabled()`** (false while unknown, so nothing flashes),
  `registerPlatformRealtime` (`platform.updated` → the cache). The session's `/auth/me` query
  primes it (`primePlatformSettings`); after a sign-in it reads `/auth/me` once.
  `SessionLiveSync` subscribes `platform:settings` and refetches after a reconnect.
- **Administración · "Plataforma"** (`/admin/platform`, rail item after Auditoría): one card,
  "Funciones de IA", with what it does ("Asistente, copiloto y tipos de caso. Apagadas, la
  plataforma atiende solo con personas."), the new `Switch` primitive (`role="switch"`,
  Linear-like), the last change as facts (user + clock, or "Valor de la instalación"), and a
  neutral `Callout` "El motor de IA no está conectado" when it is on without agent-core.
  Optimistic toggle; the app's own switch follows the answer at once; toasts "Funciones de IA
  encendidas / apagadas"; a failure puts it back with an alert toast.
- **Case type** (only while `useAiEnabled()`): `CASE_TYPE` / `CASE_TYPE_OPTIONS` / `caseType` /
  `caseTypeMenuLabel` (`features/cases`), `CaseTypeMenu` (a `ChoiceMenu` with the tag icon),
  `CaseTypeControl` (`features/conversation`: the menu when `canChangeType`, else tag + word;
  renders nothing with AI off), `useChangeCaseType` (optimistic like `useChangePriority`, one
  silent retry when only the version moved, rollback + `describeCaseTypeFailure` toast). Shown in
  the ficha ("Este caso" › "Tipo de caso", after "Prioridad") and in the supervisor case header
  (before the priority).
- **Customer simulator**: `useSimulatorAiEnabled()` (`GET /customer/platform`, live on its own
  socket); it has no AI element yet (S19), so today it only exposes the state on its root
  (`data-ai-enabled`).

## 5. Tests

- Backend: `tests/unit/domain/test_case_type.py`, `tests/unit/application/test_change_case_type.py`
  (both adapters, the races), `tests/api/test_case_type_api.py` (rules, RBAC, audit, realtime,
  independent of the switch), `tests/unit/domain/test_platform_settings.py`,
  `tests/unit/application/test_platform_settings.py` (default, stored value wins, race on the
  first insert), `tests/api/test_platform_api.py` (admin, `/me`, simulator, RBAC, audit, live to
  staff and customers), `tests/api/test_ai_switch_api.py` (with a fake agent-core: new chats to
  people, copilot and builder unavailable, an assistant conversation can still reach a person).
- Frontend: `Switch`, `app/platform`, the case-type model and ficha rows, `CustomerFile` (menu,
  optimistic, rollback, hidden with AI off), the supervisor header, `/admin/platform`, the
  simulator following the switch live.
- e2e: `ai.spec.ts` — Administración turns AI off and on from "Plataforma"; the analyst's
  "Tipo de caso" disappears and comes back live (and after a reload), the simulator follows, the
  analyst sets "Cobro indebido". The scenario leaves AI on (the dev default).

## 6. Known gaps

- No migration: delete `backend/cc_platform.db` (new column `cases.case_type`, new table
  `platform_settings`; the startup check says so).
- Turning AI off does not move the assistant's open conversations to people (§2.2).
- Nothing classifies a case automatically yet (the assistant's handoff or the copilot): S21.
- No stages yet: S21 computes them per type.
