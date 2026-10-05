# Deploy runtime contract: environment, health, shutdown

What the support-platform API (`cc-api`) needs from whoever deploys it, and what it guarantees
in return. The edge (CloudFront and the host reverse proxy: paths, WebSocket, timeouts,
headers, caching) is in [deploy/edge.md](deploy/edge.md). Database roles and grants are in
[deploy/database.md](deploy/database.md).

The variable table at the end is **generated** from
`backend/src/cc_platform/bootstrap/settings.py` (`uv run python -m cc_platform.scripts.env_contract`);
a backend test fails when it is stale, so a new setting cannot ship undocumented.

## 1. Environments (`CC_ENV`)

| `CC_ENV` | Used for | Reload | Dev mailbox | Synthetic seed | Runtime contract (§3) |
| --- | --- | --- | --- | --- | --- |
| `dev` (default) | a developer's machine | on | on | on | not enforced |
| `test` | unit, API and browser e2e suites | off | off unless `CC_DEV_MAILBOX=true` | as set | not enforced |
| `staging` | the shared deployed environment (EC2 behind CloudFront) | refused | only if `CC_DEV_MAILBOX=true` | allowed (`CC_SEED_DEMO_DATA=true`) | **enforced** |
| `prod` | real customers | refused | refused | refused | **enforced** |

`staging` exists because the shared environment runs on **synthetic demo data** (seeded
accounts, the development MFA code of seeded accounts, the dev mailbox for invitations) while
still being reachable from the internet: it must have real secrets, https origins and the
proxy settings of production. `prod` additionally refuses every development aid and, today,
refuses to start at all: there is no production email adapter yet (invitations and password
resets go to the dev mailbox only), and the container says so when it starts.

## 2. Startup: fail fast, never print a secret

`cc-api` (and the `create_app` factory) reads the configuration once, before anything else.
A broken configuration stops the process with **exit status 2** and every problem at once:

```text
Invalid configuration: the API will not start.
  - CC_SESSION_SECRET must be at least 32 characters
  - CC_TOTP_SECRET_KEY is required (a Fernet key)
  - CC_PUBLIC_APP_URL is required (the public https origin of the SPA)
See docs/platform/deploy-env.md for every CC_* variable.
```

Messages name the variable and the rule, **never the value**: validation errors hide their
input (`hide_input_in_errors`), secrets are `SecretStr` (masked in `repr`), and the log
pipeline masks `token=`, `password=`, `secret=` parameters, Argon2 hashes and the password of
any `scheme://user:password@host` URL, in messages and in tracebacks. Tests start the whole app
with distinctive secrets and assert that no log line, startup error or `/readyz` answer
contains them.

## 3. Rules of a deployed environment (`staging`, `prod`)

| Rule | Variable |
| --- | --- |
| Set, not the development default, 32+ characters | `CC_SESSION_SECRET` |
| Set, a valid Fernet key (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) | `CC_TOTP_SECRET_KEY` |
| Set explicitly (the local SQLite default is refused); `CC_PERSISTENCE` must stay `sqlalchemy` | `CC_DATABASE_URL` |
| Set, `https://`, not localhost | `CC_PUBLIC_APP_URL` |
| No `*`; only `https://` non-localhost origins; `[]` when the SPA and the API share the CloudFront domain | `CC_CORS_ORIGINS` |
| No `*` (list the proxy addresses or CIDRs) | `CC_TRUSTED_PROXIES` |
| If set, 32+ characters | `CC_INTERNAL_SERVICE_TOKEN` |
| Not `true` | `CC_RELOAD` |
| `prod` only: `false` | `CC_SEED_DEMO_DATA` |
| `prod` only: not `true` | `CC_DEV_MAILBOX` |
| Any environment: both or neither | `CC_AGENT_CORE_URL` with `CC_AGENT_KEYS_FILE` |
| Any environment: IPs or CIDRs only | `CC_TRUSTED_PROXIES` |

Secrets (session secret, TOTP key, internal service token, the database URL, the agent signing
keys file and the bank-customer links file) are injected by infra; none has a usable default
in a deployed environment and none is ever committed.

