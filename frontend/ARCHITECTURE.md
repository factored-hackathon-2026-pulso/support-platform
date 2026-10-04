# Frontend architecture · plataforma de soporte (CC)

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
    roles.ts            role definitions, rail destinations, path helpers (pure, tested)
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
  lib/                  framework-free infrastructure
    api/                THE API boundary (client.ts), problem errors, OpenAPI types
    realtime/           WebSocket client, envelope → cache handlers, React hooks
    session-token.ts    token store (memory + sessionStorage)
    config.ts           VITE_API_URL, realtime URL
    format.ts, cn.ts    formatters (incl. joinEs "A, B y C"), class names
    hooks.ts            generic React hooks shared by features: useDebouncedValue, useNow
  styles/index.css      tokens (@theme) and base styles
  test/                 render helpers, fixtures (invented people), fake socket,
                        architecture.test.ts (import boundaries)
```

## 3. Feature slices

```
features/<name>/
  api.ts         typed calls through `api` + `unwrap`, query/mutation key factory
  model.ts       pure business rules and copy mapping (unit-tested, no React, no I/O)
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
Today `cases`, `conversation`, `supervision`, `admin` and `home` have one. The vocabulary the
shell itself shows (role names, "Ahora tienes: …") lives in `app/roles.ts`.

Rules:

- Import a feature only through its `index.ts` (`@/features/auth`) or its `core.ts`
  (`@/features/cases/core`). No deep imports across features. Inside a feature, use
  relative imports. The app shell uses `core.ts` only (above).
- Features never import `src/routes`. They may import `@/components/*`, `@/lib/*`
  and, for the session and role helpers, `@/app/session` / `@/app/roles`.
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
- Shareable state lives in the URL (selected case `?caso=`, filters, open tab).
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
  and the `case.assigned` toast. Owns `CLOSE_REASONS` / `closeReasonLabel`.
