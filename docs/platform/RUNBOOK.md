# Runbook · support platform

How to install, run, reset and verify the platform on a development machine. Every command in
this file was tested on macOS with the versions in the requirements table.

The platform has two applications:

- `backend/`: FastAPI API (Python 3.12, uv). It stores everything in SQLite and seeds the sample
  data on startup.
- `frontend/`: React SPA (Vite, pnpm). It holds the staff Workspace (`/analista`,
  `/supervision`, `/administracion`) and the customer simulator (`/cliente`). An analyst lands on
  **Inicio** (`/analista/inicio`): her availability ("Empezar a atender"), the counters per status
  (they open Casos with that filter), "Lo primero", "Mientras no estabas" and "Tu equipo ahora".
  "Casos" (`/analista`) is the list by urgency plus the conversation, with the "Ficha del
  cliente" on the right when the name is clicked.

Every person, customer and case is made up ("Datos de ejemplo").

## 1. Requirements

| Tool | Tested version | What for |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | 0.9 | Installs Python 3.12 (pinned in `backend/.python-version`) and the backend dependencies |
| Node.js | 22 | Frontend |
| pnpm | 10 | Frontend |
| Playwright's Chromium | installed by `pnpm e2e:install` | Only for the e2e suite |

No Docker and no external database are needed.

## 2. Install

```bash
cd backend
uv sync                         # creates backend/.venv with the runtime and dev dependencies

cd ../frontend
pnpm install                    # uses pnpm-lock.yaml
```

No `.env` file is required: every variable has a safe development default.

## 3. Run backend and frontend together

Two terminals, from the repository root:

```bash
# terminal 1 · API on http://127.0.0.1:8000
cd backend
uv run cc-api

# terminal 2 · SPA on http://localhost:5173
cd frontend
pnpm dev
```

- On first start, the backend creates `backend/cc_platform.db` and seeds the sample data. The
  times of the seeded story (waits, SLA, lockouts) are computed from that first start.
- With `CC_ENV=dev` (the default) the backend reloads itself when the code changes.
- Check that everything answers:
  - `curl -s http://127.0.0.1:8000/api/v1/health` → `{"status":"ok","checks":{"database":"ok"}}`
  - Swagger: http://127.0.0.1:8000/api/v1/docs
  - Staff sign-in: http://localhost:5173/login
  - Customer simulator: http://localhost:5173/cliente

