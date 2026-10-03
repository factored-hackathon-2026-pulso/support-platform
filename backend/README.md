# CC Platform API (backend)

FastAPI service for the LATAM Bank support platform: support staff and customers talk by chat.
Architecture: hexagonal (ports and adapters) + DDD-lite + CQRS-lite with an append-only event
log. See `docs/platform/ENGINEERING_BRIEF.md`, `docs/platform/adr/0001-architecture.md` and the
current slice contract, `docs/platform/api/slice-4-administration.md` (slices 2 and 3,
`slice-2-case-lifecycle.md` and `slice-3-supervision.md`, still hold where slice 4 does not
change them).

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
- **After pulling slice 4, delete `backend/cc_platform.db`** (or run with
  `CC_PERSISTENCE=memory`): the schema changed (new `teams` and `admin_roster` tables,
  `staff.team` → `staff.team_id`, new `staff.created_at` / `staff.creation_key`) and there
  are no migrations. An old database fails fast at startup (`OutdatedSchemaError` lists the
  missing tables and columns), and the seed never rewrites existing rows.
- Configuration: environment variables with the `CC_` prefix (or `backend/.env`); see
  `.env.example` and `src/cc_platform/bootstrap/settings.py`.

## Sign in (development)

Seeded staff are fictitious ("Datos de ejemplo"). Every account uses the password
**`demo1234`**, and the MFA code is always **`000000`**.

| Persona | Email | Roles | Languages | Team | Starts |
|---|---|---|---|---|---|
| Daniela Ríos (main analyst) | `daniela.rios@latambank.example` | analyst | es, pt | Disputas · Equipo Andes | paused (switch to "Disponible") |
| Julián Ortega | `julian.ortega@latambank.example` | analyst | es | Disputas · Equipo Andes | paused, **signed in** (seeded session) |
| Paula Medina | `paula.medina@latambank.example` | analyst | es | Disputas · Equipo Pacífico | paused (before Lucía moved 114) |
| Sebastián Cárdenas | `sebastian.cardenas@latambank.example` | analyst | es, pt | Disputas · Equipo Pacífico | paused |
| Tomás Arango | `tomas.arango@latambank.example` | analyst | es, pt | Disputas · Equipo Pacífico | paused |
| Lucía Herrera | `lucia.herrera@latambank.example` | supervisor | es, pt | Disputas · Equipo Andes | — |
| Martín Salazar | `martin.salazar@latambank.example` | supervisor | es | Disputas · Equipo Pacífico | — |
| Renata Villalba | `renata.villalba@latambank.example` | supervisor | es, pt | Disputas · Equipo Pacífico | — |
| Felipe Echeverri (team lead) | `felipe.echeverri@latambank.example` | analyst + supervisor | es | Disputas · Equipo Andes | paused |
| Valeria Quintero | `valeria.quintero@latambank.example` | admin | es | Administración de la plataforma | — |
| Carolina Peña | `carolina.pena@latambank.example` | admin | es | Administración de la plataforma | — |
| Mariana Duque | `mariana.duque@latambank.example` | supervisor | es | Disputas · Equipo Pacífico | **locked** until 13 min after the first start (five wrong passwords); an admin unlocks her |
| Andrés Villamil | `andres.villamil@latambank.example` | analyst | es | Disputas · Equipo Andes | **inactive** (Carolina deactivated him); cannot sign in |

