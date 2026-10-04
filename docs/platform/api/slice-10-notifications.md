# Slice 10 contract · notification center ("Centro de notificaciones")

**Status:** implemented (2026-10-04). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-04.

**Scope.** Every staff member gets a bell in the dark rail (canvas `Workspace.dc.html` views
"notificaciones" / "notificacionesVacia", `SuColas.dc.html` and `Admin.dc.html` with
`notificaciones`, `HomeTurno.dc.html`). Notifications are **persisted per person**, derived from
facts the platform already records (domain events of the log, plus the first-response SLA
entering its risk window), and shown in a panel ("Nuevas" / "Anteriores"). The live toasts of
those facts now come from the same stream, on every screen of the role (Inicio included), with
"Más tarde". The slice also fixes the part-2 leftovers (§8).

People-only, as every slice: no AI, no summaries, no ranking. Each notification is a fixed
mapping of one fact; the frontend renders every word with fixed templates.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-6-analyst-home.md`, `slice-9-supervision-v2.md`,
`../DATA_MODEL.md`.

---

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Storage | Its own aggregate and table (`Notification`, `notifications`, id `NTF-…`, own `version`). | Read state is per person and must survive a reload and other devices; the bell counts unread ones. |
| Event log | Creating or reading a notification is **not** a domain event and never enters `event_log`. `source_key` points at the fact (the source event id). | The fact is already in the log; logging its projection (or a personal "read") would duplicate the audit trail. |
| Derivation | `NotificationProjector`, an event-bus subscriber like the realtime projectors; one fixed rule per event type (§3). | Same pattern as every projection: committed facts only, isolated failures. |
| Idempotency | `(recipient_id, source_key)` is unique; the writer skips recipients who already have the key. | A replayed event, a retried write or a second sweep never notifies twice. |
| Structured data | `kind` + ids (case, customer, actor, target, escalation) + language / score / failed attempts. Names resolve at read time. | No pre-rendered Spanish in the API (slice 6 rule); a renamed person shows with her current name. |
| Recipients | Analyst kinds: the analyst concerned. Supervision kinds: every **active** person with Supervisión. Administration kinds: every active person with Administración. Never the actor of the fact; never an inactive person. | Spec. Felipe (Analista + Supervisión) escalating does not notify himself. |
| SLA risk | `SweepSlaRisk`, a deterministic sweep (§4). | Time passing is not an event; the sweep turns "due in ≤ 5 min without a first response" into one fact per case. |
| Queue notice | One per language while its queue is not empty (§3.2). | A queue that keeps filling would flood the bell; the first waiting case is the news. |
| Retention | The newest **200** per person (`RETENTION_PER_PERSON`, team-generated); the writer prunes right after inserting. | Bounded table, enough history for a shift. |
| Toast role | A toast shows only on the screens of the notification's role (`Notification.role`); the bell shows all. | An Analista + Supervisión working cases is not interrupted by supervision news. |
| Invitations | `invitation_accepted` is defined now (kind, recipients, copy); part 4 records `staff.invitation_accepted` and the projector already maps it. | Spec. |

## 2. Domain (`domain/notifications/notification.py`)

```
Notification(id NTF-…, recipient_id STF-…, kind, created_at, source_key,
             case_id?, customer_id?, actor_id?, target_id?, escalation_id?,
             language?, score?, failed_attempts?, read_at?)   + version
