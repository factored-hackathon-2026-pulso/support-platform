# CC Platform API (backend)

FastAPI service of the LATAM Bank support platform: support staff (Analista, Supervisión,
Administración) and customers talk by chat. Hexagonal (ports and adapters) + DDD-lite +
CQRS-lite with an append-only event log.

Read first: `docs/platform/ENGINEERING_BRIEF.md` (scope, rules, conventions),
`docs/platform/adr/0001-architecture.md`, and the slice contracts in `docs/platform/api/`
(slice 2 case life cycle, slice 3 supervision, slice 4 administration, slice 6 analyst home,
slice 7 customer rating, slice 8 case priority, slice 9 supervision v2: Colas and escalations,
slice 10 notification center, slice 11 secure onboarding by email invitation, slice 12
simulated phone and email channels; a later slice wins).
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
- Seeded staff all use the password `demo1234` and the development MFA code `000000`, e.g.
  `daniela.rios@latambank.example` (analyst), `lucia.herrera@latambank.example` (supervisor),
  `valeria.quintero@latambank.example` (admin), `felipe.echeverri@latambank.example` (analyst +
  supervisor). The full table, the seeded cases and the simulator customers are in the runbook §5.
  Nobody starts available: the seeded language queues hold cases nobody available could take.
- **Part 4 (slice 11): nobody hands out passwords.** People are invited by email (single-use
  link, 48 h) and set their own password and an authenticator app (TOTP); a forgotten password is
  replaced through an emailed link (1 h). Accounts created that way sign in with their app's code:
  the dev code `000000` works **only** for the seeded accounts without an authenticator. Seeded
  Tatiana Rojas (`tatiana.rojas@`, `demo1234`) uses TOTP key `JBSWY3DPEHPK3PXP`; Bruna Esteves is a
  pending invitation. With `CC_ENV=dev` the **dev mailbox** keeps every email:
  `GET /api/v1/dev/mailbox` or the SPA page `/dev/mailbox` (runbook §5.1).

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
| Auth | `POST /auth/login`, `POST /auth/mfa` (TOTP for invited accounts; dev code for seeded ones), `POST /auth/logout`, `GET /auth/me` | staff |
| Onboarding (slice 11) | `POST /onboarding/invitations/check\|password\|activate`, `POST /onboarding/password-resets/check\|complete` (token in the body; 410 `link_invalid` for any unusable link, 429 `rate_limited` per client) | public (the link's token) |
| Dev mailbox (slice 11) | `GET /dev/mailbox?limit=` (404 unless `CC_DEV_MAILBOX`; never in prod) | public, development only |
| Availability | `GET\|PUT /me/availability` (Disponible / En pausa) | analyst |
| Home (slice 6) | `GET /me/home`: `since` (end of her previous session, else now − 8 h), activity rows from the event log (structured, no text), her team's availability and queues (counts) | analyst |
| Cases | `GET /cases/inbox?status=&q=` (`closed` = last 7 days), `GET /cases/{id}`, `GET /cases/{id}/history`, `GET\|POST /cases/{id}/turns`, `POST /cases/{id}/read`, `POST /cases/{id}/close` (`{reason, note}`) | analyst; supervisors read any case (audited `case.viewed`) |
| Case priority (slice 8) | `PUT /cases/{id}/priority` (`{priority, expectedVersion}` → `{changed, case}`) | the assignee analyst, or a supervisor on any open case |
| Calls, email, notes (slice 12) | `GET\|POST /cases/{id}/calls` (`{reason}` + `Idempotency-Key`), `POST /cases/{id}/calls/{callId}/answer\|hold\|resume\|mute\|hangup\|transcript`, `POST /cases/{id}/notes`, `GET\|POST /cases/{id}/emails` (reply framed with greeting and signature) | the assignee analyst writes; reads like the case |
| Customer calls and email (slice 12) | `GET /customer/call`, `POST /customer/calls` (+ `Idempotency-Key`), `POST /customer/calls/{callId}/answer\|reject\|hangup\|transcript`, `GET\|POST /customer/emails` | customer token |
| Customer simulator | `GET /customer/demo-customers`, `POST /customer/sessions`, `GET /customer/conversation`, `POST /customer/conversation/turns`, `GET /customer/conversations`, `GET /customer/conversations/{id}`, `POST /customer/conversations/{id}/rating` (slice 7: `{score 1–4, comment?}` + `Idempotency-Key`) | customer token |
| Supervision | `GET /supervision/team`, `GET /supervision/queues`, `PUT /supervision/cases/{id}/assignee` (`{analystId, expectedAnalystId, confirmPaused}`; ends an open escalation as `reassigned`) | supervisor |
| Colas (slice 9) | `GET /supervision/open-cases?language=es\|pt`: every open case of a language and who holds it | supervisor |
| Escalations (slice 9) | `POST /cases/{id}/escalations` (`{motive}` + `Idempotency-Key`), `POST /cases/{id}/escalations/{escId}/withdraw`, `POST /cases/{id}/escalations/{escId}/acknowledge` | analyst (the assignee; acknowledge: who escalated) |
| Escalados (slice 9) | `GET /supervision/escalations`, `POST /supervision/escalations/{escId}/response` (`{note}`), `POST /supervision/escalations/{escId}/take` | supervisor (take: also Analista and speaks the language) |
| Notifications (slice 10) | `GET /me/notifications?cursor=&limit=` (hers, newest first, `unreadCount`), `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all` | any staff role, **her own only** (another person's id is 404) |
| Audit | `GET /audit/events` (filters `actorKind, actorId, caseId, family, changesOnly, from, to, q`, cursor), `GET /audit/events/{id}` | supervisor, admin |
| People | `GET /staff?role=&includeInactive=` | supervisor, admin |
| Administration | `GET\|POST /admin/users` (POST invites by email), `GET\|PATCH /admin/users/{id}`, `POST /admin/users/{id}/deactivate\|reactivate\|unlock\|password-reset` (password-reset emails a link), `POST /admin/users/{id}/invitation/resend\|cancel`, `GET\|POST /admin/teams`, `GET\|PATCH /admin/teams/{id}`, `POST /admin/teams/{id}/deactivate\|reactivate` | admin |

Product rules enforced in the service layer (brief §4.3):

- **Rule 3 (language, `H1`).** A new case goes to an available analyst who speaks the
  customer's language, the least loaded first (`AssignCase` + `LanguageLeastLoadedStrategy`).
  Otherwise it waits in its language queue (first in, first out) and `QueueDrainer` assigns it
  when an eligible analyst becomes available. Manual assignment applies the same rule; a paused
  target needs `confirmPaused`.
- One open case per customer; a message after a close opens a new case with `previousCaseId`.
- Slice 7: only its own customer rates a case, only once it is closed, only once (`404`,
  `409 case_not_closed`, `409 already_rated`); the rating counts for whoever closed it
  (`recentRatings` in `GET /supervision/team`, last 7 days). The audit never shows the comment.
- Slice 8: a case opens with priority `none`; its assignee (as Analista) or a supervisor (any
  open case, queued included) changes it (`none · low · medium · high · critical`); a closed case
  is `409 case_closed`, the same level is `changed: false`, a stale `expectedVersion` is
  `409 version_conflict` with the case as `current`. The first-response SLA is a fixed 15 minutes
  for every case (`FirstResponseSlaPolicy`), whatever the priority.
- Slice 9 (escalations, grounded only in the dataset's `was_escalated` yes/no): the assignee
  escalates an open assigned case with a motive (≤ 500); one open escalation per case
  (`409 escalation_open`); she may withdraw it while open; supervision answers (a note ≤ 500),
  takes the case (only someone who also holds Analista, is active and speaks its language:
  `422 analyst_not_eligible` / `language_mismatch`) or reassigns it (`reassigned`); closing the
  case ends it (`closed`); anything on an ended one is `409 escalation_not_open`. Motive and note
  are redacted from the audit (`motive_length`, `note_length`).
- Slice 10 (notifications, people-only, fixed mappings): `NotificationProjector` derives them from
  committed events (assigned on arrival / from the queue / by supervision, reassigned away,
  customer returned, escalation answered / taken / reassigned, case rated → that analyst; case
  escalated and queued → every active Supervisión; account locked, invitation accepted →
  every active Administración; never the actor, never an inactive person). `case_queued` is one
  per language while its queue holds an older waiting case. `SweepSlaRisk` writes "Caso por vencer
  sin respuesta" (open case, no first response, due in ≤ 5 min) once per case, at startup and
  every `CC_NOTIFICATION_SWEEP_SECONDS` (30 s; 0 = off). `(recipient_id, source_key)` is unique
  (idempotent); the newest 200 per person are kept. Notifications are not domain events and
  never enter the event log.
- Slice 12 (simulated calls and email, no telephony or mail server): a call or an email joins the
  customer's open case or opens one (`phone_inbound`, `email`); one active call per case
  (`409 call_in_progress`), and a case with an active call is not closed; answering a call (or
  the first email reply) is the first response; the transcript is `transcript` turns, emails are
  `email` turns with a subject, internal notes are staff-only `note` turns. Contract:
  `docs/platform/api/slice-12-channels.md`.
- Only the assignee writes; a closed case is read-only. A close needs a reason from a fixed
  list; the customer sees a notice, never the reason. Staff banners never reach customers.
- Administration guard rails: nobody removes their own Administración, deactivates themself or
  resets their own password (`422 self_change_forbidden`); there is always an active admin
  (`409 last_admin`); administration never moves cases (`409 staff_has_open_cases` until
  supervision reassigns them).
- Slice 11 (secure onboarding): creating a person invites her (`staff.setup = invited`, an
  `Invitation` with a single-use token whose SHA-256 is all that is stored; resend replaces it,
  cancel withdraws her); the activation sets her password (policy: ≥ 12 characters, not her email
  name nor her name, not a common one; Argon2id) and enrolls TOTP (`pyotp`, the secret sealed with
  Fernet); "password-reset" emails a 1-hour link and ends her sessions now. Emails go through the
  `EmailSender` port after the commit; the only adapter is the dev mailbox.
- Lockout: 5 failed attempts (wrong passwords and wrong MFA codes) lock the account for 15
  minutes (`423 account_locked` with `unlockAt`); an admin can unlock it.

## API conventions

- camelCase JSON, ISO-8601 UTC timestamps, prefixed opaque ids (`CASE-…`, `TRN-…`, `ASG-…`,
  `CUS-…`, `STF-…`, `TEAM-…`, `EVT-…`, `CALL-…`).
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
| `case:<caseId>` | assignee, supervisors | `turn.created`, `case.updated`, `escalation.updated`, `call.updated` (slice 12) |
| `inbox:<staffId>` | that analyst | `case.updated`, `case.assigned`, `case.unassigned`, `inbox.counts`, `availability.updated`, `escalation.updated` (her escalations), `call.updated` (her calls) |
| `customer:<customerId>` | that customer | `turn.created`, `conversation.updated`, `call.updated` (`CustomerCall`) |
| `supervision:queues`, `supervision:team`, `supervision:escalations` | supervisors | `queue.updated`, `queue.case_queued`, `team.updated`, `escalation.updated` |
| `admin:directory` | admins | `directory.updated` |
| `staff:<staffId>` | that person | `me.updated`, `notification.created` (`{notification, unreadCount}`), `notifications.read` (`{notificationIds \| null, unreadCount}`) |

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
`data-lab/contracts/synthetic-sample/platform_history.json` envelope) in the same transaction, then published in-process
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
- Dev-only parts: the MFA code `000000` for seeded accounts, HMAC session tokens, the dev
  mailbox; `CC_ENV=prod` refuses to start until a real email adapter exists (and requires its own
  `CC_TOTP_SECRET_KEY`). No self-service "forgot password", no administration reset of a lost
  authenticator, no TOTP replay memory or backup codes (slice 11 §10).
- Single process: the realtime hub, the event bus and the queue drain run in-process (one
  worker). If the process dies between commit and publish, sockets miss that signal (clients
  refetch on reconnect); a drain that never ran waits for the next availability change.
- WebSocket auth uses the `?token=` query parameter (redacted in logs).
- Customer tokens are stateless (8 h, no revocation); anyone can pick a seeded customer in the
  simulator, which is a dev/demo tool.
- No per-IP throttling of the login. Unknown emails get the same lockout answers as real accounts,
  and the onboarding links are rate-limited per client address, but those counters are
  process-local and reset on restart.
- No presence: availability persists across sign-ins, so an available analyst who closes the
  browser keeps receiving cases. "Signed in" in supervision means an active session. No
  capacity cap per analyst yet.
- The priority routes, assigns and orders nothing on the server (queues stay oldest first); only
  the analyst's lists use it (frontend urgency order).
- Accepted assignment races (slice 2 §3.1, slice 3 §3.9): two cases opened at the same instant
  may pick the same least-loaded analyst; an analyst who pauses, is deactivated or loses a
  language at that instant may still get one (supervision reassigns it).
- Notifications (slice 10) are written in-process after the commit of their fact: if the process
  dies in between, that notification is lost (the fact stays in the log; no catch-up job). The SLA
  sweep runs every 30 s, so "Caso por vencer" may be up to 30 s late (its `createdAt` is exact).
- The directory (`GET /admin/users`) is not paginated (at most 500 rows, filtered in memory).
- Team renames do not rewrite old audit payloads; no deletion of people or teams.
- In-memory SQLite (`sqlite+aiosqlite:///:memory:`) shares one connection between Units of
  Work; use a file database or `CC_PERSISTENCE=memory`.