Roles combine (Analista, Supervisora, Administración). Felipe exercises the role switcher
(Casos ↔ Equipo y colas). Teams are records (`TEAM-…` ids): the three above, plus the
inactive "Disputas · Equipo Caribe" (no members). The admin story in the audit (family
"Administración"): Valeria gave Felipe Supervisora (5 days before the first start), created
the Caribe team (3 days) and deactivated it (1 day); Carolina deactivated Andrés (2 days).
Signed in as Valeria, the rail shows "Usuarios y roles, 1 pendiente" (Mariana's lock).

Julián has a seeded staff session (started 45 minutes before the first start, normal TTL) and
paused 20 minutes before it, so "Equipo y colas" shows him **En pausa** (paused and signed
in) rather than Desconectada. When that session expires he becomes Desconectada (delete the
database to re-anchor).

Availability ("Disponible" / "En pausa"): **nobody starts available**. The seeded queues hold
cases nobody available could take (rule 3), so an available Spanish or Portuguese speaker would
contradict them: Daniela paused 12 minutes before the first start, right after her last new
case and before the queued cases arrived (Paula paused at T−33m, Julián at T−20m; each pause is
in the audit). To start the demo, sign in as Daniela and switch to "Disponible"
(`PUT /api/v1/me/availability`): the queues drain to her, oldest first, and new chats then land
on her. Until someone is available, a new chat waits in its language queue (supervisors can
assign it). Sign in as Sebastián or Tomás (es, pt, no cases) and switch to "Disponible" too to
see least-loaded balancing.

## Seeded cases and the customer chat simulator

Every case is a chat (`app_chat` / `web_chat`), with invented people ("Datos de ejemplo").
Daniela's "Casos": **Todos 5 · Por responder 2 · Nuevos 2 · Esperando al cliente 1 ·
Cerrados 3**. Besides her inbox:

- **Queues:** three cases wait, all opened after Daniela paused. "Cola en español": Rosa (111,
  SLA due in 4 min, at risk) and Mauricio (112, high priority, SLA overdue); "Cola en
  portugués": Gabriela (109). The rail badge shows 3. Startup runs no drain: a supervisor
  assigns them by hand, or switching Daniela (or Sebastián/Tomás) to "Disponible" drains them.
  Each language queue is first in, first out: a new chat never jumps an older case of its
  language (`AssignCase` serves the queue first).
- **Julián** (En pausa) holds two open cases: Camila (113, Por responder, SLA overdue) and
  Esteban (114, Esperando al cliente), which Lucía reassigned to him from Paula. Lucía has a
  seeded supervision view of 113, so the audit shows the access family.
- **History:** Patricia (Nuevos, "Volvió a escribir") has two earlier cases: one closed by
  Daniela two days ago and one closed by Julián twenty days ago (outside the 7-day Cerrados
  window). "Casos anteriores (2)" lists both; Daniela reads Julián's case read-only.
- **Reopen:** write as Claudia or Héctor (closed cases) in the simulator: a new case opens,
  linked to the closed one (`previousCaseId`), and is assigned normally.

Times are relative to the **first** start (delete `cc_platform.db`, or use
`CC_PERSISTENCE=memory`, to re-anchor them). Every seeded arrival agrees with rule 3 and the
least-loaded choice at its time, and the seed writes the whole event log in story-time order
(`infrastructure/seed/timeline.py`), so the audit lists it as it happened. Team-generated values: the first-response SLA
(high 5 min · medium 15 min · low 60 min), the 7-day Cerrados window, the queue names and
the close reasons.

The simulator (`/cliente` in the SPA) chats as a seeded customer, no password:

```bash
curl -s localhost:8000/api/v1/customer/demo-customers          # picker (no auth)
curl -s localhost:8000/api/v1/customer/sessions -H 'content-type: application/json' \
  -d '{"customerId":"CUS-00000000000000000000002004"}'           # Rafael (pt-BR) → token
curl -s localhost:8000/api/v1/customer/conversation/turns -H 'Authorization: Bearer <token>' \
  -H 'Idempotency-Key: 6b0e…' -H 'content-type: application/json' \
  -d '{"text":"Olá, não reconheço uma compra","clientMessageId":"6b0e…"}'
```

The first message opens a case and assigns it **in the same request** (`AssignCase`): an
available analyst who speaks the customer's language (rule 3: Portuguese only to a
Portuguese speaker, `H1`), the least loaded first. If nobody is eligible, the case waits in
the language queue (`waiting_agent`) and `QueueDrainer` assigns it as soon as an eligible
analyst becomes available. When the analyst closes the case (with a reason; the customer
only sees a closing notice), the customer's next message opens a new linked case.

Supervision (Supervisora; slice 3): `GET /supervision/team` (analysts by team, what each
one is doing now, load, longest wait, open cases), `GET /supervision/queues` (both language
queues, oldest first), `PUT /supervision/cases/{caseId}/assignee`
(`{analystId, expectedAnalystId, confirmPaused}`: assign a queued case or reassign an open
one; rule 3 applies, a paused target needs `confirmPaused`, a stale `expectedAnalystId` is
`409 assignment_changed`, the current assignee is a `200` no-op). A supervisor reads any case
through `GET /cases/{caseId}` read-only; that read is audited as `case.viewed` (at most once
per 15 minutes per supervisor and case). Audit (Supervisora, Administración):
`GET /audit/events?actorKind=&actorId=&caseId=&family=&changesOnly=&from=&to=&q=&cursor=&limit=`
(newest first, cursor pagination, a Spanish description per event, message text redacted)
and `GET /audit/events/{eventId}`.

```bash
curl -s -X PUT localhost:8000/api/v1/supervision/cases/CASE-00000000000000000000000109/assignee \
  -H 'Authorization: Bearer <Lucía token>' -H 'content-type: application/json' \
  -d '{"analystId":"STF-00000000000000000000000004","expectedAnalystId":null,"confirmPaused":true}'
```