## 4. Health: `GET /healthz` and `GET /readyz`

Both are at the **root** (not under `/api/v1`), outside the OpenAPI contract, unauthenticated,
JSON, `Cache-Control: no-store`, and never contain error text. Like the Core's (agent-core M9
§3.9). The access log records them at `debug` only.

**`GET /healthz`** (liveness): `200 {"status": "ok"}` whenever the process serves requests. It
touches no dependency: a database or Core outage never makes the orchestrator restart the API.

**`GET /readyz`** (readiness): every dependency is checked at once, each bounded by
`CC_READINESS_TIMEOUT_SECONDS` (default 2 s; a timeout counts as down), so the answer comes in
about 2 s at worst.

| Situation | Status | Body |
| --- | --- | --- |
| Database reachable and schema current; Core ready | 200 | `{"status": "ready", "checks": {"database": "ok", "core": "ok"}}` |
| Same, `CC_AGENT_CORE_URL` unset (people-only) | 200 | `{"status": "ready", "checks": {"database": "ok", "core": "disabled"}}` |
| Core down, slow, or its own `/readyz` not 200 | **200** | `{"status": "ready", "checks": {"database": "ok", "core": "degraded"}}` |
| Database unreachable (or slower than the timeout) | 503 | `{"status": "not_ready", "checks": {"database": "unreachable", …}}` |
| Database reachable, schema not current (not migrated) | 503 | `{"status": "not_ready", "checks": {"database": "not_migrated", …}}` |
| `CC_PERSISTENCE=memory` | 200 | no `database` check |

The Core is **not critical**: without it the platform keeps serving every screen that needs no
AI (the assistant hands customers to people, the copilot stays silent), so the instance stays
in rotation and reports `core: "degraded"` for monitoring.

"Schema current" is one function, `schema_is_current(connection)` in
`backend/src/cc_platform/infrastructure/persistence/sqlalchemy/readiness.py`. Today it checks
that every table and column of the code's metadata exists (the same stand-in the startup check
uses). With Alembic it becomes "the database revision is at head": only that function changes.

Use `/readyz` for the container health check and for the reverse proxy's upstream check, and
`/healthz` for liveness (restart) decisions.

## 5. Graceful shutdown

On SIGTERM `cc-api` (uvicorn, `timeout_graceful_shutdown`):

1. stops accepting connections;
2. closes every WebSocket with **1012 (service restart)**; the SPA reconnects with backoff to
   the restarted (or another) process and refetches what it may have missed;
3. lets in-flight HTTP requests finish for up to `CC_SHUTDOWN_TIMEOUT_SECONDS` (default 10 s),
   then cancels the rest;
4. stops the periodic jobs (SLA sweep, assistant sweep, suggestion purge), closes any socket
   still registered (1012), and gives the one-shot background jobs (queue drains, assistant
   turns, suggestions) another `CC_SHUTDOWN_TIMEOUT_SECONDS`; what is left is cancelled and
   logged (`background_jobs_cancelled`). Assistant work cut short is picked up by the assistant
   sweep on the next start;
5. closes the Core HTTP client and the database pool, logs `shutdown`, and exits. uvicorn then
   re-raises SIGTERM, so the exit status is the signal's (143 in a shell), as supervisors expect.

The stop grace period (`stop_grace_period` in compose, `TimeoutStopSec` in systemd, `docker
stop -t`) must exceed **2 × `CC_SHUTDOWN_TIMEOUT_SECONDS` + 5 s**: 30 s with the defaults.
Docker's own default (10 s) is too short.

## 6. Realtime (WebSocket)

- Path: **`/api/v1/ws?token=<session token>`** (one socket per tab, staff or simulator customer).
  It is under `/api/`, so one edge rule covers the REST API and the socket.
- Every `CC_REALTIME_HEARTBEAT_SECONDS` (default 25 s) the server sends a `heartbeat` envelope
  (`{"type": "heartbeat", "data": {"intervalSeconds": 25}, …}`), so no proxy on the way sees an
  idle connection, and uvicorn also sends protocol pings every 20 s. The SPA treats 3 missed
  intervals of silence as a dead socket and reconnects at once.
