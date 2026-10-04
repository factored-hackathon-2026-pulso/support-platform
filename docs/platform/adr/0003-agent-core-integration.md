# ADR 0003 · Integrating agent-core: AI-handled chat, analyst copilot and agent builder

- Status: **Accepted in principle** (user decisions of 2026-10-04); the open points in §6 are settled slice by slice. **S13, the backend of S14 and the backend of S15 (copilot) are built** (contract: `api/slice-14-assistant.md`); decided while building S14: the assistant's replies never stop the first-response SLA and the SLA restarts when the case reaches people; only chat cases and `CC_ASSISTANT_LANGUAGES` (default Spanish and Portuguese since 2026-10-04, policy `H1` rewritten) start with the assistant; a call or an email cannot join an assistant conversation; delegations are minted per call and live 10 minutes. **The backend of S16 (agent builder) is built** (contract: `api/slice-16-agent-builder.md`); decided while building S16: a fresh authenticator code (`stepUpCode`) in the body of each call is what raises the person to the registry's `step_up`, nothing is remembered; the registry and the builder chat use two credentials signed with two keys; the platform keeps an index of proposals because agent-core cannot list them (§7).
- Date: 2026-10-04
- Scope: `backend/`, `frontend/`, and the contract with the sibling repo `agent-core`.
- Related: `ENGINEERING_BRIEF.md` §1 (scope, amended by this ADR), ADR 0001 (architecture, still stands), ADR 0002 (superseded; not revived).
  In `agent-core`: M9 (access and API), M10 (handoff), ADR 0006 (principals and delegation), ADR 0019 (internal agents), `docs/plan-e2e-produccion.md`.

## Context

On 2026-10-03 the product was cut to a people-only chat platform and ADR 0002 said that, if AI came back, a new ADR must start from the current architecture. It comes back now: `agent-core` is a decision engine that runs agents described as versioned data, and the goal is to wire it into the platform so that:

1. a customer can talk end to end with an agent (`recepcion` → `disputas` / `consultas`) and, when the agent escalates, reach an analyst with a structured handoff;
2. analysts get a copilot (`copiloto-asesor`) that reads, calculates and suggests what to look up;
3. supervisors build and change agents (`constructor-chat` and the registry API).

What `agent-core` already gives: a runtime API (`POST /v1/runs`, `POST /v1/sessions/{id}/turns`, handoffs, transcript, lineage), a registry API (`/v1/registry`: proposals, validate, freeze, evaluate, approve, publish, aliases), an export API and outbound events. What it requires from its caller: signed identities (Ed25519 JWS principals and delegations), a real tool backend, authorization and a transcript store (today all doubles behind `AGENTCORE_ALLOW_DEMO=1`), and a caller that mints the delegation when a case is assigned (ADR 0006 names the assignment queue as the delegation issuer, which is this platform).

## Decision

1. **A new bounded context, `ai`, behind a port.** `application/ai/` defines `AgentRuntime` (start a run, post a turn, read a handoff, record a resolution) and `AgentRegistryClient` (the registry API). `infrastructure/ai/` holds the HTTP adapters (`httpx`) and an in-memory fake used by every test. The platform never imports `agent_core`; the contract is `agent-core/contracts/openapi.json`, from which the typed client is generated and checked for drift like `openapi.json` is today.
2. **The platform is the identity issuer.** An `AgentCredentialIssuer` port signs Ed25519 JWS principals and delegations and publishes the public keys that `agentcore serve` loads (`--identity-keys`, `--staff-keys`, rotated by `kid`).

   | Platform actor | agent-core principal |
   |---|---|
   | Customer session | `customer` (subject derived from the credential, never from the body) |
   | Analista on a case | `advisor` + a delegation `on_behalf_of` (`grantee` = the analyst, `subject` = the customer), signed when the case is assigned |
   | Supervisión | `builder` with roles `constructor` and `aprobador` |
   | Administración | `builder` with `constructor`, `aprobador` and `admin` (the only builder that reaches customer data, and only as a human at `step_up`: agent-core ADR 0006) |

