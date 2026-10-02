# ADR 0001 · Backend architecture: hexagonal + CQRS-lite + append-only event log

- Status: Accepted
- Date: 2026-10-02
- Scope: `backend/` (Python API). Frontend structure is covered by the brief (§5).
- Related: `ENGINEERING_BRIEF.md` §4, ADR 0002 (copilot wire protocol), `AI_INTEGRATION.md`.

## Context

The platform must (1) let an analyst work a dispute case with a customer end to end today,
with **no AI connected**; (2) record *how* each case is resolved (messages, copilot questions,
tool calls, approvals, routing) in the shape of `contracts/platform_history.json`, so the AI
team can learn from it and evaluate automated tiers; (3) let the AI team plug a judge, a
decision tree, agents and a real copilot in later **without touching the core**; (4) enforce
product rules (identity checks, abono limits, approvals, verified actions) in code, the same
way for people and for automated tiers.

The team is small, the timeline is a hackathon, and the API contract is consumed by a typed
React frontend. Persistence starts on SQLite but must be Postgres-ready.

## Decision

### 1. Hexagonal architecture (ports and adapters), DDD-lite

```
domain/          entities, value objects, domain events, errors        (no framework imports)
application/     use cases + ports (typing.Protocol) + DTOs             (depends on domain only)
infrastructure/  adapters: SQLAlchemy/in-memory persistence, event bus, realtime hub, security…
api/             FastAPI routers, schemas, problem+json, RBAC dependencies, WebSocket
bootstrap/       settings + composition root (the only place that knows concrete classes)
```

Bounded contexts (`people`, `cases`, `routing`, `identity`, `tools`, `approvals`, `policies`,
`copilot`, `customers`, `audit`, `automation`, `admin`) are packages inside each layer. A
test (`tests/test_architecture.py`) fails the build if `domain` or `application` import a
framework or an outer layer, or if `api` imports an adapter directly.

### 2. CQRS-lite

Commands are use-case classes that open one **Unit of Work**, load aggregates through
repositories, call domain behaviour, save and commit. Queries are separate use cases that
read (today through the same repositories; dedicated read models such as the masked customer
file can be added without touching commands). There is no separate write/read database.

### 3. Domain events + append-only event log + in-process bus

- Aggregates record domain events (`AggregateRoot._record`). Events are immutable dataclasses
  with `event_type`, `entity`, `entity_id`, `case_id`, `actor` (role + id) and `occurred_at`;
  everything else is the payload.
- On `commit` the Unit of Work (Template Method in `BaseUnitOfWork`) wraps each event as an
  `EventRecord` (`EVT-…` id + `ingested_at`), **appends it to `event_log` in the same
  transaction** as the state change, commits, and then publishes the records on the event bus.
  Events of one transaction keep the order in which they were recorded, across aggregates
  and loose `record` calls (a process-wide recording stamp on `AggregateRoot`).
  The log can never miss a committed change, and subscribers only see committed facts.
- `event_log` mirrors the contract envelope: `event_id, event_type, entity, entity_id,
  case_id, actor_role, actor_id, event_time, ingested_at, payload` plus a monotonically
  increasing `sequence` for cursor pagination and export. Rows are never updated.
- Subscribers (realtime projector today; audit projections, signal detectors and evaluation
  exporters later) are isolated: a failing handler is logged and does not affect others.

### 4. Realtime as a projection of the bus

`RealtimeProjector` maps each committed event to topics (`case:<id>` by default, plus rules
registered per event type, e.g. `inbox:<staffId>`, `approvals`) and pushes typed envelopes
`{type, id, occurredAt, data}` through the `RealtimeHub` port to WebSocket subscribers.
Topic access is decided by `TopicAccessPolicy`. Sockets only *signal* changes; REST and the
event log remain the source of truth.

### 5. Errors and API conventions

Domain/application errors carry a stable `code`; `api/errors.py` is the single place that maps
codes to HTTP statuses and renders RFC 7807 `application/problem+json`. The OpenAPI document
is post-processed so every error response is declared as problem+json, and it is exported to
`backend/openapi.json` (a test fails when it is stale) for the frontend's generated types.

### 6. Security (dev mode)

Password (Argon2id) → MFA challenge → session. Sessions are stored (revocable on logout) and
referenced by an HMAC-signed token (JWT HS256) carrying session id, staff id and roles.
Roles are re-read from the directory on every request. Expiry is checked against the
injectable `Clock`. Every route declares its roles with `require_roles(...)`.

### Patterns used (and where)

| Pattern | Where |
|---|---|
| Repository + Unit of Work | `application/ports/unit_of_work.py`, `infrastructure/persistence/*` |
| Template Method | `BaseUnitOfWork` (event pipeline shared by SQL and in-memory UoWs) |
| Observer (pub/sub) | `InProcessEventBus`, realtime projector |
| Registry | `TopicMapper` rules, `ResponderRegistry`; later `ToolRegistry`, `ComponentRegistry` |
| Chain of Responsibility | `Responder` tiers judge → tree → ai_agent → human (`RouteCase`, slice 1) |
| Strategy | `AssignmentPolicy`, `SlaPolicy`, `CopilotEngine`, `PasswordHasher`, `MfaVerifier`, policy rules (later) |
| Process manager | `RoutingProcessManager` (`case.opened` → route, analyst available → drain queue) |
| Command | `ToolHandler` + one execute-tool use case (tools slice) |
| State machine | `MfaChallenge`, `StaffSession`, `Case`; `Approval` later |
| Composition root | `bootstrap/container.py` |

## Alternatives considered

- **Layered MVC (routers → services → ORM models).** Fastest to start, but FastAPI/SQLAlchemy
  leak into business rules, the rules become hard to test without a database, and the AI team
  would plug into service internals instead of stable ports. Rejected.
- **Full event sourcing (state rebuilt from events).** Gives the history for free, but adds
  projections, snapshots and versioned upcasting for every aggregate: too much for the
  timeline. We keep state tables *and* an append-only log written in the same transaction,
  which gives the AI team the history without event-sourcing the aggregates.
- **Transactional outbox + broker (Kafka/Redis streams).** The right next step for multiple
  processes. Today one process suffices; the `EventBus` and `RealtimeHub` ports let us add a
  relay later without changing use cases.
- **ORM-mapped domain entities (SQLAlchemy declarative on domain classes).** Less mapping code,
  but couples the domain to SQLAlchemy and makes in-memory tests depend on ORM state. We map
  explicitly with SQLAlchemy Core in repositories.
- **A DI framework (dependency-injector, punq).** A small explicit composition root is easier to
  read and type-check; revisit if wiring grows unwieldy.

## Consequences

- Positive: business rules are testable in milliseconds with the in-memory Unit of Work
  (contract tests run the same scenarios on both adapters); adapters are swappable (SQLite →
  Postgres, in-process hub → Redis, dev MFA → real provider); every state change is in the
  log with actor and timestamps, ready for audit and AI learning; the AI team plugs in through
  documented ports.
- Negative: more files and explicit mapping code than a CRUD app; the single `UnitOfWork`
  protocol grows one repository per aggregate; events are published in-process after commit
  (a crash between commit and publish drops that realtime signal, never the log entry).
- Follow-ups: Alembic migrations when the schema stabilises; broker-backed hub/outbox relay
  for multi-worker deployments; real MFA/IdP adapter before any production use.
