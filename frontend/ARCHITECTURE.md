# Frontend architecture · support platform (CC)

The rules in `docs/platform/ENGINEERING_BRIEF.md` win over this file. This file
explains how the SPA is put together and the conventions every slice follows.

Code, identifiers and comments are in English. Everything a user sees is Spanish
(neutral LATAM), copied from the canvas (`warehouse/design/source/project/*.dc.html`).

## 1. Stack

Vite · React 19 · TypeScript (strict, `noUncheckedIndexedAccess`) · Tailwind v4
(tokens in `src/styles/index.css`) · React Router v8 data router · TanStack Query v5 ·
openapi-fetch + openapi-typescript · lucide-react · Vitest + Testing Library ·
oxlint + prettier. Fonts are self-hosted (`@fontsource/*`).

## 2. Folders

```
src/
  main.tsx              entry: providers + RouterProvider
  app/                  composition root of the SPA
    providers.tsx       QueryClient → Session → Realtime → Toasts (+ SessionLiveSync)
    router.tsx          route table (lazy route modules, guards)
    guards.tsx          RequireSession, RequireRole, GuestOnly, RootRedirect
    redirect.ts         "from" state carried to /login
    paths.ts            every path of the SPA (PATHS) and the link builders (pure, tested; §4)
    roles.ts            role definitions, rail destinations (pure, tested)
    rail-indicators.ts  useRailIndicators: live rail badges/dots fed by features; useRailPresence (slice 6)
    session.tsx         SessionProvider, useSession, useCurrentUser, useCurrentRole
    session-realtime.ts `me.updated` → the session cache (registerSessionRealtime)
    session-live.tsx    SessionLiveSync: `staff:<me>` topic, 4409 → reload /auth/me, roles toast
    realtime.ts         the app RealtimeClient (token + auth-error wiring)
    realtime-handlers.ts  composition point: every feature's realtime registration
    query-client.ts     TanStack Query defaults
    RouteErrorBoundary  per-route crash screen
  components/ui/        design-system primitives (import from '@/components/ui')
  components/layout/    AppShell, Rail, RoleSwitcher, AuthLayout, Page, SplitView,
                        ScreenPlaceholder, FullScreenStatus
  features/<name>/      one folder per product capability (see §3)
  routes/<area>/        thin route modules, one per screen (default export)
  routes/staff-shell.tsx  layout route of the staff area: AppShell + the notification bell (slice 10)
  lib/                  framework-free infrastructure
    api/                THE API boundary (client.ts), problem errors, OpenAPI types
    realtime/           WebSocket client, envelope → cache handlers, React hooks
    session-token.ts    token store (memory + sessionStorage)
    config.ts           VITE_API_URL, realtime URL
    format.ts, cn.ts    formatters (incl. joinEs "A, B y C"), class names
    hooks.ts            generic React hooks shared by features: useDebouncedValue, useNow
  styles/index.css      tokens (@theme) and base styles
  test/                 render helpers, fixtures (invented people), fake socket,
                        architecture.test.ts (import boundaries, path literals)
```

## 3. Feature slices

```
features/<name>/
  api.ts         typed calls through `api` + `unwrap`, query/mutation key factory
  model.ts       pure business rules and copy mapping (unit-tested, no React, no I/O)
  url.ts         the screen's query string: parse + serialize, English names (when it has one; §4)
  types.ts       UI-side types when the API schema is not enough (optional)
  hooks/         TanStack Query hooks and small UI-state hooks
  components/    presentational pieces + the screen component(s)
  realtime.ts    `registerXRealtime: RealtimeRegistration` (envelope → cache handlers, when needed)
  core.ts        screen-free public API: what the always-loaded shell may import (when needed)
  index.ts       public API: `export * from './core'` + the screens and screen hooks
```

Two public files: other modules import a feature only through `index.ts` or
`core.ts`. `core.ts` holds what can load with the entry chunk: the realtime
registration, the count hooks behind rail badges, query keys, shared labels and
readers, and types. It never reaches a component or a feature `index.ts`,
transitively (anything it loads imports other features through their `core.ts`).
`index.ts` re-exports it and adds the screens. The app shell (`src/app` except the
route table, and `main.tsx`) imports features only through `core.ts`: an import of
an `index.ts` there would put every screen of that feature in the entry chunk, since
the barrel statically depends on them (lazy routes would then be empty shells).
Today `cases`, `conversation`, `copilot`, `supervision`, `admin`, `home`, `notifications` and `onboarding` have one. The vocabulary the
shell itself shows (role names, "Ahora tienes: …") lives in `app/roles.ts`.

Rules:

- Import a feature only through its `index.ts` (`@/features/auth`) or its `core.ts`
  (`@/features/cases/core`). No deep imports across features. Inside a feature, use
  relative imports. The app shell uses `core.ts` only (above).
- Features never import `src/routes`. They may import `@/components/*`, `@/lib/*`
  and, for the session, platform (slice 18: the AI switch) and role helpers, `@/app/session` /
  `@/app/platform` / `@/app/roles`.
- Layers: `components/ui` imports nothing from `app`, `features`, `routes` or
  `components/layout`; `lib` imports nothing from `app`, `features`, `routes` or
  `components`; `components` never import features (the app composes them, e.g.
  `app/rail-indicators.ts`); `src/test` is for tests only. Tests may import (and
  `vi.mock`) a feature's `api.ts` directly.
- These rules are enforced: `src/test/architecture.test.ts` (runs in `pnpm test`,
  resolves alias, relative and dynamic imports; walks every `core.ts` runtime graph,
  `import type` excluded, and fails on a component or a feature `index.ts`) and oxlint
  `no-restricted-imports` (deep `@/features/*/*` other than `core`, and `@/routes`
  imports, in the editor). Check the result with `pnpm build`: copy of a screen (e.g.
  "Crear cuenta", "Reasignar") must only appear in a lazy chunk, never in `index-*.js`.
- Route modules (`src/routes`) are thin: read URL params / router state, call the
  feature's screen component, translate callbacks into navigation. No fetching and
  no business rules there.
- Business rules live in `model.ts` and are unit-tested. Components stay small and
  presentational; data fetching lives in hooks.
- Shareable state lives in the URL (selected case `?case=`, filters, open tab).
  Router `state` is only for one-shot hand-offs (MFA challenge, lockout time).
- No global store. If a real cross-cutting need appears, write an ADR first.

### The analyst Workspace and the case lifecycle (slice 2)

Contract: `docs/platform/api/slice-2-case-lifecycle.md` §9. Dependency direction:
`routes/analyst/workspace` → `features/workspace` → `features/conversation` →
`features/cases`. `features/customer-chat` imports no feature.

- **`cases`**: the "Casos" column. Five tiles that are the filters (Todos =
  open cases · Por responder · Nuevos · Esperando al cliente · Cerrados = the
  analyst's closes of the last 7 days, read-only), the cards (first-response
  "SLA x" only until the first reply, "Volvió a escribir", "Cerrado hace x" +
  reason), the collapsed rail (open cases only), the inbox realtime
  (`patchInbox` refetches when `inboxStatus`, `status`, `lastInteractionAt`,
  `assignedAnalystId` or `closedAt` change, or an unknown case fits the filter)
  and the `case.assigned` toast (slice 10: moved to the notification stream). Owns
  `CLOSE_REASONS` / `closeReasonLabel`.
- **`conversation`**: one chat layout that takes the whole width (bubbles ≤ 70%
  of a readable column). Header (meta, "Casos anteriores (n)", "Cerrar caso" or
  the "Cerrado" status), `ArrivalNote` ("Cómo llegó a ti": the people-based
  assignment only), the composer or `ReadOnlyFooter` (closed: "Caso cerrado el …
  · motivo" + note; someone else's case: "Solo lectura: …"), `CloseCaseDialog`
  (required reason, optional internal note ≤ 500, the customer notice
  `CLOSED_NOTICE` pinned to the backend text) and `CaseHistorySheet` (the
  customer's other cases and their read-only transcripts, through
  `GET /cases/{id}/history`; no composer, read cursor or `case:` subscription).
- **`workspace`**: two columns, list + conversation (no right panel), and the URL
  state `?case=&status=&q=&list=&previous=` (`previous=list` or a case id
  opens the sheet; picking another case closes it; `panel`/`apoyo` are ignored).
- **`customer-chat`** (simulator): the closed conversation keeps the input
  enabled ("Escribe para empezar una nueva conversación"); a post opens a new case.
  A newer `caseId` (POST response or `conversation.updated`) switches the chat
  and keeps the closed one as an expanded past block (`ended` in the cache); a
  late update of an older case is ignored. "Ver conversaciones anteriores (n)"
  loads `GET /customer/conversations` as collapsed blocks (oldest at the top);
  expanding one loads `GET /customer/conversations/{caseId}`.

### Inicio and the Casos adjustments (slice 6)

Contract: `docs/platform/api/slice-6-analyst-home.md`. Dependency direction:
`routes/analyst/home` → `features/home` → `features/cases` (index) and
`features/conversation/core` (types); `app/` composes the rail badge and presence.

- **`home`** (new): "Inicio" (`HomeScreen`): greeting by local time, date + team pill, the
  availability block ("Empezar a atender" / "Pausar casos nuevos", same mutation as Casos), the
  four status tiles (links to `/analyst/cases?status=…`), "Lo primero" (open cases by `sortByUrgency`,
  "Abrir" → `/analyst/cases?case=&status=`), "Mientras no estabas" (`GET /me/home`; fixed templates per
  `HomeActivityKind` in `model.ts`; read-only rows open `/analyst/cases?case=` through history access)
  and "Tu equipo ahora" (counts only). `registerHomeRealtime` refetches `homeKeys.all` on her inbox,
  availability and queue envelopes (2 s throttle, leading + trailing, per registry); 60 s
  refetch and after a reconnect.
- **`cases`** (changed): no status tiles (filter chip "Quitar filtro X" when the URL has one), one
  flat list in urgency order (`sortByUrgency` / `compareByUrgency` / `urgencyGroup`, the one
  order), the availability control as the pause indicator (orange full-width "En pausa" /
  white "Disponible" pill; `PausedNotice` removed), cards built from facts (`caseCardFacts`,
  `slaFact` = the one SLA level → icon/tone map), close reasons with `CLOSE_REASONS` (label,
  meaning, tone) + `CLOSE_REASON_ICON` / `CloseReasonIcon`, and the shell hooks
  `useToReplyCount` (rail badge; keeps `inbox:<me>` subscribed on every analyst screen) and
  `useAvailabilityPresence` (avatar dot), both in `core.ts`.
- **`conversation`** (changed): `ConversationPane customerFile={{ open, onToggle }}` slims the
  Workspace header to the name (button "Ver ficha de …") and the number; `CustomerFile` renders the
  sections of the ficha (`customerRows`, `caseRows`, `arrivalFacts`, `CaseHistoryBrowser`);
  `ArrivalNote` and `ReadOnlyFooter` show facts in the Workspace (`arrivalFacts`, `footerFacts`)
  and keep their lines in the supervisor view; `CloseCaseDialog` uses reason cards
  (`RadioGroup variant="cards"`). `CaseHistorySheet` (supervision) wraps the same
  `CaseHistoryBrowser`.
- **`workspace`** (changed): URL `?panel=customer` (and `?previous=` opens the panel), one
  `SidePanel` slot with the ficha's sections; auto-selection and "next after close" follow the
  urgency order.

### Customer rating (slice 7)

Contract: `docs/platform/api/slice-7-csat.md`. No new feature folder and no new dependency
direction.

- **`customer-chat`**: `RatingSurvey` (takes the composer's place while `surveyState` is `ask`:
  closed, unrated, not skipped), `RatedPill` in an always-mounted `<output>`,
  `useRateConversation` (one `Idempotency-Key` per survey; the answer goes into the chat cache;
  `already_rated` / `case_not_closed` refetch), `useSkippedRatings` ("Ahora no", sessionStorage
  `cc.customer.rating-skipped`). Copy in the customer's language (`ratingSurveyCopy`,
  `ratingOptions`, `ratedThanks`). Still imports no feature.