- Close codes: 4401 session ended or expired (the SPA signs out), 4409 roles changed (reconnect
  now), 1013 too slow (reconnect with backoff), **1012 server restart** (reconnect with backoff).
- The SPA reconnects with exponential backoff and jitter (0.5 s up to 15 s), resubscribes every
  topic, refetches the screens' data after the reconnect, and skips the pending backoff when the
  browser comes back online or the tab becomes visible again.

## 7. Sessions and cookies

The API sets **no cookies**. Staff and simulator sessions are bearer tokens: the SPA keeps them
in `sessionStorage` and sends `Authorization: Bearer …` (the WebSocket carries the token in
its query string). So there are no cookie settings (`Secure`, `SameSite`, domain, path) to
configure, CSRF does not apply, and the edge must forward the `Authorization` header and
query strings. A test asserts that login answers carry no `Set-Cookie`. Every `/api/` answer is
`Cache-Control: no-store`.

## 8. Behind CloudFront and the reverse proxy

The API believes `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` only from peers
in `CC_TRUSTED_PROXIES` (IPs or CIDRs). From them it takes the scheme (`https`/`wss`), the host,
and the client address (the right-most address that is not a trusted proxy; the onboarding
link rate limits key on it). uvicorn's own proxy handling is off in `cc-api`. The SPA must be
built with `VITE_API_URL=/` so it calls the API and the socket on its own origin. What infra
configures is in [deploy/edge.md](deploy/edge.md).

## 9. Every variable

Required: when it must be set (otherwise its default applies). Secret: injected by infra,
never logged or committed. Example shapes are placeholders, never real values. JSON lists are
written as JSON (`CC_CORS_ORIGINS=["https://a.example"]`).

<!-- BEGIN GENERATED: env table (cc_platform.scripts.env_contract) -->

#### General

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_ENV` | staging, prod | `dev` | no | `staging` | `staging`: the shared deployed environment (synthetic demo data allowed); `prod`: real customers. Both enforce the runtime contract (`docs/platform/deploy-env.md`). One of: `dev`, `test`, `staging`, `prod`. |
| `CC_BUILD` | no | `dev` | no | `<git sha>` | Build id (git sha or CI run) shown in /meta. |

#### Persistence

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_PERSISTENCE` | no | `sqlalchemy` | no | `sqlalchemy` | `memory` keeps nothing across restarts (tests, demos without a database). One of: `sqlalchemy`, `memory`. |
| `CC_DATABASE_URL` | staging, prod | `sqlite+aiosqlite:///<backend>/cc_platform.db` | yes (holds the password) | `postgresql+asyncpg://<app_role>:<password>@<host>:5432/<db>` | SQLAlchemy async URL. SQLite for local development and tests; Postgres when deployed (roles and grants: [database.md](deploy/database.md)). |
| `CC_DATABASE_ECHO` | no | `false` | no | `false` | Log every SQL statement (development only). |
| `CC_SEED_DEMO_DATA` | prod (false) | `true` | no | `true` | Insert the synthetic demo data (accounts, customers, cases) that is missing; idempotent. Refused in prod. |

