# Slice 8 contract · case priority (part 1)

**Status:** implemented (2026-10-04). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-04.

**Scope.** Staff set how urgent a case is, on the dataset's own scale (`complaints.priority`:
Low, Medium, High, Critical) plus "Sin prioridad". Every case opens without one; its analyst or
supervision changes it. The first-response SLA no longer depends on the priority: one fixed
target for every case. Part 1 also trims the rating text in lists (frontend only, §7).

Still people-only: no AI, no automatic priority, no priority-based routing or SLA.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-2-case-lifecycle.md`,
`slice-3-supervision.md`, `slice-6-analyst-home.md`, `slice-7-csat.md`, `../DATA_MODEL.md`.

---

## 1. Vocabulary

| `CasePriority` | Staff word | Glyph (`PriorityIcon`, Linear-style) | On a card |
|---|---|---|---|
| `none` | Sin prioridad | three dotted bars (muted) | no |
| `low` | Baja | 1 of 3 bars filled | no |
| `medium` | Media | 2 of 3 bars filled | no |
| `high` | Alta | 3 of 3 bars filled | yes, icon-only ("Prioridad alta") |
| `critical` | Crítica | an exclamation in a filled square (danger) | yes, icon-only ("Prioridad crítica") |

The words live in one map in the frontend (`CASE_PRIORITY` in `features/cases/model.ts`; menu
order: Sin prioridad, Crítica, Alta, Media, Baja) and in the audit catalog (`PRIORITY_LABEL`,
the same words). The API carries only the value.

Team-generated: the first-response target (15 minutes for every case, `FIRST_RESPONSE_TARGET`).

## 2. Domain (`Case.change_priority`, `domain/cases/case.py`)

- `CasePriority` gains `none` and `critical`. `Case.open` takes the priority; every live case
  opens with `none` (`PostCustomerTurn`), and so does every seeded case (§8).
- `Case.change_priority(actor, priority, at) -> bool`:
  - a closed case → `CaseClosedError` (`case_closed`, `currentStatus: closed`);
  - the same priority → `False`, no event;
  - otherwise sets it and records **`case.priority_changed`** with payload `{"from": "medium",
    "to": "high"}`; no status transition, the SLA does not move.
- Who may call it is the use case's rule (§3), not the aggregate's.

`SlaPolicy.due_at(*, opened_at)`: `FirstResponseSlaPolicy` = `opened_at + 15 min` for every case
(was 5 / 15 / 60 min by high / medium / low). A priority set later never moves a promise
already made.

## 3. Use case (`ChangeCasePriority`, `application/cases/priority.py`)

A `PUT` that sets a state, safe to repeat: the whole body runs in `retry_on_conflict` and every
rule is re-evaluated on the freshly loaded case, **in this order**:

1. the case exists (404 `not_found`; a malformed id too);
2. the caller is its **assignee with the Analista role**, or holds **Supervisión** (any case,
   queued included); an analyst who only reads it through history access, or anyone else, gets
   403 `case_not_assigned`;
3. it is not closed (409 `case_closed`);
4. it already has that priority → **no-op** (`changed: false`, no event, no save), whatever
   `expectedVersion` says (a double submit, or two people choosing the same level);
5. the case is still at `expectedVersion`, else 409 `version_conflict` with `currentVersion` and
   `current` (the `CaseSummary` as the caller reads it now): a priority is never overwritten
   blindly.

Then `Case.change_priority` (actor role: `analyst` for the assignee, else `supervisor`) and the
case save with its compare-and-set; the event lands in `event_log` in the same transaction.

**Concurrency.** A concurrent save of the same case (a customer message, a reply, a read, a
second priority change) makes this save raise `ConcurrentUpdateError`; the command re-runs on
fresh state, where rule 4 or 5 decides. Tests: two different levels racing on the same version →
one changes, the other gets `version_conflict` whose `current` shows the winner; four copies of
one change → one `changed: true`, three `changed: false`, one event.

Capability: `CaseCapabilities.canChangePriority` = the case is open and the caller is its
assignee analyst or a supervisor (`can_change_priority` in `read_model.py`, the same rule).

## 4. REST API

### 4.1 Endpoint (router `api/routers/cases.py`, tag `cases`)

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `PUT /api/v1/cases/{caseId}/priority` | analyst, supervisor | **`ChangePriorityRequest`** | 200 **`CasePriorityResult`** | 401 `unauthenticated` · 403 `forbidden` (`requiredRoles`), `case_not_assigned` · 404 `not_found` · 409 `case_closed` (`currentStatus`), `version_conflict` (`currentVersion`, `current`) · 422 `validation_error` (unknown level, missing or negative `expectedVersion`, unknown member) |

```ts
ChangePriorityRequest { priority: CasePriority; expectedVersion: int /* ≥ 0, the version the caller saw */ }
CasePriorityResult    { changed: boolean; case: CaseSummary }
```

No new problem code: `version_conflict` (slice 4) now also carries a case (`current` is a
`CaseSummary`; its description in `ProblemDetails` says so).

### 4.2 Members added to existing schemas

| Schema | Member | Notes |
|---|---|---|
| `CasePriority` (enum) | `none`, `critical` | now `none · low · medium · high · critical` |
| `CaseCapabilities` | `canChangePriority: boolean` | always present |

## 5. Realtime (existing projectors, no new envelope type)

| Event | Envelope · topic |
|---|---|
| `case.priority_changed` | `case.updated` (`CaseSummary` with the new `priority`) → `case:<id>` and `inbox:<assignee>` (one envelope for both; + `inbox.counts`) |
| `case.priority_changed` | `team.updated` `{staffIds: [assignee]}` → `supervision:team` (her open cases show it) |
| `case.priority_changed` of a queued case | `queue.updated` → `supervision:queues` (like any event of a queued case) |

The customer never sees the priority: no `conversation.updated`.

## 6. Audit

- Catalog: `case.priority_changed` → family **lifecycle** ("Ciclo del caso", the Casos family),
  changes state.
- Description (the log shows the actor next to it, so it starts with the verb): "Cambió la
  prioridad a Alta" (Baja, Media, Alta, Crítica); to `none`: "Quitó la prioridad". The row
  reads "Daniela Ríos · Cambió la prioridad a Alta".
- Payload as stored: `{"from": "none", "to": "high"}`.

## 7. Frontend

### 7.1 Primitives (`components/ui`)

- `PriorityIcon` (`level`, `size`, `className`): the glyphs of §1, decorative (`aria-hidden`,
  `data-priority`). `PRIORITY_LEVELS` / `PriorityLevel` in `priority-levels.ts`. The glyphs are
  also fact icons (`priority-none` … `priority-critical` in `FACT_ICONS`), so a model names them
  like any other fact.
- `ChoiceMenu` (`value`, `options`, `onChange`, `triggerLabel`, `menuLabel`, `align`,
  `disabled`): WAI-ARIA menu button with `menuitemradio` items (the current one
  `aria-checked`, with a check). Click / Enter / Space open it on the checked option, ArrowDown /
  ArrowUp on the first / last; inside, arrows move (wrapping), Home / End jump, a letter jumps to
  the next option starting with it, Enter / Space pick, Escape closes (and is kept from a panel
  around it); the focus returns to the trigger. Tab or a click outside closes it.

### 7.2 Cases model (`features/cases`, the one map)

- `CASE_PRIORITY` (value, `label` "Alta", `longLabel` "Prioridad alta", `icon`, urgency `rank`),
  `PRIORITY_OPTIONS`, `casePriority`, `priorityLabel`, `priorityMenuLabel` ("Prioridad: Alta.
  Cambiar la prioridad"), `isUrgentPriority`.
- `priorityFact(priority, { onlyUrgent })`: cards and Inicio show it only for high / critical,
  icon-only with the tooltip and accessible text "Prioridad alta" / "Prioridad crítica" (no
  more flag); supervision rows show every level.
- `PriorityMenu` (index): the menu with the five glyphs, used by the ficha and the supervisor
  view.
- **Urgency order** (`urgencyGroup` / `compareByUrgency` / `sortByUrgency`, Inicio "Lo primero",
  the Casos list, auto-selection): 0 first-response SLA overdue · 1 critical · 2 high · 3 SLA at
  risk or running · 4 the customer waits without an SLA · 5 Esperando al cliente · 6 closed.
  Critical and high count only while the analyst has to act (a case waiting for the customer
  stays in group 5). Within a group: the nearest due time while the SLA runs, else the oldest
  last interaction; ties by id.

### 7.3 Ficha and supervisor view (`features/conversation`, `features/supervision`)

- Ficha › "Este caso" › **"Prioridad"**: the value is the menu button (`CasePriorityControl`)
  when `capabilities.canChangePriority`, else the glyph and the word.
- `useChangePriority(caseId)`: optimistic (the new level shows at once in the ficha, the cards
  and Inicio), then the server's case; a `version_conflict` whose `current` still has the level
  the viewer saw (only a message or a read moved the version) is sent once more with the fresh
  version, and one where someone set the same level is a success. Any other failure puts the
  previous level back (or the case as the server has it now) and shows a toast (`role="alert"`)
  from `describePriorityFailure`: "Alguien más la cambió: ahora es Crítica.", "El caso ya está
  cerrado.", "Ya no puedes cambiar la prioridad de este caso.", "Revisa tu conexión e inténtalo
  de nuevo.".
- Supervisor case view: the same control in the header, before "Asignar" / "Reasignar"; the
  priority left the meta line ("Colombia · Barranquilla · chat web").
- Supervision rows (the analyst sheet's open cases, the queue rows): the priority glyph,
  icon-only with its tooltip, next to the status; the sheet row shows channel and language as
  facts instead of "Prioridad media · App · español".

### 7.4 Rating with less text (part B)

- Lists (Cerrados cards, "Casos anteriores" rows): only the colored face, tooltip and accessible
  text "Calificación: Excelente" (`ratingFact`).
- Ficha "Calificación" row and the closed footer: the face and one word ("Excelente"); the
  footer's pill is read "Calificación del cliente: Excelente" by screen readers; the comment
  stays in quotes. `ratedByCustomerLabel` / `ratedShortLabel` are gone.

## 8. Seed (invented; every case opens with `none`, then staff set it through the domain)

| Case | Priority | Set by |
|---|---|---|
| 101 Marcela (Por responder; an ATM withdrawal she did not make) | critical | Daniela |
| 102 Beatriz (Por responder) | high | Daniela |
| 112 Mauricio (Cola en español) | high | Lucía (supervision, while queued) |
| 106 Héctor (Cerrados), 114 Esteban (Julián) | low | Daniela, Julián |
| 104, 107, 110, 113 | medium | Daniela or Julián |
| 103, 105, 108, 109, 111 | none | — |

With the fixed 15-minute target, Mauricio's 112 (opened T−8 min) is due in 7 min instead of
overdue; the Spanish queue starts with one case at risk (Rosa's 111).

## 9. Tests

- Backend: `tests/unit/domain/test_case_priority.py` (levels, event payload, no-op, queued,
  closed), `tests/unit/application/test_change_priority.py` (assignee, supervision on any open
  case and on a queued one, Analista + Supervisora on someone else's case, other analysts,
  history access, closed, unknown, no-op whatever the version, stale version with `current`, the
  capability; both adapters; the two races), `tests/api/test_priority_api.py` (200 and no-op,
  409 with `current`, RBAC 401/403, 404, 409 `case_closed`, 422s, the audit row, the realtime
  fan-out validated against the REST schemas), `test_audit.py` (descriptions, family); shape and
  seed tests updated (capabilities, fixed SLA, the Spanish queue).
- Frontend: `PriorityIcon.test.tsx`, `ChoiceMenu.test.tsx` (keyboard: open, arrows, wrap,
  Home/End, letters, Enter/Space, Escape kept, Tab, outside click), cases model (map, facts,
  urgency with priorities), conversation model (rows, failures, conflict reader), supervision
  model (row facts), home model ("Lo primero" with critical/high), `CustomerFile.test.tsx` (menu
  by keyboard, optimistic, rollback + toast, retry on a version-only conflict, someone else's
  change, read-only), `CaseListPanel.test.tsx` (card glyphs), the supervisor route (header
  menu), and the rating-text updates.
- e2e: `chat.spec.ts` › "two windows talk live…": the analyst opens the ficha, sets "Alta" with
  the keyboard, the card shows the high glyph ("Prioridad alta") and keeps it after a reload; the
  slice 7 scenario checks the shorter footer pill.

## 10. Known gaps

- No migration: delete `backend/cc_platform.db` (the enum and the seed changed; an old database
  still holds `medium` on every live case and the old SLA due times).
- The priority does not route, assign or reorder queues; supervision queues stay oldest first.
- No bulk change and no priority filter in Casos.
- The customer never sees the priority (by design).
