# Engineering brief · support platform (CC)

Read this before you write any code. Every slice and every reviewer follows it. If it conflicts with code already in the repo, this brief wins. If it conflicts with the user's latest decision, the decision wins and this file must be updated first.

Language: the implementation is in English: code, identifiers (variables, functions, types, file names, CSS classes, test ids), comments and docstrings, tests (test names and titles), log and developer-facing error messages, engineering docs (`docs/platform/`, including the slice contracts and ADRs, the READMEs, `frontend/ARCHITECTURE.md`) and commit messages. The product is in Spanish: everything a user sees in the UI (neutral es-CO/es-MX; copy, labels, aria-labels, toasts, user-facing errors, emails, audit texts), the seeded demo content (names, messages, motives) and the business docs (`docs/policies.md`, `docs/security_questions.md`). The customer simulator speaks the customer's own locale (es-CO, es-MX, es-AR, pt-BR). When English text refers to UI copy, it quotes it in Spanish (for example, the "Por responder" status). Data-side artifacts (`reports/`, `synthetic/writer_prompt.md`) keep their own language.

Scope decision of **2026-10-03**. It overrides every earlier doc, canvas note and slice contract.

## 1. Product and scope

LATAM Bank **support platform**. Support staff and customers talk **by chat**, end to end. A customer writes from the app or the web (the customer simulator stands in for both). The case goes to an available analyst who speaks the customer's language. The two talk until the analyst closes the case with a reason. If the customer writes again, a new case opens, linked to the previous one.

Roles. They combine: one person can hold several, and the role switcher moves between them.
- **Analista**: lands on "Inicio" (slice 6) and works her cases in the Workspace ("Casos").
- **Supervisión** (slice 9: the role is named gender-neutrally, never "Supervisora"): "Colas" (every
  open case by language; assignment is automatic), "Equipo", "Escalados" (answer, take, reassign),
  reassignment as the exception, audit.
- **Administración**: users (invite by email, edit, deactivate, unlock, send a reset link),
  roles, languages, teams. It never sees or hands out a password (part 4, slice 11).

In scope:
- dev auth and roles (done);
- the live analyst ↔ customer chat and the "Casos" inbox (done, slice 1);
- the full case lifecycle (done, slice 2);
- supervision (done, slice 3);
- administration (done, slice 4);
- browser e2e and the hand-over docs (done, slice 5);
- the analyst home "Inicio" and the Casos adjustments of 2026-10-03 (done, slice 6);
- customer satisfaction ratings (CSAT 1–4) after a close, from the simulator, shown to staff
  and as a 7-day figure in supervision (done, slice 7; user decision of 2026-10-03);
- the case priority (none, low, medium, high, critical, as the dataset's
  `complaints.priority` plus "none"), set by the assignee or supervision; a fixed 15-minute
  first-response SLA for every case (done, slice 8 part 1);
- supervision v2 and escalations (done, slice 9; user decision of 2026-10-04): "Colas" with every
  open case of a language, "Equipo" as one table with filters, the redesigned reassign dialog,
  escalations to supervision grounded only in the dataset's `was_escalated` (a motive and what
  supervision did: answer, take, reassign; no types, amounts, limits, levels or deadlines),
  gender-neutral role names and the admin users filters;
- the notification center (done, slice 10): a bell in the rail for every role, notifications
  persisted per person and derived from facts already in the event log (plus the first-response
  SLA risk, from a periodic sweep), the toasts of those facts on every screen of the role with
  "Más tarde"; no AI, fixed templates.
- secure onboarding by email invitation (done, slice 11 = part 4; user decision of 2026-10-04:
  "no tiene sentido si somos una empresa segura"): invitations by email with a single-use link,
  the person sets her own password and enrolls an authenticator app (TOTP), password resets by an
  email link, TOTP at sign-in, the dev mailbox. No temporary passwords anywhere.

The chat must work for real in two browser windows: the analyst Workspace and the customer simulator.

**Out of scope, and not built anywhere** (no ports, seams or placeholders):
- AI of any kind: copilot, AI agents, judge, decision tree, automated routing tiers, suggestions or drafts;
- a tool catalog or any action on bank systems (blocks, abonos, claims);
- customer or bank data panels (customer file, products, movements, complaints, "who saw what");
- identity verification and security questions;
- approvals and four-eyes;
- the Automatización role and its screens;
- calls, outbound calls, email, WhatsApp (as **support channels**; the platform's own account
  emails of part 4 — invitations and reset links — are not a channel);
- analyst-to-analyst transfers;
- the customer mobile app (only the minimal **customer chat simulator** exists, as a dev/demo tool);
- core-banking integration;
- CSAT beyond slice 7 (no automatic surveys by email or WhatsApp, no sentiment, no averages for
  analysts).

## 2. Sources of truth