- **`conversation`**: one chat layout that takes the whole width (bubbles ≤ 70%
  of a readable column). Header (meta, "Casos anteriores (n)", "Cerrar caso" or
  the "Cerrado" badge), `ArrivalNote` ("Cómo llegó a ti": the people-based
  assignment only), the composer or `ReadOnlyFooter` (closed: "Caso cerrado el …
  · motivo" + note; someone else's case: "Solo lectura: …"), `CloseCaseDialog`
  (required reason, optional internal note ≤ 500, the customer notice
  `CLOSED_NOTICE` pinned to the backend text) and `CaseHistorySheet` (the
  customer's other cases and their read-only transcripts, through
  `GET /cases/{id}/history`; no composer, read cursor or `case:` subscription).
- **`workspace`**: two columns, list + conversation (no right panel), and the URL
  state `?caso=&estado=&q=&lista=&historial=` (`historial=lista` or a case id
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
`features/conversation/core` (language names); `app/` composes the rail badge and presence.

- **`home`** (new): "Inicio" (`HomeScreen`): greeting by local time, date + team pill, the
  availability block ("Empezar a atender" / "Pausar casos nuevos", same mutation as Casos), the
  four status tiles (links to `/analista?estado=…`), "Lo primero" (open cases by `sortByUrgency`,
  "Abrir" → `/analista?caso=&estado=`), "Mientras no estabas" (`GET /me/home`; fixed templates per
  `HomeActivityKind` in `model.ts`; read-only rows open `/analista?caso=` through history access)
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
- **`workspace`** (changed): URL `?ficha=1` (and `?historial=` opens the panel), one
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

### Supervision and audit (slice 3)

Contract: `docs/platform/api/slice-3-supervision.md` §8. Dependency direction:
`routes/supervision/*` → `features/supervision` → `features/conversation` →
`features/cases`; `features/audit` imports only `@/features/conversation` (short
case ids) and `@/app/roles`. The audit route mounts `useQueueNotices()` itself, so
the audit feature never imports supervision.

- **`supervision`**: "Equipo y colas" (`TeamScreen`: the two language queues with
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
  conversación" with `state.from`, "Filtrar por este caso"; a `?evento=` outside the
  loaded pages is fetched by id). No realtime: "Actualizar" refetches.
- **Changes to slice 2 features**: `ConversationPane` takes `mode` (`workspace` |
  `supervision`: never a composer, read cursor or "Cerrar caso") and
  `headerActions`; `arrivalLine` covers `manual`; `supervisionArrivalLine` /
  `supervisionFooter`; `useMarkRead(summary, meId, enabled)` is silent on errors
  (a 403 after a reassignment is expected). `cases` handles `case.unassigned`
  (refetch + toast "Supervisión reasignó un caso") and says "Te asignaron un caso ·
  desde supervisión" when the envelope actor is a supervisor (`envelopeActor`).
- **Back navigation**: screens open the case view with router `state.from` (the
  full return URL); the case route keeps that state across its own `?historial=` /
  `?asignar=` changes and names the link "Volver a Auditoría" or "Volver a Equipo y
  colas".

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
  Rules live in `model.ts`: labels, `accountStatusAt`, URL state, the draft diff (`userChanges`
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
- **Temporary passwords** (create, reset) live only in `UsersScreen` component state
  and `TemporaryPasswordDialog`: never in the URL, the query cache or storage. Creates
  send one `Idempotency-Key` per open dialog; a replay (`temporaryPassword: null`)
  offers "Restablecer contraseña".
- **Realtime** (`core.ts`: `registerAdminRealtime`, `useLockedAccountsCount`, keys,
  types): `registerAdminRealtime` (`directory.updated` → invalidate the user and
  team lists, the named people and teams, every team detail when people moved);
  `useAdminLive` subscribes `admin:directory` and refetches after a reconnect;
  `useLockedAccountsCount` (rail badge, Administración role only) shares the default
  list cache and refetches every 60 s (locks expire on their own).
- **Supervision migration**: teams are records; `TeamRef.id` / `TeamSummary.id`
  (`TEAM-…`) replace the slice 3 slugs, `?equipo=` holds the id (an old slug URL falls
  back to "Todos los equipos").
- **Audit**: `/administracion/auditoria` renders the same `AuditScreen` with
  `canOpenCases={hasRole('supervisor')}` (no "Ver la conversación" for an admin without
  Supervisora) and without the queue notices; the "Tipo" select gains
  "Administración"; the "Persona" select lists inactive people "(desactivada)".

## 4. Routing

`src/app/router.tsx` holds the table. Paths are Spanish:

| Path                                                                                   | Screen                                             | Guard      |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------- |
| `/`                                                                                    | redirect to the first role home (or `/login`)      | —          |
| `/login`, `/login/verificacion`, `/login/bloqueada`                                    | login, MFA, lockout                                | GuestOnly  |
| `/analista/inicio`                                                                     | Inicio (the analyst's landing, slice 6)            | analyst    |
| `/analista?caso=&estado=&q=&lista=&ficha=&historial=`                                  | Workspace ("Casos")                                | analyst    |
| `/supervision/equipo?equipo=&estado=&analista=&asignar=`                               | Equipo y colas                                     | supervisor |
| `/supervision/casos/:caseId?historial=&asignar=`                                       | supervisor read-only case view (`state.from`)      | supervisor |
| `/supervision/auditoria?quien=&persona=&caso=&tipo=&desde=&hasta=&q=&cambios=&evento=` | Auditoría                                          | supervisor |
| `/administracion/usuarios?rol=&estado=&equipo=&idioma=&q=&persona=&nueva=`             | Usuarios y roles                                   | admin      |
| `/administracion/equipos?estado=&equipo=&nuevo=`                                       | Equipos                                            | admin      |
| `/administracion/auditoria?…` (the supervision audit params)                           | Auditoría (same screen, `canOpenCases`)            | admin      |
| `/cliente`                                                                             | customer chat simulator (dev tool, no staff shell) | —          |

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

Adding a screen: create `src/routes/<area>/<screen>.tsx` (default export), register
it with `lazyRoute()` in the right role section. Until it is built, render
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
  that person, a fresh `StaffOut`): `topics.adminDirectory()`, `topics.staff(id)`.

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

| Component                                                      | Key props                                                                                                                               | Notes                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `LinkButton`                                        | `variant` primary·accent·secondary·ghost·danger, `size` sm·md·lg, `block`, `loading`, `icon`, `iconEnd`                                 | `LinkButton` is a router `Link` with the same look; `buttonClasses()` for anything else                                                                                                                                 |
| `IconButton`                                                   | `aria-label` (required), `icon`, `variant` secondary·ghost·primary·soft, `size` sm·md, `dot`                                            | title defaults to the label; `dot` appends ", con alertas" to the name                                                                                                                                                  |
| `Badge` / `CountBadge`                                         | `tone`, `variant` soft·solid, `size` sm·md, `icon` / `count`                                                                            | CountBadge is decorative: put the count in the parent's label                                                                                                                                                           |
| `Callout`                                                      | `tone` info·warn·success·danger·neutral, `title`, `kickerTitle`, `actions`, `icon`, `role`                                              | danger defaults to `role="alert"`                                                                                                                                                                                       |
| `Card` / `LinkCard` / `CardHeader`                             | `as` div·section·article·li, `padding` none·sm·md·lg, `tone`, `radius` 10·12·14 / `LinkCard` = router `Link` props / `title`, `aside`   | clickable card → `LinkCard` (or `cardClasses()` on a button)                                                                                                                                                            |
| `Accordion` / `AccordionItem`                                  | `value`/`defaultValue`/`onValueChange`, `collapsible` / `value`, `title`, `count`, `summary`                                            | one open at a time                                                                                                                                                                                                      |
| `Tabs`, `TabList`, `Tab`, `TabPanel`                           | `value`/`defaultValue`, `fitted` / `aria-label`, `trailing` / `value`, `count`, `dot` / `keepMounted`                                   | WAI-ARIA tabs, arrow keys; with no tab selected the first one keeps the Tab stop                                                                                                                                        |
| `SegmentedControl`                                             | `options`, `value`, `onValueChange`, `label`, `variant` segmented·pills, `fitted`                                                       | native radios in a fieldset                                                                                                                                                                                             |
| `FilterTile` / `FilterTileGroup`                               | `count`, `label`, `tone`, `selected`, `onSelect` / `aria-label`, `columns`, `name`                                                      | the status counters ARE the filters; native radios (one Tab stop, arrows select), white tiles for contrast; long labels wrap, never cut                                                                                 |
| `RadioGroup`                                                   | `label`, `options` (`value`, `label`, `description?`, `disabled?`), `value` (null = none), `onValueChange`, `required`, `error`, `name` | vertical list of native radios in `role="radiogroup"`; arrows move and select (roving focus); error describes the group; an option's `description` is a second line that describes its radio (the name stays the label) |
| `ListItemButton`                                               | `selected`, `tone`, `markWidth` 3·4                                                                                                     | master/detail rows                                                                                                                                                                                                      |
| `Field`                                                        | `label`, `hint`, `error`, `required`, `labelAside`, `hideLabel`                                                                         | wires id / aria-describedby / aria-invalid into the control                                                                                                                                                             |
| `Input` / `SearchInput`                                        | `size` sm·md·lg, `leadingIcon`                                                                                                          |                                                                                                                                                                                                                         |
| `Textarea` / `ComposerFrame`                                   | `variant` bordered·bare                                                                                                                 | put a bare Textarea inside `ComposerFrame` (draws the frame and the focus ring)                                                                                                                                         |
| `Select`                                                       | `options`, `placeholder`, `size`                                                                                                        | native select                                                                                                                                                                                                           |
| `Checkbox`                                                     | `label`, `description`, `variant` plain·card                                                                                            | works inside `Field` (id, hint/error, aria-invalid)                                                                                                                                                                     |
| `CodeInput`                                                    | `value`, `onChange`, `length`, `label`, `describedBy`, `invalid`, `disabled`, `initialFocus`, `ref` (`CodeInputHandle.focus(i?)`)       | one box per digit, paste/autofill, Backspace/arrows; every box is described by `describedBy`                                                                                                                            |
| `Dialog`                                                       | `open`, `onOpenChange`, `title`, `description`, `footer`, `footerNote`, `size` sm·md·lg                                                 | focus trap, Escape, restores focus (if the trigger still exists); stacks over a Sheet (top layer reacts, the rest is `inert`)                                                                                           |
| `Sheet`                                                        | `open`, `onOpenChange`, `title`, `description`, `header`, `footer`, `width` 480·600·720                                                 | right drawer, same modal behaviour as Dialog; `description` is the subtitle and the accessible description                                                                                                              |
| `ToastProvider` / `useToast` / `useToastClearance`             | `toast({ title, description, tag, meta, actions, duration, politeness })`; `dismiss(id)`; `ref={useToastClearance()}`                   | persistent live regions (`status` / `alert`); 6 s auto-dismiss paused on hover/focus; below open modals (z-40); rises above an element that reserves clearance (the composer)                                           |
| `EmptyState`                                                   | `icon`, `title`, `description`, `action`, `as` h1·h2·h3, `size`, `headingRef`                                                           | placeholders, empty lists; `headingRef` makes the title a focus target                                                                                                                                                  |
| `PageHeader`                                                   | `title`, `subtitle`, `actions`, `eyebrow`, `documentTitle`                                                                              | h1 of every staff page; also sets the tab title (`title` if it is a string, else `documentTitle`)                                                                                                                       |
| `DocumentTitle`                                                | `title`                                                                                                                                 | tab title "Página · LATAM Bank Soporte" (React 19 hoists `<title>`); for screens without PageHeader / AuthHeading                                                                                                       |
| `Kicker`                                                       | `tone`, `size`, `as` (intrinsic tags)                                                                                                   | uppercase section labels                                                                                                                                                                                                |
| `KeyValueList`                                                 | `items[{ key, label, value, mono, strong }]`, `labelWidth`                                                                              |                                                                                                                                                                                                                         |
| `Table`, `THead`, `TBody`, `TRow`, `TRowSelect`, `TH`, `TCell` | `stickyHeader`, `density` / `selected`, `onSelect` / `align`, `muted`, `numeric`, `truncate`                                            | native table; selectable rows put a `TRowSelect` button in the primary cell (keyboard + `aria-current`), a click on the row also selects                                                                                |
| `Stat`                                                         | `label`, `value`, `hint`, `hintTone`, `valueTone`, `size`, `order`                                                                      |                                                                                                                                                                                                                         |
| `StatusDot`                                                    | `tone`, `size` 8·10, `label`, `srLabel`                                                                                                 |                                                                                                                                                                                                                         |
| `Avatar`                                                       | `name`, `initials`, `tone` accent·peach·success·neutral, `size`, `decorative`                                                           | success uses `success-tint` (Admin)                                                                                                                                                                                     |
| `Spinner` / `Skeleton`                                         | `label`, `size` / `className`                                                                                                           |                                                                                                                                                                                                                         |
| `QueryState`                                                   | `query`, `skeleton`, `empty`, `isEmpty`, `errorTitle`, `errorDescription`, `children(data)`                                             | loading / error-with-retry / empty / content for any TanStack query                                                                                                                                                     |
| `SourceNote`                                                   | `variant` footer·inline                                                                                                                 | where the data comes from                                                                                                                                                                                               |
| `Fact` / `FactList`                                            | `icon` (`FactIcon`), `text`, `tone`, `label`, `tag`, `iconOnly`, `tooltip`, `focusable` / `items`, `size`                               | slice 6: one short fact (icon + 1–3 words); icon-only facts keep the text for screen readers; never a dot-joined line                                                                                                   |
| `Tooltip`                                                      | `content`, `focusable`                                                                                                                  | visual bubble on hover and `:focus-visible` (`aria-hidden`; the trigger carries the text); not focusable inside buttons/links                                                                                           |

`RadioGroup` also has `variant="cards"` + `columns` (slice 6: options with `icon`, `tone`,
`wide`; the native radio is visually hidden, the card shows focus and the checked tone).
`EmptyState` accepts `as="h4"`.

Layout (`@/components/layout`): `SidePanel` / `SidePanelSection` (slice 6: the 360 px right
panel slot of the Workspace, sections, close button + Escape, focus in on open and back to the
trigger), `AppShell` (rail + outlet), `Rail` (role
destinations from `ROLES`, `aria-current`, live badges/dots from the `indicators`
prop: nav items name an `indicator` key and `app/rail-indicators.ts` maps feature
counts to it; no count means no badge, never a constant), `RoleSwitcher` (avatar menu:
CAMBIAR DE ROL with only the roles the user holds, sign out), `AuthLayout` (dark brand
panel + form column), `Page` / `PageBody` / `PageToolbar`, `SplitView`,
`ScreenPlaceholder`, `FullScreenStatus`.

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
`../backend`) on a **fresh temporary SQLite database** (`CC_DATABASE_URL` under the OS
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
  it leave her list, rule 3 in the dialog), `admin.spec.ts` (an admin creates an analyst
  who signs in with the temporary password and gets a case; a role change reaches the
  role switcher live and back; deactivation signs the other window out),
  `auth.spec.ts` (5 wrong passwords → lockout; an admin unlocks).
- **Support** (`e2e/support/`): page objects per screen (`pages/`: login + MFA,
  Workspace, customer simulator, Equipo y colas + assign dialog, supervisor case view,
  Usuarios y roles, the shell and role switcher), `api.ts` (REST helpers for setup and
  cleanup only: sign-in, create people, release a customer), `data.ts` (the seeded
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