3. **One case, an agent as assignee.** An AI-handled conversation is the same `Case` aggregate (one open case per customer, linked cases after a close, one transcript). The assignee becomes a union of person or agent, turns gain the author role `agent` (audience `everyone`), and a `case_agent_sessions` record links a case to its agent-core `session_id` (runs in a session are read from `GET /v1/sessions/{id}/lineage`). No parallel conversation entity.
4. **The agent turn runs outside the customer's Unit of Work.** The customer's message commits as today; an `AgentTurnProcess` process manager (same shape as `QueueDrainer`) then calls the runtime with the `clientMessageId` as idempotency key and appends the answer in a second Unit of Work, pushing it over the existing `customer:<id>` socket. agent-core has no streaming, and a turn takes as long as the model. If the runtime fails or times out, the case falls back to the language queue with a staff-only banner, never to silence.
5. **Escalation reuses assignment.** When a run closes as `escalated` (it carries a `handoff_ref`), the case leaves the agent and enters the language queue through the existing `AssignCase` (rule 3). On assignment the platform signs the delegation, and the analyst reads the packet through `GET /v1/handoffs/{ref}` (rendered for her permissions). Closing the case sends the handoff resolution (`resolution_code` from the close reason, `handoff_quality` asked of the analyst: `useful`, `incomplete`, `unnecessary`).
6. **The copilot suggests and consults; it does not act.** One run of `copiloto-asesor` per (analyst, case), through a platform endpoint that mints the advisor credential and delegation. It is the "Copiloto" right panel in the Workspace. There is no action catalog on bank systems and no execution of tools by the analyst: that follows agent-core ADR 0019 (read and compute only in the first version).
7. **The builder is a client of the registry.** Chat with `constructor-chat` through a proxy, plus screens in Supervisión for proposals, diff, evaluation, approval, publication and aliases. The platform never approves or publishes on someone's behalf: the human acts with her own `builder` credential, and the registry decides by its own roles. Decided while building S16 (`api/slice-16-agent-builder.md` is the contract):

   - **Identity.** Supervisión signs as a human `builder` with `constructor` and `aprobador`; Administración adds `admin`; always `attrs.actor = "human"`, derived from her roles in the directory, never from a request. The builder agent and the registry lend nothing: agent-core's registry tools run with the service identity `constructor-bot` and the person is only an audit context (agent-core ADR 0019 §4).
   - **Two credentials, two keys.** agent-core verifies the registry's principals against `--staff-keys` and the runtime's (`POST /v1/runs`, the chat) against `--identity-keys`. The registry credential is signed with the staff key (`issuer.builder`), the chat's with the identity key (`issuer.builder_run`). Found against a real agent-core: a staff-signed credential on a run is `credentials_invalid`.
   - **Step-up.** agent-core lets only a human at `step_up` approve, reject, publish, promote and revoke. The platform grants that level **per call, to a person who types a fresh code from her authenticator app in the same request** (`stepUpCode`), verified with sign-in's TOTP check (her own secret; the development code only for seeded accounts that never enrolled one). A wrong code counts toward the account lock; a right one yields a credential at `step_up` that lives two minutes; nothing is remembered. Alternatives rejected: a session-wide "elevated" window (a stolen session would inherit it), reusing the sign-in MFA as proof (it is minutes or hours old), an approval by a second person (the registry's rule is human + step-up, not four eyes), and the platform signing `step_up` on its own authority (it would lend exactly the authority this decision refuses to lend).
   - **No list in the registry.** agent-core has no "list proposals" call, so the platform keeps an index (`builder_proposals`: the ones created here, found through the builder chat, or tracked by id) and reads the registry for every detail. Asking agent-core for a listing would remove it.
   - **Audit.** `builder.*` events (family `agents`): ids, states and counters, never a draft, a prompt, a reason or a chat text; never on a socket.
   - **Evaluations.** agent-core only evaluates an agent that has an `eval_suite`; without one nothing goes past `candidate` (ADR 0018 §4, 9). Open, content work.
8. **Tools are served over HTTP, from the ETL's data.** agent-core's `ToolExecutor` is an in-process Python port loaded with `--tools module:attr`, and the only real executors today are the builder's and the directory's. The decision is to add an `HttpToolExecutor` to agent-core (the counterpart of `HttpLLMGateway`, ADR 0024) that calls an internal tool service with service-to-service authentication. The service enforces the subject from the signed `ToolCallContext`, never from arguments. This is a cross-repo change in agent-core and needs its own ADR there.

   The data comes from `data-pipeline`, which reads the challenge's S3 bucket (`LATAM_Bank_Complete_Data_Dictionary` PDF at the repo root, credentials only in environment variables) and publishes `gold_restricted.duckdb`: per-customer read-models (`customer_profile`, `customer_products`, `customer_transactions`, `customer_cases`) with clear, classified PII, whose intended reader is "authenticated agent-core tools" (`data-pipeline/docs/02-gobierno-de-datos.md`, access matrix). Where the tool service lives (a small service over `gold_restricted`, or platform endpoints) is open in §6; the data contract is not.
9. **Events.** The platform's event log emits the AI entities of the `platform_history` contract again (routing step, tool call, copilot query), so the data pipeline can read them. agent-core's outbound events (`run.*`, `handoff.*`, `release.*`) are consumed later, by the relay or the export API, for analytics and not for state.

## Not changed