- **Visual design:** the Claude Design canvas. A local copy lives in `warehouse/design/source/project/*.dc.html`, with `canvas.json` for board titles and pages. Read the `.dc.html` of the screen you build:
  - its markup holds the layout, spacing and copy;
  - its `renderVals()` script holds the states and sample data;
  - the wrapper boards (`An*`, `Su*`, `Ad*`) set a `view`/`section` prop, and each one is a **state** the real screen must support.

  Only boards for things still in scope apply: the Workspace list and conversation, login/MFA/lockout, the customer chat (`AppSupportChat`), supervision team and queues, audit, and admin users. Ignore every copilot, tools, client-file, identity, approval, call, email and automation board, and every board element of that kind (the support panel, "Siguiente paso", action cards). Where this brief changes a canvas decision (§5.4), the brief wins.
- **Design tokens:** `frontend/src/styles/index.css` (`@theme`). Never hard-code colors. If a token is missing, add it.
- **Data contracts:** `contracts/synthetic-sample/platform_history.json`, for the event-log envelope only (`event_id, event_type, entity, entity_id, case_id, actor_role, actor_id, event_time, ingested_at, payload`). Its AI entities (`routing_step`, `tool_call`, `copilot_query`, `component`, …) are not produced. `contracts/synthetic-sample/evaluation.json` is not used by the platform.
- **Policies:** from `docs/policies.md`, only **rule 3 (language, policy id `H1`)** applies. `docs/security_questions.md` and the identity, abono, approval, verified-action, regulator and automation rules no longer apply.
- **Synthetic values:** SLA targets, the closed-case window, queue names and close reasons are **team-generated** (not from the dataset). Name them as such in code comments. Where the UI shows them as policy, label them "Política de ejemplo".
- **Sample data reference:** `reports/platform/SAMPLE.md`. Do **not** read or commit anything from `data/`, `warehouse/` (except the design references) or `guides/`.

## 3. Repository layout

```
hackaton/
  backend/            Python API (own pyproject, uv)
  frontend/           React SPA (pnpm)
  contracts/          JSON data contracts (existing, read-only)
  docs/               product docs (existing) + docs/platform/ (this brief, ADRs, API contracts)
  docs/platform/adr/  one Markdown file per architecture decision (NNNN-title.md)
  docs/platform/api/  one contract per slice (slice-N-title.md)
```

## 4. Backend

### 4.1 Stack
- **Runtime:** Python 3.12 (uv, `backend/pyproject.toml`, src layout `backend/src/cc_platform`).
- **Libraries:** FastAPI; Pydantic v2 + pydantic-settings; SQLAlchemy 2.0 (async) with SQLite via aiosqlite by default (Postgres-ready: no SQLite-only SQL); uvicorn; structlog (JSON logs with a request/correlation id).
- **Tests:** pytest, pytest-asyncio, httpx.
- **Quality:** ruff (lint + format) and mypy (strict on `domain` and `application`).
- **Migrations:** no Alembic yet. `metadata.create_all` runs at startup behind a function. This is a documented known gap: a schema change means deleting `backend/cc_platform.db`.

### 4.2 Architecture: hexagonal (ports and adapters), DDD-lite, CQRS-lite
```
cc_platform/
  domain/          pure Python: entities, value objects, domain events, domain services, errors. No FastAPI/SQLAlchemy imports.
  application/     use cases (commands and queries), ports (Protocols), DTOs. Depends only on domain.
  infrastructure/  adapters: persistence (SQLAlchemy + in-memory), event bus, realtime hub, background tasks, security, seed data, clock, id generator.
  api/             FastAPI routers per bounded context, request/response schemas, error mapping (RFC 7807 problem+json), auth dependency, websocket endpoint.
  bootstrap/       composition root: builds the container (settings → adapters → use cases). The only place that knows concrete classes.
```
Bounded contexts (one package per context in each layer):
- `people`: staff, roles, teams, languages, availability, login/MFA/sessions; administration in slice 4;
- `customers`: minimal customer profile (name, locale, language, country, city) and customer sessions;
- `cases`: case, turn, assignment, queue, close, case history;
- `audit`: event-log queries, in slice 3.

Use these patterns where they fit, and name them in docstrings when they are not obvious:
- **Repository + Unit of Work** per aggregate, with in-memory implementations for tests.
- **Domain events + event bus** (in-process, async):
  - Every state change emits an event.
  - Events are **append-only**. They are persisted to an `event_log` table, using the contract envelope (event_time, ingested_at, actor, entity, payload), in the same transaction as the state change.
  - Realtime projectors and process managers subscribe to the bus.
- **Strategy:** `AssignmentStrategy` (who gets a case), `SlaPolicy`, `PasswordHasher`, `MfaVerifier`.
- **State machines** for `Case`, `MfaChallenge` and `StaffSession`: explicit allowed transitions, and a domain error on any other.
- **Process manager:** `QueueDrainer` (when an analyst becomes available, drain the queue in the background).
- **Optimistic concurrency** on every aggregate:
  - `AggregateRoot.version`; repositories save with a compare-and-set (`WHERE id AND version = :loaded`, then bump) and raise `ConcurrentUpdateError` (409 `concurrent_update`).
  - Commands that are safe to repeat run in `retry_on_conflict` and re-check their rules on fresh state: lockout counters, MFA challenge, case status, assignment, the customer's open-case slot.
  - Expensive or side-effecting checks done before the save (hashing) are cached across retries.
  - Every state machine relies on this. Never write a read-modify-write without it.
