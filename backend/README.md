# CC Platform API (backend)

FastAPI service for the LATAM Bank contact-center platform (transaction-dispute intake).
Architecture: hexagonal (ports and adapters) + DDD-lite + CQRS-lite with an append-only event
log. See `docs/platform/ENGINEERING_BRIEF.md`, `docs/platform/adr/0001-architecture.md` and
`docs/platform/AI_INTEGRATION.md`.

## Requirements

- [uv](https://docs.astral.sh/uv/) (Python 3.12 is pinned in `.python-version`; uv installs it).

## Run

```bash
cd backend
uv sync                      # install runtime + dev dependencies
uv run cc-api                # http://127.0.0.1:8000 (auto-reload when CC_ENV=dev)
# equivalent:
uv run uvicorn cc_platform.bootstrap.app:create_app --factory --port 8000
```

- Swagger UI: http://127.0.0.1:8000/api/v1/docs · OpenAPI JSON: `/api/v1/openapi.json`
- Health: `GET /api/v1/health` · Build info: `GET /api/v1/meta`
- Data lives in `backend/cc_platform.db` (SQLite, git-ignored). Delete the file to reset.
  `CC_PERSISTENCE=memory` runs without any database.
- Configuration: environment variables with the `CC_` prefix (or `backend/.env`); see
  `.env.example` and `src/cc_platform/bootstrap/settings.py`.

## Sign in (development)

Seeded staff are fictitious ("Datos de ejemplo"). Every account uses the password
**`demo1234`**, and the MFA code is always **`000000`**.

| Persona | Email | Roles | Level | Languages |
|---|---|---|---|---|
| Daniela Ríos (main analyst) | `daniela.rios@latambank.example` | analyst | Specialist | es, pt |
| Julián Ortega | `julian.ortega@latambank.example` | analyst | Junior | es |
| Paula Medina | `paula.medina@latambank.example` | analyst | Mid-Senior | es |
| Sebastián Cárdenas | `sebastian.cardenas@latambank.example` | analyst | Senior | es, pt |
| Lucía Herrera | `lucia.herrera@latambank.example` | supervisor | Specialist | es, pt |
| Martín Salazar | `martin.salazar@latambank.example` | supervisor | Senior | es |
| Valeria Quintero (four-eyes) | `valeria.quintero@latambank.example` | automation + admin | Senior | es |
| Tomás Arango | `tomas.arango@latambank.example` | automation | Senior | es, pt |
| Carolina Peña | `carolina.pena@latambank.example` | admin | Senior | es |
| Renata Villalba | `renata.villalba@latambank.example` | supervisor + automation | Specialist | es, pt |
| Felipe Echeverri (team lead) | `felipe.echeverri@latambank.example` | analyst + supervisor | Senior | es |

Multi-role personas exercise the role switcher: Renata (Supervisora ↔ Automatización, canvas
note `au3`), Felipe (Workspace ↔ "Por aprobar") and Valeria (Automatización ↔ Administración,
four-eyes on admin changes).

```bash
# 1) password → MFA challenge
curl -s localhost:8000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"daniela.rios@latambank.example","password":"demo1234"}'
# 2) challenge + code → session token
curl -s localhost:8000/api/v1/auth/mfa -H 'content-type: application/json' \
  -d '{"challengeId":"MFA-…","code":"000000"}'
# 3) use it
curl -s localhost:8000/api/v1/auth/me -H 'Authorization: Bearer <token>'
```

Five consecutive failed attempts lock the account for 15 minutes (`423 account_locked` with
`unlockAt`). Wrong passwords **and wrong MFA codes** both count (a correct password does not
reset the counter; only a completed sign-in does), so logging in again never buys fresh MFA
guesses. Wrong passwords return `remainingAttempts`; wrong MFA codes too (3 per challenge,
capped by the account countdown). Parallel requests are counted one by one (optimistic
locking), so batching guesses does not bypass the lock, and a challenge is redeemed once.

## API conventions

- REST under `/api/v1`, camelCase JSON, ISO-8601 UTC timestamps (`…Z`), prefixed opaque ids
  (`STF-…`, `CASE-…`, `EVT-…`).
- Errors are RFC 7807 `application/problem+json` with a stable `code` plus `requestId`. The
  codes are the `ProblemCode` enum (`src/cc_platform/api/problems.py`, one registry with the
  status and title of each), published in `openapi.json`; the frontend derives its code type
  from it, so `pnpm check:api` catches drift. `409 concurrent_update` means another request
  changed the same record first: reload and retry. Unexpected errors are `500 internal_error`
  problems that still carry CORS headers, so the browser can read them.
- Every response carries `X-Request-ID` / `X-Correlation-ID` (accepted from the client).
- Realtime: `ws://localhost:8000/api/v1/ws?token=<session token>`; send
  `{"action":"subscribe","topic":"case:CASE-…"}` (also `inbox:STF-…`, `approvals`),
  `unsubscribe`, `ping`; receive `{type,id,occurredAt,data}` envelopes. Close code 4401 means
  "sign in again" (bad token, logout, expiry).

## Quality gates

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src            # strict on cc_platform.domain and cc_platform.application
uv run pytest -q
```

## OpenAPI contract for the frontend

```bash
uv run python -m cc_platform.scripts.export_openapi          # writes backend/openapi.json
uv run python -m cc_platform.scripts.export_openapi --check  # CI: fails if stale
```

`tests/test_openapi.py` fails when `openapi.json` is out of date, so regenerate and commit it
with every API change. The frontend generates its types from it (`openapi-typescript`).

## Layout

```
src/cc_platform/
  domain/          pure Python: entities, value objects, events, errors (shared kernel + contexts)
  application/     use cases, ports (Protocols), DTOs; realtime topics/projection; AI ports
  infrastructure/  adapters: SQLAlchemy + in-memory persistence, event bus, realtime hub,
                   Argon2, HMAC tokens, dev MFA, structlog, seed data, clock, ids
  api/             FastAPI routers, schemas, problem+json, auth/RBAC dependencies, WebSocket
  bootstrap/       settings, composition root (container), app factory, cc-api entry point
  scripts/         export_openapi
tests/             unit (domain, application, infrastructure), api, architecture, openapi
```

Layering is enforced by `tests/test_architecture.py`; `api` may not import `bootstrap` or
`infrastructure`. Routers get an `ApiContext` (use cases grouped by context, clock, ids,
realtime hub, topic policy, health probes, build info), never the container or adapters.

## Concurrency (optimistic locking)

Every aggregate has a `version`. Repositories save with a compare-and-set
(`UPDATE … WHERE id = :id AND version = :loaded`, then `version + 1`; the in-memory adapter
checks the same at commit) and raise `ConcurrentUpdateError` when another request saved
first. Commands that are safe to repeat run inside `retry_on_conflict`
(`application/concurrency.py`) and re-evaluate their rules on fresh state; otherwise the API
answers `409 concurrent_update`. New aggregates (cases, approvals, assignments) get this by
extending `_VersionedRepository` / `_StagedRepository`; their state machines then cannot
lose updates.

## Known gaps

- No migrations yet: `metadata.create_all` runs at startup (Alembic comes with the first
  schema change that needs data preservation). A database created by an older build fails
  fast at startup (`OutdatedSchemaError` lists the missing columns): delete `cc_platform.db`
  and restart.
- Dev-only MFA (`000000`) and HMAC session tokens; `CC_ENV=prod` refuses to start until a
  real MFA provider adapter exists.
- The realtime hub is in-process (single API worker). Scale-out needs a broker-backed hub
  behind the same `RealtimeHub` port.
- Events are published after commit, in-process. If the process dies between commit and
  publish, sockets miss that signal (the event log still has it; clients refetch on reconnect).
- No per-IP throttling yet. Unknown emails get the same `remainingAttempts` countdown and 423
  lock as real accounts (anti-enumeration: same domain `FailedAttemptCounter`, stored through
  the async `UnknownLoginAttempts` port), but those counters are process-local (bounded LRU)
  and reset on restart; they are not written to the event log.
- WebSocket auth uses the `?token=` query parameter (redacted in logs). First-message auth
  (brief §4.4) can be added as an alternative without breaking clients.
- `Idempotency-Key` handling arrives with the first create-command endpoints (cases, turns).
