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
    providers.tsx       QueryClient → Session → Realtime → Toasts
    router.tsx          route table (lazy route modules, guards)
    guards.tsx          RequireSession, RequireRole, GuestOnly, RootRedirect
    redirect.ts         "from" state carried to /login
    roles.ts            role definitions, rail destinations, path helpers (pure, tested)
    rail-indicators.ts  useRailIndicators: live rail badges/dots fed by features
    session.tsx         SessionProvider, useSession, useCurrentUser, useCurrentRole
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
    format.ts, cn.ts    formatters, class names
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
  index.ts       public API: the only file other modules may import
```

Rules:

- Import a feature only through its `index.ts` (`@/features/auth`). No deep imports
  across features. Inside a feature, use relative imports.
- Features never import `src/routes`. They may import `@/components/*`, `@/lib/*`
  and, for the session and role helpers, `@/app/session` / `@/app/roles`.
- Layers: `components/ui` imports nothing from `app`, `features`, `routes` or
  `components/layout`; `lib` imports nothing from `app`, `features`, `routes` or
  `components`; `components` never import features (the app composes them, e.g.
  `app/rail-indicators.ts`); `src/test` is for tests only. Tests may import (and
  `vi.mock`) a feature's `api.ts` directly.
- These rules are enforced: `src/test/architecture.test.ts` (runs in `pnpm test`,
  resolves alias, relative and dynamic imports) and oxlint `no-restricted-imports`
  (deep `@/features/*/*` and `@/routes` imports, in the editor).
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

## 4. Routing

`src/app/router.tsx` holds the table. Paths are Spanish:

| Path                                                | Screen                                             | Guard      |
| --------------------------------------------------- | -------------------------------------------------- | ---------- |
| `/`                                                 | redirect to the first role home (or `/login`)      | —          |
| `/login`, `/login/verificacion`, `/login/bloqueada` | login, MFA, lockout                                | GuestOnly  |
| `/analista?caso=&estado=&q=&lista=&historial=`      | Workspace ("Casos")                                | analyst    |
| `/supervision/{equipo,auditoria}`                   | team and queues, audit (placeholders, slice 3)     | supervisor |
| `/administracion/usuarios`                          | users and roles (placeholder, slice 4)             | admin      |
| `/cliente`                                          | customer chat simulator (dev tool, no staff shell) | —          |

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

## 7. Realtime

`src/lib/realtime` is framework-free except `react.tsx` / `hooks.ts`:

- `RealtimeClient`: one WebSocket to `/api/v1/ws?token=`; ref-counted topic
  subscriptions (`case:<id>`, `inbox:<staffId>`) replayed after every
  reconnect; exponential backoff with jitter (`computeBackoff`), reset on open;
  close code 4401 (token rejected, logout, expiry; also 4403/1008) stops and ends the
  session, 1013 and network drops reconnect. `disconnect()` closes a socket that is
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
  reader, owned by its feature and shared through its `index.ts` (e.g.
  `readCaseSummary` and `isNewerCase` from `@/features/cases`), never copied.
- Handler registry (`createEnvelopeHandlerRegistry`): one handler per event type
  that updates the TanStack Query cache (`setQueryData` / `invalidateQueries`).
  Handlers must still be idempotent (a late payload can be older than the cache) and
  should refetch only when a patch cannot be applied in place (e.g. the inbox refetches
  only when a case may enter, leave or move in it). There is **no global
  registry and no registration at import time** (routes are lazy, so import side
  effects would depend on which screen loaded first). Instead:
  1. the feature writes `export const registerCasesRealtime: RealtimeRegistration =