- **API boundary:**
  - Routers receive an `ApiContext`: use cases grouped by context (`use_cases.<context>.<use_case>`), plus the clock, ids, realtime hub, topic policy, health probes and build info.
  - `api` never imports `bootstrap` or `infrastructure` (architecture test).

Keep it pragmatic: add no abstraction without a second caller or a named seam in a slice contract.

### 4.3 Product rules (enforced in the service layer, never in prose)
- **Rule 3 · language (`H1`).** A new case goes to an **available** analyst who **speaks the customer's language**: a Portuguese case only to a Portuguese speaker, never to an available Spanish-only analyst. Among those, the least loaded gets it. If nobody is eligible, the case waits in the language queue and is assigned as soon as an eligible analyst becomes available. Supervision may reassign an open case (and the API still assigns a queued one by hand, slice 3), with the same rule; since slice 9 the UI never offers "Asignar" for a queued case: assignment is automatic.
- **Paused analysts get no new cases.** The cases they already hold stay with them.
- **At most one open case per customer.** A customer message after a close opens a **new** case, linked to the previous one (`previousCaseId`) and assigned normally.
- **Only the assignee writes in a case.** A closed case is read-only for everyone.
- **A close needs a reason** from a fixed list. The customer sees a closing notice, never the reason.
- **Customers see only their own cases** and only the turns meant for them (`audience = everyone`). Staff banners never reach a customer, over REST or the socket.
- **Staff see a case** if they are its assignee, a supervisor, or an analyst who holds (or held) another case of the same customer (read-only history).

### 4.4 API conventions
- **REST and ids:** REST under `/api/v1`, JSON with **camelCase** fields (Pydantic alias generator), ISO-8601 UTC timestamps. Ids are opaque strings with a prefix (`CASE-…`, `TRN-…`, `ASG-…`, `CUS-…`, `STF-…`).
- **Errors:** RFC 7807 `application/problem+json` with a stable `code` (e.g. `forbidden`, `invalid_transition`, `case_closed`, `case_not_assigned`).
  - Every code is a member of `ProblemCode` in `api/problems.py`, the one registry of status, title and default detail.
  - `ProblemDetails.code` is that enum in OpenAPI. The documented extensions (`remainingAttempts`, `unlockAt`, `requiredRoles`, `currentStatus`, `errors`) are typed optional fields.
  - The frontend derives its code type from the generated schema, so a new code without regenerated types fails `check:api`.
  - A test fails if an error class declares an unregistered code.
- **Idempotency:** commands that create things accept an `Idempotency-Key` header. Chat messages use it as the `clientMessageId`.
- **Pagination:** cursor based (`?cursor=&limit=`) for lists that can grow (transcripts, audit).
- **OpenAPI is the contract for the frontend.** A script exports `backend/openapi.json`. The frontend generates types from it (`openapi-typescript`) and calls the API with `openapi-fetch`.
- **Realtime:**
  - One WebSocket, `/api/v1/ws`, authenticated with the session token or the customer token as a query param.
  - The server pushes typed envelopes `{type, id, occurredAt, data}` derived from domain events (`turn.created`, `case.updated`, `case.assigned`, `inbox.counts`, `availability.updated`, `conversation.updated`, …).
  - Clients subscribe to topics: `case:<id>`, `inbox:<staffId>` and `customer:<customerId>`. Supervision topics come in slice 3; `staff:<staffId>` (slice 4) also carries her notifications (slice 10).
  - Sockets only *signal* changes. REST and the event log stay the source of truth.

### 4.5 Auth
- **Staff sign-in:** no external IdP. `POST /api/v1/auth/login` takes email + password (Argon2id),
  then `POST /api/v1/auth/mfa` the second factor. It returns a signed session token (HMAC,
  configurable secret) carrying the session id, staff id and roles.
- **Second factor (part 4, slice 11):** every account created by an invitation enrolled an
  authenticator app (TOTP, RFC 6238: 30 s, 6 digits, SHA-1; the secret sealed with Fernet) and
  signs in with its codes. The development code `000000` works **only** for the seeded accounts
  that have no authenticator, and only outside production (`CC_ENV=prod` has no dev verifier).
- **Nobody hands out passwords (part 4):** administration invites (`POST /admin/users` → an
  email with a single-use link, 48 h) and sends reset links (1 h); the person sets her own password
  (policy: ≥ 12 characters, not her email name nor her name, not a common one) on the public
  routes `/api/v1/onboarding/*` (tokens in POST bodies, hashed at rest, one generic 410 for any
  unusable link, per-client rate limit). Emails go through the `EmailSender` port; the only
  adapter is the development mailbox (`GET /api/v1/dev/mailbox`, SPA `/dev/correos`), never in
  production. Contract: `api/slice-11-invitations.md`.