- **`cases`**: the staff vocabulary `RATING_SCALE` / `ratingOption` / `ratingFact` /
  `ratedByCustomerLabel` / `ratedShortLabel` (core) and `RatingBadge` (index); the Cerrados card
  shows the face as an icon-only fact. Face icons (`frown`, `meh`, `smile`, `laugh`) joined
  `FACT_ICONS`; tokens `app-rate-good`, `app-rate-great`, `app-rate-ink` for the simulator.
- **`conversation`**: `footerFacts(...).rating` + `ratingComment` (closed footer pill and quoted
  comment), `ratingRow` ("Calificación" in "Este caso", closed cases only), `historyItemFacts`
  adds "Calificó: …". `CaseSummary.rating` carries the comment, so `case.updated` updates the
  footer in place.
- **`supervision`**: `recentRatingCell` / `RecentRating` (the "Calificación 7 días" column and a
  sheet stat). **`audit`**: `redactionNote` (message text or rating comment).

### Case priority (slice 8, part 1)

Contract: `docs/platform/api/slice-8-priority.md`. No new feature folder and no new dependency
direction.

- **`components/ui`**: `PriorityIcon` (Linear-style glyphs: none = three dotted bars, low /
  medium / high = 1 / 2 / 3 of 3 bars, critical = an exclamation in a filled danger square;
  `PRIORITY_LEVELS` in `priority-levels.ts`; also the fact icons `priority-*`) and `ChoiceMenu`
  (menu button with `menuitemradio` items and the full keyboard model).
- **`cases`**: the one map `CASE_PRIORITY` (word, long word, glyph, urgency rank),
  `PRIORITY_OPTIONS`, `casePriority`, `priorityLabel`, `priorityMenuLabel`, `isUrgentPriority`,
  `priorityFact` (cards and Inicio: only high / critical, icon-only), `PriorityMenu` (index).
  The urgency order puts overdue first, then critical, then high, then the nearest SLA (cases
  waiting for the customer keep their place). The rating in lists is the face alone
  (`ratingFact`: tooltip and accessible text "Calificación: Bien").
- **`conversation`**: `changeCasePriority` (api), `useChangePriority` (optimistic over the detail
  and inbox caches; one silent retry when only the version moved; rollback or the server's case
  - an alert toast from `describePriorityFailure`), `CasePriorityControl` (index: the menu when
    `capabilities.canChangePriority`, else glyph + word) in the ficha's "Prioridad" row; the
    supervisor meta line lost the priority; the closed footer pill says one word.
- **`supervision`**: the supervisor case view puts `CasePriorityControl` in its header;
  `casePriorityFact` (every level, icon-only) next to the status in the analyst sheet and the
  queue rows; `caseRowFacts` replaces the dot-joined `caseRowLine`.

### Supervision v2 and escalations (slice 9)

Contract: `docs/platform/api/slice-9-supervision-v2.md`. No new feature folder; dependency
direction unchanged (`routes/supervision/*` → `features/supervision` → `features/conversation`
→ `features/cases`).

- **`components/ui`**: `FilterMenu` + `FilterChips` (and the pure `filter-selection.ts`:
  `toggleFilter`, `activeFilterChips`, `countSelected`) are the one way to filter a list: a
  "Filtros" button, a panel (`fieldset`) of checkbox groups with counts, "Limpiar filtros" /
  "Listo", removable chips. `StatusShape` gains `up` ("Escalado") and `forward` ("Reasignado").
  `RailIndicator.noun` names what a badge counts ("Colas, 3 sin asignar").
- **`cases`** (core): `ESCALATED_MARKER`, `ESCALATION_STATE`, `escalationWaitFact`,
  `isAttendedEscalation`, `MAX_ESCALATION_TEXT`, `readEscalation` (the one reader of
  `escalation.updated`); the Casos card shows "Escalado".
- **`conversation`**: "Escalar a supervisión", `EscalateCaseDialog`, `EscalationCard` (open,
  attended + "Entendido", supervision read-only), the escalation hooks; `escalation.updated`
  patches `detail.escalation`. The supervision arrival line and footer carry no " · ".
- **`supervision`**: `QueuesScreen` ("Colas", the landing; `useOpenCases`), `TeamScreen` (one
  table, `teamFilterGroups`, the sheet), `ReassignDialog` (`reassignPool`, `reassignList`),
  `EscalationsScreen` + `EscalationPanel` (`useEscalationOverview`, `useRespondEscalation`,
  `useTakeEscalatedCase`, `useLastTurns`), the case view (no "Asignar"; "Escalado" marker),
  `useSupervisionNotices` (queue and escalation toasts; slice 10: removed, the notification
  stream toasts them),
  `useOpenEscalationsCount` (rail badge, core). `registerSupervisionRealtime` also refetches
  "Colas" on queue and team signals and "Escalados" on `escalation.updated`. The slice 3 queue
  column, team pills and `AssignCaseDialog` are gone.