#### Auth

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_SESSION_SECRET` | staging, prod | dev-only value | yes | `<64 random url-safe characters>` | HMAC key of the staff and customer session tokens (32+ characters). |
| `CC_SESSION_TTL_MINUTES` | no | `480` | no | `480` | Staff session lifetime. |
| `CC_LOCKOUT_MAX_ATTEMPTS` | no | `5` | no | `5` | Failed passwords before an account locks. |
| `CC_LOCKOUT_MINUTES` | no | `15` | no | `15` | How long a locked account stays locked. |
| `CC_MFA_TTL_SECONDS` | no | `300` | no | `300` | Lifetime of an MFA challenge. |
| `CC_MFA_MAX_ATTEMPTS` | no | `3` | no | `3` | Wrong MFA codes before the challenge is spent. |
| `CC_DEV_MFA_CODE` | no | `000000` | no | `000000` | MFA code of the seeded accounts without an authenticator (synthetic data). |
| `CC_ARGON2_TIME_COST` | no | `3` | no | `3` | Argon2id password hashing: iterations. |
| `CC_ARGON2_MEMORY_COST` | no | `65536` | no | `65536` | Argon2id password hashing: memory in KiB. |
| `CC_ARGON2_PARALLELISM` | no | `4` | no | `4` | Argon2id password hashing: lanes. |
| `CC_CUSTOMER_SESSION_TTL_MINUTES` | no | `480` | no | `480` | Customer chat simulator sessions (stateless tokens, audience cc-customer) |

#### Secure onboarding

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_PUBLIC_APP_URL` | staging, prod | `http://localhost:5173` | no | `https://<cloudfront-domain>` | Origin of the SPA: the emails link to `{public_app_url}/activar?token=…`. |
| `CC_INVITATION_TTL_HOURS` | no | `48` | no | `48` | Lifetime of an invitation link. |
| `CC_PASSWORD_RESET_TTL_MINUTES` | no | `60` | no | `60` | Lifetime of a password-reset link. |
| `CC_TOTP_ISSUER` | no | `LATAM Bank CC` | no | `LATAM Bank CC` | The name authenticator apps show above the codes. |
| `CC_TOTP_SECRET_KEY` | staging, prod | unset | yes | `<Fernet.generate_key()>` | Fernet key that seals the TOTP secrets at rest. Unset: derived from the session secret (development and tests only; production must set it). |
| `CC_DEV_MAILBOX` | no | unset | no | `false` | The development mailbox (`GET /api/v1/dev/mailbox`): unset = on only with `CC_ENV=dev`; the browser e2e turns it on with `CC_ENV=test`. Refused in prod. |

#### HTTP

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_CORS_ORIGINS` | staging, prod | `["http://localhost:5173", "http://127.0.0.1:5173"]` | no | `[]` | Origins allowed to call the API from a browser (JSON list). `[]` when the SPA and the API share the CloudFront origin. |
| `CC_HOST` | no | `127.0.0.1` | no | `127.0.0.1` | Bind address of `cc-api` (`0.0.0.0` in a container). |
| `CC_PORT` | no | `8000` | no | `8000` | Port of `cc-api`. |
| `CC_TRUSTED_PROXIES` | deployed behind a proxy | `["127.0.0.1", "::1"]` | no | `["<proxy docker network CIDR>","<VPC CIDR>"]` | Peers whose `X-Forwarded-For/-Proto/-Host` headers are believed (IPs or CIDRs, `*` = any, refused when deployed): the host reverse proxy in front of the API. |
| `CC_RELOAD` | no | unset | no | `false` | Reload on code changes (`cc-api`). Unset: on only with `CC_ENV=dev`. |
| `CC_SHUTDOWN_TIMEOUT_SECONDS` | no | `10.0` | no | `10.0` | Graceful shutdown: how long in-flight requests, then background jobs, may take to finish after SIGTERM (each); the rest is cancelled. Keep the stop grace period above twice this. |
| `CC_READINESS_TIMEOUT_SECONDS` | no | `2.0` | no | `2.0` | `GET /readyz`: the longest each dependency check may take before it counts as down. |

#### Realtime

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_REALTIME_QUEUE_SIZE` | no | `256` | no | `256` | Envelopes a slow socket may lag behind before it is closed (1013). |
| `CC_REALTIME_EXPIRY_CHECK_SECONDS` | no | `30.0` | no | `30.0` | How often an idle socket re-checks its session expiry. |
| `CC_REALTIME_HEARTBEAT_SECONDS` | no | `25.0` | no | `25.0` | An idle socket gets a `heartbeat` envelope this often, so CloudFront and the reverse proxy never see it idle and the SPA can tell a dead socket from a quiet one; 0 = off. |