- **Lockout:** 5 failed attempts lock the account for 15 minutes (canvas `BoLocked`). Unlocking by hand is administration, in slice 4.
- **Roles:** roles are re-read on every request. Every route declares the roles it allows (`require_roles(...)`).
- **Customer simulator:** it uses `POST /api/v1/customer/sessions` with a seeded customer id. The channel identity is the app or web session. Customer tokens and staff tokens are never interchangeable.

### 4.6 Assignment (the only "routing" there is)
- **One use case, two callers.** `AssignCase` places one case: it assigns it through the `AssignmentStrategy` port, or it leaves it in the language queue with a staff-only banner. It runs inside the Unit of Work that opens the case, and again from `DrainQueue` when an analyst becomes available.
- **The strategy.** `LanguageLeastLoadedStrategy` (rule 3) keeps the available analysts who speak the case language, then picks the minimum of (open cases, last assignment time, staff id).
- **Later seams:** manual assignment and reassignment by a supervisor (slice 3) and a capacity cap (`max_open_cases`). No other seam.
- **No tiers.** There is no judge, tree, agent, `Responder`, routing step or background routing job. Slice 2 deletes them (`api/slice-2-case-lifecycle.md` §1).

### 4.7 Seed data
- **Labeling:** everything is fictitious; the UI does not label it (the user removed the "Datos de ejemplo" tags). Names, ids and contact data are **invented**. Never copy customer or staff records from the dataset into committed files.
- **Cases:** chat only (`app_chat`, `web_chat`). Together they cover every inbox status:
  - Nuevos, Por responder and Esperando al cliente;
  - a few Cerrados, inside and outside the 7-day window;
  - a case that reopened after a close;
  - a case waiting in the queue.
- **Staff:** analysts (the main persona is "Daniela Ríos", who speaks Spanish and Portuguese), supervisors and admins, including an **Analista + Supervisión** team lead. The exact seed is in the slice 2 contract §8.

## 5. Frontend

### 5.1 Stack (already scaffolded in `frontend/`)
- **Core:** Vite, React 19, TypeScript (strict), Tailwind v4 with tokens in `src/styles/index.css`, React Router v8 (data router), TanStack Query v5.
- **Assets:** lucide-react icons and self-hosted fonts: Bricolage Grotesque for display, Schibsted Grotesk for text, IBM Plex Mono for ids.
- **Tooling:** Vitest + Testing Library; oxlint + prettier (config exists); Playwright for e2e (slice 5).

### 5.2 Structure (feature-sliced)
```
src/
  app/           providers, router, session, query client, role definitions
  components/ui/ design-system primitives (exist; extend, do not fork). Import from '@/components/ui'.
  components/layout/  AppShell, Rail (role navigation), RoleSwitcher, PageHeader usage
  features/<name>/    components/, hooks/, api.ts (typed calls + query keys), model.ts (pure logic, tested), types.ts, index.ts (public API of the feature)
  routes/        route modules that compose features (thin)
  lib/           api client (openapi-fetch), realtime client, formatters, cn
  styles/
```
Rules:
- Features import other features only through their `index.ts` (or `core.ts`, the screen-free public file the always-loaded app shell uses; frontend/ARCHITECTURE.md §3). No cross-feature deep imports.
- Components stay small and presentational. Data fetching lives in hooks. Business rules live in `model.ts` and are unit-tested.
- The URL holds shareable state: the selected case, filters, the open history.
- No global store unless a real cross-cutting need appears; document one in an ADR.

### 5.3 Data
- **Server state:** every screen reads from the backend through `openapi-fetch` with generated types. TanStack Query holds server state, with query keys from a per-feature factory.
- **Realtime:** the realtime client updates the query cache from WebSocket envelopes.
- **States:** loading, empty and error states are designed, not afterthoughts.
- **Tests:** they mock at the api-module boundary.
- **No client-side sample data:** sample data lives in the backend seed and is served by real endpoints. The SPA has no fixture layer, no second error type (`ApiProblem` only) and no fake clock.
- **Dates:** shown in the viewer's time zone.