To sign in: any account from [section 5](#5-seeded-accounts), password `demo1234`, verification
code `000000` (only the seeded accounts without an authenticator app; see
[section 5.1](#51-invitations-dev-emails-and-two-step-verification)).

**Several people at once.** The session lives in each tab's `sessionStorage`, so every new tab or
window (opened by typing the URL) can hold another staff member or another simulator customer.
Do not use "Duplicate tab": it copies the original tab's session.

### Other ports

```bash
# API on 8100 and SPA on 5180 (the SPA origin must be in CC_CORS_ORIGINS)
cd backend  && CC_PORT=8100 CC_CORS_ORIGINS='["http://localhost:5180"]' uv run cc-api
cd frontend && VITE_API_URL=http://localhost:8100 pnpm dev --port 5180 --strictPort
```

## 4. Environment variables

The backend reads variables prefixed with `CC_`, or a `.env` file in the directory it starts from
(run `uv run cc-api` inside `backend/`). Template: `backend/.env.example`. Source of truth:
`backend/src/cc_platform/bootstrap/settings.py`.

| Variable | Default | What it does |
|---|---|---|
| `CC_ENV` | `dev` | `dev` reloads the code and turns on the dev mailbox; `test` does not reload; `prod` refuses to start (a real email adapter is missing; it also requires its own `CC_SESSION_SECRET` and `CC_TOTP_SECRET_KEY`, `CC_SEED_DEMO_DATA=false` and no dev mailbox) |
| `CC_BUILD` | `dev` | Build identifier shown by `GET /api/v1/meta` |
| `CC_PERSISTENCE` | `sqlalchemy` | `memory` runs without a database (everything is lost on stop) |
| `CC_DATABASE_URL` | `sqlite+aiosqlite:///<repo>/backend/cc_platform.db` | Another SQLite database (absolute path: `sqlite+aiosqlite:////tmp/demo.db`) |
| `CC_DATABASE_ECHO` | `false` | Prints the SQL |
| `CC_SEED_DEMO_DATA` | `true` | Seeds sample people, customers and cases if they are missing |
| `CC_SESSION_SECRET` | development secret | HMAC signature of the session tokens |
| `CC_SESSION_TTL_MINUTES` | `480` | Length of a staff session |
| `CC_CUSTOMER_SESSION_TTL_MINUTES` | `480` | Length of a simulator session |
| `CC_LOCKOUT_MAX_ATTEMPTS` | `5` | Failed attempts before the account locks |
| `CC_LOCKOUT_MINUTES` | `15` | Length of the lockout |
| `CC_MFA_TTL_SECONDS` | `300` | Validity of the verification step |
| `CC_MFA_MAX_ATTEMPTS` | `3` | Wrong codes per verification |
| `CC_DEV_MFA_CODE` | `000000` | Development verification code: **only** for the seeded accounts without an authenticator app (part 4) |
| `CC_PUBLIC_APP_URL` | `http://localhost:5173` | Part 4: SPA origin used in the email links (`/activar?token=…`, `/restablecer?token=…`). Change it if the SPA runs on another port |
| `CC_INVITATION_TTL_HOURS` | `48` | Validity of an invitation link (from the last send) |
| `CC_PASSWORD_RESET_TTL_MINUTES` | `60` | Validity of a password reset link |
| `CC_DEV_MAILBOX` | unset (= on only with `CC_ENV=dev`) | Dev mailbox: keeps the emails the platform "sends" and shows them at `GET /api/v1/dev/mailbox` and `/dev/correos`. The e2e suite turns it on with `CC_ENV=test`. Forbidden in production |
| `CC_TOTP_ISSUER` | `LATAM Bank CC` | Name shown by the authenticator app |
| `CC_TOTP_SECRET_KEY` | derived from `CC_SESSION_SECRET` | Fernet key that seals the stored TOTP keys. In development it is derived from the session secret (if you change that secret, accounts with an app can no longer sign in: reset the database); production must set it |
| `CC_ARGON2_TIME_COST`, `CC_ARGON2_MEMORY_COST`, `CC_ARGON2_PARALLELISM` | `3`, `65536`, `4` | Password hash cost |
| `CC_CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173"]` | Allowed SPA origins (JSON list) |
| `CC_HOST`, `CC_PORT` | `127.0.0.1`, `8000` | Address of `uv run cc-api` |
| `CC_REALTIME_QUEUE_SIZE` | `256` | Queued messages per WebSocket connection |
| `CC_REALTIME_EXPIRY_CHECK_SECONDS` | `30` | How often an idle socket checks whether its session expired |
| `CC_NOTIFICATION_SWEEP_SECONDS` | `30` | Slice 10: how often to look for cases about to miss their first response (the "Caso por vencer sin respuesta" notification for Supervisión); it also runs on startup. `0` turns it off |
| `CC_AGENT_CORE_URL`, `CC_AGENT_KEYS_FILE` | unset | ADR 0003: agent-core's runtime URL and the private signing keys of the credentials the platform issues to it. They go together or not at all; unset, the platform is people-only (§4.1) |
| `CC_AGENT_CORE_TIMEOUT_SECONDS` | `60` | How long a turn may take before the case falls back to a person |
| `CC_CORE_TIMEOUT_ASSISTANT_SECONDS`, `CC_CORE_TIMEOUT_COPILOT_SECONDS`, `CC_CORE_TIMEOUT_SUGGESTIONS_SECONDS`, `CC_CORE_TIMEOUT_BUILDER_SECONDS` | unset (= `CC_AGENT_CORE_TIMEOUT_SECONDS`) | P4: timeout of each kind of model call (the customer's turn, the copilot's answer, a suggestion, the builder's chat) |
| `CC_CORE_TIMEOUT_REGISTRY_SECONDS`, `CC_CORE_TIMEOUT_EVALUATE_SECONDS` | `30`, `120` | P4: timeout of a registry call and of an evaluation (it runs a suite) |
| `CC_CORE_CONNECT_TIMEOUT_SECONDS`, `CC_CORE_PROBE_TIMEOUT_SECONDS` | `3`, `2` | P4: opening a connection to agent-core; its readiness probe (`GET /healthz`) |
| `CC_CORE_RETRY_ATTEMPTS`, `CC_CORE_RETRY_BASE_DELAY_SECONDS`, `CC_CORE_RETRY_MAX_DELAY_SECONDS` | `2`, `0.2`, `2` | P4: retries after a quick failure (network, 5xx), exponential backoff with full jitter, only for calls safe to repeat (idempotency key, `client_turn_id`, reads). A timeout is never retried |
| `CC_CORE_BREAKER_FAILURE_THRESHOLD`, `CC_CORE_BREAKER_RESET_SECONDS` | `5`, `30` | P4: consecutive failures that open the circuit breaker (one per agent-core URL), and how long it stays open before one probe call is let through |
| `CC_ASSISTANT_AGENT` | `recepcion@prod` | Slice 14: the agent a conversation starts with (`id`, `id@alias` or `id@X.Y.Z`) |
| `CC_ASSISTANT_SWEEP_SECONDS` | `30` | S17: how often a sweep re-runs assistant work lost with its process (sessions quiet for 20 s); `0` turns it off |
| `CC_INTERNAL_SERVICE_TOKEN` | unset | S17: shared secret of `/api/v1/internal/*` (agent-core's `grant_active` check, bearer, constant-time compare). Unset = those routes answer 404. A long random value; never commit it |
| `CC_COPILOT_AGENT` | `copiloto-asesor@prod` | Slice 15: the agent the analyst's copilot asks |
| `CC_COPILOT_SUGGESTIONS_AGENT` | unset | ADR 0005 (slice 15b): the agent that makes suggestions for a case. Unset = no suggestions. Needs agent-core ADR 0026 |
| `CC_COPILOT_SUGGESTIONS_AUTO` | `true` | Suggest on its own when a customer writes or a case reaches an analyst (`false`: only *Sugerir*) |
| `CC_COPILOT_SUGGESTIONS_COALESCE_SECONDS` | `3` | A burst of customer messages makes one suggestion |
| `CC_COPILOT_SUGGESTIONS_PURGE_SECONDS` | `600` | How often the suggestion texts older than 24 hours are purged (0 = off) |
| `CC_BUILDER_AGENT` | `constructor-chat@prod` | Slice 16: the builder agent supervisors chat with (`id`, `id@alias` or `id@X.Y.Z`) |
| `CC_ASSISTANT_LANGUAGES` | `["es", "pt"]` | Slice 14: case languages the assistant serves (JSON list, policy `H1`); others go straight to people |
| `CC_ASSISTANT_STEP_UP_CODE` | `000000` | Slice 14: the **simulated** second-factor code (a development stand-in) |
| `CC_BANK_CUSTOMER_LINKS_FILE` | unset | Slice 14: private JSON `{"CUS-…": "<dataset customer_id>"}` read at startup; only linked customers can talk to the assistant. Never commit it |
| `CC_LOG_LEVEL` | `INFO` | Log level |
| `CC_LOG_FORMAT` | `json` | `console` to read the logs in the terminal |

### 4.0 When agent-core is down (deploy brief P4)

Every call to agent-core goes through one resilience layer (`backend/src/cc_platform/infrastructure/core`):
a timeout per kind of call, retries for the calls that are safe to repeat, and a circuit breaker
shared by every call to the same agent-core. While the breaker is open, or a call fails:

- **New chat:** goes straight to people (no assistant), like with the AI switch off.
- **Ongoing assistant conversation:** the customer reads "En este momento no puedo responderte. Te
  paso con una persona del equipo…" (pt: "No momento não consigo te responder…") and the case goes to
  the language queue with the usual staff banner (`failed`, code `unavailable`).
- **Copilot and suggestions:** the copilot answers `503 agent_core_unavailable` at once (the panel
  shows its retry state); automatic suggestions are not attempted at all.
- **Automatización:** `GET /builder/status` says `reachable: false` and the screens show "El servicio
  de agentes no está disponible"; the types and the proposals index keep showing. The status is asked
  again every 15 s, so the screen recovers by itself.
- **Readiness:** `await container.core_status()` (also `ApiContext.core_status`) answers `ok` or
  `degraded`: `degraded` while the breaker is open (no call), else after a quick `GET /healthz` of
  agent-core. The probe counts like any call, so readiness polls open (and close) the breaker before a
  customer runs into it. Without agent-core configured it answers `ok`.

Each call to agent-core carries a W3C `traceparent` (and the incoming `tracestate`): the trace of the
incoming request when it brought a valid one, a new one otherwise. Every log line of the request has
its `trace_id`; agent-core's `trace_id` of the turn is the same id.

### 4.1 Connecting agent-core (ADR 0003, slice 13)

The platform issues the identities agent-core trusts, so agent-core must load the platform's
**public** keys. Nothing here is wired to a screen yet (that is slice 14); this only prepares the
connection.

```bash
cd backend
uv run python -m cc_platform.scripts.gen_agent_keys --suffix 2026-10
# writes backend/.agent-keys/ (git-ignored): private.json (secret), identity-keys.json, staff-keys.json
```

1. Give agent-core the two public files: `agentcore serve --identity-keys <identity-keys.json>
   --staff-keys <staff-keys.json> …`. In agent-core's local e2e stack (`scripts/e2e/serve.ps1`) they
   are `.e2e/identity-keys.json` and `.e2e/staff-keys.json`: replace them with the platform's (the
   demo tokens of `testing.demo_identities` then stop working, on purpose).
2. Start the platform with `CC_AGENT_CORE_URL=http://127.0.0.1:8001` (agent-core's port; the
   platform uses 8000, so start `serve` with `--port 8001`) and
   `CC_AGENT_KEYS_FILE=.agent-keys/private.json`.
3. The agent builder (slice 16) needs agent-core started with `--registry-api` (it also asks for
   `--staff-keys`, which is the platform's `staff-keys.json`, and its evaluation database). The platform
   signs two credentials for the same person: the **registry** one with the *staff* key and the **chat** one
   with the *identity* key, so both files must be the platform's. Approving, rejecting, publishing,
   promoting and revoking ask the person for a fresh authenticator code in the request (the seeded demo
   accounts have no authenticator: they use `CC_DEV_MFA_CODE`, `000000`). No agent has an `eval_suite` in
   the local stack, so nothing can be evaluated, approved or published yet (see
   `api/slice-16-agent-builder.md` §8).
4. Rotating: generate into a new `--out` with a new `--suffix`, publish both public files side by
   side (agent-core re-reads them every few seconds), switch `CC_AGENT_KEYS_FILE`, retire the old key.

5. Loading the seed agents into a deployed agent-core (its registry starts empty): sign a
   short-lived admin credential with the platform's **staff** key and use it at once (valid two
   minutes, the step-up window):
   ```bash
   uv run python -m cc_platform.scripts.registry_admin_credential --staff-id <staff id>
   ```
   It prints one JWS for `AGENTCORE_CREDENTIAL` of `agentcore registry --verifier
   agent_core.composition.registry:staff_verifier import <seed dir>` (agent-core verifies it with
   the same `staff-keys.json`). Whoever reads `private.json` can sign anything: the script only
   spares typing the claims.
6. The copilot's run carries the case's assistant session (`input.assistant_session_id`, from
   the case's `AssistantSession`), so agent-core's `obtener_handoff` and `leer_transcript` read the
   conversation the analyst inherited; agent-core refuses it unless that session is about the same
   customer as the delegation. A case that never had the assistant sends no input.

`private.json` holds the seeds: never commit it; in a deployment it belongs in a secrets manager.
`tests/contracts/agent-core-openapi.json` is a copy of agent-core's contract (`1.4.0`); refresh it,
`agent-core-registry/*.json` (agent-core's `contracts/registry/`), the listing extract
`agent-core-registry-listing.json` (`GET /v1/registry/proposals` from `contracts/registry-openapi.json`)
and `agent-core-contract-version.txt` when agent-core's contract changes, and the contract tests tell
whether the adapters still fit.

Frontend (`frontend/.env.local`, template in `frontend/.env.example`):

| Variable | Default | What it does |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | API URL. The WebSocket uses the same origin (`ws://…/api/v1/ws`) |

## 5. Seeded accounts

On sign-in, an analyst lands on **Inicio** (`/analista/inicio`); "/" also takes her there.
"Mientras no estabas" counts from the end of her previous session; on her first session, from 8
hours back (that is why the seed already shows her recent cases). The teams are called "Equipo
Andes", "Equipo Pacífico" and "Equipo Caribe" since slice 6: a database created earlier keeps the
old names ("Disputas · …"); reset it (section 6) to see them as in the demo.

All of them use the password **`demo1234`**. The seeded accounts use the development
verification code **`000000`**, except Tatiana Rojas, who joined by invitation and uses her
authenticator app (see below). Email: `nombre.apellido@latambank.example` (no accents).

| Person | Email | Roles | Languages | Team | State on startup |
|---|---|---|---|---|---|
| Daniela Ríos | `daniela.rios@` | Analista | Spanish, Portuguese | Equipo Andes | Paused, no session. 5 open and 3 closed cases (see below) |
| Julián Ortega | `julian.ortega@` | Analista | Spanish | Equipo Andes | Paused **with a seeded session** (shows as "En pausa" in Equipo). 2 open cases |
| Paula Medina | `paula.medina@` | Analista | Spanish | Equipo Pacífico | Paused, no cases |
| Sebastián Cárdenas | `sebastian.cardenas@` | Analista | Spanish, Portuguese | Equipo Pacífico | Paused, no cases |
| Tomás Arango | `tomas.arango@` | Analista | Spanish, Portuguese | Equipo Pacífico | Paused, no cases |
| Felipe Echeverri | `felipe.echeverri@` | Analista + Supervisión | Spanish | Equipo Andes | Paused, no cases. Uses the role switcher (Casos ↔ Colas). Since he is also an Analista, in "Escalados" he can **"Tomar el caso"** on a Spanish case |
| Lucía Herrera | `lucia.herrera@` | Supervisión | Spanish, Portuguese | Equipo Andes | Active |
| Martín Salazar | `martin.salazar@` | Supervisión | Spanish | Equipo Pacífico | Active |
| Renata Villalba | `renata.villalba@` | Supervisión | Spanish, Portuguese | Equipo Pacífico | Active |
| Mariana Duque | `mariana.duque@` | Supervisión | Spanish | Equipo Pacífico | **Locked** after 5 wrong passwords, until 13 min after the first start. An admin unlocks her |
| Valeria Quintero | `valeria.quintero@` | Administración | Spanish | Administración de la plataforma | Active |
| Carolina Peña | `carolina.pena@` | Administración | Spanish | Administración de la plataforma | Active |
| Andrés Villamil | `andres.villamil@` | Analista | Spanish | Equipo Andes | **Deactivated** (Carolina deactivated the account). Cannot sign in |
| Tatiana Rojas | `tatiana.rojas@` | Analista | Spanish | Equipo Andes | Part 4: **accepted her invitation** one hour before the first start. Password `demo1234` and **the code from her app** (key `JBSWY3DPEHPK3PXP`); the code `000000` does not work for her. Paused, no cases |
| Bruna Esteves | `bruna.esteves@` | Analista | Portuguese | Equipo Andes | Part 4: **pending invitation** (Valeria invited her 3 h before the first start; it expires 45 h later). She cannot sign in until she activates her account with the email link (in `/dev/correos`) |

There is also the inactive team "Equipo Caribe", with no members.

### 5.1 Invitations, dev emails and two-step verification

Part 4 (`api/slice-11-invitations.md`): Administración **never sees or hands out a password**.

- **Onboarding someone.** "Usuarios y roles" → "Nuevo usuario" → "Enviar invitación". The person
  shows as "Invitación pendiente" and gets an email with a single-use link that expires in 48
  hours. From her profile: "Reenviar invitación" (a new link; the previous one stops working) or
  "Cancelar invitación" (she disappears from the directory; inviting the same email again reuses
  her record).
- **Seeing the emails in development.** There is no mail server: the **dev mailbox** keeps what
  the platform "sends". Open it at http://localhost:5173/dev/correos (the "Correos de desarrollo"
  link at the foot of the sign-in, only when it is on) or through the API:
  `curl -s localhost:8000/api/v1/dev/mailbox | python -m json.tool`. "Abrir enlace" goes to
  `/activar?token=…` or `/restablecer?token=…`. It is on with `CC_ENV=dev`; it never exists in
  production.
- **Activating the account** (`/activar`): 1) create the password (at least 12 characters,
  without the name or the email, not a common password; the rules are checked live), 2) set up
  two-step verification: scan the QR with an authenticator app (Google Authenticator, Microsoft
  Authenticator, 1Password…) or type the manual key, and type the 6-digit code. The account is
  then active and paused ("En pausa"). From then on she signs in with email, password and the
  code from her app.
- **No phone at hand** (demo or tests): the code comes from the key:
  ```bash
  cd backend && uv run python -c "import pyotp; print(pyotp.TOTP('JBSWY3DPEHPK3PXP').now())"
  # or: oathtool --totp -b JBSWY3DPEHPK3PXP
  ```
  (replace the key with the one shown in step 2; the one above is Tatiana Rojas's).
- **Forgotten password.** Administración clicks "Enviar enlace para restablecer" on her profile:
  she gets a link that expires in 1 hour, her sessions are closed at that moment and the account
  is unlocked if it was locked. With the link (`/restablecer`) she creates the new password; her
  two-step verification does not change. Nobody can reset their own password from "Usuarios y
  roles"; there is no self-service "Olvidé mi contraseña" either.

**Seeded notifications (slice 10).** The seed story has already notified people: Daniela's bell
holds cases that reached her, "El cliente volvió a escribir", "Supervisión respondió tu
escalamiento" (107) and ratings; each Supervisión person's holds the escalations (101, 113 and
the handled ones), "Un caso espera en la cola" (Spanish and Portuguese) and "Caso por vencer sin
respuesta" (on startup, cases 5 minutes or less from their deadline are checked); Valeria's and
Carolina's hold "Cuenta bloqueada: Mariana Duque" and, already read, "Invitación aceptada:
Tatiana Rojas" (part 4). Anything older than 30 minutes starts read ("Anteriores"); the most
recent, unread ("Nuevas").

**Nobody starts available.** The seeded queues hold cases nobody available could take (rule 3),
so an available analyst would contradict them. When someone switches to "Disponible", the queues
of her languages drain to her (oldest case first) and new chats reach her.

### Seeded cases

Priority (slice 8): every case opens as "Sin prioridad"; the seeded story changes it through the
domain (`case.priority_changed`), so the audit shows who set it.

| Case | Customer | Where it is |
|---|---|---|
| 101 | Marcela Quintana Pardo (es-CO) | Daniela · Por responder, critical priority, **escalated** (open, 6 min ago) |
| 102 | Beatriz Salcedo Prieto (es-CO) | Daniela · Por responder, SLA at risk, high priority |
| 103 | Larissa Monteiro Alves (pt-BR) | Daniela · Nuevo, in Portuguese |
| 108 | Patricia Lozano Vega (es-MX) | Daniela · Nuevo, "Volvió a escribir" (previous cases 104 and 110) |
| 107 | Joaquín Ferreyra Paz (es-AR) | Daniela · Esperando al cliente, medium priority; Lucía **answered** her escalation (Daniela sees the card until "Entendido") |
| 117 | Ignacio Bustos Lagos (es-AR, Córdoba) | Daniela · Por responder, **email** (slice 12): his email, Daniela's reply with greeting and signature, and his answer |
| 104, 105, 106 | Patricia, Claudia, Héctor | Daniela · Cerrados in the last 7 days (medium, no priority, low) |
| 115 | Natalia Rendón Úsuga (es-CO, Medellín) | Daniela · closed yesterday: **inbound call** (slice 12) answered, put on hold once, internal note |
| 116 | Claudia | Daniela · closed: **outbound call** following up her chat 105 (slice 12) |
| 110 | Patricia | Closed by Julián 20 days ago (outside the 7-day window) |
| 113 | Camila Torres Benavides (es-CO) | Julián · Por responder, SLA overdue, medium priority, **escalated** (open, 21 min ago) |
| 114 | Esteban Morales Quiroga (es-CO) | Julián · Esperando al cliente (Paula escalated it and Lucía reassigned it to him: escalation "Reasignado"), low priority |
| 111 | Rosa Elena Ibarra Méndez (es-MX) | Colas → Español, unassigned, SLA at risk |
| 112 | Mauricio Achával Ríos (es-AR) | Colas → Español, unassigned, high priority (set by Lucía), SLA in 7 min |
| 109 | Gabriela Duarte Melo (pt-BR) | Colas → Portugués, unassigned |

Seeded escalations (slice 9, made-up and neutral motives): "Escalados" shows 2 open (Julián with
Camila, Daniela with Marcela) and, under "Atendidos hoy", Paula's (reassigned) and Daniela's with
Joaquín (answered). There are no types, amounts, levels or deadlines: the dataset only says
whether a case was escalated.

Full ids are `CASE-` followed by the number zero-padded to 26 digits (for example
`CASE-00000000000000000000000109`). Team-generated values (not from the dataset): the
first-response SLA (15 min for every case since slice 8; it no longer depends on the priority),
the 7-day window of Cerrados, the queue names and the close reasons. The priority levels do
follow the dataset (`complaints.priority`), plus "Sin prioridad".

After updating to slice 8, delete `backend/cc_platform.db`: the seed only adds missing cases, so
an older database keeps the old priorities and deadlines. Slice 9 adds the `escalations` table
and the `cases.open_escalation_id` column: an older database does not start
(`OutdatedSchemaError`) until it is deleted.
Slice 23 adds the `staff_preferences` table (each person's UI language): delete an older
database too. The UI language is chosen in the account menu ("Idioma de la plataforma": Español /
Português); before signing in, the app uses the language this browser last used, else the
browser's (Spanish or Portuguese), else Spanish.

### Simulator customers

At `/cliente` you pick a customer and write as them, with no password. New customers open a case
with their first message:

| Customer | Simulator language | City |
|---|---|---|
| Natalia Guzmán Rincón | Colombian Spanish | Bogotá |
| Ximena Robles Treviño | Mexican Spanish | Mexico City |
| Lucas Benítez Sosa | Argentine Spanish | Córdoba |
| Rafael Nogueira Costa | Brazilian Portuguese | Buenos Aires |
| Andrés Felipe Cardona | Colombian Spanish | Medellín |

The customers of the seeded cases are listed too: "Conversación abierta" continues their case;
Claudia and Héctor have a closed conversation, and if they write, a new case opens linked to the
previous one. Seeded ratings (slice 7): Héctor already rated his case ("¡Gracias! Calificaste:
Bien"); the simulator shows Claudia the survey (or "Ahora no"). Patricia rated her previous cases
104 (Excelente, with a comment) and 110 (Bien).

### 5.2 Seed profiles (`cc-seed`)

The API seeds the demo story on start (`CC_SEED_DEMO_DATA=true`, the default outside
production). `cc-seed` seeds on demand, against whatever database the `CC_*` settings name
(`CC_DATABASE_URL`), and is **idempotent**: run it again and nothing changes (what exists is
skipped; no duplicates). It is refused with `CC_ENV=prod`.

```bash
cd backend
uv run cc-seed --profile demo      # the accounts per role and the story cases above
uv run cc-seed --profile volume    # demo + the synthetic volume below
# another database:
#   CC_DATABASE_URL=sqlite+aiosqlite:////tmp/volume.db uv run cc-seed --profile volume
```

It prints what it added (`volume_cases_added=1651 … seconds=…`); a second run prints
`volume_cases_added=0`. The default dev start (and the e2e suite) only ever seeds `demo`.

**What `volume` contains.** 1,651 **synthetic** cases over the last 90 days, on top of the demo
story, plus 12 synthetic analysts and 1,507 synthetic customers. Nothing comes from the dataset:
names are invented combinations, texts are short templates per case type (es and pt-BR), and the
shares are team-generated (the five dataset subcategories in about equal shares, as in the
dataset's aggregate report).

| Dimension | Closed cases (1,578) |
|---|---|
| Case type | Cargo no reconocido, Cobro indebido, Problema con app, Atención en sucursal, Calidad de servicio: 306 each · Tarjeta virtual (team-generated, stage 0): 8 · Sin tipo: 40 |
| Channel | `chat_app` 528 · `chat_web` 377 · `phone_inbound` 343 · `email` 185 · `phone_outbound` 145 |
| Language | `es` 1,081 · `pt` 497 |
| Every cell of the 5 dataset types × 5 channels × 2 languages (50 cells) | 12 to 71 closed cases: the evidence route answers each one with `CC_EVIDENCE_MIN_CELL=10` |

Open now: 14 cases in the queues (10 Spanish, 4 Portuguese), 36 with the synthetic analysts
(new, to reply, waiting; 6 of them escalated to supervision) and 3 with the assistant. The
assistant also resolved 20 conversations on its own (no type) in the last 6 days. 144 cases are
a customer writing again (`previous_case_id`, "Volvió a escribir").

Events (about 36,000, through the domain and the Unit of Work like any request): case opened,
assigned, read, first response, priority and type changes (8 % corrected once), closed with a
reason, 723 CSAT ratings, 488 simulated calls (holds, notes), emails with the framed reply, 82
escalations answered by Lucía, Martín or Renata (6 more still open), and the AI side **as each
type's stage was at the time** (slice 21): no copilot for a type at stage 0, copilot questions from
stage 1 (321), suggestions with tools and their use from stage 2 (712 requested, 209
`copilot.tool_used`; the tools she sets aside and the escalation recommendations she does not follow
are `copilot.item_decided` with `dismissed`), drafts and their decisions from stage 3 (286 `copilot.suggestion_decided`:
used, edited with the edit distance, discarded, ignored, escalation accepted), and for Cargo no
reconocido, once its agent is active, chat conversations that start with the assistant
(`assistant.*`; `recepcion` and then the agent the type's `case_type_maturity` row holds act as the
assistant, ADR 0003): it resolves some and hands the rest over (`case.assistant_released`, assigned as
`assistant_handoff`; the analyst's handoff label is recorded on the session). Suggestions older
than 24 hours are purged like the platform does (no draft text kept).

The agent catalog (slice 25) reads from the same data: the demo story's agent for Cargo no
reconocido has a sample name ("Asistente de disputas", set by Lucía), and `GET /ai/agents` counts
its sessions from the volume (resolved, handed to people). Both are synthetic.

After the cases, each type's stage **signals** are recomputed from the volume (what the stage
projector counts since the type reached its stage), so Automatización shows the volume's
numbers while the stages stay as the story has them: every type still climbing stays below the
team rule's next step, and Cobro indebido keeps "ready for an agent" with 82 of its last 100
drafts sent as is.

**Telling synthetic from demo data.** Ids: synthetic cases `CASE-…0005xxxxx` (from
`CASE-00000000000000000000500001`), customers `CUS-…0005xxxxx`, analysts `STF-…000901` to
`STF-…000912` (`mariela.castano@`, `hernan.ocampo@`, … all with `demo1234` and the code
`000000`, all paused). The demo story keeps its own ids (cases 101-117, customers 1001-2005).

**How it is written.** Everything goes through the domain aggregates and the repositories, so it
works on SQLite and Postgres alike, and the events reach `event_log` through
`UnitOfWork.commit` with the envelope the log adds (no hand-written rows; the events built by
the seed, `copilot.tool_used` and `copilot.item_decided`, are recorded loose through the Unit of Work exactly as its use case
does). The Unit of Work publishes to **no** subscriber: replaying 90 days notifies no one, moves
no stage and never calls agent-core (so the volume adds no notifications). Writes go in batches of
100 cases per transaction. On a laptop the volume takes about 15-35 s on SQLite and under a
minute on a local Postgres (more on a busy machine).

**Re-anchoring.** Times are relative to the first `volume` run (later runs read the anchor back
from the first synthetic case). To move them to today, start from an empty database.

## 6. Reset the database

There are no migrations: the schema is created on startup. To return to the initial state (and
re-anchor the times of the seeded story):

```bash
# stop the backend (Ctrl+C), then
rm backend/cc_platform.db
cd backend && uv run cc-api      # creates the database and seeds again
```

- Without a file: `CC_PERSISTENCE=memory uv run cc-api` (every start begins from scratch).
- The seed never rewrites existing rows: restarting the backend without deleting the database
  keeps everything that was done.
- After pulling changes that touch the schema, the database must be deleted (see
  [OutdatedSchemaError](#the-api-does-not-start-outdatedschemaerror)).
- Staff tabs opened before the reset hold sessions that no longer exist: they go back to the
  sign-in and you have to sign in again.

## 7. Regenerate the API types

OpenAPI is the contract between the two applications. After any API change:

```bash
cd backend  && uv run python -m cc_platform.scripts.export_openapi   # writes backend/openapi.json
cd frontend && pnpm gen:api                                          # writes src/lib/api/schema.gen.ts
```

Check without writing: `uv run python -m cc_platform.scripts.export_openapi --check` and
`pnpm check:api`. Both fail if the file is out of date; the backend one also runs inside
`pytest`.

## 8. Quality gates

All of them must pass before a change is considered done (brief §6):

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest -q

cd ../frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check:api
```

`pytest` takes about a minute and a half; `pnpm test`, about ten seconds.

## 9. e2e suite (Playwright)

```bash
cd frontend
pnpm e2e:install     # once: downloads Chromium for Playwright
pnpm e2e             # runs the scenarios in the browser
```

The suite starts its own backend on a fresh temporary SQLite database, and its own Vite, on free
ports. It neither uses nor modifies `backend/cc_platform.db` and does not need the app to be
running. The scenarios live in `frontend/e2e/` and the configuration in
`frontend/playwright.config.ts`.

To run a part: `pnpm e2e e2e/auth.spec.ts` (one file) or `pnpm e2e -g "Casos anteriores"` (by
title). What each scenario covers, the isolation rules and the known gaps are in
[api/slice-5-e2e.md](./api/slice-5-e2e.md).

### 9.1 The assistant against the full stack (`pnpm e2e:stack`)

The assistant's flows need a real agent-core, so they have their own suite, outside `pnpm e2e`:
`frontend/e2e-stack/` (configuration `frontend/e2e-stack/playwright.config.ts`). It starts
nothing: it drives the local AI stack (`stack/up.sh` next to the repositories: this platform's API
on 8100 and web on 5174, agent-core on 8001 with its demo doubles, llm-gateway on 8080 to
OpenRouter).

```bash
../stack/up.sh        # from the folder that holds the repositories; see stack/README.md
cd frontend
pnpm e2e:stack        # 8 scenarios, about 40 s; STACK_API_URL / STACK_WEB_URL change the origins
pnpm exec playwright show-report playwright-report/stack   # screenshots of each step
```

| Scenario | What it checks |
|---|---|
| 1 | Natalia (Spanish) writes; "El asistente virtual está escribiendo…", then the assistant's bubble |
| 2 | "Hablar con una persona": the hand-over in the simulator; Tomás (available) gets the case "Tras el traspaso del asistente" with the banner, replies, and the customer reads him |
| 3 | A charge over agent-core's amount policy escalates with a handoff packet: "El asistente te pasó este caso", the "Traspaso" tab, and the close with "¿Te sirvió el traspaso?" → `handoffQuality: useful`, 200 |
| 4 | A smaller charge: "Confirma para seguir" (Sí) and "Confirma que eres tú" (a wrong code, then `000000`), whichever the assistant asks; the assistant's survey when it resolves |
| 5 | Colas: the row "Con el asistente", "No corre", "Asistente virtual"; "Tomar el caso" sends it to the queue and the customer is told |
| 6 | Rafael (Portuguese) is answered in Portuguese |
| 7 | Administración turns "Funciones de IA" off while the assistant holds a chat: the customer and Tomás see the hand-over ("IA desactivada" banner); it is turned on again |
| 8 | Auditoría, filtered by the case: rows with the actor "Asistente virtual" and its detail |

- **Only synthetic data reaches the model**: the scenarios write as the two simulator customers
  linked to agent-core's demo ids (Natalia `CUS-…2001` → `cust-001`, Rafael `CUS-…2004` →
  `cust-002`).
- **Seeded accounts only** (the stack's database outlives a run): Tomás Arango receives the
  hand-overs, Sebastián Cárdenas (paused) closes what a scenario left open, Lucía Herrera is
  Supervisión, Valeria Quintero is Administración. Before the run every seeded Analista is paused;
  if someone else is available the run stops and names her. Each scenario starts and ends with AI
  on, nobody available and both customers without an open conversation.
- **The model is nondeterministic**: the scenarios check states and structure (statuses, bubbles,
  cards, tabs, banners, the close request), never its words. A conversation that went elsewhere
  is closed and tried again, at most three times, and the retry is noted on the report ("model
  variance"); when agent-core refused with `rate_limited` the next attempt waits a minute.
- A failure leaves a trace and screenshots under `frontend/test-results/stack/`.

## 10. Troubleshooting

### Port in use

Symptoms: the backend exits with `[Errno 48] error while attempting to bind on address
('127.0.0.1', 8000): address already in use`; Vite with `--strictPort` says `Port 5173 is already
in use`. Without `--strictPort`, Vite takes another port (5174…) and the SPA cannot talk to the
API because that origin is not in `CC_CORS_ORIGINS`.

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN     # who holds the port (same for 5173)
kill <PID>
```

Or use other ports (section 3, "Other ports").

### The API does not start: `OutdatedSchemaError`

```
OutdatedSchemaError: The database schema is older than the code (missing tables: admin_roster).
Delete the local database (e.g. backend/cc_platform.db) and restart; there are no migrations yet.
```

The database was created by an older version. Delete `backend/cc_platform.db` and start again
(section 6). The local data is lost; the seed recreates it.

### "No hay conexión con el servidor" on sign-in

The SPA cannot reach the API. Check that the backend is running (`/api/v1/health`), that
`VITE_API_URL` points to it (restart `pnpm dev` after changing it) and that the exact SPA origin
(`http://localhost:5173` is not the same as `http://127.0.0.1:5173` nor another port) is in
`CC_CORS_ORIGINS`.

### The bell does not change

Notifications arrive through the same WebSocket (topic `staff:<id>`) and the list is fetched
again every 60 s and on reconnect. If an action did not produce the expected notification,
remember the rules (`api/slice-10-notifications.md` §3): nobody gets one for their own action;
"Un caso espera en la cola" arrives once per language while an older case is still waiting;
toasts only show on the role's screens (the bell keeps them all) and not when the screen already
shows the case. With `CC_NOTIFICATION_SWEEP_SECONDS=0`, the "Caso por vencer sin respuesta" ones
never arrive.

### Locked account

Five failed attempts (passwords or verification codes) lock the account for 15 minutes and the
screen shows "Tu cuenta está bloqueada por 15 minutos". Options:

- An admin (Valeria or Carolina) opens **Usuarios y roles**, picks the person and clicks
  **Desbloquear**. Through the API:
  `curl -s -X POST localhost:8000/api/v1/admin/users/<STF-…>/unlock -H 'Authorization: Bearer <admin token>'`.
- Wait the 15 minutes.
- Reset the database (section 6). Mariana Duque starts locked on purpose.

### "El enlace venció o ya se usó"

The `/activar` or `/restablecer` screen says this for any link that does not work: expired (48 h
for the invitation, 1 h for the reset), already used, replaced by a newer one (resending
invalidates the previous one) or cancelled. Open the most recent email in `/dev/correos` or ask
administration to resend it. If it says "Demasiados intentos", this browser opened 10 invalid
links in a row: wait 15 minutes (or restart the backend in development: the counter lives in
memory).

### The app code does not work

- Accounts that joined by invitation (and Tatiana Rojas): the code `000000` does **not** work;
  use the one from the app (or compute it with `pyotp`, section 5.1).
- The code changes every 30 seconds and one step of drift is accepted: if the phone's or the
  machine's clock is far off, sync it.
- Five wrong codes lock the account (on sign-in) or the activation (on `/activar`) for 15
  minutes.
- If you changed `CC_SESSION_SECRET` without setting `CC_TOTP_SECRET_KEY`, the stored keys can no
  longer be opened: reset the database (section 6).

### The chat does not update live (WebSocket)

Changes arrive through a single WebSocket per tab, `ws://<API>/api/v1/ws?token=…`. If messages
only show up after a reload:

1. In the browser dev tools, Network tab, filter by `ws` and look at the connection's state and
   close code.
2. `4401`: the token is no longer valid (you signed out, it expired, the account was deactivated,
   administration sent a password reset link or the database was reset). The SPA goes back to the
   sign-in; sign in again.
3. `4409`: an admin changed that person's roles. The client reconnects on its own and reloads the
   menu; nothing to do.
4. No connection or endless retries: the backend is not running, `VITE_API_URL` points elsewhere
   or a proxy does not let WebSockets through. The client retries with growing backoff and
   fetches the data again on reconnect.
5. Duplicated tab or two people in the same tab: open a new tab per person.

Notes: the realtime hub lives in the backend process (a single worker). If you run the API with
several workers, live messages do not cross between them.