#### Notifications

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_NOTIFICATION_SWEEP_SECONDS` | no | `30.0` | no | `30.0` | Notifications (slice 10): how often the SLA sweep looks for cases at risk without a first response ("Caso por vencer sin respuesta"); 0 turns it off (tests). |

#### The AI switch

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_AI_ENABLED` | no | `true` | no | `true` | The AI switch ("Funciones de IA", slice 18, ADR 0006): its value until Administración changes it (then the stored setting wins). Off = the people-only platform, whatever agent-core says; on without agent-core = also people-only. |

#### The AI maturity per case type

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_STAGE_RESOLVED_CASES_TO_ASK` | no | `10` | no | `10` | 0 → 1: cases of the type resolved by people. |
| `CC_STAGE_ASKED_CASES_TO_PROPOSE_TOOLS` | no | `20` | no | `20` | 1 → 2: closed cases of the type in which the analyst asked the copilot. |
| `CC_STAGE_TOOL_USE_PERCENT_TO_SHADOW` | no | `70` | no | `70` | 2 → 3: % of the closed cases with tool proposals in which one was used… |
| `CC_STAGE_TOOL_CASES_MINIMUM` | no | `10` | no | `10` | …counted once there are at least this many of them. |
| `CC_STAGE_DRAFT_WINDOW` | no | `100` | no | `100` | 3 → agent: the last drafts looked at… |
| `CC_STAGE_DRAFT_AS_IS_PERCENT_FOR_AGENT` | no | `80` | no | `80` | …and the % of them sent as is or with minor changes. |
| `CC_STAGE_MINOR_EDIT_PERMILLE` | no | `150` | no | `150` | An edited draft is "minor changes" up to this edit distance (0-1000). |
| `CC_STAGE_GATES_SUGGESTIONS` | no | `true` | no | `true` | The copilot's automatic suggestions only for cases whose type is at stage 2 or more. Off: for every case, whatever its type (a development aid for the suggestions agent). |

#### agent-core

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_AGENT_CORE_URL` | with the Core (with the keys) | unset | no | `http://<core-host>:<port>` | Base URL of agent-core's runtime API (`agentcore serve`), e.g. `http://localhost:8001`. |
| `CC_AGENT_CORE_TIMEOUT_SECONDS` | no | `60.0` | no | `60.0` | A turn takes as long as the model; past this the case falls back to a person. |
| `CC_AGENT_KEYS_FILE` | with the Core (with the URL) | unset | file contents | `/run/secrets/agent-keys.json` | Private signing keys for agent-core credentials (see `scripts/gen_agent_keys`); secret. |
| `CC_ASSISTANT_AGENT` | no | `recepcion@prod` | no | `recepcion@prod` | The agent a conversation starts with (`id`, `id@alias` or `id@X.Y.Z`). |
| `CC_ASSISTANT_LANGUAGES` | no | `["es", "pt"]` | no | `["es", "pt"]` | Case languages the assistant handles; other languages go straight to people. Policy `H1`: the assistant serves Spanish and Portuguese; its hand-overs follow rule 3. |
| `CC_COPILOT_AGENT` | no | `copiloto-asesor@prod` | no | `copiloto-asesor@prod` | The analyst's copilot agent (`id`, `id@alias` or `id@X.Y.Z`). |
| `CC_COPILOT_SUGGESTIONS_AGENT` | no | unset | no | `copiloto-sugerencias@prod` | The agent that proposes suggestions for a case (ADR 0005; `id@alias`). Unset = the platform makes no suggestions (the panel answers `available: false`). |
| `CC_COPILOT_SUGGESTIONS_AUTO` | no | `true` | no | `true` | Suggest on its own when a customer writes or a case reaches an analyst (off: only *Sugerir*). |
| `CC_COPILOT_SUGGESTIONS_COALESCE_SECONDS` | no | `3.0` | no | `3.0` | A customer's burst of messages makes one suggestion: it waits this long for the last one. |
| `CC_COPILOT_SUGGESTIONS_PURGE_SECONDS` | no | `600.0` | no | `600.0` | How often the drafts older than 24 hours are purged; 0 turns it off. |
| `CC_BUILDER_AGENT` | no | `constructor-chat@prod` | no | `constructor-chat@prod` | The builder agent supervisors chat with (slice 16; `id`, `id@alias` or `id@X.Y.Z`). |
| `CC_INTERNAL_SERVICE_TOKEN` | with the Core and the engine | unset | yes | `<48+ random url-safe characters>` | Shared secret of the service-to-service routes (`/api/v1/internal`): agent-core's `grant_active` check. Unset = those routes do not exist. |
| `CC_EVIDENCE_MIN_CELL` | no | `10` | no | `10` | The improvement engine's evidence sampler (`GET /internal/evidence/cases`): a cell of the cases with fewer matches than this answers "suppressed" and no ids (k-anonymity). |
| `CC_ASSISTANT_SWEEP_SECONDS` | no | `30.0` | no | `30.0` | How often the sweep looks for assistant work lost with its process; 0 turns it off. |
| `CC_ASSISTANT_STEP_UP_CODE` | no | `000000` | no | `000000` | The simulated second factor (development stand-in; a real one replaces it). |
| `CC_BANK_CUSTOMER_LINKS_FILE` | no | unset | file contents | `/run/secrets/bank-customer-links.json` | Private JSON `{platform customer id: dataset customer id}`; never committed. Only linked customers can talk to the assistant (agent-core's customer principal is the dataset id). |

#### Resilience of every call to the Core

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_CORE_TIMEOUT_ASSISTANT_SECONDS` | no | unset | no | `60` | Core call timeout for the assistant; unset: the general Core timeout. |
| `CC_CORE_TIMEOUT_COPILOT_SECONDS` | no | unset | no | `60` | Core call timeout for the copilot; unset: the general Core timeout. |
| `CC_CORE_TIMEOUT_SUGGESTIONS_SECONDS` | no | unset | no | `60` | Core call timeout for copilot suggestions; unset: the general Core timeout. |
| `CC_CORE_TIMEOUT_BUILDER_SECONDS` | no | unset | no | `60` | Core call timeout for the builder; unset: the general Core timeout. |
| `CC_CORE_TIMEOUT_REGISTRY_SECONDS` | no | `30.0` | no | `30.0` | Registry calls (proposals, releases, aliases, versions) and an evaluation (runs a suite). |
| `CC_CORE_TIMEOUT_EVALUATE_SECONDS` | no | `120.0` | no | `120.0` | Core call timeout for evaluations. |
| `CC_CORE_CONNECT_TIMEOUT_SECONDS` | no | `3.0` | no | `3.0` | Opening a connection to the Core (a Core that is down fails fast), and the readiness probe. |
| `CC_CORE_PROBE_TIMEOUT_SECONDS` | no | `2.0` | no | `2.0` | Core call timeout for the `/readyz` status probe. |
| `CC_CORE_RETRY_ATTEMPTS` | no | `2` | no | `2` | Retries after a quick failure, only for calls that are safe to repeat (0 = never). |
| `CC_CORE_RETRY_BASE_DELAY_SECONDS` | no | `0.2` | no | `0.2` | First delay between Core call retries (doubles each attempt). |
| `CC_CORE_RETRY_MAX_DELAY_SECONDS` | no | `2.0` | no | `2.0` | Ceiling of the delay between Core call retries. |
| `CC_CORE_BREAKER_FAILURE_THRESHOLD` | no | `5` | no | `5` | Consecutive failures that open the circuit breaker, and how long it stays open. |
| `CC_CORE_BREAKER_RESET_SECONDS` | no | `30.0` | no | `30.0` | How long the Core circuit breaker stays open before a trial call. |

#### Logging

| Variable | Required | Default | Secret | Example shape | Description |
| --- | --- | --- | --- | --- | --- |
| `CC_LOG_LEVEL` | no | `INFO` | no | `INFO` | Root log level. |
| `CC_LOG_FORMAT` | no | `json` | no | `json` | `json` (one object per line) or `console` (development). One of: `json`, `console`. |

<!-- END GENERATED: env table -->