### 5.4 Design decisions (user decisions, 2026-10-03)
- **List title.** The analyst list title is **"Casos"**, never "Mis contactos" or "Te toca".
- **Analyst home (slice 6).** An analyst lands on **"Inicio"** (`/analista/inicio`): availability, the four status tiles (links to Casos with the filter), "Lo primero" (open cases by urgency), "Mientras no estabas" (event-log facts with fixed templates, never a summary) and "Tu equipo ahora" (counts only). Contract: `api/slice-6-analyst-home.md`.
- **Case statuses.** There are four, chat only. "Por llamar", "En curso" and "En espera" are gone.

  | Tile | Meaning | Tone token |
  |---|---|---|
  | **Nuevos** | Assigned, not yet opened by the analyst | `accent` (blue) |
  | **Por responder** | The customer wrote last | `warn` (orange) |
  | **Esperando al cliente** | The analyst wrote last | `waiting` (grey) |
  | **Cerrados** | The analyst's own cases closed in the last 7 days; read-only transcripts | new neutral `closed` tone, built on the existing `offline`/`muted` tokens |

  - Slice 6 (user decision, 2026-10-03): the status tiles live on **Inicio** and open Casos with the filter in the URL; the Casos list shows a removable filter chip, no tiles, and one flat list in urgency order (`sortByUrgency`). Cerrados is reached from its tile (or the URL).
  - A case nobody can take yet waits in a queue that only supervision sees (slice 3). It is in no analyst's list.
- **Case card.**
  - A left color stripe shows the status, and a status pill repeats it.
  - Top right shows the first-response SLA level (clock, orange flame ≤ 5 min, filled red flame "Vencido"; slice 6 `slaFact`), only while the first reply is pending. A closed card shows when it closed (clock) instead.
  - The second line is the last message.
  - The bottom line shows short facts, never a dot-joined line: the channel (icon), the priority glyph only when high or critical (slice 8, Linear-style `PriorityIcon`, icon-only with "Prioridad alta/crítica"), "Volvió a escribir" (icon), and the time since the last interaction (clock).
- **Metadata rule (slice 6).** Facts are separate short items (icon + 1–3 words, `Fact`); status is a pill; times have a clock; secondary facts may be icon-only with a tooltip. No "·"-joined strings or wrapping sentences in the analyst UI.
- **Workspace: two columns.** The case list (collapsible to a rail) and the conversation. The conversation takes the full remaining width. There is no Copiloto, Herramientas or tool/action cards, no identity card, no call bar, no email layout. Slice 6 (user decision): one on-demand right panel, **"Ficha del cliente"** (`?ficha=1`), opened from the customer's name, with only platform data: Cliente, Este caso, Cómo llegó a ti, Casos anteriores. No bank data.
- **Conversation header.**
  - Content (slice 6): the customer name (it opens "Ficha del cliente"), the short case id under the name (copyable) and "Cerrar caso". The place, channel and priority are in the ficha; slice 8: the ficha's "Prioridad" value is a menu button (five levels with their glyphs), and the supervisor view has the same menu in its header.
  - A **"Cómo llegó a ti"** row explains the people-based assignment only, as short facts: available + language (rule 3) + queue wait or the supervisor.
  - **"Casos anteriores (n)"** is a section of the ficha: this customer's previous conversations and their read-only transcripts. This is conversation history, not bank data. The supervisor view keeps its sheet.
- **Close dialog.**
  - A required reason from a fixed list, shown as cards with an icon, a tone and a one-line meaning (slice 6): Resuelto, El cliente no respondió, Duplicado, Fuera de alcance, Otro.
  - An optional internal note.
  - A preview of the notice the customer will see.
- **Customer simulator.** It shows the current conversation, its state ("Buscando a una persona del equipo…", "Te atiende {nombre}", "Conversación terminada") and, on demand, the customer's previous closed conversations. Writing after a close starts a new conversation. Slice 7: a closed, unrated conversation shows the satisfaction survey ("¿Cómo te atendió {nombre}?", four faces, optional comment, "Ahora no") in place of the composer.
- **Removed and staying removed:**
  - every automation screen; "Por aprobar"; "Herramientas y permisos"; "Políticas y reglas"; "Retención de datos";
  - "Mi rendimiento";
  - analyst-to-analyst transfers;
  - "acceso a datos ocultos";
  - any branch/sucursal channel;
  - the call and email modes.

  The 7-day Cerrados filter is not the old "Mis casos cerrados" screen: it is a read-only filter of the same list.
- **Supervisión v2 (slice 9, user decision 2026-10-04).** Contract: `api/slice-9-supervision-v2.md`.
  - Rail: Colas (badge: cases nobody holds), Equipo, Escalados (badge: open escalations),
    Auditoría; the role lands on `/supervision/colas`. No team tabs anywhere: the team is a filter.
  - "Colas": the language queues and, for the selected one, every open case (customer with the
    channel icon, status + "Escalado" + priority glyph, how long open, first response, who has it).
    No manual "Asignar": assignment is automatic; a case nobody holds explains it in its view.
    "Reasignar" stays as the exception (Equipo, the case view, Escalados).
  - Filters everywhere are one "Filtros" button + a dropdown of checkbox groups with counts +
    removable chips (`FilterMenu`), never pill rows or tabs.
  - Escalations: the analyst escalates with a required motive ("Escalar a supervisión" next to
    "Cerrar caso"); the case stays hers; a staff-only card shows it (withdraw while open, then what
    supervision did and "Entendido"). Supervision answers with a note, takes the case (only if she
    also holds Analista and speaks the language) or reassigns it. Waiting emphasis (clock, orange
    flame > 15 min, red > 30 min) is visual only: no deadlines.
  - Alerts use `Callout` (icon tile, short title, one line, action right); role names are
    gender-neutral ("Supervisión"); facts are icon + short label, never " · " joined.