```

- `kind` (`NotificationKind`): `assigned_on_arrival`, `assigned_from_queue`, `assigned_by_supervisor`,
  `reassigned_away`, `customer_returned`, `escalation_answered`, `escalation_taken`,
  `escalation_reassigned`, `case_rated` (role Analista); `case_escalated`, `case_queued`, `sla_at_risk`
  (Supervisión); `account_locked`, `invitation_accepted` (Administración). `KIND_ROLE` maps each kind
  to its role (`Notification.role`).
- Invariants: case kinds name a case; `account_locked` / `invitation_accepted` name their person
  (`target_id`); score 1–4; `source_key` 1–80 characters; never read before it happened.
- `created_at` is when the **fact** happened (the source event's time; for the SLA sweep, when the
  case entered the risk window), not when it was written.
- `mark_read(at) -> bool`: once; a second call is a no-op (`False`).

## 3. Projector (`application/notifications/projector.py`)

| Event | Kind | Recipients | Data |
|---|---|---|---|
| `case.assigned`, no previous analyst, `language_least_loaded` | `assigned_on_arrival`, or `customer_returned` when the case has `previous_case_id` | the new assignee | case, customer, language |
| `case.assigned`, no previous analyst, `queue_drained` | `assigned_from_queue`, or `customer_returned` | the new assignee | same |
| `case.assigned`, `manual` (from the queue or a reassignment) | `assigned_by_supervisor` | the new assignee | + actor (supervisor) |
| `case.assigned` with a previous analyst | `reassigned_away`, **unless** an escalation of hers ended with that move (`taken` / `reassigned`, same instant): the escalation kind says it | the previous analyst | + actor, target (new assignee) |
| `escalation.answered` | `escalation_answered` | who escalated | + actor, escalation |
| `escalation.taken` | `escalation_taken` | who escalated | + actor, target (the supervisor who took it), escalation |
| `escalation.reassigned` | `escalation_reassigned` | who escalated | + actor, target, escalation |
| `case.rated` | `case_rated` | who closed the case (`analyst_id`) | + score |
| `escalation.opened` | `case_escalated` | every active Supervisión | + actor (analyst), escalation |
| `case.queued` | `case_queued` (§3.2) | every active Supervisión | case, customer, language |
| `auth.account_locked` | `account_locked` | every active Administración but the locked person | target, failed attempts |
| `staff.invitation_accepted` (part 4) | `invitation_accepted` | every active Administración but the new person | actor = target = the person |

### 3.1 Common rules

- `source_key` = the event id (`EVT-…`); the actor of the event is never a recipient; inactive
  people are dropped.
- The writer (`NotificationWriter`) runs in one Unit of Work inside `retry_on_conflict`: skip known
  keys, insert, prune each recipient to 200, read her unread count, commit, then publish (§5.3).
- The seed commits through the domain, so its story notifies people too (Daniela's answered
  escalation and ratings, supervision's escalations and queues, the admins' lock of Mariana).
  `mark_seed_notifications_seen` marks the story's facts older than 30 min as read, so each person
  starts with a few "Nuevas" and some "Anteriores".

### 3.2 `case_queued`: one per language while it waits

On `case.queued`, the projector reads the queued cases: if the case is no longer queued (someone
took it already) or an older case of its language still waits (`queued_at`, then id), nothing is
written. So supervision hears about a language queue when it starts filling, not once per case;
once it empties, the next queued case notifies again.

## 4. SLA risk sweep (`application/notifications/sweep.py`)

- **What:** every open case (queued, assigned, in progress) with no first response and
  `sla_due_at − now ≤ 5 min` (`SLA_AT_RISK`, the same "at risk" as Colas; overdue included).
- **Who:** every active Supervisión. **Key:** `sla:<caseId>` (once per case: the first-response
  SLA never moves).
- **`createdAt`:** `sla_due_at − 5 min`, never before the case opened nor after now.
- **Trigger (deterministic):** once at startup (after the seed) and then every
  `CC_NOTIFICATION_SWEEP_SECONDS` (default 30 s; `0` turns it off, as the tests do, which call
  `sweep_sla_risk.execute()` with a fixed clock). The loop is a `PeriodicTask` (infrastructure),
  stopped on shutdown.

## 5. REST API and realtime

### 5.1 Endpoints (router `api/routers/notifications.py`, tag `notifications`)

| Method · path | Who | Answers |
|---|---|---|
| `GET /api/v1/me/notifications?cursor=&limit=` | any staff session | 200 `NotificationPage` · 401 · 422 `invalid_value` (bad cursor), `validation_error` (limit outside 1–100) |
| `POST /api/v1/me/notifications/{notificationId}/read` | any staff session, **her own only** | 200 `NotificationReadResult` (`changed: false` when already read) · 401 · 404 `not_found` (someone else's, unknown or malformed id) |
| `POST /api/v1/me/notifications/read-all` | any staff session | 200 `NotificationsReadAllResult` · 401 |

No new problem code. Default page size 30, at most 100; the cursor is opaque
(`<microseconds>.<NTF-id>`, keyset on `created_at` then id, newest first).

### 5.2 Schemas (camelCase, members always present)

```ts
Notification {
  id; kind: NotificationKind; role: StaffRole; createdAt; readAt | null;
  caseId | null; customerName | null; actorId | null; actorName | null;
  targetId | null; targetName | null; escalationId | null; language | null;
  score | null; failedAttempts | null; slaDueAt | null; firstResponseAt | null
}
NotificationPage { items: Notification[]; unreadCount: int; nextCursor | null; serverTime }
NotificationReadResult { notification: Notification; changed: boolean; unreadCount: int }
NotificationsReadAllResult { updated: int; unreadCount: int }
```

`slaDueAt` / `firstResponseAt` are the case **now** (the SLA line counts down from them).

### 5.3 Realtime (her own `staff:<id>` topic, only that person may subscribe)

| Envelope | When | `data.payload` |
|---|---|---|
| `notification.created` (`id` = the `NTF-…` id) | after the writer commits | `{ notification: Notification, unreadCount }` |
| `notifications.read` | after she reads one (`changed`) or all | `{ notificationIds: string[] \| null (all), unreadCount }` |

`data` keeps the domain-envelope shape (`entity: "notification"`, `entityId`, `caseId`,
`actor: {role: "system", id: null}`). Sockets only signal: the list refetches every 60 s and after
a reconnect.

## 6. Frontend (`features/notifications`)

- **Files:** `types.ts`, `api.ts` (`notificationKeys`, the three calls), `model.ts` (pure, tested:
  `NOTIFICATION_KIND`, `notificationCopy`, `slaRiskDetail`, `notificationTime`, `bellLabel`,
  `notificationSections`, `isOnScreen`, `shouldToast`, the cache helpers and the two envelope
  readers), `realtime.ts` (`registerNotificationsRealtime`), `hooks/` (`useNotifications`
  infinite query, `useUnreadNotificationsCount`, `useMarkNotificationRead`,
  `useMarkAllNotificationsRead`, `useNotificationToasts`), `components/` (`NotificationCenter`,
  `NotificationItem`, `NotificationTile`), `core.ts` (no components), `index.ts`.
- **Composition:** `routes/staff-shell.tsx` mounts `AppShell notifications={<NotificationCenter/>}`
  (layout never imports features; the app shell imports `core.ts` only). `Rail` has a
  `notifications` slot above the avatar.
- **Bell:** a button in the dark rail, for every role, above the avatar; orange badge with the
  unread count; accessible name "Notificaciones, N sin leer" (or "Notificaciones");
  `aria-expanded` + `aria-controls`.
- **Panel:** a labelled region anchored to the right of the bell (380 px, at most 560 px tall,
  scrolls inside); header "Notificaciones" + "Marcar todas como leídas" (while something is unread)
  + close; "Estás al día / No tienes notificaciones nuevas." when nothing is unread; sections
  "Nuevas" and "Anteriores"; "Cargar más" for older pages; loading and error (retry) states.
  Opening it moves the focus to its heading; Escape and the close button close it and give the
  focus back to the bell; a click outside or tabbing out closes it.
- **Item:** the kind's icon tile, a short title, one line (never " · "), the relative time
  ("ahora", "hace 6 min", "hace 2 h", then "1 oct"), the unread dot (sr "Sin leer"), the primary
  action (a link; navigates with `state.focus = 'notification'`, marks it read, closes the panel)
  and, while unread, "Marcar como leída". Actions are described by the title.
- **Copy (Spanish, gender-neutral):**

| Kind | Tile | Title | Line | Action → where |
|---|---|---|---|---|
| `assigned_on_arrival`, `assigned_from_queue` | inbox, blue | Te llegó un caso nuevo | {cliente} | Abrir caso → `/analista?caso=` |
| `assigned_by_supervisor` | inbox, blue | Supervisión te asignó un caso | {cliente} | Abrir caso |
| `reassigned_away` | move, orange | Supervisión reasignó tu caso | {cliente} pasó a {persona} | Ver caso (read-only) |
| `customer_returned` | back, blue | El cliente volvió a escribir | {cliente} | Abrir caso |
| `escalation_answered` | reply, green | Supervisión respondió tu escalamiento | {supervisión} sobre {cliente} | Revisar |
| `escalation_taken` | move, orange | Supervisión tomó tu caso | {cliente} pasó a {supervisión} | Ver caso |
| `escalation_reassigned` | move, orange | Supervisión reasignó tu caso escalado | {cliente} pasó a {persona} | Ver caso |
| `case_rated` | smile, green | El cliente calificó tu atención: {Excelente} | {cliente} | Ver caso → `?estado=cerrados` |
| `case_escalated` | up, blue | {analista} escaló un caso | {cliente} | Revisar → `/supervision/escalados?escalamiento=` |
| `case_queued` | clock, orange | Un caso espera en la cola en {español} | {cliente} | Ver en la cola → `/supervision/colas[?idioma=pt]` |
| `sla_at_risk` | flame, red | Caso por vencer sin respuesta | {cliente}, vence en {n} min / vencido / ya tiene respuesta | Ver en la cola |
| `account_locked` | lock, red | Cuenta bloqueada: {persona} | {n} intentos fallidos al entrar | Revisar → `/administracion/usuarios?persona=` |
| `invitation_accepted` | user-check, green | Invitación aceptada: {persona} | Ya puede entrar a la plataforma | Ver usuarios |

### 6.1 Toasts

- Restyled primitive: ink at 88 % with a 12 px backdrop blur and a hairline border (white 14 %);
  the secondary action is outlined white 32 %; the live region is named **"Avisos"** (the panel is
  "Notificaciones").
- `useNotificationToasts` (mounted once with the bell): every `notification.created` of the current
  role that the screen does not already show toasts its title and line, the primary action (opens
  it and marks it read) and **"Más tarde"** (dismisses the toast; it stays unread). 8 s on screen,
  paused on hover or focus. "Already shown": its case open in Casos for the kinds the case shows by
  itself (arrival, answer, rating; a case that leaves her still toasts), its case open in the
  supervisor view, "Escalados" for a new escalation, the person selected in Usuarios. A toast whose
  notification becomes visible on screen (the case opened another way) is dismissed and marked
  read; one read elsewhere (the bell, another tab) is dismissed.
- Removed ad-hoc toasts: the Casos list's `case.assigned` / `case.unassigned` / escalation toasts
  (`assignedToastCopy`, `unassignedToastCopy`, `escalationToastCopy`) and supervision's
  `useSupervisionNotices` (`queuedNoticeCopy`, `escalationNoticeCopy`). Confirmations of her own
  actions ("Escalaste el caso a supervisión", "Cambios guardados", "Cambiaron tus roles"…) stay
  plain toasts.

## 7. Persistence

`notifications` (see `../DATA_MODEL.md`): unique `(recipient_id, source_key)`, indexes
`(recipient_id, created_at, id)` (list, retention) and `(recipient_id, read_at)` (the bell).
`mark_all_read` is one conditional `UPDATE … WHERE recipient_id = :me AND read_at IS NULL`
(version bumped), so concurrent reads cannot lose an update; a single read is a compare-and-set.
No migration: delete `backend/cc_platform.db` (a new table: an old database fails with
`OutdatedSchemaError`).

## 8. Part-2 leftovers fixed here

- Inicio "Lo primero" shows the "Escalado" marker (`FirstCaseRow.escalated`).
- Audit detail: the kicker (time + family) and the byline (person + role) are separate elements,
  no " · " join.
- Closed-case footer (Workspace and supervision): reason, when, who closed it, note and rating as
  separate facts (`closedFooter`; `closureLine` removed).
- Admin "Equipos": the status is the `Status` glyph + word (`TEAM_STATUS`), and the status filter
  is the "Filtros" dropdown with chips (no pill row; `?estado=` accepts a list, `todos` = none).

## 9. Tests

- Backend: `tests/unit/domain/test_notification.py` (invariants, role map, read once);
  `tests/unit/application/test_notifications.py` (both adapters: the seed story, every kind of the
  projector, recipients only active and never the actor, the escalation suppression of
  `reassigned_away`, the queue dedup per language, the SLA sweep once per case and its
  `createdAt`, idempotency of a replayed event, retention, the list with keyset pagination, read
  and read-all of her own only); `tests/api/test_notifications_api.py` (401 for no / bad / customer
  tokens, every role, pagination and 422s, read and read-all, 404 for someone else's, the
  `notification.created` / `notifications.read` envelopes validated against the schema, nobody
  else may follow her `staff:` topic).
- Frontend: `features/notifications/model.test.ts` (every kind's copy, SLA line, time, bell,
  sections, toast rules, cache helpers, readers), `realtime.test.ts`,
  `components/NotificationCenter.test.tsx` (bell, panel states, read one / all, open + navigate,
  Escape / outside click, empty, error + retry + "Cargar más", live count + toast + "Más tarde",
  role scoping, read elsewhere), `Rail.test.tsx` (the slot, every role's shell), the Workspace,
  Colas and Equipo route tests (toasts from the stream).
- e2e: `supervision.spec.ts` › "the bell: supervision opens an escalation from it, the analyst gets
  the answer in hers" (the count goes up live on Colas, the panel row under "Nuevas", "Revisar" lands
  on Escalados with it open, the answer reaches her bell, "Marcar como leída"); the reassignment and
  escalation scenarios follow the new toasts.

## 10. Known gaps

- Single process: the projector, the writer and the sweep run in-process (like every projection).
  If the process dies between a commit and the projection, that notification is not written (the
  fact stays in the log; no catch-up job yet).
- The sweep's granularity is its interval (30 s): a case may enter the risk window up to 30 s
  before its notification (its `createdAt` still says when it entered).
- No per-person preferences (mute a kind), no email or push, no grouping of similar notifications.
- Names resolve at read time; a deleted person (never happens today) would show "Alguien del
  equipo".
- Seeded notifications use the seed's story times; the 30-minute "seen" cut is team-generated.
