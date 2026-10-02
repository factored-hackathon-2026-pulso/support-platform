# Engineering brief · plataforma de soporte (CC)

Read this before writing any code. Every slice and every reviewer follows it. If something here conflicts with code already in the repo, this brief wins; if it conflicts with the user's latest decisions in the canvas notes below, the canvas notes win and this file must be updated.

Language: code, identifiers, comments and commit messages in English. Everything a user sees in the UI is Spanish (es-CO/es-MX neutral), following the canvas copy. Product docs under `docs/` stay in Spanish.

## 1. Product and scope

LATAM Bank contact-center platform for the **transaction-dispute intake** workflow (hackathon challenge). The platform records how every case is resolved (messages, copilot questions, tool calls, approvals, routing), so the AI team can later plug automated tiers in and the platform can measure and improve them.

Routing tiers, in order: judge (classifies) → decision tree (closes only closed queries the customer confirms; for open problems it mitigates and hands off) → AI agent → human analyst. **Today no AI is connected**: judge/tree/agent are null implementations that hand every case to a human. The architecture must let the AI team plug real implementations in without touching the core (see §4.6).

Roles (combinable; one person can hold several; R2+R3 together triggers four-eyes on admin changes):
- **Analista**: works cases (Workspace).
- **Supervisora**: team and queues, approvals ("Por aprobar"), audit.
- **Automatización**: panorama, decision tree, agents, proposals, sandbox, activation.
- **Administración**: users and roles, tools and permissions, policies, retention.

In scope now: every support-platform screen of the canvas, end to end in the UI, backed by the API. The analyst ↔ customer chat must work for real (two browser windows: analyst Workspace and the customer simulator), with no AI behind it.

Out of scope now (keep the seams, build nothing): call transcription, email channel, the customer mobile app (only a minimal **customer chat simulator** page exists, as a dev/demo tool), real LLM/agents, real core-banking integration, contact transfers, requesting access to hidden data.

## 2. Sources of truth

- Visual design: Claude Design canvas, local copy in `warehouse/design/source/project/*.dc.html` (+ `canvas.json` for board titles/pages). Read the `.dc.html` of the screen you build: the markup holds layout, spacing, copy, and the `renderVals()` script holds states and sample data. Wrapper boards (`An*.dc.html`, `Su*`, `Au*`, `Ad*`) only set a `view`/`section`/`startItem` prop on the main board: each one is a **state** the real screen must support.
- Design tokens: `frontend/src/styles/index.css` (`@theme`). Never hard-code colors; add a token if one is missing.
- Data contracts: `contracts/platform_history.json` (entities the platform emits) and `contracts/evaluation.json` (labels; never exposed to runtime components).
- Policies: `docs/policies.md` (rules 1–11 with IDs R1, R3, H1, R2, B1, AP1, L1, A1, —, R4/H2, A2) and `docs/security_questions.md` (identity verification).
- Sample data reference: `reports/platform/SAMPLE.md`. Do **not** read or commit anything from `data/`, `warehouse/` (except design references), or `guides/`.

## 3. Repository layout

```
hackaton/
  backend/            Python API (own pyproject, uv)
  frontend/           React SPA (pnpm)
  contracts/          JSON data contracts (existing)
  docs/               product docs (existing) + docs/platform/ (this brief, ADRs, API notes)
  docs/platform/adr/  one Markdown file per architecture decision (NNNN-title.md)
```

## 4. Backend

### 4.1 Stack
Python 3.12 (uv, `backend/pyproject.toml`, src layout `backend/src/cc_platform`), FastAPI, Pydantic v2 + pydantic-settings, SQLAlchemy 2.0 (async) with SQLite via aiosqlite by default (Postgres-ready: no SQLite-only SQL), uvicorn, structlog (JSON logs with request/correlation id). Tests: pytest, pytest-asyncio, httpx. Quality: ruff (lint + format), mypy (strict on `domain` and `application`). No Alembic yet: `metadata.create_all` at startup behind a function, documented as a known gap.