- **Notification center (slice 10, user decision 2026-10-04).** Contract:
  `api/slice-10-notifications.md`.
  - A bell in the dark rail above the avatar, for every staff role: orange badge with the unread
    count, accessible name "Notificaciones, N sin leer"; a panel anchored to it (380 px, ≤ 560 px,
    scrolls inside): "Marcar todas como leídas", "Nuevas" / "Anteriores", items with an icon tile,
    a short title, one line, the time, the unread dot, the primary action ("Abrir caso",
    "Revisar", "Ver en la cola", "Ver usuarios") and "Marcar como leída"; empty: "Estás al día".
  - Notifications are persisted per person and derived from facts (event log + SLA sweep); they
    are not events themselves. Kinds and recipients are fixed (analyst: her cases; supervision and
    administration: every active person of the role; never the actor).
  - Toasts: ink at 88 % with a 12 px blur and a hairline border, region "Avisos". A live toast of
    a notification has its action (opens it, marks it read) and "Más tarde" (it stays unread);
    it shows on every screen of its role unless the screen already shows it. Confirmations of
    one's own actions stay plain toasts.
- **Layout and accessibility.** Desktop-first (1440×900 boards), but it must not break at 1280 width. Keyboard accessible, visible focus, aria labels as in the canvas.

## 6. Quality gates (must pass before a slice is done)
Backend (`cd backend`): `uv run ruff check .` · `uv run ruff format --check .` · `uv run mypy src` · `uv run pytest -q` (includes the OpenAPI staleness check).
Frontend (`cd frontend`): `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm format:check` · `pnpm check:api`.
Browser e2e (`cd frontend`, from slice 5): `pnpm e2e` (Playwright, Chromium; it starts the backend on a fresh temporary SQLite database and the Vite dev server itself; run `pnpm e2e:install` once). A slice that changes a flow it covers is done only when it is green.

Test coverage required:
- every use case and every `model.ts` has unit tests;
- every router has API tests for the happy path and the main rule violations;
- every screen has at least a render test of its main states.

## 7. Repo hygiene
- Never commit `data/`, `warehouse/`, `guides/`, `.env`, credentials or dataset-derived customer records.
- Commits: imperative English subject, no co-author trailers. Agents never commit: the user does.
- Do not edit `synthetic/`, `pipeline/`, `analysis/` or `contracts/` (read only) unless the slice says so.

## 8. Slice plan