Analyst endpoints: `GET /cases/inbox?status=&q=` (`status=closed` = the last 7 days),
`GET /cases/{caseId}`, `GET /cases/{caseId}/history`, `GET|POST /cases/{caseId}/turns`,
`POST /cases/{caseId}/read`, `POST /cases/{caseId}/close` (`{reason, note}`),
`GET|PUT /me/availability`. Customer endpoints: `GET /customer/demo-customers`,
`POST /customer/sessions`, `GET /customer/conversation`, `POST /customer/conversation/turns`,
`GET /customer/conversations`, `GET /customer/conversations/{caseId}`. The full contract is
`docs/platform/api/slice-2-case-lifecycle.md` (slice 1 rules it does not change still hold) and
`slice-3-supervision.md`.

Administration (Administración; slice 4): `GET|POST /admin/users`
(`?q=&role=&status=active|locked|inactive|all&teamId=&language=`, with role and status
counts), `GET|PATCH /admin/users/{staffId}` (`{expectedVersion, name?, email?, roles?,
languages?, teamId?}`), `POST /admin/users/{staffId}/deactivate|reactivate`
(`{expectedVersion}`), `POST /admin/users/{staffId}/unlock`,
`POST /admin/users/{staffId}/password-reset`, `GET|POST /admin/teams`,
`GET|PATCH /admin/teams/{teamId}`, `POST /admin/teams/{teamId}/deactivate|reactivate`.
Every edit carries `expectedVersion`; a stale one is `409 version_conflict` with
`currentVersion` and `current` (the record as its GET returns it). Creating a person or a
password reset returns a **temporary password once** (`xxxx-xxxx-xxxx`, `Cache-Control:
no-store`; only its hash is stored, never logged or audited); the new person signs in with
it and the MFA code `000000`. Both creates take an `Idempotency-Key` (a retry answers `200`
+ `Idempotent-Replayed: true`, with `temporaryPassword: null` for a person). A password
reset or a deactivation ends her sessions **and cancels her pending MFA challenges**, so a
sign-in that already passed the password step (the old password) cannot finish
(`401 mfa_challenge_invalid`), even if she is reactivated within the challenge's 5 minutes.

Guard rails: nobody removes their own Administración, deactivates themself or resets their
own password (`422 self_change_forbidden` with `action`); there is always an active admin
(`409 last_admin`, serialised by the `AdminRoster` aggregate); **administration never moves
cases**: deactivating someone, removing her Analista role or a language one of her open
cases uses is `409 staff_has_open_cases` (with `caseIds`) until supervision reassigns them.
Deactivation and password reset end her sessions (her sockets close with 4401); a roles
change ends none (roles are re-read on every request) and closes her sockets with **4409**
(`access_changed`) so they reconnect with the new roles. Removing Analista, or deactivating
an available analyst, pauses her; adding a language drains the queues (rule 3).

```bash
curl -s -X POST localhost:8000/api/v1/admin/users/STF-00000000000000000000000012/unlock \
  -H 'Authorization: Bearer <Valeria token>'                      # Mariana can sign in again
curl -s localhost:8000/api/v1/admin/users -H 'Authorization: Bearer <Valeria token>' \
  -H 'content-type: application/json' -H 'Idempotency-Key: create-ana-0001' \
  -d '{"name":"Ana Gil","email":"ana.gil@latambank.example","roles":["analyst"],
       "languages":["pt"],"teamId":"TEAM-00000000000000000000000002"}'  # → temporaryPassword
```

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
  changed the same record first: reload and retry (SQLite's `database is locked` is treated
  the same way: commands retry it on fresh state instead of failing). Unexpected errors are
  `500 internal_error` problems that still carry CORS headers, so the browser can read them;
  their logged traceback never carries SQL bind values (`hide_parameters`) and password
  hashes or tokens in any log line are masked.
- Every response carries `X-Request-ID` / `X-Correlation-ID` (accepted from the client).
- Cursors (`cursor`, `afterSequence`) are sequences: anything but ASCII digits that fit a
  signed 64-bit integer (`²`, `٣`, 2**63, a 30-digit string) is `422`, never a `500`
  (`application/pagination.py`, the one decoder).
- Commands that create things take an `Idempotency-Key` header. Chat turns use it as the
  `clientMessageId`: a retry with the same text answers `200` + `Idempotent-Replayed: true`
  and the original turn; the same id with another text is `409 idempotency_conflict`.
