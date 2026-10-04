# Slice 6 contract · Inicio de la analista y ajustes de Casos

**Status:** implemented (2026-10-03). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-03.

**Scope.** A people-only home for the analyst role, "Inicio" (canvas `HomeTurno.dc.html`), plus the
user's decisions of the same day on "Casos": the status tiles move to Inicio, the list is one flat
list by urgency, the pause control is the indicator, the case header slims down to the name and
the number, a right panel "Ficha del cliente" holds the case and customer facts and "Casos
anteriores", the close reasons become cards, and metadata is shown as short facts (never a
dot-joined line or a sentence).

Not in this slice (and not built anywhere): AI of any kind (the activity feed is **not** a
summary: it is event-log facts rendered with fixed templates), tools, bank data, customer files
beyond what the platform already stores, presence. Supervision and administration screens keep
their copy, except where noted (§6).

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-2-case-lifecycle.md`,
`slice-3-supervision.md`, `../DATA_MODEL.md`.

---

## 1. Vocabulary

### 1.1 New enums (OpenAPI names)

| Enum | Values |
|---|---|
| `SinceSource` | `previous_session` · `fallback` |
| `HomeActivityKind` | `assigned_on_arrival` · `assigned_from_queue` · `assigned_by_supervisor` · `reassigned_away` · `customer_returned` · `customer_messages` |

### 1.2 Team-generated constants

| Constant | Value | Where |
|---|---|---|
| `FALLBACK_LOOKBACK` | 8 h (one shift) | `application/cases/analyst_home.py` |
| `MAX_ACTIVITY_ITEMS` | 10 rows (`total` counts all) | same |
| `FEED_PREVIEW_ROWS` | 4 rows before "Ver todo (n)" | `features/home/model.ts` |
| `FIRST_CASES_LIMIT` | 6 cases in "Lo primero" | same |
| SLA "at risk" | ≤ 5 min (unchanged, `SLA_AT_RISK`) | slice 3 |

No new problem code: the endpoint answers only the existing `unauthenticated` (401) and
`forbidden` (403) through the existing RBAC.

## 2. The read model (`GetAnalystHome`, CQRS-lite)

`application/cases/analyst_home.py`. One Unit of Work, no write, a fixed number of queries
whatever her history (no N+1):

1. `AnalystHomeReader.previous_session_end` (one `MAX(COALESCE(ended_at, expires_at))` over
   `staff_sessions` by `staff_id`, index `ix_staff_sessions_staff_id`);
2. `uow.staff.list()` (names, her team, her teammates) and `uow.teams.get`;
3. `AnalystHomeReader.touched_case_ids` (one `UNION` over `cases` by `(assigned_analyst_id,
   status|closed_at)` and `assignments` by `(staff_id, assigned_at)` /
   `(previous_staff_id, assigned_at)`: two new indexes, `ix_assignments_staff_assigned` and
   `ix_assignments_previous_staff_assigned`);
4. `AnalystHomeReader.case_events` (the `event_log` rows of those cases, types `case.assigned`,
   `case.opened`, `turn.created`, `event_time > since`, by `ix_event_log_case_sequence`; chunks of
   500 ids);
5. `uow.cases.get_many` (new on `CaseRepository`) and `uow.customers.get_many`;
6. `AnalystHomeReader.customer_cases` (only for customers who came back);
7. `uow.availability.list()` and the existing `queue_counts` (the queued cases by language).

The port `AnalystHomeReader` (`application/cases/ports.py`) has an SQL adapter
(`infrastructure/persistence/sqlalchemy/repositories/analyst_home.py`, portable Core SQL) and an
in-memory one (`InMemoryAnalystHomeReader`); both are exposed as `uow.analyst_home`. The unit
tests run every scenario on both adapters.

### 2.1 `since`

- The latest **ended** (`ended_at`: logout, revocation) or **expired** (`expires_at <= now`)
  session of hers **other than the current one** (`Actor.session_id`); never later than now.
- None (first sign-in, or only active sessions): `now − 8 h`, `sinceSource = fallback`.
- Exclusive: only facts with `event_time > since`.

### 2.2 Activity rules (`project_activity`, pure)

Over the event-log rows of the touched cases, in log order:

| Rule | Detail |
|---|---|
| Scope | Only cases she holds now, or that were assigned to her or taken away from her (`touched_case_ids`). Other analysts' cases never appear. |
| Own actions | An event whose `actor_id` is hers is skipped (her replies, closes, a self-assignment as Analista + Supervisora). |
| `case.assigned` to her | `language_least_loaded` → `assigned_on_arrival`; `queue_drained` → `assigned_from_queue` (+ `waitedSeconds`); `manual` → `assigned_by_supervisor` (+ `actorName`). |
| `case.assigned` away | `previous_analyst_id` = her and `assigned_analyst_id` ≠ her → `reassigned_away` (+ `actorName`, `targetName`). |
| `case.opened` with `previous_case_id` | `customer_returned` when the case is hers now or was assigned to her; it **replaces** that case's arrival row (`assigned_on_arrival` / `assigned_from_queue`); `previousCasesCount` = the customer's cases opened before it; `lastCloseReason` = how the case it continues was closed. |
| `turn.created` | Customer messages (`author_role = customer`, `kind = message`, audience `everyone`) in a case she holds **now**, written **after** her current assignment (`event_time > assigned_at`: the opening message of a new case is how it arrived, not a separate row) → one `customer_messages` row per case (`messageCount`, `occurredAt` = the last one). |
| Dedupe | One row per `(case, kind)`, the newest. |
| Order and cap | Newest `occurredAt` first (ties: kind order, then case id); at most 10 `items`; `total` counts every row. |
| `readOnly` | The case is not hers now (`assigned_analyst_id` ≠ her) for every row of that case. |

Every row also carries the case **now** (`caseStatus`, `inboxStatus`, `slaDueAt`,
`firstResponseAt`, `language`) so the UI shows the current status and SLA.

### 2.3 Team snapshot

- `availableCount` / `analystCount`: active staff with the Analista role in **her** team; available
  = availability `available` (no presence). Counts only, no names.
- `queues`: the language queues of the languages she speaks (es, then pt): `waiting` and
  `oldestQueuedAt`. No case rows.

## 3. REST API

### 3.1 Endpoint (router `api/routers/home.py`, tag `home`)

| Method | Path | Roles | Answers |
|---|---|---|---|
| GET | `/api/v1/me/home` | analyst (`require_roles(ANALYST)`) | 200 `AnalystHome` · 401 `unauthenticated` (no token, or a customer token) · 403 `forbidden` (`requiredRoles: ["analyst"]`) |

### 3.2 Schemas (camelCase, members always present)

```text
AnalystHome {
  since: datetime                 # exclusive start of "Mientras no estabas"
  sinceSource: SinceSource
  activity: { items: HomeActivityItem[] (≤ 10, newest first), total: int }
  teamNow: { teamId, teamName, availableCount, analystCount,
             queues: { language, waiting, oldestQueuedAt | null }[] }
  serverTime: datetime
}
HomeActivityItem {
  kind: HomeActivityKind, caseId, customerName, occurredAt, language, readOnly,
  caseStatus, inboxStatus | null, slaDueAt, firstResponseAt | null,
  actorName | null, targetName | null, reason: AssignmentReason | null,
  waitedSeconds | null, previousCasesCount | null, lastCloseReason: CloseReason | null,
  messageCount | null
}
```

No pre-rendered Spanish: the frontend owns every word (§4.5).

## 4. Frontend

### 4.1 Routes, rail and landing

- `/analista/inicio` (`routes/analyst/home.tsx` → `features/home`), inside the analyst section
  (plus the section's not-found page for other `/analista/*` paths).
- `ROLES.analyst.home = '/analista/inicio'`: after the MFA step and at `/` an analyst lands on
  Inicio (the role switcher too). A remembered `state.from` (e.g. `/analista?caso=…`) still wins.
- Rail: **Inicio** (house) first, then **Casos** (`end: true`, so only `/analista` marks it), with
  the indicator `toReplyCases` ("Casos, 2 pendientes"). The analyst's avatar shows a presence dot
  (orange "Estado: En pausa", green "Estado: Disponible") on every analyst screen.
- `app/rail-indicators.ts`: `useToReplyCount` (cases core) also keeps her `inbox:<id>` topic
  subscribed on every analyst screen; `useRailPresence` reads the availability cache.

### 4.2 "Lo primero" and the urgency order

`sortByUrgency` / `compareByUrgency` / `urgencyGroup` in `features/cases/model.ts` (the one order,
used by Inicio, the Casos list, auto-selection and "next case after closing"):

| Group | Cases | Within the group |
|---|---|---|
| 0 | First-response SLA overdue or at risk (≤ 5 min) | nearest `slaDueAt` |
| 1 | SLA still running | nearest `slaDueAt` |
| 2 | Nuevo / Por responder after the first reply (no SLA) | oldest `lastInteractionAt` |
| 3 | Esperando al cliente | oldest `lastInteractionAt` |
| 4 | Closed | — |

Ties by id. Each row: status stripe and pill, the channel, the high-priority flag and "Volvió a
escribir" as icons with a tooltip (no language: it shows only in the customer file), the last
message ("Tú: …" for hers), the SLA level (§4.6) or the time, and "Abrir" →
`/analista?caso=<id>&estado=<slug>` (Casos with the case open, its filter chip, its card marked).

### 4.3 Casos list (changed)

- No status tiles. The tiles live on Inicio and link to `/analista?estado=<slug>`; with a filter,
  the list shows a removable chip ("Quitar filtro Cerrados"); removing it returns to every open
  case. Cerrados is reachable only this way (or by URL).
- One flat list, urgency order (§4.2); Cerrados keeps the most recent close first.
- The availability control is the indicator: paused → full-width orange button "En pausa / No te
  llegan casos nuevos" (pause icon), name "En pausa. Volver a disponible"; available → white pill
  "Disponible", name "Disponible. Pausar casos nuevos". The old paused banner is gone.
- Cards: status pill, channel / high priority / "Volvió a escribir" icon-only (tooltip, text for
  screen readers), the SLA level fact, the time with a clock; Cerrados cards: "Cerrado" pill, the
  reason with its icon, when it closed.

### 4.4 Realtime

`registerHomeRealtime` (`features/home/realtime.ts`): `case.assigned`, `case.unassigned`,
`case.updated`, `inbox.counts`, `availability.updated`, `queue.updated`, `queue.case_queued` →
invalidate `homeKeys.all`, at most once per 2 s (leading + trailing, throttle per registry). The
analyst subscribes only to her own `inbox:<id>`; no supervision topic is exposed to analysts
(`queue.*` arrive only for someone who also holds Supervisora and has a supervision screen open).
The home also refetches every 60 s and after a reconnect. The tiles and "Lo primero" read the
inbox cache, which the cases handlers patch.

### 4.5 "Mientras no estabas": fixed templates (`features/home/model.ts`, unit-tested)

Each row: kind icon, **customer** (bold), the fixed phrase, the status pill when it matters, one
short fact each, the time; the link name is the full sentence for screen readers
("{cliente}: {frase}. {hechos}. {hora}. Abrir el caso | Abrir en solo lectura").

| Kind | Phrase | Facts |
|---|---|---|
| `assigned_on_arrival` | Te llegó | [languages] Español / Portugués, with the tag "Regla 3" for Portuguese |
| `assigned_from_queue` | Te llegó desde la cola | [hourglass] Esperó {n} min |
| `assigned_by_supervisor` | Te lo asignaron | status pill · [users] {supervisora} · SLA level |
| `reassigned_away` | Ya no es tuyo | [users] {supervisora} ("Lo reasignó") · [user] {analista} ("Ahora lo atiende") · [eye] Solo lectura |
| `customer_returned` | Volvió a escribir | [history] {n} casos antes · reason icon + {motivo} |
| `customer_messages` | Escribió {n} mensaje(s) | status pill · SLA level |

Subtitle: [log-out] "Cerraste sesión" + [clock] "hoy 11:20" / "ayer 18:05" / "28 sep, 18:05";
fallback: [clock] "Últimas 8 horas". Empty: "Nada nuevo desde tu última sesión". Four rows, then
"Ver todo (n)" expands in place (`aria-expanded`); "Se muestran las 10 más recientes de n." when
the server capped it.

**Read-only rows.** A `readOnly` row links to `/analista?caso=<id>` (no filter): the Workspace
already reads a case she held through history access (slice 3 §3.7) and shows the read-only
footer ([lock] Solo lectura · [user] Lo atiende …), no composer, no read cursor (403s are
silent), no `case:` subscription error surfaced.

### 4.6 SLA levels (`slaFact`, cases model: one map)

| Level | Icon | Tone | Visible value | Tooltip / accessible |
|---|---|---|---|---|
| overdue | flame, filled | danger | "Vencido" | "Primera respuesta vencida" |
| at risk (≤ 5 min) | flame | warn | "1 min" | "Vence en 1 min" |
| running | clock | muted | "12 min" / "5 h" / "2 días" | "Primera respuesta: vence en 12 min" |

The word "SLA" is in the accessible label ("SLA de primera respuesta") and the tooltip only.

### 4.7 UI rule: facts, not dot-joined lines

- `Fact` / `FactList` (`components/ui`): icon + 1–3 words; `iconOnly` facts (channel, high
  priority, "Volvió a escribir", a non-Spanish language) show the icon with a `Tooltip` and keep
  the text for screen readers; inside a button or link they are not focusable (the text is in the
  control's name). Status is always a colored pill; times have a clock; names, status, reasons,
  SLA values and the availability state stay visible text.
- The "·" separator is not used in the analyst UI touched here (Inicio, Casos list, slim header,
  ficha, footer, toasts, arrival row, transcript meta).

## 5. Casos conversation (changed)

### 5.1 Slim header and "Ficha del cliente"

- Workspace header: the customer's name (a button "Ver ficha de {nombre}", `aria-expanded`,
  `aria-controls`) and the case number with "Copiar"; "Cerrado" badge and "Cerrar caso" stay.
  The meta line and "Casos anteriores (n)" moved to the panel. The supervisor view keeps its full
  header and its "Casos anteriores" sheet.
- `SidePanel` / `SidePanelSection` (`components/layout`): a generic 360 px right panel of titled
  sections, not modal (the conversation keeps working), close button and Escape (inside the
  panel), focus to the panel heading on open (not when restored from the URL) and back to the
  name on close.
- URL: `?ficha=1` (kept across case switches); `?historial=lista|CASE-…` opens the panel on
  "Casos anteriores" (old deep links keep working).
- Sections (only data the platform has): **Cliente** ([user] Nombre, [map-pin] Ciudad
  "Barranquilla, Colombia", [languages] Idioma "Español"/"Portugués", [id] Id de cliente) ·
  **Este caso** ([hash] Número, [smartphone|globe] Canal, [flag] Prioridad, [calendar-clock]
  Abierto, Estado as a pill, Primera respuesta = SLA level, or "A tiempo"/"Tarde" + time) · **Cómo
  llegó a ti** (time on the heading row; icon rows from the assignment fields: [check] Estabas
  disponible, [languages] Hablas portugués + "Regla 3", [hourglass] Esperó 14 min, [inbox] Cola en
  portugués, [users] Asignado por Lucía Herrera, [user] Antes: Julián Ortega; someone else's case:
  "Quién lo atiende/atendió") · **Casos anteriores (n)** (`CaseHistoryBrowser`, shared with the
  supervisor's sheet: list, read-only transcript, focus rules unchanged).
- The arrival row under the header (Workspace) uses the same facts; the read-only footer shows
  the reason (icon + label), [clock] when, [user] who closed it, then the note.

### 5.2 Close reasons as cards

`RadioGroup variant="cards" columns={2}` (native radios, visually hidden; focus ring on the card
via `:has(:focus-visible)`; arrows move and select). One reason map in `CLOSE_REASONS`
(cases model: label, meaning, tone) + `CLOSE_REASON_ICON` (cases components):

| Reason | Icon | Tone | Meaning |
|---|---|---|---|
| Resuelto | check | success | Se atendió lo que pidió. |
| El cliente no respondió | message-square-more | closed (panel / muted) | Dejó de contestar y no se pudo seguir. |
| Duplicado | copy | accent | Ya hay otro caso por lo mismo. |
| Fuera de alcance | ban | warn | Lo que pide no lo atiende este equipo. |
| Otro (spans both columns) | ellipsis | neutral (canvas / muted) | Cuéntalo en la nota interna. |

The same icon and tone appear wherever a reason is shown: Cerrados cards, the closed-case footer,
"Casos anteriores" rows and past-case heading, Inicio's "Volvió a escribir".

## 6. Other changes of this slice

- Seed: the teams are "Equipo Andes", "Equipo Pacífico", "Equipo Caribe" (were "Disputas · …");
  "Administración de la plataforma" unchanged. Existing databases keep their old names (reset).
- `assignedToastCopy` from a supervisor: description = the customer, tag "Supervisión".
- Session summary (`SessionUser.summary`) and the admin user aside: structured items (team,
  languages "Español y portugués", role chips) instead of a dot-joined line.

## 7. Tests and done criteria

- Backend: `tests/unit/application/test_analyst_home.py` (since, scoping, own actions, reassigned
  away, aggregation, returned, cap, team snapshot; every scenario on the memory **and** SQL
  adapters) and `tests/api/test_home_api.py` (shape, since across sign-ins, SQL rows, RBAC: 403
  for Supervisora / Administración, 200 for Analista + Supervisora, 401 for a customer token).
- Frontend: `features/home/model.test.ts` (templates of every kind, rule 3 tag, urgency rows,
  since, team), `features/home/realtime.test.ts` (signals, throttle), `features/cases/model.test.ts`
  (urgency order, SLA levels, chip, reason map), `routes/analyst/home.test.tsx` (every state,
  links, rail, realtime), workspace / case list / ficha / close dialog render tests,
  `components/ui/Fact.test.tsx`.
- e2e: `e2e/home.spec.ts` (lands on Inicio, "Empezar a atender", a queued case arrives, "Abrir"
  from "Lo primero" lands in Casos with it open); `supervision.spec.ts` checks the
  "Ya no es tuyo" row opens read-only; the other flows use Inicio's tiles, the ficha and the
  reason cards.

## 8. Known gaps

- No presence: "Disponibles" counts availability, like supervision.
- `since` of the first session is a fixed 8-hour window; a very old previous session can make the
  window long (the feed is capped at 10 rows, the query is bounded by her touched cases).
- No toast on Inicio when a case arrives (the toast lives in the Casos list); Inicio refreshes.
- Queue counts on Inicio refresh every 60 s or with her own envelopes (no analyst queue topic).
- Supervisor and admin screens still use some dot-joined lines (out of this slice).