| Slice | Scope | Contract | State |
|---|---|---|---|
| S0 | Foundations: hexagonal skeleton, UoW + event log, optimistic concurrency, problem+json, dev auth (login, MFA, lockout, sessions), roles and role switcher, realtime hub, design system. | (in code + ADR 0001) | done |
| S1 | Live analyst ↔ customer chat, "Casos" inbox, availability, language assignment, customer simulator, seed. | `api/slice-1-cases.md` | done |
| **S2** | **Scope cut + case lifecycle.** Remove every AI, tool, routing-tier, identity, approval, automation, call and email part (backend, frontend, docs). Then: the four statuses with counters-as-filters (Cerrados = last 7 days, read-only); close with a required reason, an optional note and the customer notice; a new case linked by `previousCaseId` when a customer writes after a close; "Casos anteriores de este cliente" with read-only transcripts; first-response SLA; one `AssignCase` use case with the `AssignmentStrategy`; the customer simulator with past conversations; the reseed. | `api/slice-2-case-lifecycle.md` | done (browser pass pending) |
| S3 | **Supervision.** Team and queues: who is available or paused, the load per analyst, queued cases by language with their wait and first-response SLA, cases at risk. Manual assignment of a queued case and reassignment of an open case (rule 3 enforced: a Portuguese case only to a Portuguese speaker; paused analysts allowed only with an explicit confirmation), each with a staff banner and an audit event. Supervisor read-only view of any case. Audit: event-log queries (who did what, on which case, when) with filters and cursor pagination. Realtime topics for team and queues; rail badge for queued cases. | `api/slice-3-supervision.md` | done. Final check 2026-10-03: `openapi.json` and the generated types in sync; every §6 gate green (backend 501 tests, frontend 500 tests, `check:api`); a scripted API/WS live check on a fresh database (68/68: queues, team, rule 3, pause confirmation, reassignment, §3.9 races, audit, and the S1/S2 chat + close + linked-case regression); Playwright smoke at 1440 and 1280. The multi-window browser pass is in S5. |
| S4 | **Administration.** Users: create, edit, deactivate/reactivate, unlock a locked account, reset the dev password. Combinable roles (Analista, Supervisión, Administración; at least one). Languages spoken (es, pt). Teams: create, rename, deactivate, membership. Guard rails: nobody removes their own admin role or deactivates themself, and the last active admin cannot be removed. Each change is audited. | `api/slice-4-administration.md` | done. Final check 2026-10-03: `openapi.json` and the generated types in sync; every §6 gate green (backend 669 tests, frontend 586 tests, `check:api`); a scripted API/WS live check on a fresh database (68/68: create a pt analyst who signs in with the temporary password + MFA and receives the queued pt case, a role added → 4409 and the next request reflects it, self guards, concurrent demotions keep one admin, deactivation blocked by open cases until supervision reassigns them, then 4401 + revoked sessions, 5-password lockout and unlock, password reset, teams, audit texts, 403 for non-admins on all 14 routes); the S1–S3 regression script on a second fresh database (68/68: queues, team, rule 3, manual assignment and reassignment, §3.9 races, audit, live chat, close with reason, new linked case, "Casos anteriores"); Playwright smoke at 1440 and 1280 (42/42, no page errors). The multi-window browser pass is in S5. |
| S5 | **Browser e2e + docs.** Playwright scenarios over a fresh backend:<br>• two-window chat;<br>• close and a new linked case;<br>• "Casos anteriores";<br>• queue and drain;<br>• supervisor assignment and reassignment;<br>• admin creates an analyst, who then receives a case;<br>• lockout and unlock.<br>Final READMEs and run book. | `api/slice-5-e2e.md` | done. Final whole-platform check 2026-10-03: no API change (`export_openapi` + `gen:api` rewrote byte-identical `openapi.json` and the generated types in sync); every §6 gate green (backend: `ruff check`, `ruff format --check` (231 files), `mypy src` (169 files), `pytest` 673 passed; frontend: `typecheck`, `lint`, `format:check`, `test` 592 passed in 63 files, `build`, `check:api`); `pnpm e2e` 8/8 twice in a row, each on its own fresh temporary database (24.4 s each, one worker; the seven bullets above plus a live role change and a live deactivation sign-out), 16/16 with `--repeat-each=2` on one database (50.1 s), temp databases removed by the teardown, and file and title subsets green on their own; one product bug found and fixed with a unit test (`features/cases/realtime.ts` `writeInbox`: an off-screen inbox lost its pending refetch); RUNBOOK and DEMO rehearsed on a fresh database (DEMO step 9.3 locks Martín Salazar live). Known gaps in the contract §9. |
| S6 | **Analyst home ("Inicio") + Casos adjustments.** `GET /me/home` (CQRS-lite `GetAnalystHome`, port `AnalystHomeReader` in SQL and memory): `since` = end of her previous session (fallback now − 8 h), deterministic activity rows from the event log (fixed templates in the frontend), team snapshot (counts only). Inicio screen (`/analista/inicio`, landing of the analyst role, rail Inicio + Casos with a Por responder badge, presence dot). Casos: tiles moved to Inicio (filter chip), urgency order shared with "Lo primero", pause control as the indicator, slim header + "Ficha del cliente" panel, close reasons as cards, SLA levels, facts instead of dot-joined lines; teams renamed "Equipo Andes/Pacífico/Caribe". | `api/slice-6-analyst-home.md` | done. Gates 2026-10-03: see the slice report (backend ruff, format, mypy, pytest, OpenAPI check; frontend typecheck, lint, test, build, format:check, check:api; `pnpm e2e` 9/9 twice). |
| S7 | **Customer rating (CSAT).** The customer rates a closed case once (1–4: Mal, Regular, Bien, Excelente; optional comment ≤ 500) from the simulator (survey in place of the composer, "Ahora no", thanks pill; es and pt-BR). `POST /customer/conversations/{caseId}/rating` (customer token, `Idempotency-Key`; 409 `case_not_closed` / `already_rated`, 404 for someone else's case), stored on the case (version CAS), `case.rated` in the event log and on the existing sockets. Staff: the closed footer pill + comment, the Cerrados card face, the ficha "Calificación" row and "Calificó: …" in "Casos anteriores"; no averages for analysts. Supervision: "Calificación 7 días" per analyst (who closed the case). Audit: "El cliente calificó el caso: Bien", never the comment. Seed: 104 (4, with comment), 106 (3), 110 (3); 105 unrated. | `api/slice-7-csat.md` | done. Gates 2026-10-04: backend `ruff check`, `ruff format --check` (241 files), `mypy src` (174 files), `pytest` 756 passed, `export_openapi --check` clean; frontend `typecheck`, `lint`, `test` 694 passed in 69 files, `build` (no rating copy in the entry chunk), `format:check`, `check:api`; `pnpm e2e` 10/10 twice in a row (new: the customer rates and the analyst sees it live). |
| S8 | **Case priority (part 1).** `CasePriority` = none · low · medium · high · critical (every case opens with none); `PUT /cases/{caseId}/priority` (`{priority, expectedVersion}`; the assignee analyst or Supervisión on any open case; 409 `case_closed` / `version_conflict` with `current`; same level = `changed: false`), CAS + `retry_on_conflict`, `case.priority_changed {from, to}` in the event log, audit "Cambió la prioridad a Alta" (Casos family), `case.updated` / `team.updated` / `queue.updated` on the existing topics. The first-response SLA is a fixed 15 minutes for every case. Frontend: `PriorityIcon` + `ChoiceMenu` primitives, one `CASE_PRIORITY` map, the ficha menu (optimistic, rollback + toast), the supervisor header menu, card glyph for high/critical, supervision row glyphs, "Lo primero" order (overdue, critical, high, nearest SLA). Rating with less text in lists (face + tooltip) and in the ficha/footer (face + one word). Seed: 101 critical, 102 and 112 high, 106 and 114 low. | `api/slice-8-priority.md` | done. Gates 2026-10-04: see the slice report. |
| S9 | **Supervision v2 + escalations.** Rail Colas / Equipo / Escalados / Auditoría (landing `/supervision/colas`); "Colas" lists every open case of a language (`GET /supervision/open-cases`), no manual "Asignar"; "Equipo" one table with one "Filtros" dropdown (no team tabs) and the redesigned reassign dialog (only speakers, 3 suggestions, search, "+N más", paused people on demand); escalations as their own aggregate (`escalations`, one open per case through `cases.open_escalation_id`): escalate / withdraw / "Entendido" (analyst), answer / take / reassign (supervision), `escalation.*` events with motive and note redacted in the audit, `escalation.updated` on `case:`, `inbox:` and the new `supervision:escalations`; gender-neutral "Supervisión"; admin users list with search + "Filtros" + chips, "Nuevo usuario", language pills. | `api/slice-9-supervision-v2.md` | done. Gates 2026-10-04: backend `ruff check`, `ruff format --check` (250 files), `mypy src` (177 files), `pytest` 857 passed, `export_openapi --check` clean; frontend `typecheck`, `lint`, `test` 783 passed in 76 files, `build` (screen copy only in lazy chunks), `format:check`, `check:api`; `pnpm e2e` 11/11 twice in a row (new: an analyst escalates, supervision answers from Escalados and she sees it live). |
| S10 | **Notification center.** `Notification` aggregate + `notifications` table (`NTF-…`, structured data, `source_key` unique per person, newest 200 kept), `NotificationProjector` on the bus (assigned on arrival / from the queue / by supervision, reassigned away, customer returned, escalation answered / taken / reassigned, case rated; case escalated, queued (once per language while it waits); account locked; invitation accepted, defined for part 4), `SweepSlaRisk` (once at startup, then every 30 s), `GET /me/notifications`, `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all`, `notification.created` / `notifications.read` on `staff:<id>`. SPA: `features/notifications` (bell + panel in the rail through `routes/staff-shell.tsx`, toasts from the stream on every screen of the role with "Más tarde"), the restyled toast ("Avisos"), the ad-hoc toasts of Casos and supervision removed. Part-2 leftovers: "Escalado" in "Lo primero", no " · " in the audit detail and the closed footer, Equipos with `Status` and "Filtros". | `api/slice-10-notifications.md` | done. Gates 2026-10-04: backend `ruff check`, `ruff format --check` (266 files), `mypy src` (190 files), `pytest` 911 passed, `export_openapi --check` clean; frontend `typecheck`, `lint`, `test` 811 passed in 79 files, `build` (the bell's copy is in the entry chunk on purpose: it is on every staff screen), `format:check`, `check:api`; `pnpm e2e` 12/12 twice in a row (new: supervision opens an escalation from the bell, the answer reaches the analyst's bell). |
| S11 | **Secure onboarding by invitation (part 4).** No temporary passwords anywhere: `POST /admin/users` invites (person `invited`, `Invitation` `INV-…` with a single-use 48 h link, only its SHA-256 stored, one per person; resend replaces the token, cancel withdraws her and the same email can be invited again); public `POST /onboarding/invitations/{check,password,activate}` (password policy ≥ 12 / not her email name or name / not common; Argon2id; TOTP enrollment with `pyotp`, QR + manual key shown once, secret sealed with Fernet; `staff.mfa_enrolled` + `staff.invitation_accepted`, which notifies administration) and `POST /onboarding/password-resets/{check,complete}` (`PasswordReset` `PWR-…`, 1 h; "Enviar enlace para restablecer" ends her sessions now); one 410 `link_invalid` for any unusable token, 429 `rate_limited` per client, 423 after 5 wrong enrollment codes; TOTP at sign-in (dev code only for seeded accounts); `EmailSender` port + dev mailbox (`GET /dev/mailbox`, `/dev/correos`, `CC_DEV_MAILBOX`, never in prod); audit texts; seed Tatiana (accepted, TOTP) and Bruna (pending). SPA: "Enviar invitación", "Invitación enviada", "Invitación pendiente" with Reenviar / Cancelar, the reset-link dialog, `/activar` and `/restablecer`, `/dev/correos`. | `api/slice-11-invitations.md` | done. Gates 2026-10-04: see the slice report. |