- Realtime: `ws://localhost:8000/api/v1/ws?token=<token>` (a staff session token or a
  customer token); send `{"action":"subscribe","topic":"case:CASE-…"}` (also `inbox:STF-…`,
  and for customers only their own `customer:CUS-…`), `unsubscribe`, `ping`; receive
  `{type,id,occurredAt,data}` envelopes. `case:` topics are limited to the assignee analyst
  and supervisors (history readers use REST only). Supervisors also subscribe to
  `supervision:queues` (`queue.updated` with `QueueCounts`, `queue.case_queued` with a
  `CaseSummary`) and `supervision:team` (`team.updated` with `{staffIds}`: refetch the team). Admins subscribe
  to `admin:directory` (`directory.updated` with `{staffIds, teamIds}`: refetch the users
  and teams shown; also after a case is assigned, reassigned or closed, naming the analysts
  whose open cases changed), and every staff member to her own `staff:STF-…` (`me.updated` with her
  fresh `StaffOut` after a change of her name, email, roles, languages or team).
  A reassignment sends `case.unassigned` (+ `case.updated`, `inbox.counts`) to the previous
  assignee's `inbox:`. `case.viewed` never reaches a socket. Case envelopes (`turn.created`, `case.updated`, `case.assigned`,
  `inbox.counts`, `availability.updated`, `conversation.updated`) carry camelCase payloads
  equal to the REST schemas (`CaseRealtimeProjector`). An envelope bound to several topics
  (`case.updated` → `case:` + `inbox:`) reaches each connection once (`publish_many`). Close code 4401 means "sign in again"
  (bad token, logout, expiry, deactivation, password reset); 4409 means "your roles
  changed": refetch `/auth/me` and reconnect right away.

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
  application/     use cases, ports (Protocols), DTOs; realtime topics/projection
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

Every aggregate (staff, teams, the admin roster, sessions, cases, the one-open-case slot
per customer, availability) has a `version`. Repositories save with a compare-and-set
(`UPDATE … WHERE id = :id AND version = :loaded`, then `version + 1`; the in-memory adapter
checks the same at commit) and raise `ConcurrentUpdateError` when another request saved
first. Commands that are safe to repeat run inside `retry_on_conflict`
(`application/concurrency.py`) and re-evaluate their rules on fresh state; otherwise the API
answers `409 concurrent_update`. New aggregates get this by extending
`VersionedRepository` / `_StagedRepository`; their state machines then cannot lose updates.
A close racing the customer's next message is serialised the same way: either the message
lands first (and the closing notice follows it) or it retries and opens a new linked case.

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
- Customer sessions are stateless signed tokens (audience `cc-customer`, 8 h): no revocation
  list yet. The simulator is a dev/demo tool; anyone can pick a seeded customer.
- "Signed in" (supervision "Ahora") means an active staff session, nothing more: an expiring
  session emits no event (the team screen refetches every 60 s), and an available analyst
  without a session is still Atendiendo/Disponible ("sin sesión abierta") because cases keep
  landing on her.
- `queue.updated` is sent for every committed event of a queued case (a case entering the
  queue sends several in a row) and when a case leaves a queue (drained or assigned by hand);
  clients apply the newest `computedAt` and refetch. A case assigned on arrival sends none.
- Two parallel first reads of a case by the same supervisor may both record `case.viewed`
  (accepted; the 15-minute dedupe is a read before the write, no lock).
- The directory (`GET /admin/users`) is not paginated: at most 500 rows (team-generated),
  filtered and searched in memory over the loaded rows.
- Temporary passwords travel in the response body (dev only, `Cache-Control: no-store`); no
  forced change at first sign-in, no password policy, no self-service password change.
- Deactivated and locked people get the same `invalid_credentials` / lock answers as
  before (anti-enumeration): the login never says "desactivada".
- An assignment racing a deactivation or a role/language removal may land on someone who
  just lost eligibility (different aggregates): supervision reassigns it; no automatic sweep.
- Team renames do not rewrite old audit payloads (names are historical by design). No
  deletion of people or teams, no bulk moves.
- The access-changed close (4409) reconnects every socket of that person, even for a role
  that changes no topic (cheap, accepted).
- No presence: availability persists across sign-ins (an analyst who closes the browser
  while "Disponible" keeps receiving cases). No capacity cap per analyst yet.
- Live cases open with priority `medium` (nothing sets another priority yet); seeds vary it.
- Assignment limits (accepted, slice 2 §3.1, slice 3 §3.9): two cases opened at the same
  instant may both pick the same least-loaded analyst; an analyst who pauses at that instant
  may still get one (also by hand: availability is another aggregate); a new case may be assigned while an older case of **another** language waits (never of its own: the arrival serves its language queue first). The queue
  drains only when someone becomes available (no startup drain; supervisors assign by hand).
- The queue drain runs as an in-process background task after `staff.availability_changed`.
  If the process dies before it runs, the cases stay queued until the next availability
  change.
- The realtime projection re-reads the case for each committed case event (a few queries per
  message); fine for one process, revisit with the broker-backed hub.
- In-memory SQLite (`sqlite+aiosqlite:///:memory:`) shares one connection between all Units
  of Work, so concurrent work (a background drain during a request) would share a
  transaction. Use a file database (the default) or `CC_PERSISTENCE=memory`; the API tests
  use a temporary file.
