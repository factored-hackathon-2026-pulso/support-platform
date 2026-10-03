# Engineering brief · plataforma de soporte (CC)

Read this before you write any code. Every slice and every reviewer follows it. If it conflicts with code already in the repo, this brief wins. If it conflicts with the user's latest decision, the decision wins and this file must be updated first.

Language: code, identifiers, comments and commit messages are in English. Everything a user sees in the UI is in Spanish (neutral es-CO/es-MX). The customer simulator speaks the customer's own locale (es-CO, es-MX, es-AR, pt-BR). Product docs under `docs/` stay in Spanish.

Scope decision of **2026-10-03**. It overrides every earlier doc, canvas note and slice contract.

## 1. Product and scope

LATAM Bank **support platform**. Support staff and customers talk **by chat**, end to end. A customer writes from the app or the web (the customer simulator stands in for both). The case goes to an available analyst who speaks the customer's language. The two talk until the analyst closes the case with a reason. If the customer writes again, a new case opens, linked to the previous one.

Roles. They combine: one person can hold several, and the role switcher moves between them.
- **Analista**: works her cases in the Workspace ("Casos").
- **Supervisora**: team and queues, manual assignment and reassignment, cases nobody could take, audit.
- **Administración**: users (create, edit, deactivate, unlock), roles, languages, teams.

In scope:
- dev auth and roles (done);
- the live analyst ↔ customer chat and the "Casos" inbox (done, slice 1);
- the full case lifecycle (done, slice 2);
- supervision (done, slice 3);
- administration (slice 4);
- browser e2e (slice 5).

The chat must work for real in two browser windows: the analyst Workspace and the customer simulator.

**Out of scope, and not built anywhere** (no ports, seams or placeholders):
- AI of any kind: copilot, AI agents, judge, decision tree, automated routing tiers, suggestions or drafts;
- a tool catalog or any action on bank systems (blocks, abonos, claims);
- customer or bank data panels (customer file, products, movements, complaints, "who saw what");
- identity verification and security questions;
- approvals and four-eyes;
- the Automatización role and its screens;
- calls, outbound calls, email, WhatsApp;
- analyst-to-analyst transfers;
- the customer mobile app (only the minimal **customer chat simulator** exists, as a dev/demo tool);
- core-banking integration;
- CSAT surveys.

## 2. Sources of truth

- **Visual design:** the Claude Design canvas. A local copy lives in `warehouse/design/source/project/*.dc.html`, with `canvas.json` for board titles and pages. Read the `.dc.html` of the screen you build:
  - its markup holds the layout, spacing and copy;
  - its `renderVals()` script holds the states and sample data;
  - the wrapper boards (`An*`, `Su*`, `Ad*`) set a `view`/`section` prop, and each one is a **state** the real screen must support.

  Only boards for things still in scope apply: the Workspace list and conversation, login/MFA/lockout, the customer chat (`AppSupportChat`), supervision team and queues, audit, and admin users. Ignore every copilot, tools, client-file, identity, approval, call, email and automation board, and every board element of that kind (the support panel, "Siguiente paso", action cards). Where this brief changes a canvas decision (§5.4), the brief wins.
- **Design tokens:** `frontend/src/styles/index.css` (`@theme`). Never hard-code colors. If a token is missing, add it.
- **Data contracts:** `contracts/platform_history.json`, for the event-log envelope only (`event_id, event_type, entity, entity_id, case_id, actor_role, actor_id, event_time, ingested_at, payload`). Its AI entities (`routing_step`, `tool_call`, `copilot_query`, `component`, …) are not produced. `contracts/evaluation.json` is not used by the platform.
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
- **Rule 3 · language (`H1`).** A new case goes to an **available** analyst who **speaks the customer's language**: a Portuguese case only to a Portuguese speaker, never to an available Spanish-only analyst. Among those, the least loaded gets it. If nobody is eligible, the case waits in the language queue and is assigned as soon as an eligible analyst becomes available. Supervision (slice 3) may also assign it by hand, and the same rule applies.
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
  - Clients subscribe to topics: `case:<id>`, `inbox:<staffId>` and `customer:<customerId>`. Supervision topics come in slice 3.
  - Sockets only *signal* changes. REST and the event log stay the source of truth.

### 4.5 Auth (dev mode)
- **Staff sign-in:** no real IdP yet. `POST /api/v1/auth/login` takes email + password from the seeded staff, then the MFA code `000000` in dev. It returns a signed session token (HMAC, configurable secret) carrying the session id, staff id and roles.
- **Lockout:** 5 failed attempts lock the account for 15 minutes (canvas `BoLocked`). Unlocking by hand is administration, in slice 4.
- **Roles:** roles are re-read on every request. Every route declares the roles it allows (`require_roles(...)`).
- **Customer simulator:** it uses `POST /api/v1/customer/sessions` with a seeded customer id. The channel identity is the app or web session. Customer tokens and staff tokens are never interchangeable.