- **`audit`**: the "Escalamientos" family and its redaction notes; role badge "Supervisión".
- **`admin`**: the users list filters with `FilterMenu` (multi-value URL), "Nuevo usuario",
  language option cards (only the language's own name).

### Notification center (slice 10)

Contract: `docs/platform/api/slice-10-notifications.md`. New feature `notifications`, which imports
only `@/features/cases/core` (rating words, the inbox statuses) and `@/features/conversation/core`
(language names), plus `@/app/roles` (paths, `roleFromPath`).

- **Composition:** `routes/staff-shell.tsx` is the layout route of the staff area (the route table
  mounts it eagerly): `<AppShell notifications={<NotificationCenter />} />`. `AppShell` passes the
  slot to `Rail`, which draws it above the avatar for every role. Layout never imports features
  and the rest of the app shell only imports `core.ts`, so the composition lives in `src/routes`.
  The bell is on every staff screen, so its copy is in the entry chunk on purpose.
- **Data:** `useNotifications` is one `useInfiniteQuery` (`notificationKeys.list()`, pages of 30
  through `nextCursor`, refetch every 60 s and after a reconnect); `useUnreadNotificationsCount`
  (core) selects the first page's `unreadCount`. `useMarkNotificationRead` /
  `useMarkAllNotificationsRead` are optimistic (dot and count at once, then the server's answer;
  a failure refetches). `registerNotificationsRealtime` (core) applies `notification.created`
  (prepend once, newest first, server count) and `notifications.read` (ids or all, server count)
  on her `staff:<id>` topic (already subscribed by `SessionLiveSync`).
- **Copy:** `model.ts` owns every word: `NOTIFICATION_KIND` (tile icon, tone, primary action),
  `notificationCopy` (title, one line, href), `slaRiskDetail`, `notificationTime` ("ahora",
  "hace 6 min", "hace 2 h", "1 oct"), `bellLabel`, `notificationSections` ("Nuevas" /
  "Anteriores"), plus the cache helpers and the two envelope readers.
- **Panel:** `NotificationCenter` (bell button with `aria-expanded` / `aria-controls`, the orange
  `CountBadge`, name "Notificaciones, N sin leer") and its region (380 px, ≤ 560 px, scrolls
  inside; focus to the heading on open; Escape / close button → focus back to the bell; outside
  click or tabbing out closes). `NotificationItem`: `NotificationTile`, title, line, `<time>`,
  the unread dot ("Sin leer"), the primary action as a `Link` with
  `state = NOTIFICATION_NAVIGATION` (marks it read, closes the panel) and "Marcar como leída",
  both described by the title. The Workspace focuses the case heading after such a navigation.
- **Toasts:** `useNotificationToasts` (mounted with the bell) is the only source of the live
  toasts of facts: title + line, the primary action and "Más tarde"; only for the current role
  (`shouldToast`) and never when the screen already shows it (`isOnScreen`); dismissed (and read)
  when the screen comes to show it, dismissed when read elsewhere. The Casos list
  (`useInboxLive` keeps only the reconnect refetch) and supervision (`useSupervisionNotices` is
  gone) no longer toast on their own.
- **Primitive:** the toast is ink at 88 % with a 12 px backdrop blur and a hairline border; its
  live region is "Avisos" (the panel is "Notificaciones").

### Simulated channels: calls and email (slice 12)

Contract: `docs/platform/api/slice-12-channels.md`. No new feature folder and no new dependency
direction. Everything is simulated (no telephony, no mail server): people type what is said.

- **`cases`** (core): the one channel map `CASE_CHANNEL` (`chat_app`, `chat_web`,
  `phone_inbound`, `phone_outbound`, `email`: `kind`, `icon`, `label`), `caseChannel`,
  `channelLabel`, `channelFact` (icon-only: chat bubble `message`, `phone-incoming`,
  `phone-outgoing`, `mail`; the label is the tooltip). Cards, Inicio rows and the supervision
  tables (Colas, Equipo sheet, the case header) show the icon; the ficha's "Canal" row says the
  label. A case with `activeCallId` adds the green `phone` fact "Llamada en curso" to its card.
  `channelPhrase` and supervision's `channelTooltip` are gone.
- **`components/ui`**: fact icons `phone`, `phone-incoming`, `phone-outgoing`, `mic-off`.
- **`conversation`**: the rules live in `channels.ts` (pure, `channels.test.ts`):
  `centerMode` (a live call takes the center; otherwise the channel; a chat whose customer last
  wrote an email is answered by email), `CALL_STATUS` (Sonando = ring, En llamada = dot, En espera
  = pause, Llamada terminada = check), `callElapsedSeconds` (ringing from `startedAt`, answered
  from `answeredAt`, ended = `durationSeconds`), `callStateLabel`, `callControls`,
  `callDirectionFact`, `upsertCall` / `applyCallToDetail` (newer `version` only), `callForTime` /
  `lineOffset` (a line's "02:41" inside its call), `callEventKind` (the backend's fixed system
  lines), `threadSubject`, `replySubject` (never "Re: Re:"), `unansweredEmailIds` ("Nuevo"),
  `emailToTurn`, `closeNoticeChannel`, the failure copy. `TranscriptItem` gained the variants
  `line`, `call-event`, `note` and `email` (`TranscriptMessage` + `EmailCard`), so every view of a
  transcript (Workspace, supervision, history) renders every kind. Components: `CallBar` (state,
  live timer, direction, "Silenciado", Contestar / Poner en espera / Retomar / Silenciar /
  Colgar; read-only in supervision), `CallReasonCard` ("Por qué llamas", outbound calls),
  `CallComposer` ("Lo que dices", only `in_call`, + "Nota interna"), `EmailComposer` (Para hidden:
  the API exposes no address; "Re: …" or an Asunto field before the first email; "El saludo y la
  firma se agregan solos"; attach `aria-disabled` with tooltip "Pronto"), `StartCallDialog`
  ("Llamar al cliente", required reason, one `Idempotency-Key` per opening). The header hides
  "Cerrar caso" (and "Llamar al cliente") while a call is on; `describeCloseFailure` covers
  `call_in_progress`; the close dialog drops "El cliente verá" for a phone case and says "El
  cliente lo recibe por correo" for an email case. Hooks: `useCaseCalls` (only where a call
  matters), `useCallCommand`, `useStartCall`, `useCallLine`, `useAddNote`, `useEmailReply` (writes
  are not optimistic: the box keeps the text until the server answers; a retry re-sends the same
  `clientMessageId`; they share the case's send scope). `call.updated` patches the calls list and
  `detail.activeCall`; `case.updated` refetches the detail when `activeCallId` changes.
- **`customer-chat`**: `url.ts`: `?channel=` (`chat` | `call` | `email`); `channels.ts` (pure):
  `customerCallPhase` (dialing, incoming, live, hold, ended), titles and copy in es / pt,
  `customerCallLines` (the conversation's `transcript` turns inside the call window),
  `customerMailItems` ("Nuevo" = the bank's emails after the customer's last one),
  `mailComposeMode`, `chatTurns` (the chat view shows messages and notices only). Screens: after
  the customer, `ChannelPicker` ("Chat", "Llamar" dials at once, "Escribir un correo"),
  `CustomerCallView` (phone frame: "Llamando…", "Te atiende {nombre}", timer, a local
  "Silenciar", "Colgar", the lines, "Lo que dices"; "Volver a llamar" after the end),
  `CustomerMailView` (thread + "Escribe tu correo" / "Responder"), `IncomingCallBanner` ("LATAM
  Bank te está llamando", Contestar / Rechazar, over any channel) and `ConversationSurvey` (the
  rating after a close, in the call and email views too). The route `routes/customer/simulator.tsx`
  owns `?channel=` (through `url.ts`); the screen also works uncontrolled (tests). `call.updated` on `customer:<id>`
  updates the call cache (`isNewerCustomerCall`: an ended call is final).
- **No " · " joins** (UI rule): the supervisor header meta became facts (`caseHeaderFacts`), the
  simulator lines ("Te atiende Daniela, de LATAM Bank", past blocks with title + byline), admin
  `openCasesFact` ("5 (4 en español y 1 en portugués)") and the "Agregar persona" options
  ("Nombre (Equipo)"), the MFA eyebrow, the error boundary and the auth panel. Only the document
  title keeps its app suffix ("Página · LATAM Bank Soporte").

### AI foundation: the AI switch and the case type (slice 18)

Contract: `docs/platform/api/slice-18-ai-foundation.md`; the model: ADR 0006. Everything AI is
additive: with the switch off the app is the people-only one, unchanged.

- **`app/platform.ts`** (the one module of `src/app` besides session, roles and paths that
  features may import; architecture.test.ts allows it): `platformKeys`, `usePlatformSettings`,
  **`useAiEnabled()`** (false while unknown: nothing AI flashes), `primePlatformSettings` (the
  session's `/auth/me` query writes `platform` here, so it costs no request),
  `registerPlatformRealtime` (`platform.updated` → the cache). It reads the token store, not
  `useSession`, so the session module can import it without a cycle. `SessionLiveSync`
  subscribes `platform:settings` and refetches after a reconnect. **Every AI element of later
  slices renders nothing unless `useAiEnabled()`**. Tests: `renderRoute` / `renderWithProviders`
  take `aiEnabled` (default false).
- **`components/ui`**: `Switch` (`role="switch"`, `checked`, `onCheckedChange`; Linear-like ink
  track) and the fact icon `tag`.
- **`admin`**: "Plataforma" (`/admin/platform`, `PlatformScreen`): one card "Funciones de IA"
  (the switch named by its title and described by its line, the last change as facts or "Valor de
  la instalación", a neutral `Callout` when it is on without agent-core); `useAdminPlatform`
  (follows `platform:settings`; `platform.updated` refetches it), `useSetAiEnabled` (optimistic,
  primes the app's switch with the answer, toasts, rollback); copy in `model.ts`
  (`AI_SWITCH_DESCRIPTION`, `platformChangeFacts`, `aiToggledToast`, `describeAiToggleFailure`).
- **`cases`** (core): the one map `CASE_TYPE` (dataset subcategories + "Sin tipo" + the
  team-generated "Tarjeta virtual"), `CASE_TYPE_OPTIONS`, `caseType`, `caseTypeMenuLabel`;
  `CaseTypeMenu` (index: a `ChoiceMenu` with the tag).
- **`conversation`**: `changeCaseType` (api), `useChangeCaseType` (the priority's optimistic
  pattern), `describeCaseTypeFailure`, `caseRows(detail, now, { aiEnabled })` / `caseTypeRow`
  (the ficha's "Tipo de caso" after "Prioridad"), `CaseTypeControl` (index: the menu when
  `capabilities.canChangeType`, else tag + word, nothing with AI off).
- **`supervision`**: the supervisor case header shows `CaseTypeControl` before the priority.
- **`customer-chat`**: `useSimulatorAiEnabled` (`GET /customer/platform`, `platform.updated` on
  the simulator's own socket); exposed as `data-ai-enabled` on the session root until S19 gives it
  an element to show.

### The assistant in the app (slice 19)

Contract: `docs/platform/api/slice-19-assistant-screens.md` (screens of `slice-14-assistant.md`). No new
feature folder and no new dependency direction. The assistant's look: lucide's stroke `bot` and a pale blue
bubble (`assistant-bubble`, `accent-border`); its name "Asistente virtual". AI elements follow
`useAiEnabled()`; the assistant's conversation states follow the data (a `with_assistant` conversation only
exists while AI is on: turning it off hands them to people).

- **`components/ui`**: `StatusShape` `bot` ("Con el asistente"), the fact icon `bot`, the token
  `assistant-bubble`. **`components/layout`**: `TabbedSidePanel` (the Workspace's right panel as tabs: `aside`
  named by `label`, a tab list with the close button at its end, 400 px, Escape and the focus return of
  `SidePanel`; tabs are `{ value, label, content }`, S20 adds entries).
- **`customer-chat`**: `assistant.ts` (pure: `assistantView`, the copy in es / pt, `describeAssistantFailure`
  for every §8 code, `isAssistantName`, `confirmationExpiry`, `wrongCodeMessage`), `use-assistant.ts`
  (`useAnswerConfirmation`, `useVerifyStepUp`, `useRequestPerson`: the answer goes into the chat cache; a
  failure that means the conversation moved on refetches it), `AssistantControls.tsx` (`AssistantTyping`,
  `ConfirmationCard`, `StepUpCard`, `AskPersonButton`). `toChatItems` has the `assistant` side;
  `conversationStatusLine(conversation, language, turns)` says "Te atiende el asistente virtual" and, after
  it, "Te estamos pasando con una persona del equipo…"; the survey and past blocks name the assistant;
  `PICKER_STATUS.assistant`. Calls and emails show "Hablar con una persona" on `assistant_active`.
- **`conversation`**: `handoff.ts` (pure: `readHandoff` reads agent-core's snake_case packet defensively and
  words its codes; `describeHandoffFailure`, `HANDOFF_QUALITY_OPTIONS`, `hasHandoff`), `useCaseHandoff`
  (AI on, her own `assistant_handoff` case, once; shared by the card, the tab and the close dialog),
  `HandoffCard` (on top of the conversation: why, priority, queue, verified; "Ver todo"; a retry on
  502 / 503; nothing on 403 / 404) and `HandoffPanel` (the "Traspaso" tab), the transcript variant
  `assistant`, `arrivalFacts` for `assistant_handoff`, the supervision line and footer of a
  `with_assistant` case, `CloseCaseForm.handoffQuality` (sent only when answered, asked only when the
  handoff loaded). `ConversationPane onOpenHandoff` turns the card on.
- **`workspace`**: `WorkspaceUrlState.panel` (`customer` | `handoff`, `?panel=`; was `customerFile`,
  `openPanel`). With AI on the right panel is `TabbedSidePanel` "Apoyo del caso" ("Traspaso" for a handoff
  case, "Cliente" = the ficha); with AI off it is the slice 6 `SidePanel`, unchanged.
- **`cases`** (core): `WITH_ASSISTANT_STATUS`; `caseLifecycleStatus('with_assistant')`.
- **`supervision`**: `releaseFromAssistant` / `useReleaseFromAssistant` ("Tomar el caso", in Colas and the
  case view), the row's status, "No corre" and holder, `QueueNavFigures.withAssistant`, the "Con el
  asistente" filter option (AI on), the toasts. **`audit`**: "Asistente virtual" badge, no name next to it
  (`showsActorName`).

### The support panel: the copilot (slice 20)

Contract: `docs/platform/api/slice-20-support-panel.md` (screens of `slice-15-copilot.md` and
`slice-15b-copilot-suggestions.md`). New feature `copilot`; dependency direction `workspace` → `conversation` →
`copilot` (it imports no feature). Everything follows `useAiEnabled()` and her own case (`useCopilotAccess`), and
shows only what the API says is `available`.

- **The stage as one value**: `CopilotMode` (`answer | tools | drafts`, ADR 0005's `copilot_mode`) and
  `copilotSurfaces(mode)` → `{ copilot, tools, draft }`. The Workspace computes `copilotMode` once (S20:
  `FULL_COPILOT_MODE` with AI on, `null` off) and passes it to the panel and to `ConversationPane`; S21 swaps that one
  line for the case type's stage.
- **`copilot`**: `api.ts` (`copilotKeys.thread | asks | latest`), `model.ts` (pure: `copilotTurns`, `mergeExchange`,
  `describeAskFailure`, `suggestionView`, `toolQuestion` / `toolResult`, `escalationReason`, `describeSuggestFailure`,
  `composerTextWithDraft`), hooks (`useCopilotThread`, `useCopilotAsks` (questions in flight in a UI-only cache entry,
  never fetched), `useAskCopilot` (same `clientMessageId` on retry, one at a time), `useLatestSuggestion`
  (refetched on reconnect), `useRequestSuggestion` (one key per attempt, kept for a retry), `useDiscardDraft`
  (optimistic)), `realtime.ts` (`copilot.suggestion_updated` and a customer's `turn.created` → the newest suggestion),
  components `CopilotPanel` ("Copiloto"), `ToolsPanel` ("Herramientas"), `CopilotDraft` (above the composer),
  `EscalationSuggestion`.
- **`conversation`**: `ConversationPane copilotMode / supportPanel` (the draft over the chat composer, the
  recommendation under the header, "Apoyo" in the header), `useSendMessage().send(text, { copilotSuggestionId })`
  (kept on the pending message for a retry), `escalateCase(…, copilotSuggestionId)`, `EscalateCaseDialog suggestion`
  (motive prefilled, "El copiloto sugirió este motivo"), the `Composer` focus handle (`ComposerHandle`),
  `SUPPORT_PANEL_TRIGGER_ID`.
- **`workspace`**: `WorkspacePanel` adds `copilot` and `tools` (`parsePanel`); the tabs are Traspaso · Copiloto ·
  Herramientas · Cliente, each only when it applies; "Apoyo" opens at Copiloto; the focus returns to the trigger that
  opened the panel. **`components/layout`**: `SidePanelTab.layout` (`fill`: the tab handles its own scroll).

### Supervision and audit (slice 3)

Contract: `docs/platform/api/slice-3-supervision.md` §8. Dependency direction:
`routes/supervision/*` → `features/supervision` → `features/conversation` →
`features/cases`; `features/audit` imports only `@/features/conversation` (short
case ids) and `@/app/roles`. (Slice 10: the audit route mounts no notices any more.) Before, it
mounted `useQueueNotices()` itself, so
the audit feature never imports supervision.

- **`supervision`**: (Superseded by slice 9 above.) "Equipo y colas" (`TeamScreen`: the two language queues with
  their cases, the analysts table with the "Ahora" state, filters Conectadas / En
  pausa / Desconectadas, the team pills, the analyst sheet, the "Listo ·" strip),
  the supervisor's read-only case view (`SupervisorCaseScreen`: `ConversationPane
mode="supervision"` + "Asignar"/"Reasignar" + "Casos anteriores"), the assign
  dialog (rule 3: non-speakers listed but disabled "(regla 3)"; a paused or offline
  target needs "Asignar aunque esté en pausa"; "El cliente verá" with
  `REASSIGNED_NOTICE` pinned to the backend text), `useQueuedCasesCount` (rail
  badge, Supervisora role only), `useQueueNotices` (the "Un caso espera…" toast)
  and `registerSupervisionRealtime` (`queue.updated` patches counts when newer then
  refetches; `queue.case_queued` refetches; `team.updated` refetches at most once
  per 2 s, leading + trailing, throttle state per registry). Time-dependent figures
  (SLA risk, waits) are recomputed from the rows with a 15 s clock, minute
  resolution (`waitSince`). Both overviews also refetch every 60 s and after a
  reconnect.
- **`audit`**: "Auditoría" (`AuditScreen`): Quién pills, Tipo / Persona selects,
  Desde / Hasta (viewer's zone → UTC; Hasta inclusive; Hasta < Desde blocks the
  request), "Solo acciones que cambian algo", the case chip, the debounced id
  search, the log with day separators and "Cargar más" (`useInfiniteQuery` over
  `nextCursor`), and the detail aside (payload accordion, redaction note, "Ver la
  conversación" with `state.from`, "Filtrar por este caso"; a `?event=` outside the
  loaded pages is fetched by id). No realtime: "Actualizar" refetches.
- **Changes to slice 2 features**: `ConversationPane` takes `mode` (`workspace` |
  `supervision`: never a composer, read cursor or "Cerrar caso") and
  `headerActions`; `arrivalLine` covers `manual`; `supervisionArrivalLine` /
  `supervisionFooter`; `useMarkRead(summary, meId, enabled)` is silent on errors
  (a 403 after a reassignment is expected). `cases` handles `case.unassigned`
  (refetch + toast "Supervisión reasignó un caso") and says "Te asignaron un caso ·
  desde supervisión" when the envelope actor is a supervisor (`envelopeActor`).
- **Back navigation**: screens open the case view with router `state.from` (the
  full return URL); the case route keeps that state across its own `?previous=` /
  `?reassign=` changes and names the link "Volver a Auditoría" or "Volver a Equipo y
  colas".

### Onboarding (part 4: invitations and reset links)

Contract: `docs/platform/api/slice-11-invitations.md`. New feature `onboarding`, which imports no
other feature (only `@/app/roles` for role labels, `@/components/*`, `@/lib/*`).

- **Public routes** under `AuthLayout` but outside `GuestOnly` (a signed-in person opening a link
  still sees it): `/activate?token=` (`ActivationScreen`) and `/reset-password?token=`
  (`PasswordResetScreen`). The token lives in the URL and component state only; the API receives
  it in JSON bodies. A missing or unusable token (410 `link_invalid`, one answer for unknown,
  expired, used or cancelled) shows `LinkInvalid` ("El enlace venció o ya se usó").
- **Activation** (BoActivar): `StepIndicator` (`ol` "Pasos para activar tu cuenta",
  `aria-current="step"`); step 1 `PasswordFields` (Mostrar / Ocultar with `aria-pressed`, the live
  requirements list "Requisitos de la contraseña" with ": cumple / no cumple / pendiente" for
  screen readers, "Repite la contraseña"; "Continuar" is `aria-disabled` until every rule passes
  and a submit focuses the first broken field); step 2 the QR (`QrCode`: an `img` from
  `qrcode-generator`, pinned exact version, error correction M, black on white), the manual key in
  mono grouped by 4 with "Copiar", `CodeInput` and "Activar cuenta"; step 3 "Tu cuenta está
  lista" → "Entrar". The enrollment (QR, key) lives in the mutation result only.
- **Rules** (`model.ts`, tested): the password policy mirrors the backend's
  `password_policy.py` (≥ 12 characters, not her email name or its pieces or her name's words,
  not a common password; the thresholds and the block list are pinned by tests),
  `describeOnboardingFailure` (link_invalid → invalid screen, rate_limited → "Vuelve a intentarlo a
  las {hora}", password_rejected → the password field, totp_invalid / account_locked → the code,
  invalid_transition → back to step 1), `groupKey`, `activationSteps`, `inAppPath`.
- **Dev mailbox** (`/dev/mailbox`, `DevMailboxScreen`): only when `GET /meta` says `devMailbox`
  (else "No disponible"); a development tool (warn Callout) listing the newest emails with "Abrir
  enlace" (navigates inside the SPA). The login route shows a "Correos de desarrollo" link
  through `LoginScreen showDevMailbox`, fed by `useDevMailboxEnabled` from `onboarding/core.ts`
  (so the login chunk does not load the onboarding screens).

### Administration (slice 4)

Contract: `docs/platform/api/slice-4-administration.md` §10. `features/admin` imports
no other feature (only `@/app/roles`, `@/components/*`, `@/lib/*`); the admin audit
route composes `@/features/audit`, and `app/` composes the badge and the session sync.

- **`admin`**: "Usuarios y roles" (`UsersScreen`: role pills with counts, Cuenta /
  Equipo / Idioma selects, debounced search, the table with role chips and the account
  status recomputed with a 15 s clock from `lockedUntil`, and the 400 px aside
  `UserPanel`) and "Equipos" (`TeamsScreen`: status pills, table, `TeamPanel` with
  rename, members, "Agregar persona", deactivate / reactivate). One `UserForm` serves
  the aside and `CreateUserDialog`. Role names (`ROLE_LABEL`, pinned to the backend,
  `rolesLabel`, `rolesNowCopy`) live in `app/roles.ts`, shared with the session toast.
  Rules live in `model.ts` (the URL state in `url.ts`): labels, `accountStatusAt`, the draft diff (`userChanges`
  sends only what changed, with the `expectedVersion` the admin saw), client
  validation, guard rails (`userGuardState`: own Administración / deactivation /
  password; last active admin) and open-case blocks (`openCaseBlocks`, checked at
  submit with no request), and `describeAdminFailure` (one copy per problem code).
  `useFailureHandler` applies a failure to the cache: `version_conflict` writes
  `current` (validated by `readAdminUser` / `readAdminTeam`) and resets the draft.
- **Drafts and live data**: without a draft the form follows the cache; with one it
  keeps it and, when the cached `version` moves past the draft's base, says so ("Alguien
  más acaba de cambiar a esta persona…"). "Guardar cambios" is enabled while the draft
  differs; validation runs on submit and focuses the first invalid control.
- **No passwords in administration** (part 4, secure onboarding): "Nuevo usuario" sends an
  invitation ("Enviar invitación" → `InvitationSentDialog`: "Invitación enviada a {correo}. El
  enlace vence en 48 horas."); creates send one `Idempotency-Key` per open dialog and a replay
  shows the same dialog. An invited person reads "Invitación pendiente" (`ACCOUNT_STATUS.invited`,
  dashed accent ring), her aside shows the invitation facts (`invitationFacts`: "Invitación
  enviada", "Vence" / "Venció", "Último ingreso: Nunca") and "Reenviar invitación" /
  "Cancelar invitación" (`CancelInvitationDialog`; a cancelled person leaves the directory and
  the selection is cleared). An active person gets "Enviar enlace para restablecer"
  (`ResetPasswordDialog`: a link by email, 1 hour, her sessions end now). No password is ever
  displayed, copied or stored by the SPA.
- **Realtime** (`core.ts`: `registerAdminRealtime`, `useLockedAccountsCount`, keys,
  types): `registerAdminRealtime` (`directory.updated` → invalidate the user and
  team lists, the named people and teams, every team detail when people moved);
  `useAdminLive` subscribes `admin:directory` and refetches after a reconnect;
  `useLockedAccountsCount` (rail badge, Administración role only) shares the default
  list cache and refetches every 60 s (locks expire on their own).
- **Supervision migration**: teams are records; `TeamRef.id` / `TeamSummary.id`
  (`TEAM-…`) replace the slice 3 slugs, `?team=` holds the id (an old slug URL falls
  back to "Todos los equipos").
- **Audit**: `/admin/audit` renders the same `AuditScreen` with
  `canOpenCases={hasRole('supervisor')}` (no "Ver la conversación" for an admin without
  Supervisora) and without the queue notices; the "Tipo" select gains
  "Administración"; the "Persona" select lists inactive people "(desactivada)".

## 4. Routing

`src/app/router.tsx` holds the table. Paths and query parameters are English (brief, Language
rule); only the copy is Spanish. Every path is written once, in `src/app/paths.ts` (`PATHS` and
the link builders: `workspacePath`, `supervisionCasePath`, `adminUserPath`, …); the router, the
rail (`roles.ts`) and the features import it, and `src/test/architecture.test.ts` fails on a
path literal anywhere else. Each screen's query string is parsed and serialized in its
feature's `url.ts` (`features/workspace/url.ts`, `features/supervision/url.ts`,
`features/admin/url.ts`, `features/audit/url.ts`, `features/customer-chat/url.ts`,
`features/onboarding/url.ts`), pure and round-trip tested. Values are the API enums and ids
(`?status=to_reply`, `?role=analyst`, `?type=assignment`); multi-value filters are
comma-separated. Unknown values (old Spanish links included) fall back to the defaults:

| Path                                                                         | Screen                                             | Guard      |
| ---------------------------------------------------------------------------- | -------------------------------------------------- | ---------- |
| `/`                                                                          | redirect to the first role home (or `/login`)      | —          |
| `/login`, `/login/verify`, `/login/locked`                                   | login, MFA, lockout                                | GuestOnly  |
| `/activate?token=`, `/reset-password?token=`                                 | invitation and password-reset links (part 4)       | —          |
| `/dev/mailbox`                                                               | dev mailbox (only with the backend's dev mailbox)  | —          |
| `/analyst` → `/analyst/home`                                                 | Inicio (the analyst's landing, slice 6)            | analyst    |
| `/analyst/cases?case=&status=&q=&list=&panel=&previous=`                     | Workspace ("Casos"; `panel=customer\|handoff`)     | analyst    |
| `/supervision/queues?language=&status=&priority=&analyst=`                   | Colas (the landing of Supervisión, slice 9)        | supervisor |
| `/supervision/team?status=&language=&team=&analyst=&reassign=`               | Equipo (slice 9)                                   | supervisor |
| `/supervision/escalations?escalation=&reassign=`                             | Escalados (slice 9)                                | supervisor |
| `/supervision/cases/:caseId?previous=&reassign=`                             | supervisor read-only case view (`state.from`)      | supervisor |
| `/supervision/audit?actor=&person=&case=&type=&from=&to=&q=&changes=&event=` | Auditoría                                          | supervisor |
| `/admin/users?role=&status=&team=&language=&q=&person=&new=`                 | Usuarios y roles                                   | admin      |
| `/admin/teams?status=&team=&new=`                                            | Equipos                                            | admin      |
| `/admin/audit?…` (the supervision audit params)                              | Auditoría (same screen, `canOpenCases`)            | admin      |
| `/admin/platform`                                                            | Plataforma (slice 18: "Funciones de IA")           | admin      |
| `/customer?channel=`                                                         | customer simulator: chat, call or email (dev tool) | —          |

Any other path inside a role section shows that role's not-found page; any other
path at all (including the removed automation, approvals, tools, rules and
retention URLs) shows the global one.

Guards (`app/guards.tsx`):

- `RequireSession`: spinner while the session restores; anonymous → `/login` with
  `state.from`; a user with no role sees "Tu cuenta no tiene un rol asignado".
- `RequireRole`: a role section the user does not hold → their first role home.
- `GuestOnly`: once signed in (e.g. right after MFA) → `state.from` if the user may
  open it, else the first role home (`resolvePostLoginPath`). This is the only
  post-login redirect.

The rail role comes from the URL (`roleFromPath`); the role order
(analyst → supervisor → admin; they combine) decides the "first role home".

Adding a screen: add its path to `PATHS` (`src/app/paths.ts`), create
`src/routes/<area>/<screen>.tsx` (default export) and register it with `lazyRoute()` in the
right role section; its query string goes in the feature's `url.ts`. Until it is built, render
`<ScreenPlaceholder title subtitle description />`.

## 5. Data layer

- **No client-side mock data.** Every screen reads the API through its feature
  `api.ts`, even while its data is sample data: the backend seeds it (labelled
  "Datos de ejemplo") and serves it through real endpoints. There is no fixture
  layer, no second error type and no fake clock in the SPA: `ApiProblem` is the only
  error and "now" is the real clock (or a time the server sends). Fixtures exist
  only in tests (`src/test/fixtures.ts`, mocked at the `api.ts` boundary).
- **One boundary**: `src/lib/api/client.ts` is the only module that imports
  `openapi-fetch` and the OpenAPI types. Features call `api.GET/POST(...)` wrapped in
  `unwrap()` from their `api.ts`.
- **Types**: `src/lib/api/schema.gen.ts` is generated from `backend/openapi.json`
  (never edit it by hand). After a backend contract change: in `backend/`,
  `uv run python -m cc_platform.scripts.export_openapi`; then here `pnpm gen:api`.
  `pnpm check:api` fails when the generated file is stale. Only `client.ts` imports
  it; features use `Schemas['X']` (e.g. `Schemas['StaffOut']`).
- **Errors**: every failure becomes an `ApiProblem` (`status`, stable `code`,
  `title`, `detail`, `extensions`): RFC 7807 bodies, unexpected bodies and network
  failures (`code: 'network_error'`, `status: 0`). Branch on `code`, never on text.
  Map codes to Spanish copy in the feature `model.ts`.
- **Auth**: the client attaches `Authorization: Bearer <token>` from
  `lib/session-token`. A 401 for the _current_ token clears it; the session becomes
  anonymous and the guards redirect to `/login`.
- **Server state**: TanStack Query only. Query keys come from a per-feature factory
  (`caseKeys.detail(id)`), mutations have `mutationKey`s. Retries: transient errors
  only (network, 5xx).
- **Loading / empty / error** states are designed, never left blank: wrap the
  query in `<QueryState query skeleton empty>{(data) => …}</QueryState>` (Skeleton
  while pending, danger Callout + "Reintentar" on error, `empty` for no rows).

## 6. Session

`SessionProvider` (`app/session.tsx`) combines the token store with
`GET /api/v1/auth/me` (`sessionKeys.me()`):

- `status` (`deriveSessionStatus`, pure): `anonymous` (no token, or a token /me
  rejected with a 4xx, which is then dropped) · `loading` · `authenticated` ·
  `error` (network or 5xx on /me: the token is kept and the guards show "No pudimos
  cargar tu sesión" with `retry()` and "Cerrar sesión", so an outage is not a
  sign-out). `user` is the API `Staff` plus `initials`, `roleIds` (canonical order)
  and a `summary` line.
- `signIn(token, staff)` primes the `me` cache and stores the token (MFA step).
- `signOut()` sends `POST /auth/logout` with the current token passed explicitly
  (best effort, it also closes the session's sockets), then clears the token; any
  token loss clears the whole query cache so the next person never sees the
  previous one's data. Covered by `app/session.test.tsx` with a fake `fetch`.
- The token lives in memory and in `sessionStorage` (survives reload, dies with the tab).
- **Live profile** (slice 4): `SessionLiveSync` subscribes `staff:<me.id>`;
  `me.updated` replaces the `me` cache (`app/session-realtime.ts`), so the rail, the role
  switcher, the summary line and the guards follow an admin's change without signing in
  again. A roles change also closes her sockets with 4409: the client reconnects at
  once and `SessionLiveSync` reloads `/auth/me`. When `roleIds` change it toasts
  "Cambiaron tus roles · Ahora tienes: …"; `RequireRole` sends her to her first role
  home if the section she is in is gone. Deactivation and password reset end the
  session (4401 → sign out).

## 7. Realtime

`src/lib/realtime` is framework-free except `react.tsx` / `hooks.ts`:

- `RealtimeClient`: one WebSocket to `/api/v1/ws?token=`; ref-counted topic
  subscriptions (`case:<id>`, `inbox:<staffId>`, `supervision:queues|team`, `admin:directory`, `staff:<id>`) replayed after every
  reconnect; exponential backoff with jitter (`computeBackoff`), reset on open;
  close code 4401 (token rejected, logout, expiry; also 4403/1008) stops and ends the
  session, 1013 and network drops reconnect. 4409 (`access_changed`, slice 4: her
  roles changed) is not an auth error: it reconnects at once (no backoff, a
  `reconnecting` → `open` edge so screens refetch) and notifies
  `client.onAccessChanged` listeners. `disconnect()` closes a socket that is
  still connecting once it opens (never mid-handshake), so StrictMode's dev remount of
  a provider that already holds a token logs nothing. The customer simulator runs a
  second client with the customer token (`customer:<customerId>` topic, own registry).
  Domain envelopes are deduplicated by `(type, id)` before any listener runs
  (`RecentKeys`, a bounded window kept across reconnects); control envelopes pass through.
- Protocol: client frames `{ action: 'subscribe' | 'unsubscribe', topic }` and
  `{ action: 'ping' }`; server envelopes `{ type, id, occurredAt, data }` validated by
  `parseEnvelope`. Control envelopes (`welcome`, `subscribed`, `unsubscribed`, `pong`,
  `error`) share the shape (`isControlEnvelope`). Domain envelopes carry
  `data = { entity, entityId, caseId, actor, payload }`; read them only through
  `envelopePayload` / `envelopeCaseId` (`@/lib/realtime`). Each payload type has one
  reader, owned by its feature and shared through its `core.ts` (e.g.
  `readCaseSummary` and `isNewerCase` from `@/features/cases/core`), never copied.
- Handler registry (`createEnvelopeHandlerRegistry`): one handler per event type
  that updates the TanStack Query cache (`setQueryData` / `invalidateQueries`).
  Handlers must still be idempotent (a late payload can be older than the cache) and
  should refetch only when a patch cannot be applied in place (e.g. the inbox refetches
  only when a case may enter, leave or move in it). There is **no global
  registry and no registration at import time** (routes are lazy, so import side
  effects would depend on which screen loaded first). Instead:
  1. the feature writes `export const registerCasesRealtime: RealtimeRegistration =
(registry) => { registry.register('turn.created', …) }` in its `realtime.ts`
     and exports it from `core.ts` (keep that module light: keys + handlers);
  2. it is added to `FEATURE_REALTIME_REGISTRATIONS` in `app/realtime-handlers.ts`,
     the single composition point;
  3. `AppProviders` builds one registry per provider tree with
     `createAppEnvelopeHandlers()` before the socket connects (tests get a fresh one
     from `renderRoute` / `renderWithProviders`, or inject `envelopeHandlers`).
- `<RealtimeProvider>` (mounted in `app/providers.tsx`) connects only while the
  session is authenticated. Components use `useRealtimeSubscription(topic)` and
  `useRealtimeStatus()`. Refetching what envelopes missed while the socket was down
  goes through `useOnReconnect(callback, enabled)` (runs on `reconnecting` → `open`),
  never a hand-written status edge detection.
- Event types: `turn.created`, `case.updated`, `case.assigned`, `inbox.counts`,
  `availability.updated`, `conversation.updated` (slice 2 contract §7), plus slice
  3: `case.unassigned` (on `inbox:<previous assignee>`), `queue.updated`,
  `queue.case_queued` (topic `supervision:queues`) and `team.updated` (topic
  `supervision:team`, ids only). Supervision topics are for the supervisor role
  (`topics.supervisionQueues()`, `topics.supervisionTeam()`); read the envelope
  actor with `envelopeActor`. Slice 4: `directory.updated` (topic `admin:directory`,
  admins only, `{ staffIds, teamIds }`) and `me.updated` (topic `staff:<id>`, only
  that person, a fresh `StaffOut`): `topics.adminDirectory()`, `topics.staff(id)`. Slice 10:
  `notification.created` and `notifications.read` on `staff:<id>` (the bell). Slice 12:
  `call.updated` (`Call` on `case:` / `inbox:`, `CustomerCall` on `customer:`). Slice 18:
  `platform.updated` (topic `platform:settings`, every staff member and every simulator session:
  `{ aiEnabled }`): `topics.platformSettings()`. Slice 20: `copilot.suggestion_updated` (on `inbox:<staffId>`, the
  suggestion id and status only; the content is read over REST).

## 8. Tokens and styling

- Colors only from `@theme` tokens (`bg-surface`, `text-ink-2`, `border-border`,
  `bg-warn-soft`…). The default Tailwind palette is disabled on purpose. Need a new
  color? Add a token in `src/styles/index.css`.
- Type scale: `text-11 … text-40` (px names, incl. 28/32/34 for the lockout
  countdown); display font `font-display` (Bricolage), body `font-body`
  (Schibsted), ids `font-mono` (IBM Plex Mono). Display headings use
  `tracking-display` (-0.01em).
- Radii `rounded-8/10/12/14/16`; shadows `shadow-popover/toast/dialog/drawer`.
- Compose classes with `cn()` (tailwind-merge aware of the custom scales).
- Case-status tones (brief §5.4): accent (Nuevos), warn (Por responder),
  waiting (Esperando al cliente), closed (Cerrados). `waiting` (#8a867c) is for dots
  and borders only: its text and solid pills use `muted` to keep 4.5:1. `closed` has
  no color of its own: it is built on `offline` (stripe, dot) and `muted` (text).
  A status stripe outside a primitive uses `toneBorderLeft[tone]` from
  `@/components/ui` (the map `ListItemButton` and `FilterTile` use); never copy it.
- **States are glyph + word, not pills** (Linear-style `Status`). Each domain keeps ONE map of
  `StatusAppearance` (`shape`, `tone`, `label`, `strong`) in its pure model: case status
  `CASE_STATUS` / `caseStatus` / `caseLifecycleStatus` (`features/cases`, core: Sin asignar =
  dashed, Nuevo = ring, Por responder = ¾ pie, Esperando al cliente = ½ pie, Cerrado = check;
  the same `tone` drives the stripes and the Inicio tiles), availability `ACTIVITY_META`
  (`features/supervision`: Atendiendo = dot, Disponible = ring, En pausa = pause, Sin conexión =
  grey ring), account and team `ACCOUNT_STATUS` / `TEAM_STATUS` (`features/admin`: check, lock,
  x) and the simulator picker `PICKER_STATUS`. Pills stay for what is not a state: counts, roles,
  the team, ratings, filter chips. Glyph colors: `toneIcon`; a `strong` label: `toneStrongText`.
- Canvas values outside the Workspace have their own tokens instead of being
  normalized: `success-tint`/`success-ink` (Admin avatar, "Activo").
- Dark surfaces (rail, toasts, auth brand panel) carry `data-surface="dark"`: the
  focus ring there switches to `accent-muted` (7:1); a light popover inside one
  sets `data-surface="light"`.
- Dates and times are shown in the **viewer's** time zone (`lib/format.ts`): staff
  work from México, Colombia and Argentina, and the API sends UTC instants. Pass
  `{ timeZone }` only when a screen must show another zone on purpose, and say so
  in the copy ("10:47 (hora Bogotá)"). Tests pin the process zone to
  `America/Bogota` (`vite.config.ts`). `formatRelativeTime(value, now)` takes `now`
  explicitly (real clock or a server time).

## 9. Component catalog (`@/components/ui`)

| Component                                                      | Key props                                                                                                                               | Notes                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `LinkButton`                                        | `variant` primary·accent·secondary·ghost·danger, `size` sm·md·lg, `block`, `loading`, `icon`, `iconEnd`                                 | `LinkButton` is a router `Link` with the same look; `buttonClasses()` for anything else                                                                                                                                                                   |
| `IconButton`                                                   | `aria-label` (required), `icon`, `variant` secondary·ghost·primary·soft, `size` sm·md, `dot`                                            | title defaults to the label; `dot` appends ", con alertas" to the name                                                                                                                                                                                    |
| `Badge` / `CountBadge`                                         | `tone`, `variant` soft·solid, `size` sm·md, `icon` / `count`                                                                            | CountBadge is decorative: put the count in the parent's label                                                                                                                                                                                             |
| `Callout`                                                      | `tone` info·warn·success·danger·neutral, `title`, `kickerTitle`, `actions`, `icon`, `role`                                              | danger defaults to `role="alert"`                                                                                                                                                                                                                         |
| `Card` / `LinkCard` / `CardHeader`                             | `as` div·section·article·li, `padding` none·sm·md·lg, `tone`, `radius` 10·12·14 / `LinkCard` = router `Link` props / `title`, `aside`   | clickable card → `LinkCard` (or `cardClasses()` on a button)                                                                                                                                                                                              |
| `Accordion` / `AccordionItem`                                  | `value`/`defaultValue`/`onValueChange`, `collapsible` / `value`, `title`, `count`, `summary`                                            | one open at a time                                                                                                                                                                                                                                        |
| `Tabs`, `TabList`, `Tab`, `TabPanel`                           | `value`/`defaultValue`, `fitted` / `aria-label`, `trailing` / `value`, `count`, `dot` / `keepMounted`                                   | WAI-ARIA tabs, arrow keys; with no tab selected the first one keeps the Tab stop                                                                                                                                                                          |
| `SegmentedControl`                                             | `options`, `value`, `onValueChange`, `label`, `variant` segmented·pills, `fitted`                                                       | native radios in a fieldset                                                                                                                                                                                                                               |
| `FilterTile` / `FilterTileGroup`                               | `count`, `label`, `tone`, `selected`, `onSelect` / `aria-label`, `columns`, `name`                                                      | the status counters ARE the filters; native radios (one Tab stop, arrows select), white tiles for contrast; long labels wrap, never cut                                                                                                                   |
| `RadioGroup`                                                   | `label`, `options` (`value`, `label`, `description?`, `disabled?`), `value` (null = none), `onValueChange`, `required`, `error`, `name` | vertical list of native radios in `role="radiogroup"`; arrows move and select (roving focus); error describes the group; an option's `description` is a second line that describes its radio (the name stays the label)                                   |
| `ListItemButton`                                               | `selected`, `tone`, `markWidth` 3·4                                                                                                     | master/detail rows                                                                                                                                                                                                                                        |
| `Field`                                                        | `label`, `hint`, `error`, `required`, `labelAside`, `hideLabel`                                                                         | wires id / aria-describedby / aria-invalid into the control                                                                                                                                                                                               |
| `Input` / `SearchInput`                                        | `size` sm·md·lg, `leadingIcon`                                                                                                          |                                                                                                                                                                                                                                                           |
| `Textarea` / `ComposerFrame`                                   | `variant` bordered·bare                                                                                                                 | put a bare Textarea inside `ComposerFrame` (draws the frame and the focus ring)                                                                                                                                                                           |
| `Select`                                                       | `options`, `placeholder`, `size`                                                                                                        | native select                                                                                                                                                                                                                                             |
| `Checkbox`                                                     | `label`, `description`, `variant` plain·card                                                                                            | works inside `Field` (id, hint/error, aria-invalid)                                                                                                                                                                                                       |
| `Switch`                                                       | `checked`, `onCheckedChange`, `disabled`, `aria-label` / `aria-labelledby`, `aria-describedby` (slice 18)                               |
| `CodeInput`                                                    | `value`, `onChange`, `length`, `label`, `describedBy`, `invalid`, `disabled`, `initialFocus`, `ref` (`CodeInputHandle.focus(i?)`)       | one box per digit, paste/autofill, Backspace/arrows; every box is described by `describedBy`                                                                                                                                                              |
| `Dialog`                                                       | `open`, `onOpenChange`, `title`, `description`, `footer`, `footerNote`, `size` sm·md·lg                                                 | focus trap, Escape, restores focus (if the trigger still exists); stacks over a Sheet (top layer reacts, the rest is `inert`)                                                                                                                             |
| `Sheet`                                                        | `open`, `onOpenChange`, `title`, `description`, `header`, `footer`, `width` 480·600·720                                                 | right drawer, same modal behaviour as Dialog; `description` is the subtitle and the accessible description                                                                                                                                                |
| `ToastProvider` / `useToast` / `useToastClearance`             | `toast({ title, description, tag, meta, actions, duration, politeness })`; `dismiss(id)`; `ref={useToastClearance()}`                   | persistent live regions (`status` / `alert`) in the "Avisos" region; translucent ink (88 %, 12 px blur, hairline border); 6 s auto-dismiss paused on hover/focus; below open modals (z-40); rises above an element that reserves clearance (the composer) |
| `EmptyState`                                                   | `icon`, `title`, `description`, `action`, `as` h1·h2·h3, `size`, `headingRef`                                                           | placeholders, empty lists; `headingRef` makes the title a focus target                                                                                                                                                                                    |
| `PageHeader`                                                   | `title`, `subtitle`, `actions`, `eyebrow`, `documentTitle`                                                                              | h1 of every staff page; also sets the tab title (`title` if it is a string, else `documentTitle`)                                                                                                                                                         |
| `DocumentTitle`                                                | `title`                                                                                                                                 | tab title "Página · LATAM Bank Soporte" (React 19 hoists `<title>`); for screens without PageHeader / AuthHeading                                                                                                                                         |
| `Kicker`                                                       | `tone`, `size`, `as` (intrinsic tags)                                                                                                   | uppercase section labels                                                                                                                                                                                                                                  |
| `KeyValueList`                                                 | `items[{ key, label, value, mono, strong }]`, `labelWidth`                                                                              |                                                                                                                                                                                                                                                           |
| `Table`, `THead`, `TBody`, `TRow`, `TRowSelect`, `TH`, `TCell` | `stickyHeader`, `density` / `selected`, `onSelect` / `align`, `muted`, `numeric`, `truncate`                                            | native table; selectable rows put a `TRowSelect` button in the primary cell (keyboard + `aria-current`), a click on the row also selects                                                                                                                  |
| `Stat`                                                         | `label`, `value`, `hint`, `hintTone`, `valueTone`, `size`, `order`                                                                      |                                                                                                                                                                                                                                                           |
| `Status` / `StatusIcon`                                        | `shape`, `tone`, `label`, `strong`, `iconOnly`, `srLabel`, `size` sm·md, `title`, `focusable` / `shape`, `tone`, `size` 14·16           | a state as Linear shows it: stroked glyph (`StatusShape`: dashed, ring, pie-25/50/75, check, cross, dot, pause, lock) + plain word, never a pill; `iconOnly` keeps the word as tooltip and accessible text                                                |
| `Avatar`                                                       | `name`, `initials`, `tone` accent·peach·success·neutral, `size`, `decorative`                                                           | success uses `success-tint` (Admin)                                                                                                                                                                                                                       |
| `Spinner` / `Skeleton`                                         | `label`, `size` / `className`                                                                                                           |                                                                                                                                                                                                                                                           |
| `QueryState`                                                   | `query`, `skeleton`, `empty`, `isEmpty`, `errorTitle`, `errorDescription`, `children(data)`                                             | loading / error-with-retry / empty / content for any TanStack query                                                                                                                                                                                       |
| `SourceNote`                                                   | `variant` footer·inline                                                                                                                 | where the data comes from                                                                                                                                                                                                                                 |
| `Fact` / `FactList`                                            | `icon` (`FactIcon`), `text`, `tone`, `label`, `tag`, `iconOnly`, `tooltip`, `focusable` / `items`, `size`                               | slice 6: one short fact (icon + 1–3 words); icon-only facts keep the text for screen readers; never a dot-joined line                                                                                                                                     |
| `PriorityIcon`                                                 | `level` (`PriorityLevel`), `size`, `className`                                                                                          | slice 8: decorative priority glyph (`data-priority`); the level is said next to it or in the control's name                                                                                                                                               |
| `ChoiceMenu`                                                   | `value`, `options` (`value`, `label`, `icon`), `onChange`, `triggerLabel`, `menuLabel`, `align`, `disabled`                             | slice 8: menu button + `menuitemradio` (checked one marked); click/Enter/Space open on the checked option, arrows wrap, Home/End, letters, Escape kept from a panel, focus back to the trigger                                                            |
| `Tooltip`                                                      | `content`, `focusable`                                                                                                                  | visual bubble on hover and `:focus-visible` (`aria-hidden`; the trigger carries the text); not focusable inside buttons/links                                                                                                                             |

`RadioGroup` also has `variant="cards"` + `columns` (slice 6: options with `icon`, `tone`,
`wide`; the native radio is visually hidden, the card shows focus and the checked tone).
`EmptyState` accepts `as="h4"`.

Languages (`LanguageMark.tsx`, names and codes in `language.ts`): a language is shown as a
mark, lucide's `Globe` + code ("ES", "PT"), one globe per group ("ES PT" for someone who speaks
both), never the globe alone and never an emoji or a flag; a pt-BR customer shows PT. The globe
is stroked and `text-muted` like the other UI icons, 14 px with 12 px codes (`size="sm"`) or
16 px with 16 px codes (`size="lg"`: the "Colas" queue cards and title). Where a name is shown
it is only the language's own name ("Español", "Português"). Dense rows and headers use
`LanguageMarks` (`languages`, `focusable`, `name`, `size`: the group's name, "Español y
Português", is its tooltip and its screen-reader text); `LanguageMark` is the same mark,
decorative, for a control that names itself (the language filter chip); an "Idioma" value uses
`LanguageName` (globe + own name, no code); form and filter options show only the own name, no
icon (`FilterOption.language` sets its `lang`); a fact takes `FactItem.languages` (the mark
after its text, or in place of the icon when the text is empty) or `FactItem.language` (the
text is that language's own name: the globe stands in for the icon); `spokenFact` says a fact
for a control's accessible name. Marks carry `data-languages` ("es pt") and names
`data-language` for tests. Sentences keep the Spanish word ("Cola en portugués", "Nadie con ese
nombre habla portugués.").

Layout (`@/components/layout`): `SidePanel` / `SidePanelSection` (slice 6: the 360 px right
panel slot of the Workspace, sections, close button + Escape, focus in on open and back to the
trigger), `AppShell` (rail + outlet), `Rail` (role
destinations from `ROLES`, `aria-current`, live badges/dots from the `indicators`
prop: nav items name an `indicator` key and `app/rail-indicators.ts` maps feature
counts to it; no count means no badge, never a constant), `RoleSwitcher` (avatar menu:
CAMBIAR DE ROL with only the roles the user holds, sign out), `AuthLayout` (dark brand
panel + form column), `Page` / `PageBody` / `PageToolbar`, `SplitView`,
`ScreenPlaceholder`, `FullScreenStatus`. Slice 10: `AppShell` / `Rail` take a `notifications`
slot (the bell, above the avatar), composed by `routes/staff-shell.tsx`.

Extend primitives instead of forking them; add new ones here with a test.

## 10. Testing

- Vitest + Testing Library (jsdom). `pnpm test`. Browser e2e: `pnpm e2e` (below).
- `src/test/render.tsx`: `renderRoute(entry, { staff, token })` renders the real route
  table with fresh providers, a signed-in staff member (or none, or only a stored
  `token` restored through a stubbed `fetch`), a fake realtime socket and a fresh
  envelope handler registry;
  `renderWithProviders(ui, { route, path, staff })` for isolated components (`path`
  is the route pattern, so `useParams` works).
- Route modules are lazy, so the first render of a screen and every navigation to
  another route are asynchronous: wait with `findBy*` / `waitFor` (never a bare
  `expect(router.state.location.pathname)` right after a click). `src/test/setup.ts`
  sets the async-util timeout to 5 s (a cold lazy import under CPU load takes more
  than the 1 s default); `vite.config.ts` keeps the test timeout above it.
- Mock at the feature `api.ts` boundary (`vi.mock('@/features/x/api')`), never fetch.
  `lib/api/client.test.ts` covers the HTTP boundary with a fake `fetch`.
- Every `model.ts` has unit tests; every screen has a render test of its main
  states (canvas states such as `error`, `vacia`, `bloqueada`).
- Fixtures use invented people (`src/test/fixtures.ts`), never dataset records.
- Query by role and accessible name (that is also the a11y check).
- `src/test/architecture.test.ts` checks the import boundaries of §3.

### Browser e2e (Playwright, slice 5)

`pnpm e2e` runs `e2e/*.spec.ts` in Chromium against the real stack; `pnpm e2e:install`
downloads the browser once. Nothing to start by hand: `playwright.config.ts` picks two
free ports and starts, as `webServer` entries, the backend (`uv run uvicorn …` in
`../backend`, with `CC_DEV_MAILBOX=true` and `CC_PUBLIC_APP_URL` set to the web server) on a
**fresh temporary SQLite database** (`CC_DATABASE_URL` under the OS
temp dir, seeded, deleted by `e2e/support/global-teardown.ts`; `backend/cc_platform.db`
is never touched) and the Vite dev server with `VITE_API_URL` pointed at it
(`CC_CORS_ORIGINS` allows its origin). Traces and screenshots are kept on failure
(`test-results/`; the CI HTML report goes to `playwright-report/`; both git-ignored).
`pnpm e2e --ui`, `--headed` and `-g "<title>"` work as usual.

- **Scenarios** (brief §8 S5, S6): `home.spec.ts` (slice 6: lands on Inicio, "Empezar a
  atender", a queued case arrives, "Abrir" from "Lo primero" lands in Casos with it open),
  `chat.spec.ts` (two-window chat, live both ways, order
  after a reload; close with a reason → the customer notice, a new linked case,
  "Casos anteriores" in both windows), `supervision.spec.ts` (queue and drain under
  rule 3; a supervisor assigns a queued case and reassigns it while the analyst watches
  it leave her list, rule 3 in the dialog), `admin.spec.ts` (part 4: an admin invites an
  analyst, who opens the link from `/dev/mailbox`, sets her password, enrolls her
  authenticator (the test computes the TOTP code from the key on screen, `support/totp.ts`),
  signs in with password + code and gets a case; a role change reaches the role switcher live
  and back; deactivation signs the other window out),
  `auth.spec.ts` (5 wrong passwords → lockout; an admin unlocks), `channels.spec.ts` (slice 12:
  the customer calls, the analyst answers, lines both ways, hold / resume, a staff-only note,
  hang up, close without "El cliente verá", the survey in the call view; the customer emails, the
  analyst replies by email, the framed reply reaches the customer marked "Nuevo", the customer
  answers in the thread). The simulator page object picks a channel (`open(channel)`,
  `actors.customer(label, customer, channel)`, chat by default) and has call and email helpers;
  the Workspace page object has `callBar`, `callState`, `say`, `addNote`, `replyByEmail`. Slice 10: `supervision.spec.ts`
  › "the bell: …" (supervision's count goes up live, "Revisar" in the panel lands on Escalados
  with it open, the answer reaches the analyst's bell); the shell page object has `bell`,
  `unreadCount()`, `openNotifications()` and `notification(title, line)`, and `toast()` reads the
  "Avisos" region.
- **Support** (`e2e/support/`): page objects per screen (`pages/`: login + MFA,
  Workspace, customer simulator, Equipo y colas + assign dialog, supervisor case view,
  Usuarios y roles, the dev mailbox and the activation, the shell and role switcher), `api.ts`
  (REST helpers for setup and cleanup only: sign-in, create people (invite + activate through
  the public API with the token from the dev mailbox; each keeps her `totpSecret`), release a
  customer), `totp.ts` (RFC 6238, checked against the RFC vector), `data.ts` (the seeded
  accounts and simulator customers it relies on, invented names, unique texts) and
  `fixtures.ts`:
  - `actors`: one browser **context** per person (own `sessionStorage`, so own session):
    `open`, `signedIn` (UI password + MFA), `customer` (the simulator as a seeded
    customer). Any uncaught page error in any window fails the test.
  - `people`: analysts created through the admin API for this test only (unique names,
    rotating first names); paused again in teardown so they never take the next test's
    cases. `adopt` registers one created through the UI.
  - `customers.release`: hands the test a customer with no open conversation (one left
    open, by the seed or a previous attempt, is moved by supervision to a paused
    "janitor" analyst and closed), so every test also passes on a retry or with
    `--repeat-each` on the same database.
- **Rules:** one worker (the backend is shared and assignment depends on who is
  available); each test creates the people it needs and leaves nobody available; seeded
  staff are only used as the supervisor (Lucía) and the admin (Valeria) and are never
  changed. Locators are roles and accessible names (no CSS or test ids), assertions are
  web-first (`expect(locator)…`, no sleeps, no `waitForTimeout`), and every message
  text is unique (`uniqueText`) so an assertion never matches an older turn.
- A scenario that exposes a product bug gets the fix and a unit test in the app, never
  a weaker assertion (slice 5: `features/cases/realtime.ts` `writeInbox`).

## 11. Accessibility conventions

- Every page has one `h1` (PageHeader / AuthHeading); landmarks: `nav[aria-label=Principal]`,
  `main`, `aside[aria-label]`.
- Every screen has its own tab title (WCAG 2.4.2): PageHeader and AuthHeading set it
  from their title; other full screens render `<DocumentTitle>`.
- Icon-only controls need `aria-label`; live badge counts and dots go into the
  accessible name ("Cola, 4 pendientes", "Cola, con novedades").
- Current location: `aria-current="page"` in the rail, `aria-current="true"` in lists.
- Errors: inline field errors via `Field error`; form-level errors in a danger
  `Callout` (`role="alert"`). Inputs get `aria-invalid`.
- Focus after errors: a failed client validation focuses the first invalid control
  (its error is its description); a server rejection that clears a field (password,
  MFA code) puts the focus back in it.
- Motion: `prefers-reduced-motion` turns transitions off globally
  (`styles/index.css`); looping animations add `motion-reduce:` variants with a
  static fallback (spinner, skeleton, navigation progress).
- Visible focus everywhere (`:focus-visible` outline in accent; `accent-muted` or
  white on dark surfaces).
- Keyboard: Escape closes popovers/dialogs and returns focus; tabbing out of the
  role switcher closes it. Tabs use roving focus with arrow keys (the first tab is
  reachable even with nothing selected); filter tiles and segmented controls are
  native radios. Tables stay native tables: no `role="grid"` without a grid keyboard
  model.
- Live regions are mounted before their content (toasts, NavigationProgress), so
  insertions are announced. Transcripts are the opposite case: the `role="log"`
  mounts once the first page is in (history is not announced), with
  `aria-relevant="additions"`, `aria-busy` while an older page is merged, and one
  React key per message from "Enviando…" to sent (`clientMessageId ?? turn.id`).
  Controls around it (load older, chips, errors) stay outside the log.
- Focus after a programmatic switch: when the screen replaces the focused control
  (next case after "Cerrar caso", "Ver caso" in a toast) it moves the focus to the
  new heading (`tabIndex=-1`) or to the empty state's heading. The same inside a
  view that swaps its content: "Casos anteriores" focuses the past case heading,
  and back on the list the row it came from; the simulator's "Ver conversaciones
  anteriores" hands the focus to the first loaded block. Buttons that become
  unavailable while focused (composer "Enviar") use `aria-disabled`, not `disabled`.
- Language: the customer simulator's chat (inside the phone frame) speaks the
  customer's language (`es` | `pt`, `lang` on the frame); the staff UI and the
  simulator page around it are Spanish.
- Desktop-first (1440×900) and must not break at 1280 px.

## 12. Environment

`VITE_API_URL` (default `http://localhost:8000`, see `.env.example`). Scripts:
`dev`, `build`, `typecheck`, `lint`, `test`, `e2e`, `e2e:install`, `format`, `format:check`,
`gen:api`, `check:api`. The e2e runner sets its own `VITE_API_URL` (§10).