### 4.2 Architecture: hexagonal (ports and adapters), DDD-lite, CQRS-lite
```
cc_platform/
  domain/          pure Python: entities, value objects, domain events, domain services, errors. No FastAPI/SQLAlchemy imports.
  application/     use cases (commands and queries), ports (Protocols), DTOs. Depends only on domain.
  infrastructure/  adapters: persistence (SQLAlchemy + in-memory), event bus, realtime hub, bank gateway mock, copilot mock, identity directory, seed data, clock, id generator.
  api/             FastAPI routers per bounded context, request/response schemas, error mapping (RFC 7807 problem+json), auth dependency, websocket endpoint.
  bootstrap/       composition root: builds the container (settings → adapters → use cases). The only place that knows concrete classes.
```
Bounded contexts (one package per context in each layer): `cases` (case, turn, assignment, close), `routing` (tiers, handoff), `identity` (security questions, identity checks), `tools` (catalog, permissions, executions), `approvals`, `policies`, `copilot`, `customers` (customer file read model, masked), `people` (staff users, roles, teams, queues), `audit` (event log queries), `automation` (signals, components registry, proposals, evaluations, activation), `admin` (change requests with four-eyes, retention settings).

Patterns, use them where they fit and name them in docstrings when non-obvious:
- **Repository + Unit of Work** per aggregate; in-memory implementations for tests.
- **Domain events + event bus** (in-process, async). Every state change emits an event; events are **append-only** and persisted to an `event_log` table shaped after `contracts/platform_history.json` (event_time, ingested_at, actor, entity, payload). Audit and the realtime hub subscribe to the bus.
- **Chain of Responsibility** for routing tiers (`Responder` port: judge → tree → ai_agent → human).
- **Strategy** for `CopilotEngine`, `PolicyEngine` rule evaluation, `QuestionSelector`.
- **Command pattern / registry** for tools: each tool is a `ToolHandler` registered by id with a `ToolDefinition` (permission level, confirmation, approval requirements, rules). Executing a tool goes through one use case that checks RBAC, policy decisions, identity requirements and approvals, then calls the handler, verifies the result and records a `tool_call`.
- **State machines** for `Case` status and `Approval` lifecycle (explicit allowed transitions, domain errors on invalid ones).
- **Specification** objects for policy conditions.
- **Optimistic concurrency** on every aggregate: `AggregateRoot.version`, repositories save with a compare-and-set (`WHERE id AND version = :loaded`, then bump) and raise `ConcurrentUpdateError` (409 `concurrent_update`). Commands that are safe to repeat run in `retry_on_conflict` and re-check their rules on fresh state (lockout counters, MFA challenge, and later case status, approvals, assignment). Expensive or side-effecting checks done before the save (hashing, provider calls) are cached across retries. Every state machine relies on this; never write a read-modify-write without it.
- **API boundary**: routers receive an `ApiContext` (use cases grouped by context, `use_cases.<context>.<use_case>`, plus clock, ids, realtime hub, topic policy, health probes, build info). `api` never imports `bootstrap` or `infrastructure` (architecture test).
Keep it pragmatic: no abstraction without a second caller or a documented extension point.