### 4.6 Assignment (the only "routing" there is)
- **One use case, two callers.** `AssignCase` places one case: it assigns it through the `AssignmentStrategy` port, or it leaves it in the language queue with a staff-only banner. It runs inside the Unit of Work that opens the case, and again from `DrainQueue` when an analyst becomes available.
- **The strategy.** `LanguageLeastLoadedStrategy` (rule 3) keeps the available analysts who speak the case language, then picks the minimum of (open cases, last assignment time, staff id).
- **Later seams:** manual assignment and reassignment by a supervisor (slice 3) and a capacity cap (`max_open_cases`). No other seam.
- **No tiers.** There is no judge, tree, agent, `Responder`, routing step or background routing job. Slice 2 deletes them (`api/slice-2-case-lifecycle.md` §1).

### 4.7 Seed data
- **Labeling:** everything is fictitious and clearly labeled "Datos de ejemplo". Names, ids and contact data are **invented**. Never copy customer or staff records from the dataset into committed files.
- **Cases:** chat only (`app_chat`, `web_chat`). Together they cover every inbox status:
  - Nuevos, Por responder and Esperando al cliente;
  - a few Cerrados, inside and outside the 7-day window;
  - a case that reopened after a close;
  - a case waiting in the queue.
- **Staff:** analysts (the main persona is "Daniela Ríos", who speaks Spanish and Portuguese), supervisors and admins, including an **Analista + Supervisora** team lead. The exact seed is in the slice 2 contract §8.

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
- Features import other features only through their `index.ts`. No cross-feature deep imports.
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
- **Case statuses.** There are four, chat only. "Por llamar", "En curso" and "En espera" are gone.

  | Tile | Meaning | Tone token |
  |---|---|---|
  | **Nuevos** | Assigned, not yet opened by the analyst | `accent` (blue) |
  | **Por responder** | The customer wrote last | `warn` (orange) |
  | **Esperando al cliente** | The analyst wrote last | `waiting` (grey) |
  | **Cerrados** | The analyst's own cases closed in the last 7 days; read-only transcripts | new neutral `closed` tone, built on the existing `offline`/`muted` tokens |

  - The status counters **are** the filters: Todos (open cases) · Por responder · Nuevos · Esperando al cliente · Cerrados. There is no second filter row.
  - A case nobody can take yet waits in a queue that only supervision sees (slice 3). It is in no analyst's list.
- **Case card.**
  - A left color stripe shows the status.
  - Top right shows "SLA x", the first-response SLA, only while the first reply is pending. A closed card shows "Cerrado hace x" there instead.
  - The second line is the last message.
  - The bottom line shows priority · channel (App/Web), and the time since the last interaction.
  - A small "Volvió a escribir" tag appears when the case continues a closed one.
- **Workspace: two columns.** The case list (collapsible to a rail) and the conversation. The conversation takes the full remaining width. There is **no right-hand panel**: no Copiloto, Herramientas or Cliente tabs, no customer file, no tool or action cards, no identity card, no call bar, no email layout.
- **Conversation header.**
  - Content: customer name, short case id (copyable), "{país} · {ciudad} · {chat en la app | chat web} · {prioridad | en portugués}", "Datos de ejemplo" and "Cerrar caso".
  - A one-line **"Cómo llegó a ti"** note explains the people-based assignment only: available + language (rule 3) + queue wait.
  - A **"Casos anteriores (n)"** button opens a side sheet with this customer's previous conversations and their read-only transcripts. This is conversation history, not bank data.
- **Close dialog.**
  - A required reason from a fixed list: Resuelto · El cliente no respondió · Duplicado · Fuera de alcance · Otro.
  - An optional internal note.
  - A preview of the notice the customer will see.
- **Customer simulator.** It shows the current conversation, its state ("Buscando a una persona del equipo…", "Te atiende {nombre}", "Conversación terminada") and, on demand, the customer's previous closed conversations. Writing after a close starts a new conversation.
- **Removed and staying removed:**
  - every automation screen; "Por aprobar"; "Herramientas y permisos"; "Políticas y reglas"; "Retención de datos";
  - "Mi rendimiento";
  - analyst-to-analyst transfers;
  - "acceso a datos ocultos";
  - any branch/sucursal channel;
  - the call and email modes.

  The 7-day Cerrados filter is not the old "Mis casos cerrados" screen: it is a read-only filter of the same list.
- **Layout and accessibility.** Desktop-first (1440×900 boards), but it must not break at 1280 width. Keyboard accessible, visible focus, aria labels as in the canvas.

## 6. Quality gates (must pass before a slice is done)
Backend (`cd backend`): `uv run ruff check .` · `uv run ruff format --check .` · `uv run mypy src` · `uv run pytest -q` (includes the OpenAPI staleness check).
Frontend (`cd frontend`): `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm format:check` · `pnpm check:api`.

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
| S4 | **Administration.** Users: create, edit, deactivate/reactivate, unlock a locked account, reset the dev password. Combinable roles (Analista, Supervisora, Administración; at least one). Languages spoken (es, pt). Teams: create, rename, deactivate, membership. Guard rails: nobody removes their own admin role or deactivates themself, and the last active admin cannot be removed. Each change is audited. | `api/slice-4-administration.md` (to write) | next |
| S5 | **Browser e2e + docs.** Playwright scenarios over a fresh backend:<br>• two-window chat;<br>• close and a new linked case;<br>• "Casos anteriores";<br>• queue and drain;<br>• supervisor assignment and reassignment;<br>• admin creates an analyst, who then receives a case;<br>• lockout and unlock.<br>Final READMEs, run book and demo script. | `api/slice-5-e2e.md` (to write) | planned |