Hexagonal layering, CQRS-lite, optimistic concurrency, the append-only event log, problem+json, rule 3 (language, `H1`) and every product rule of brief §4.3 stand. Customers still see only their own cases and only `everyone` turns; staff banners never reach them, including agent-related ones.

## Alternatives rejected

- **A conversation entity separate from the case.** It isolates the AI flow but duplicates the transcript, breaks the customer's history and the one-open-case rule, and forces a second escalation path.
- **Tools as a Python package loaded into agent-core.** Fast, but it couples the two repos' releases and puts platform data access inside the engine's process.
- **Reviving ADR 0002 (AG-UI streaming).** agent-core answers request/response; the sockets that exist already carry the signal.
- **Letting the platform approve and publish for supervisors.** It would lend the platform's authority to a person's action and defeat the registry's roles.

## Consequences

- The platform stops being people-only: the brief's out-of-scope list, the README and the backend README are amended in the same change.
- Production needs more than the integration: the platform runs on SQLite without migrations in a single process, has only the development mailbox (`CC_ENV=prod` refuses to start), and authenticates customers only through the simulator. agent-core cannot leave demo mode until the tool backend, authorization, transcript store, calibration and field classifier are real. These are listed as slice 17 and track T below; nothing here claims them done.
- Two systems hold a transcript (the case turns and agent-core's). The case is the customer-facing record; agent-core's is the audit record. Divergence is a risk to watch, not a design goal.
- An AI-handled case needs a visible state for supervision ("Atendido por agente") that the current four statuses do not have.

## 6. Open points (settled in the slice that needs each)

- **Where the tool service lives.** The governance matrix limits `gold_restricted` to agent-core's authenticated tools, so a separate read-only service over it keeps the platform away from PII in clear; platform endpoints are simpler but widen who reads it. Recommended: the separate service.
- **Customer linkage.** Platform customers are invented (`CUS-…`); the dataset's are not. The customer principal's id must be the dataset `customer_id` (it is `pii_direct` in the catalog, so the model only sees a token), so a platform customer needs a `bankCustomerId`, filled at runtime from the data and never committed (brief §4.7).
- **Writes.** `gold_restricted` is a read-only snapshot. `radicar_pqr` needs a writable store (a platform record of filed PQRs), and `leer_pqr_cliente` would read the dataset's `customer_cases` plus what the platform filed.
- **Grant revocation.** agent-core's verifier asks the assignment issuer whether a delegation (`grant_ref`) is still active (`grant_active`, a demo double in `serve`; it fails closed). The platform must answer it: a grant dies when the case is reassigned, closed or escalated away from the analyst. Needs an internal endpoint here and a real `grant_active` adapter in agent-core (same cross-repo ADR as the tool executor).
- **Tool and field alignment.** The registry's tool definitions use synthetic `cust-001` shapes; they must be re-pointed at the real read-model columns and at the catalog's field classes. The ETL's catalog already exports in agent-core's `FieldClassification` format (545 entries), which also covers the real `FieldClassifier` still missing in `serve`.
- **Portuguese.** Settled 2026-10-04: policy `H1` now reads "the assistant serves Spanish and Portuguese; when it hands a case over, it goes to a person who speaks the customer's language". `CC_ASSISTANT_LANGUAGES` defaults to both. The quality of agent-core's Portuguese is agent-core's to confirm; until then a deployment can set `["es"]`.
- **First-response SLA.** Whether an agent's reply stops the clock or only a person's does.
- **Agent steps in the audit.** How much of agent-core's chain (decisions, tool calls) is shown to supervision, and what the audit text says (no content, ids and enums only).
- **Customer authentication.** The simulator's stateless token is not a real channel identity; the step-up OTP is simulated in agent-core.

## Slice plan (planned)

| Slice | Scope |
|---|---|
| S13 | Contract and identity: this ADR and the brief, the combined compose (platform, agent-core, Postgres, llm-gateway), the generated typed client, `AgentCredentialIssuer`, `AgentRuntime` with its HTTP adapter and fake. |
| S14 | AI-handled customer chat end to end: agent assignee and author, `AgentTurnProcess`, confirmation and step-up in the simulator, escalation to the queue with the packet, the resolution at close. |
| S15 | Analyst copilot panel (minimum: ask and read answers with sources). **Backend built.** |
| S16 | Agent builder screens in Supervisión and the builder chat. **Backend built** (`api/slice-16-agent-builder.md`); screens are the frontend team's. |
| S17 | Production hardening: Postgres and migrations, a real email adapter, real customer authentication, secrets, outbound-event consumption, trace ids across both systems. |
| T | Tool backend: `HttpToolExecutor` in agent-core and `/internal/agent-tools/*` here, in parallel with S14. |