### 4.3 Non-negotiable product rules (enforced in the service layer, never in prose)
- Rule 9 · only verified actions: a bank message may claim an action only if a verified tool call backs it; turns carry `evidenceIds`. The API rejects or flags analyst/agent messages that reference unverified actions only where detectable; tool results are the source of truth for UI "Hecho" states.
- Rule 1 · identity: channel identity (app/web session, registered WhatsApp, IVR) is enough to read movements, open a dispute or block a card. **Security questions are required** before an abono, before changing contact data/password, and before giving account data on a channel without identity (outbound call, email). The identity service selects 2 questions (one registered-data, one activity; a third if one fails; never the disputed charge; never questions whose answer is visible to the person attending), validates answers itself, and **never returns the correct answers**. Store which questions and the result, never the answers.
- Rule 7/8 · abono limits by analyst level (Junior 300.000 / Mid-Senior 800.000 / Senior 1.200.000 / Specialist 1.500.000 COP; other currencies converted with the sample's ratio COP 4000, MXN 18, ARS 350 per USD); over the limit → approval request to a supervisor; the case stays with the requester; 30 min SLA, then reassigned to another supervisor.
- Rule 6 · abono eligibility (charge identified, "Cargo no reconocido", < 3 prior complaints, customer confirmed card possession); abono is always decided by a person, never by an automated tier.
- Rule 5 · card block needs explicit customer confirmation.
- Rule 10 · automated tiers never resolve charges > 1.000.000 COP (or equivalent) or when the customer asks for a person; they hand off with verified facts, actions taken and open questions.
- Rule 11 · regulator complaints: response signed by a supervisor.
- Rule 2 · only the account holder; Rule 3 · Portuguese handled by a Portuguese-speaking person.
All amounts/limits/questions are **synthetic policy** and must be labeled as such in UI copy where the canvas does.

### 4.4 API conventions
- REST under `/api/v1`, JSON with **camelCase** fields (Pydantic alias generator), ISO-8601 UTC timestamps, opaque string ids with a prefix (`CASE-…`, `TRN-…`, `CALL-…`, `APR-…`, `IDC-…`).
- Errors: RFC 7807 `application/problem+json` with a stable `code` (e.g. `identity_verification_required`, `approval_required`, `forbidden`, `invalid_transition`). Every code is a member of `ProblemCode` in `api/problems.py` (one registry: status, title, default detail); `ProblemDetails.code` is that enum in OpenAPI and documented extensions (`remainingAttempts`, `unlockAt`, `requiredRoles`, `errors`) are typed optional fields. The frontend derives its code type from the generated schema, so a new code without regenerated types fails `check:api`. A test fails if an error class declares an unregistered code.
- Commands that create things accept an `Idempotency-Key` header.
- Pagination: cursor based (`?cursor=&limit=`) for lists that can grow (events, audit).
- OpenAPI is the contract for the frontend: a script exports `backend/openapi.json`; the frontend generates types from it (`openapi-typescript`) and uses `openapi-fetch`.
- Realtime: one WebSocket `/api/v1/ws` (auth via the session token as a query param or first message). Server pushes typed envelopes `{type, id, occurredAt, data}` derived from domain events (`turn.created`, `case.updated`, `identity_check.updated`, `tool_call.completed`, `approval.updated`, ...). Clients subscribe to topics (`case:<id>`, `inbox:<staffId>`, `approvals`). Design the copilot stream so it can emit **AG-UI** compatible events later (see ADR on AI UI frameworks).
- Copilot stream (decided in `adr/0002-ai-ui-frameworks.md`): AG-UI 1.0 events over SSE on `POST /api/v1/cases/{caseId}/copilot/runs` (a second transport next to the WebSocket, by design); tool proposals end the run with an AG-UI interrupt and resume after the analyst decides. Human chat, identity checks and approvals stay on REST + WebSocket.

### 4.5 Auth (dev mode)
No real IdP yet. `POST /api/v1/auth/login` (email+password from seeded staff, then MFA code `000000` in dev), returns a signed session token (HMAC, configurable secret) carrying staff id and roles; lockout after 5 failed attempts for 15 minutes (canvas `BoLocked`). Every route declares the roles it allows. The customer simulator uses `POST /api/v1/customer/sessions` with a seeded customer id (channel identity = app session).

### 4.6 Extension points for the AI team (document each in `docs/platform/AI_INTEGRATION.md`)
- `Responder` port + registry: plug judge / tree / ai_agent implementations (in-process or `RemoteResponder` calling an HTTP endpoint). Each returns a `RoutingDecision` (resolved | mitigated | handed_off | abstained) with a structured `Handoff` (verified facts, actions taken, open questions).
- `CopilotEngine` port: current mock answers questions from the customer's data with sources; an LLM engine replaces it.
- Tools are the only way to act: automated tiers call the same tool use case, with the same permissions, policies and approvals as people.
- Components registry (automation context): register component versions (tree branch, agent, tool), sandbox evaluations, activation with rollout %, automatic stop conditions; signals detected from the event log feed proposals.
- Event log export (platform_history shape) for learning and evaluation.

### 4.7 Seed data
Fictitious, clearly labeled "Datos de ejemplo". Reuse the **stories** of the canvas (a web-chat dispute with abono over the limit, a live app chat with an impatient customer, a Portuguese case, an outbound regulator call, etc.) but with **invented names, ids and contact data** — never copy customer records from the dataset into committed files. Amounts and merchants may follow the canvas. Seed staff: invented names too (staff names in the dataset are records as well): analysts (the main persona is a Specialist who speaks Spanish and Portuguese, e.g. "Daniela Ríos"), supervisors, automation and admin users, with the roles and combinations of the canvas (canvas note au3: one person with Automatización + Administración to exercise four-eyes, one with Supervisora + Automatización, and an Analista + Supervisora team lead).

## 5. Frontend

### 5.1 Stack (already scaffolded in `frontend/`)
Vite, React 19, TypeScript (strict), Tailwind v4 with tokens in `src/styles/index.css`, React Router v8 (data router), TanStack Query v5, lucide-react icons, self-hosted fonts (Bricolage Grotesque for display, Schibsted Grotesk for text, IBM Plex Mono for ids). Vitest + Testing Library. oxlint + prettier (config exists). Playwright for e2e (final slice).

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
Rules: features import other features only through their `index.ts`; no cross-feature deep imports. Components stay small and presentational; data fetching lives in hooks; business rules live in `model.ts` and are unit-tested. URL holds shareable state (selected case, filters, open panel tab). No global store unless a real cross-cutting need appears (document it in an ADR).

### 5.3 Data
All screens read from the backend through `openapi-fetch` with generated types. TanStack Query for server state; query keys from a per-feature factory; the realtime client updates the query cache from WebSocket envelopes. Loading, empty and error states are designed, not afterthoughts (canvas has `vacia`, `errorHerramienta`, etc.). Tests mock at the api-module boundary. Sample ("mocked") data lives in the backend seed and is served by real endpoints; the SPA has no client-side fixture layer, no second error type (`ApiProblem` only) and no fake clock. Dates are shown in the viewer's time zone.

### 5.4 Design fidelity and the user's latest decisions (canvas v66 comments)
- Analyst list title is **"Casos"**; never "Mis contactos" or "Te toca".
- Case statuses and colors: Por responder (orange), En curso (green), Nuevos (blue), Por llamar (pink `callout`), En espera (grey `waiting`). The status counters ARE the filters (no duplicate filter row). Each case card: left color stripe = status; top-right "SLA x"; below: priority · channel · request type, and time since last interaction.
- Right support panel is collapsible to an icon rail (Copiloto, Herramientas, Cliente). Copilot answers render as a table with a header; a short "Fuente: …" line; the "Tu equipo pregunta esto seguido…" nudge to tools stays.
- Tools are grouped in three tabs with icons and counts: Acciones · Consultas · Hechas; permissions shown as colored badges with clear copy (e.g. "Verificar identidad y aprobación de la supervisora", "$X · supera tu límite de abono ($1.500.000)", "Con confirmación del cliente").
- Client file: header, signals, "Cómo llegó a ti" (keep), then accordion sections with counts (Productos, Reclamos, Contactos recientes, Contacto, Quién vio qué), one open at a time; while an identity check is open, rows that answer the active questions show "Oculto mientras verificas".
- Identity verification card (abono, outbound call, email), approval flow (pedir → esperando → aprobado/rechazado), outbound-call brief, call bar — follow the canvas states. Calls and email modes: build the layout seams but only the chat mode is functional now.
- Removed screens stay removed: no "Mis casos cerrados", no "Mi rendimiento", no transfers, no "acceso a datos ocultos", no branch/sucursal channel.
- Desktop-first (1440×900 boards) but must not break at 1280 width; keyboard accessible; visible focus; aria labels as in the canvas.

## 6. Quality gates (must pass before a slice is done)
Backend (`cd backend`): `uv run ruff check .` · `uv run ruff format --check .` · `uv run mypy src` · `uv run pytest -q`.
Frontend (`cd frontend`): `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm format:check`.
Every use case and every `model.ts` has unit tests; every router has API tests for the happy path and the main rule violations; every screen has at least a render test of its main states.

## 7. Repo hygiene
Never commit `data/`, `warehouse/`, `guides/`, `.env`, credentials or dataset-derived customer records. Commits: imperative English subject, no co-author trailers. Do not edit `synthetic/`, `pipeline/`, `analysis/`, `contracts/` (read only) unless the slice says so.
