# CC Platform API (backend)

FastAPI service of the LATAM Bank support platform: support staff (Analista, Supervisora,
Administración) and customers talk by chat. Hexagonal (ports and adapters) + DDD-lite +
CQRS-lite with an append-only event log.

Read first: `docs/platform/ENGINEERING_BRIEF.md` (scope, rules, conventions),
`docs/platform/adr/0001-architecture.md`, and the slice contracts in `docs/platform/api/`
(slice 2 case life cycle, slice 3 supervision, slice 4 administration; a later slice wins).
Operating the app (accounts, reset, troubleshooting) is in `docs/platform/RUNBOOK.md`.

## Run

Requires [uv](https://docs.astral.sh/uv/); it installs Python 3.12 (`.python-version`).

```bash
cd backend
uv sync          # runtime + dev dependencies into .venv
uv run cc-api    # http://127.0.0.1:8000 (reloads on code changes when CC_ENV=dev, the default)
```

- Swagger UI: http://127.0.0.1:8000/api/v1/docs · OpenAPI JSON: `/api/v1/openapi.json` ·
  health: `GET /api/v1/health` · build info: `GET /api/v1/meta`.
- Data lives in `backend/cc_platform.db` (SQLite, git-ignored). The first start creates the
  schema and seeds the demo data; the seed only inserts what is missing. Delete the file to
  reset, or run with `CC_PERSISTENCE=memory`.
- Configuration: `CC_*` environment variables or `backend/.env` (template `.env.example`,
  source `src/cc_platform/bootstrap/settings.py`, table in the runbook §4).
- Seeded staff all use the password `demo1234` and the MFA code `000000`, e.g.
  `daniela.rios@latambank.example` (analyst), `lucia.herrera@latambank.example` (supervisor),
  `valeria.quintero@latambank.example` (admin), `felipe.echeverri@latambank.example` (analyst +
  supervisor). The full table, the seeded cases and the simulator customers are in the runbook §5.
  Nobody starts available: the seeded language queues hold cases nobody available could take.

Sign-in from the command line:

```bash
curl -s localhost:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"daniela.rios@latambank.example","password":"demo1234"}'        # → challengeId
curl -s localhost:8000/api/v1/auth/mfa -H 'content-type: application/json' \
  -d '{"challengeId":"MFA-…","code":"000000"}'                                  # → token
curl -s localhost:8000/api/v1/auth/me -H 'Authorization: Bearer <token>'
```

The customer simulator needs no password: `POST /api/v1/customer/sessions` with
`{"customerId":"CUS-00000000000000000000002004"}` returns a customer token.

## Endpoints

All under `/api/v1`. Every staff route declares its roles (`require_roles`); roles are
re-read on every request.

| Context | Routes | Who |
|---|---|---|
| System | `GET /health`, `GET /meta` | anyone |
| Auth | `POST /auth/login`, `POST /auth/mfa`, `POST /auth/logout`, `GET /auth/me` | staff |
| Availability | `GET\|PUT /me/availability` (Disponible / En pausa) | analyst |
| Cases | `GET /cases/inbox?status=&q=` (`closed` = last 7 days), `GET /cases/{id}`, `GET /cases/{id}/history`, `GET\|POST /cases/{id}/turns`, `POST /cases/{id}/read`, `POST /cases/{id}/close` (`{reason, note}`) | analyst; supervisors read any case (audited `case.viewed`) |
| Customer simulator | `GET /customer/demo-customers`, `POST /customer/sessions`, `GET /customer/conversation`, `POST /customer/conversation/turns`, `GET /customer/conversations`, `GET /customer/conversations/{id}` | customer token |
| Supervision | `GET /supervision/team`, `GET /supervision/queues`, `PUT /supervision/cases/{id}/assignee` (`{analystId, expectedAnalystId, confirmPaused}`) | supervisor |
| Audit | `GET /audit/events` (filters `actorKind, actorId, caseId, family, changesOnly, from, to, q`, cursor), `GET /audit/events/{id}` | supervisor, admin |
| People | `GET /staff?role=&includeInactive=` | supervisor, admin |
| Administration | `GET\|POST /admin/users`, `GET\|PATCH /admin/users/{id}`, `POST /admin/users/{id}/deactivate\|reactivate\|unlock\|password-reset`, `GET\|POST /admin/teams`, `GET\|PATCH /admin/teams/{id}`, `POST /admin/teams/{id}/deactivate\|reactivate` | admin |

Product rules enforced in the service layer (brief §4.3):

- **Rule 3 (language, `H1`).** A new case goes to an available analyst who speaks the
  customer's language, the least loaded first (`AssignCase` + `LanguageLeastLoadedStrategy`).
  Otherwise it waits in its language queue (first in, first out) and `QueueDrainer` assigns it
  when an eligible analyst becomes available. Manual assignment applies the same rule; a paused
  target needs `confirmPaused`.
- One open case per customer; a message after a close opens a new case with `previousCaseId`.
- Only the assignee writes; a closed case is read-only. A close needs a reason from a fixed
  list; the customer sees a notice, never the reason. Staff banners never reach customers.
- Administration guard rails: nobody removes their own Administración, deactivates themself or
  resets their own password (`422 self_change_forbidden`); there is always an active admin
  (`409 last_admin`); administration never moves cases (`409 staff_has_open_cases` until
  supervision reassigns them). Creating a person or resetting a password returns a temporary
  password once (`Cache-Control: no-store`, only its hash is stored).
- Lockout: 5 failed attempts (wrong passwords and wrong MFA codes) lock the account for 15
  minutes (`423 account_locked` with `unlockAt`); an admin can unlock it.

## API conventions

- camelCase JSON, ISO-8601 UTC timestamps, prefixed opaque ids (`CASE-…`, `TRN-…`, `ASG-…`,
  `CUS-…`, `STF-…`, `TEAM-…`, `EVT-…`).
- Errors are RFC 7807 `application/problem+json` with a stable `code` and a `requestId`. Every
  code is a member of `ProblemCode` (`api/problems.py`, one registry of status and title),
  published in `openapi.json`, so the frontend's `pnpm check:api` catches drift.
  `409 concurrent_update` means another request saved first: reload and retry. Edits in
  administration carry `expectedVersion`; a stale one is `409 version_conflict` with the
  current record.
- Commands that create things take an `Idempotency-Key` header (chat turns use it as the
  `clientMessageId`); a replay answers `200` + `Idempotent-Replayed: true`.
- Lists that grow use cursor pagination (`cursor`, `limit`); invalid cursors are `422`.
- Every response carries `X-Request-ID` / `X-Correlation-ID`. Logs are structlog JSON (or
  `CC_LOG_FORMAT=console`); SQL bind values, password hashes and tokens are never logged.

## Realtime

One WebSocket: `ws://localhost:8000/api/v1/ws?token=<staff session token | customer token>`.
Send `{"action":"subscribe","topic":"…"}` (also `unsubscribe`, `ping`); receive
`{type, id, occurredAt, data}` envelopes whose payloads equal the REST schemas. Sockets only
signal changes: REST and the event log stay the source of truth.

| Topic | Who | Envelopes |
|---|---|---|
| `case:<caseId>` | assignee, supervisors | `turn.created`, `case.updated` |
| `inbox:<staffId>` | that analyst | `case.updated`, `case.assigned`, `case.unassigned`, `inbox.counts`, `availability.updated` |
| `customer:<customerId>` | that customer | `turn.created`, `conversation.updated` |
| `supervision:queues`, `supervision:team` | supervisors | `queue.updated`, `queue.case_queued`, `team.updated` |
| `admin:directory` | admins | `directory.updated` |
| `staff:<staffId>` | that person | `me.updated` |

Close codes: `4401` sign in again (bad or expired token, logout, deactivation, password reset);
`4409` the person's roles changed (refetch `/auth/me` and reconnect at once).

## Layout

```
src/cc_platform/
  domain/          pure Python: entities, value objects, events, errors (people, customers, cases, shared)
  application/     use cases (commands and queries), ports (Protocols), DTOs, realtime topics
  infrastructure/  adapters: SQLAlchemy + in-memory persistence, event bus, realtime hub,
                   Argon2, HMAC tokens, dev MFA, structlog, seed data, clock, ids
  api/             FastAPI routers per context, schemas, problem+json, auth/RBAC, WebSocket
  bootstrap/       settings, composition root (container), app factory, cc-api entry point
  scripts/         export_openapi
tests/             domain, application, infrastructure, api, architecture, openapi
```

`tests/test_architecture.py` enforces the layering: `api` never imports `bootstrap` or
`infrastructure`; routers get an `ApiContext` (use cases grouped by context, clock, ids,
realtime hub, topic policy, health probes, build info).

**Concurrency.** Every aggregate has a `version`; repositories save with a compare-and-set
(`UPDATE … WHERE id = :id AND version = :loaded`) and raise `ConcurrentUpdateError`. Commands
that are safe to repeat run inside `retry_on_conflict` (`application/concurrency.py`) and
re-check their rules on fresh state. New aggregates get this by extending
`VersionedRepository` / `_StagedRepository`.

**Event log.** Every state change emits a domain event, stored in `event_log` (the
`contracts/platform_history.json` envelope) in the same transaction, then published in-process
to the realtime projectors and process managers. The seed writes its story through the domain,
in story-time order (`infrastructure/seed/`).

## Quality gates

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src            # strict on cc_platform.domain and cc_platform.application
uv run pytest -q           # includes the OpenAPI staleness check
```

## OpenAPI contract

```bash
uv run python -m cc_platform.scripts.export_openapi          # writes backend/openapi.json
uv run python -m cc_platform.scripts.export_openapi --check  # fails if stale
```

Regenerate after every API change, then run `pnpm gen:api` in `frontend/`.

## Known gaps

- **No migrations.** `metadata.create_all` runs at startup. A database created by an older
  build fails fast with `OutdatedSchemaError` (it names the missing tables or columns): delete
  `cc_platform.db` and restart.
- Dev-only security: MFA code `000000`, HMAC session tokens; `CC_ENV=prod` refuses to start
  until a real MFA provider exists. Temporary passwords travel in the response body; no forced
  change at first sign-in and no password policy.
- Single process: the realtime hub, the event bus and the queue drain run in-process (one
  worker). If the process dies between commit and publish, sockets miss that signal (clients
  refetch on reconnect); a drain that never ran waits for the next availability change.
- WebSocket auth uses the `?token=` query parameter (redacted in logs).
- Customer tokens are stateless (8 h, no revocation); anyone can pick a seeded customer in the
  simulator, which is a dev/demo tool.
- No per-IP throttling. Unknown emails get the same lockout answers as real accounts, but those
  counters are process-local and reset on restart.
- No presence: availability persists across sign-ins, so an available analyst who closes the
  browser keeps receiving cases. "Signed in" in supervision means an active session. No
  capacity cap per analyst yet.
- Live cases open with priority `medium`; only the seed varies it.
- Accepted assignment races (slice 2 §3.1, slice 3 §3.9): two cases opened at the same instant
  may pick the same least-loaded analyst; an analyst who pauses, is deactivated or loses a
  language at that instant may still get one (supervision reassigns it).
- The directory (`GET /admin/users`) is not paginated (at most 500 rows, filtered in memory).
- Team renames do not rewrite old audit payloads; no deletion of people or teams.
- In-memory SQLite (`sqlite+aiosqlite:///:memory:`) shares one connection between Units of
  Work; use a file database or `CC_PERSISTENCE=memory`.