(registry) => { registry.register('turn.created', …) }` in its `realtime.ts`
     and exports it from `index.ts` (keep that module light: keys + handlers);
  2. it is added to `FEATURE_REALTIME_REGISTRATIONS` in `app/realtime-handlers.ts`,
     the single composition point;
  3. `AppProviders` builds one registry per provider tree with
     `createAppEnvelopeHandlers()` before the socket connects (tests get a fresh one
     from `renderRoute` / `renderWithProviders`, or inject `envelopeHandlers`).
- `<RealtimeProvider>` (mounted in `app/providers.tsx`) connects only while the
  session is authenticated. Components use `useRealtimeSubscription(topic)` and
  `useRealtimeStatus()`.
- Event types: `turn.created`, `case.updated`, `case.assigned`, `inbox.counts`,
  `availability.updated`, `conversation.updated` (slice 2 contract §7). Slice 3
  adds the supervision topics.

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

| Component                                                      | Key props                                                                                                                             | Notes                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `LinkButton`                                        | `variant` primary·accent·secondary·ghost·danger, `size` sm·md·lg, `block`, `loading`, `icon`, `iconEnd`                               | `LinkButton` is a router `Link` with the same look; `buttonClasses()` for anything else                                                                                       |
| `IconButton`                                                   | `aria-label` (required), `icon`, `variant` secondary·ghost·primary·soft, `size` sm·md, `dot`                                          | title defaults to the label; `dot` appends ", con alertas" to the name                                                                                                        |
| `Badge` / `CountBadge`                                         | `tone`, `variant` soft·solid, `size` sm·md, `icon` / `count`                                                                          | CountBadge is decorative: put the count in the parent's label                                                                                                                 |
| `Callout`                                                      | `tone` info·warn·success·danger·neutral, `title`, `kickerTitle`, `actions`, `icon`, `role`                                            | danger defaults to `role="alert"`                                                                                                                                             |
| `Card` / `LinkCard` / `CardHeader`                             | `as` div·section·article·li, `padding` none·sm·md·lg, `tone`, `radius` 10·12·14 / `LinkCard` = router `Link` props / `title`, `aside` | clickable card → `LinkCard` (or `cardClasses()` on a button)                                                                                                                  |
| `Accordion` / `AccordionItem`                                  | `value`/`defaultValue`/`onValueChange`, `collapsible` / `value`, `title`, `count`, `summary`                                          | one open at a time                                                                                                                                                            |
| `Tabs`, `TabList`, `Tab`, `TabPanel`                           | `value`/`defaultValue`, `fitted` / `aria-label`, `trailing` / `value`, `count`, `dot` / `keepMounted`                                 | WAI-ARIA tabs, arrow keys; with no tab selected the first one keeps the Tab stop                                                                                              |
| `SegmentedControl`                                             | `options`, `value`, `onValueChange`, `label`, `variant` segmented·pills, `fitted`                                                     | native radios in a fieldset                                                                                                                                                   |
| `FilterTile` / `FilterTileGroup`                               | `count`, `label`, `tone`, `selected`, `onSelect` / `aria-label`, `columns`, `name`                                                    | the status counters ARE the filters; native radios (one Tab stop, arrows select), white tiles for contrast; long labels wrap, never cut                                       |
| `RadioGroup`                                                   | `label`, `options`, `value` (null = none), `onValueChange`, `required`, `error`, `name`                                               | vertical list of native radios in `role="radiogroup"`; arrows move and select (roving focus); error describes the group                                                       |
| `ListItemButton`                                               | `selected`, `tone`, `markWidth` 3·4                                                                                                   | master/detail rows                                                                                                                                                            |
| `Field`                                                        | `label`, `hint`, `error`, `required`, `labelAside`, `hideLabel`                                                                       | wires id / aria-describedby / aria-invalid into the control                                                                                                                   |
| `Input` / `SearchInput`                                        | `size` sm·md·lg, `leadingIcon`                                                                                                        |                                                                                                                                                                               |
| `Textarea` / `ComposerFrame`                                   | `variant` bordered·bare                                                                                                               | put a bare Textarea inside `ComposerFrame` (draws the frame and the focus ring)                                                                                               |
| `Select`                                                       | `options`, `placeholder`, `size`                                                                                                      | native select                                                                                                                                                                 |
| `Checkbox`                                                     | `label`, `description`, `variant` plain·card                                                                                          | works inside `Field` (id, hint/error, aria-invalid)                                                                                                                           |
| `CodeInput`                                                    | `value`, `onChange`, `length`, `label`, `describedBy`, `invalid`, `disabled`, `initialFocus`, `ref` (`CodeInputHandle.focus(i?)`)     | one box per digit, paste/autofill, Backspace/arrows; every box is described by `describedBy`                                                                                  |
| `Dialog`                                                       | `open`, `onOpenChange`, `title`, `description`, `footer`, `footerNote`, `size` sm·md·lg                                               | focus trap, Escape, restores focus (if the trigger still exists); stacks over a Sheet (top layer reacts, the rest is `inert`)                                                 |
| `Sheet`                                                        | `open`, `onOpenChange`, `title`, `description`, `header`, `footer`, `width` 480·600·720                                               | right drawer, same modal behaviour as Dialog; `description` is the subtitle and the accessible description                                                                    |
| `ToastProvider` / `useToast` / `useToastClearance`             | `toast({ title, description, tag, meta, actions, duration, politeness })`; `dismiss(id)`; `ref={useToastClearance()}`                 | persistent live regions (`status` / `alert`); 6 s auto-dismiss paused on hover/focus; below open modals (z-40); rises above an element that reserves clearance (the composer) |
| `EmptyState`                                                   | `icon`, `title`, `description`, `action`, `as` h1·h2·h3, `size`, `headingRef`                                                         | placeholders, empty lists; `headingRef` makes the title a focus target                                                                                                        |
| `PageHeader` / `SampleDataTag`                                 | `title`, `subtitle`, `actions`, `sampleData`, `eyebrow`, `documentTitle`                                                              | h1 of every staff page; also sets the tab title (`title` if it is a string, else `documentTitle`)                                                                             |
| `DocumentTitle`                                                | `title`                                                                                                                               | tab title "Página · LATAM Bank Soporte" (React 19 hoists `<title>`); for screens without PageHeader / AuthHeading                                                             |
| `Kicker`                                                       | `tone`, `size`, `as` (intrinsic tags)                                                                                                 | uppercase section labels                                                                                                                                                      |
| `KeyValueList`                                                 | `items[{ key, label, value, mono, strong }]`, `labelWidth`                                                                            |                                                                                                                                                                               |
| `Table`, `THead`, `TBody`, `TRow`, `TRowSelect`, `TH`, `TCell` | `stickyHeader`, `density` / `selected`, `onSelect` / `align`, `muted`, `numeric`, `truncate`                                          | native table; selectable rows put a `TRowSelect` button in the primary cell (keyboard + `aria-current`), a click on the row also selects                                      |
| `Stat`                                                         | `label`, `value`, `hint`, `hintTone`, `valueTone`, `size`, `order`                                                                    |                                                                                                                                                                               |
| `StatusDot`                                                    | `tone`, `size` 8·10, `label`, `srLabel`                                                                                               |                                                                                                                                                                               |
| `Avatar`                                                       | `name`, `initials`, `tone` accent·peach·success·neutral, `size`, `decorative`                                                         | success uses `success-tint` (Admin)                                                                                                                                           |
| `Spinner` / `Skeleton`                                         | `label`, `size` / `className`                                                                                                         |                                                                                                                                                                               |
| `QueryState`                                                   | `query`, `skeleton`, `empty`, `isEmpty`, `errorTitle`, `errorDescription`, `children(data)`                                           | loading / error-with-retry / empty / content for any TanStack query                                                                                                           |
| `SourceNote`                                                   | `variant` footer·inline                                                                                                               | where the data comes from                                                                                                                                                     |

Layout (`@/components/layout`): `AppShell` (rail + outlet), `Rail` (role
destinations from `ROLES`, `aria-current`, live badges/dots from the `indicators`
prop: nav items name an `indicator` key and `app/rail-indicators.ts` maps feature
counts to it; no count means no badge, never a constant), `RoleSwitcher` (avatar menu:
CAMBIAR DE ROL with only the roles the user holds, sign out), `AuthLayout` (dark brand
panel + form column), `Page` / `PageBody` / `PageToolbar`, `SplitView`,
`ScreenPlaceholder`, `FullScreenStatus`.

Extend primitives instead of forking them; add new ones here with a test.

## 10. Testing

- Vitest + Testing Library (jsdom). `pnpm test`.
- `src/test/render.tsx`: `renderRoute(entry, { staff, token })` renders the real route
  table with fresh providers, a signed-in staff member (or none, or only a stored
  `token` restored through a stubbed `fetch`), a fake realtime socket and a fresh
  envelope handler registry;
  `renderWithProviders(ui, { route, path, staff })` for isolated components (`path`
  is the route pattern, so `useParams` works).
- Mock at the feature `api.ts` boundary (`vi.mock('@/features/x/api')`), never fetch.
  `lib/api/client.test.ts` covers the HTTP boundary with a fake `fetch`.
- Every `model.ts` has unit tests; every screen has a render test of its main
  states (canvas states such as `error`, `vacia`, `bloqueada`).
- Fixtures use invented people (`src/test/fixtures.ts`), never dataset records.
- Query by role and accessible name (that is also the a11y check).
- `src/test/architecture.test.ts` checks the import boundaries of §3.

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
`dev`, `build`, `typecheck`, `lint`, `test`, `format`, `format:check`, `gen:api`, `check:api`.
