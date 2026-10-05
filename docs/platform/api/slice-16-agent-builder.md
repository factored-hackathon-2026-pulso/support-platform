# Slice 16 · The agent builder for supervisors (agent-core)

Contract for ADR 0003 §7. Like slices 14 and 15, the **backend is done and tested** and no screen was touched: this is the
hand-over for whoever wires "Supervisión · Agentes" (and "Administración" for revoking). Tests:
`tests/unit/application/test_builder.py`, `test_builder_chat.py`, `test_builder_constructor.py` (against a double of
`constructor-chat`'s flow), `tests/unit/domain/test_builder.py`,
`tests/unit/infrastructure/test_agent_registry.py`, `tests/contracts/test_agent_core_registry_contract.py`,
`tests/api/test_builder_api.py`.

## 1. What it is

An **agent** in agent-core is versioned data (flows, prompts, tools, policies). Changing one is a **proposal** that goes
through agent-core's registry (agent-core ADR 0018). The platform is a **client of that registry**: it adds screens'
worth of endpoints, the identity of the person acting, a fresh second factor for the decisions, an audit trail and a chat
with the builder agent (`constructor-chat`). Three rules hold everywhere:

1. **The person acts, not the platform and not the agent.** Every registry call carries a `builder` credential minted from
   *her* session: Supervisión is `constructor` + `aprobador`; Administración adds `admin`; always as a human
   (`attrs.actor = "human"`). The registry decides by its own roles. The builder agent only *proposes*: it never approves,
   publishes, promotes or revokes (agent-core ADR 0018 §6, ADR 0019 §4), and the platform never lends it her authority.
2. **Approve, reject, publish, promote and revoke need a fresh second factor** (the registry's `step_up`). The request
   carries `stepUpCode` (a code from her authenticator app); see §3.
3. **Every operation is audited** with ids, states and counters, never the content of a draft, a prompt, a reason or a
   chat text, and never on a socket.

Only **Supervisión and Administración** (`403 forbidden` otherwise). Without agent-core (`CC_AGENT_CORE_URL` unset) every
route is `404 assistant_disabled`, except `GET /builder/status` and `GET /builder/chat`, which answer `available: false`
(hide the section).

Configuration: `CC_BUILDER_AGENT` (default `constructor-chat@prod`); the rest is slice 14's (§2 there). agent-core must run
with `--registry-api` and load the platform's `staff-keys.json` (registry) **and** `identity-keys.json` (runtime): see
RUNBOOK §4.1.

## 2. The life of a proposal

```
draft ──freeze──▶ candidate ──evaluate (pass)──▶ evaluated ──approve──▶ approved ──publish──▶ published
  ▲                  │  │                           │  │                    │
  │                  │  └─ evaluate (fail) ─────────┼──┼────────────────────┘ (publish when staging moved: stale)
  └──── reopen ──────┴─────────── reopen ───────────┘  └── reject ──▶ draft
```

| State | What the person can do | Endpoint | Second factor |
|---|---|---|---|
| `draft` | write the draft | `PUT /builder/proposals/{id}/draft` | no |
| `draft` | check it (violations or the candidate hash) | `POST .../validate` | no |
| `draft` | freeze it into a candidate | `POST .../freeze` | no |
| `candidate` | evaluate it with the agent's suite | `POST .../evaluate` | no |
| `candidate`, `evaluated`, `approved` | go back to edit | `POST .../reopen` | no |
| `evaluated` | approve / reject | `POST .../approve`, `POST .../reject` | **yes** |
| `approved` | publish (a release; `staging` points at it) | `POST .../publish` (+ `Idempotency-Key`) | **yes** |
| `published` | point `staging` or `prod` at a release | `POST /builder/aliases/{agentId}/{alias}/promote` | **yes** |
| any release | withdraw it (Administración only) | `POST /builder/releases/{releaseId}/revoke` | **yes** |

Rules worth knowing (agent-core enforces them; the platform shows them as `registry_*` problems, §5):

- A **failed gate** returns the proposal to `draft` (the 409 carries the report). There is no manual override.
- Editing after `freeze` is `reopen`, then `PUT draft`: a new candidate, a new hash; evaluations and approvals bind to one hash.
- `publish` makes `staging` point at the release. If `staging` moved since the proposal was made, the proposal goes back to
  `draft` (409 `registry_conflict`, `registryCode: proposal_stale`): freeze and evaluate again.
- `revoke` is refused while `prod` points at the release.
- A person may walk the whole cycle and approve her own proposal (agent-core ADR 0018, 2026-09-30 amendment 4): the hard
  barrier is *human + step-up*, not a second person.

## 3. The second factor (step-up)

agent-core lets only a **human at `step_up`** approve, reject, publish, promote and revoke. The platform is the identity
issuer, so it decides when a person earned that level: **only while she types a fresh code from her authenticator app**, in
the very request that asks for the operation.

- Body: `"stepUpCode": "123456"` on `approve`, `reject`, `publish`, `promote` and `revoke`. **Ask for it in the confirmation
  dialog of each action**: nothing is remembered, so the next decision asks again.
- Verification is sign-in's: her own TOTP secret (an account created through an invitation); the development code
  (`CC_DEV_MFA_CODE`, `000000`) only for the seeded accounts that never enrolled an authenticator, and never in production.
- A **wrong code** is `422 builder_step_up_invalid` with `remainingAttempts`. It **counts toward the account lock** (a stolen
  session cannot guess codes for free): the fifth consecutive failure is `423 account_locked` with `unlockAt`. Do not
  retry blindly: show the attempts left.
- A good code raises **that one call** to `step_up`: the credential lives two minutes. The other steps (`PUT draft`,
  `validate`, `freeze`, `reopen`, `evaluate`, every read, the chat) use an ordinary credential and ask for nothing.
- `GET /builder/status` says whether the caller sees the decision controls (`canApprove`, `canRevoke`) and how the code is
  asked (`stepUpMethod: "authenticator"`, `stepUpDigits: 6`).
- Known gap (shared with sign-in): a code is not remembered after use, so it can be replayed inside its ~1 minute window.

## 4. Endpoints (session token; Supervisión or Administración)

All bodies and responses are camelCase; ids are agent-core's opaque text (proposal ids are UUIDs), not platform ids.

### Status and the list

- `GET /builder/status` → `BuilderStatus` `{available, canApprove, canRevoke, stepUpMethod, stepUpDigits}`. Always 200.
- `GET /builder/proposals?agentId=&state=&limit=&refresh=` → `ProposalList` `{items: ProposalSummary[], registryListed}`,
  newest first, at most 50. **Every proposal agent-core has** (its `GET /v1/registry/proposals`, contract 1.4.0, read as
  the person) **merged with the platform's index**, which remembers who brought each one here. With `refresh`
  (default) one call to agent-core's list gives the current state of every row (`live: true`) and refreshes the index's
  cache; an indexed proposal missing from a complete list is re-read by id. If agent-core's list does not answer (an
  outage, an agent-core before 1.4.0, a refusal), the **index alone** comes back, each row re-read by id as before (a
  row the registry did not answer for keeps its cached state, `live: false`) and `registryListed: false`: show a quiet
  notice. `refresh=false` returns the cached index, untouched (`registryListed: false`).
  `ProposalSummary`: `proposalId, agentId, title, origin, state, rev, baseReleaseId, candidateHash, createdBy,
  registeredBy, source, updatedAt, refreshedAt, live`. `source` is who brought it here: `platform` (created on this
  screen), `chat` (the builder chat's answer named it), `tracked` (by id), `engine` (announced by the improvement engine,
  ADR 0007; the dossier stays on the notification), or **`registry`**: only agent-core's list has it (the builder chat
  made it without naming it, or someone created it in agent-core). A `registry` row has `registeredBy: null`; listing it
  adopts nothing (no index row, no audit event).
- `POST /builder/proposals/track` `{proposalId}` → `ProposalSummary`: bring a proposal agent-core already has into the
  index (`source: tracked`). Idempotent. `404 registry_not_found` when the registry does not know it. Since the list reads
  agent-core's, this is the fallback for `registryListed: false` (the SPA shows "Seguir" only then).

### Building

- `POST /builder/proposals` `{agentId, title}` → `201 Proposal` (`draft`, based on the agent's `staging` release).
  `agentId` is agent-core's id (`disputas`); there is **no agent catalog** (see §8): validate it with
  `GET /builder/entities/agent/{agentId}` (404 = it does not exist).
- `GET /builder/proposals/{proposalId}` → `ProposalDetail` `{proposal, changes, lastEval, review}`: the draft (`changes`:
  full entities), the evaluation of the current candidate, and, once there is one, the approver's `review`
  (functional changes, release settings changed, the suite used, every gate item, what the yardstick loosens).
- `PUT /builder/proposals/{proposalId}/draft` `{expectedRev, changes: [{kind, content, docs: {description, rationale,
  changelog}}]}` → `Proposal`. **Replaces the whole draft.** `expectedRev` is the proposal's `rev` the caller saw (409
  `registry_conflict`, `registryCode: proposal_stale`, otherwise). A change is a full entity: `kind` (`agent`, `flow`,
  `prompt`, `tool`... or `release_settings`) and its `content`, which carries its own `id` and `version` (semver; the proposer
  sets the bump and `validate` demands it be higher than the base). Numbers travel as JSON numbers; for an exact decimal
  agent-core accepts a numeric string (`"0.50"`).
- `POST .../validate` → `ValidationReport` `{violations: [{rule, flow, nodeId, path, message}], candidateHash, autoBumped}`.
  Always 200; `violations: []` means it can be frozen. Changes nothing.
- `POST .../freeze` → `CandidateView` `{proposalId, candidateHash, releaseIdPreview, newVersions, autoBumped}`. 422
  `registry_validation_failed` (with `violations`) when the draft is not valid.
- `POST .../reopen` → `Proposal` (`draft` again, `rev` + 1).
- `POST .../evaluate` `{suiteId, suiteVersion?}` → `EvalReport` `{verdict, items, yardstickChanges, detail, runs, results,
  judgeNotes}`. **It waits for the evaluation** (it runs the real agent: seconds to minutes; the platform allows
  `CC_AGENT_CORE_TIMEOUT_SECONDS`): show a spinner. `pass` leaves the proposal `evaluated`. A failed gate is **409
  `registry_gate_failed`** with `report` (same shape) and `evalRunId`, and the proposal is back in `draft`.
  `GateItem` numbers are exact decimals as text. `runs`, `results`, `judgeNotes` are agent-core's own structures, passed
  through (keys are metric and scenario ids, not field names, so they stay snake_case).

### Deciding (step-up)

- `POST .../approve` `{candidateHash, acceptYardstickLoosened?, stepUpCode}` → `Approval`. `candidateHash` must be the
  proposal's current one (409 `registry_conflict`, `candidate_changed`). When the proposal **loosens the yardstick**
  (removes a metric, lowers a floor, widens a noise margin...) it is approved apart: the first call answers 409
  `registry_loosening_not_accepted` with `yardstickLoosened`; show it and ask again with `acceptYardstickLoosened: true`.
- `POST .../reject` `{reason, stepUpCode}` → `Proposal` (`draft`).
- `POST .../publish` `{stepUpCode}` + header `Idempotency-Key` (8-64 chars) → `201 ReleaseDetail`. One key per publication the
  person means to make: a retry with it returns the same release.
- `POST /builder/aliases/{agentId}/{alias}/promote` `{releaseId, reason?, stepUpCode}` → `AliasChange`. `alias` is `staging` or
  `prod`; **`prod` is what customers feel**.
- `POST /builder/releases/{releaseId}/revoke` `{reason, stepUpCode}` → `ReleaseDetail` (Administración only: a supervisor
  is `403 forbidden`).

### Releases, aliases, versions, entities (reads)

- `GET /builder/aliases/{agentId}/{alias}` → `AliasState` `{agentId, alias, releaseId, status}`; 404 `registry_not_found` if it points nowhere.
- `GET /builder/releases/{releaseId}` → `ReleaseDetail` (the exact versions it holds, `changedVsBase` per entity).
- `GET /builder/releases/{a}/diff/{b}` → `ReleaseDiff` `{added, removed, changed: [{before, after, docs}]}`.
- `GET /builder/versions/{kind}/{entityId}` → `VersionList` (oldest first) and `GET /builder/entities/{kind}/{entityId}?version=`
  → `EntityVersion` (full content). `entityId` may contain `/` (`t/saludo`): send it as is or encoded.

### The chat with the builder agent

- `GET /builder/chat` → `BuilderThread` `{available, messages: [{id, role: person | agent, text, createdAt, answers}],
  awaiting}`: one thread per person, the newest 200 messages; `available: false` without agent-core; `awaiting` is null
  on a read.
- `POST /builder/chat/messages` `{text (1-2000), clientMessageId}` + `Idempotency-Key` (= `clientMessageId`) →
  `BuilderExchange` `{message, answers, proposals, replayed, awaiting}`. Same mechanics as the copilot (slice 15): **it
  waits for the model**; the message is stored before the call; idempotent (the same text again is `200` +
  `Idempotent-Replayed: true` and does not ask twice; another text with that id is 409 `idempotency_conflict`); if the
  call fails (`503 agent_core_unavailable`, `502 agent_core_rejected` with `agentCoreCode`) the message stays in the
  thread: **send it again with the same `clientMessageId`**. `409 builder_busy` while it answers a previous message.
  `awaiting` is agent-core's after this answer: `slot` when the builder asked for a datum (the next message answers
  it), `none` when it finished or handed over; null on a replay.
- `POST /builder/chat/restart` (slice 22, "Nueva conversación") → `BuilderThread`: her thread starts over **and a run of
  the builder starts at once**, so the thread comes back with the run's opening question and `awaiting` (`slot`). If
  agent-core does not answer, the thread comes back empty (`awaiting: null`) and her next message starts the run.
- **Language.** The run and every turn carry her UI language (`es`, or `pt` for `pt-BR`; `constructor-chat` supports
  both since agent-core 1.4.0). A run started in one language follows the turns' language afterwards.
- **How `constructor-chat` takes a request** (agent-core's flow `construir`, checked in its code and live): the flow starts
  **when the run starts** and asks which agent (`¿Qué agente quieres modificar? (por ejemplo: disputas)`); the next
  message is taken **verbatim** as the agent id (a `collect` with no validator); it then asks what to change, and the next
  message is taken verbatim as the goal, which becomes the proposal's **title** (agent-core's `Proposal`: `agent_id`
  `^[a-z0-9][a-z0-9_/-]*$`, `title` 1-200 characters). Then it reads the agent, drafts with the model, creates the
  proposal as its service identity (`constructor-bot`, `origin: builder_chat`), writes and validates the draft, and
  answers **without naming the proposal** (its prompt says "sin incluir identificadores"). So a request is two messages:
  the agent id alone, then a goal of at most 200 characters. One message with both ("Agente: cobros. Objetivo: …") is
  swallowed whole as the agent id and the run ends in a handover.
- A message that starts a run (no run yet, or the last one ended or expired) answers that run's opening question: the
  answer carries the question first, then what the builder said to her message, so the thread reads in order.
- The agent only proposes: it never freezes, evaluates, approves or publishes. Any proposal id an answer names that the
  registry confirms joins the index (`source: "chat"`) and comes back in `proposals`; the ones it does not name are in
  the list anyway (`source: "registry"`).

## 5. Errors

All `application/problem+json` with the usual members; `registryCode` is agent-core's own code.

| Status · `code` | When | Extra members |
|---|---|---|
| 404 `assistant_disabled` | agent-core not configured | |
| 403 `forbidden` | not Supervisión or Administración (or a supervisor revoking) | `requiredRoles` |
| 422 `builder_step_up_invalid` | wrong `stepUpCode` | `remainingAttempts` |
| 423 `account_locked` | too many wrong codes (the lock is the account's) | `unlockAt` |
| 422 `registry_validation_failed` | the draft or candidate breaks rules, or exceeds limits | `registryCode`, `violations[]` |
| 409 `registry_gate_failed` | the evaluation did not pass (proposal back to `draft`), or there is no passing evaluation to approve | `registryCode`, `report`, `evalRunId` |
| 409 `registry_loosening_not_accepted` | approve without `acceptYardstickLoosened` | `yardstickLoosened[]` |
| 409 `registry_conflict` | `proposal_stale` (rev or staging moved), `candidate_changed`, `illegal_transition` (wrong state), `idempotency_conflict` | `registryCode` |
| 403 `registry_forbidden` | the registry's roles refuse (`forbidden_role`, `step_up_required`; the latter should not happen) | `registryCode` |
| 404 `registry_not_found` | proposal, release, alias, entity, version or evaluation suite does not exist | `registryCode` |
| 429 `registry_quota_exceeded` | agent-core's budget for the proposal | `registryCode` |
| 409 `builder_busy` | the chat is still answering | |
| 409 `idempotency_conflict` | chat: same `clientMessageId`, other text | |
| 503 `agent_core_unavailable` / 502 `agent_core_rejected` | agent-core does not answer / an authentication or internal refusal | `agentCoreCode`, `agentCoreStatus` |
| 422 `validation_error` | a malformed body (a missing `stepUpCode` included) | `errors[]` |

## 6. What to build (suggested)

- **Supervisión · Agentes → "Propuestas"**: the list (`GET /builder/proposals`, state chips from the five states, an
  "agent" filter), "Nueva propuesta" (agent + title), and a "Seguir una propuesta por id" action (`track`). Poll or reload
  on focus: states can change through the chat or another person.
- **Proposal detail** with the state as a stepper and tabs: *Cambios* (the draft; compare each change with the current
  version from `GET /builder/entities/{kind}/{id}`), *Validación* (violations list), *Evaluación* (gate items one by one,
  never a composite score; `lastEval` / `review`), *Decisión* (approve/reject with the code and the yardstick warning).
- **Draft editor**: a code/JSON editor per entity with the three `docs` fields; saving is `PUT draft` with the whole list
  and the `rev` the page loaded (on 409 `proposal_stale`, reload and merge). Disable it when the state is not `draft`; offer
  "Reabrir" instead.
- **Evaluation**: a progress state (the call blocks); handle 409 `registry_gate_failed` as a result, not an error: show
  `report.items` and say the proposal went back to draft.
- **Release and aliases**: for an agent, `GET .../aliases/{agent}/staging` and `/prod` show what runs; a diff between them
  (`GET /builder/releases/{a}/diff/{b}`); "Promover a prod" with the code; "Revocar" (Administración) with the code.
- **Chat panel** ("Constructor"): the thread as a small chat; one message at a time; on a returned `proposals[]` offer
  "Abrir propuesta". Show the failed message with "Reintentar" (same `clientMessageId`).
- Treat entity `content` and chat text like configuration, not customer data: do not log them.

## 7. How it works (for maintainers)

- **Port and adapters.** `AgentRegistryClient` (`application/ai/registry.py`: typed DTOs that mirror
  `agent-core/contracts/registry/*.json`) → `HttpAgentRegistry` (`infrastructure/ai/http_registry.py`, `httpx`) and
  `InMemoryAgentRegistry` (`memory_registry.py`: a small registry with agent-core's *authorization*: it reads the principal
  out of the credential the platform signed and applies `registry/roles.py`, so tests prove what is sent). Registry
  `problem+json` becomes `AgentRegistryError` (the structured bodies of `validation_failed`, `gate_failed` and
  `loosening_not_accepted` are parsed in the adapter); an outage is `AgentRuntimeUnavailableError`, as for the runtime.
- **Two credentials, two keys.** `issuer.builder(identity)` signs the registry credential with the **staff** key;
  `issuer.builder_run(identity)` signs the same person for the **runtime** (the chat) with the **identity** key, because
  agent-core verifies the runtime's principals against `--identity-keys` and the registry's against `--staff-keys`. (Found
  against a real agent-core: a staff-signed credential on `POST /v1/runs` is `credentials_invalid`.) The step-up credential
  lives 2 minutes (`STEP_UP_TTL`), the ordinary one 10.
- **The step-up check** is `BuilderStepUp` (`application/ai/builder_step_up.py`), reusing sign-in's `MfaCodeCheck`: the
  account's TOTP secret (or the dev verifier for accounts without one), failures counted with `register_failed_attempt` (factor
  `mfa`: audited as `auth.login_failed` and locking at the usual five).
- **The use cases** are `AgentBuilder` (`application/ai/builder.py`) and `AskBuilder` / `GetBuilderThread`
  (`builder_chat.py`), bundled in `BuilderUseCases` inside `AssistantUseCases.builder` (`None` when the registry is not
  wired; the routes answer `assistant_disabled`). Each operation: role check → (step-up) → registry call with **no transaction
  open** → one short Unit of Work that refreshes the proposals index and records the audit events.
- **Persistence.** `builder_threads` (`BuilderThread`, one per person) and `builder_proposals` (`BuilderProposal`, the
  index): see DATA_MODEL. The registry is the source of truth; the index is a cache plus "who brought it here".
- **The list** (`AgentBuilder.list_proposals`): agent-core's page (`AgentRegistryClient.list_proposals`, `GET
  /v1/registry/proposals` with `agent_id`, `state`, `limit`) and the index search with the same filters; an indexed row
  the list lacks is read by id only when the list is complete (a full page means it is older than every row); the index
  rows are refreshed in one Unit of Work; rows only agent-core has are built from its `Proposal` (`source: registry`).
  Sorted by `updatedAt`, then id, newest first (agent-core's order).
- **The chat's language and opening** (`AskBuilder`, `RestartBuilderThread`): her UI language comes from
  `ui_language_of`; the first turn of a run (`AgentRun.first_turn`) is stored as agent messages
  (`BuilderThread.record_opening` after a restart, or ahead of the answer when a message starts the run).
- **Audit** (`builder.*`, family `agents`, silent on sockets): ids, states, counters; the failed gate is audited too
  (`verdict: fail`) before the 409 reaches the caller. Spanish texts in `application/audit/catalog.py`.
- **The call can succeed and the audit fail** if the process dies between the registry call and the commit; the registry's
  own event log has the operation (`RegistryEvent`). Single process, like the rest.

## 8. Known gaps (open)

- **Evaluations need an `eval_suite`.** agent-core only evaluates an agent that has one (ADR 0018 §4, 9): without it `evaluate`
  is 404 `registry_not_found` ("no existe la suite") and, since approving and publishing need an `evaluated` proposal, an
  agent without a suite cannot go beyond `candidate`. Today **no demo agent has one** (checked against agent-core's local
  stack). The suite is data (`kind: eval_suite`): it can be written through the same draft, but whoever owns evaluation
  content has to author it. The screens should show the 404 as "Este agente no tiene suite de evaluación".
- **No agent catalog.** The registry has no "list agents": the screens take an `agentId` as text (validate with
  `GET /builder/entities/agent/{id}`) or from a configured list.
- ~~No list of proposals in agent-core~~ **Settled with agent-core 1.4.0** (`GET /v1/registry/proposals`): the list
  merges it with the index (§4). Verified live (2026-10-05): `constructor-chat`'s answer never names the proposal id (its
  summary prompt forbids identifiers), so before this the chat's proposals were orphans; they now show as `registry`.
- **`constructor-chat` takes each answer verbatim** (agent-core's `construir`: `collect` nodes with no validator). The
  platform answers in its format (§4), but a free message that starts a run is taken whole as the agent id. Asked of
  agent-core: a validator on `agente` (the agent id pattern) and on `objetivo` (1-200 characters, the title), or reading
  the slots the opening message already claims.
- **The builder's draft is refused** (verified live 2026-10-05, es and pt): after creating the proposal, `put_draft` is
  `invalid_args` (the model's entity has `name`, `description`, `instructions`, but no `id` / `version`), and the run hands
  over ("Te paso con un asesor."). The proposal stays in `draft` with no changes (`rev 0`). This is the drafting prompt
  and model's (agent-core): the platform shows the proposal and the handover.
- **Response schemas not published.** `contracts/registry/` has no `ProposalDetail`, `ValidationReport` or `CandidateView`
  (and its decimals are typed as numeric strings while agent-core's `dumps` writes JSON numbers: the adapter reads both). The
  contract test composes them from published pieces; ask agent-core to publish them.
- **Numbers in drafts** go through JSON doubles; use numeric strings for exact decimals.
- **Second-factor replay** inside the code's window (shared with sign-in); a real MFA provider would keep the last step.
- **Platform guardrails** (policies marked protected) cannot be edited through a proposal (`403 registry_forbidden`);
  changing a release's interrupts needs `admin`. Both are agent-core's rules.

## 9. Contract changes (checklist for the frontend)

**2026-10-05 (agent-core 1.4.0):** `ProposalList.registryListed` (required); `ProposalSummary.source` gains `registry`
and `registeredBy` becomes nullable; `BuilderExchange.awaiting` and `BuilderThread.awaiting` (`none | slot | confirmation
| step_up | input`, nullable, required members). The platform's copies of agent-core's contract are 1.4.0
(`tests/contracts/agent-core-openapi.json`, the listing extract `agent-core-registry-listing.json`, the version file).

Original list (slice 16):

After merging run `pnpm gen:api` (`frontend/src/api/schema.gen.ts` was **not** regenerated here). New: every `/builder/*` route;
schemas `BuilderStatus`, `Proposal`, `ProposalSummary`, `ProposalList`, `ProposalDetail`, `EntityDraft`, `VersionDocs`,
`VersionRef`, `Violation`, `ValidationReport`, `CandidateView`, `EvalReport`, `GateItem`, `YardstickChange`, `EvalRun`,
`ApprovalReview`, `ReleaseSettingChange`, `Approval`, `ReleaseDetail`, `EntityInRelease`, `EntityRef`, `AliasState`, `AliasChange`,
`ReleaseDiff`, `ChangedRef`, `VersionSummary`, `VersionList`, `EntityVersion`, `BuilderMessage`, `BuilderThread`,
`BuilderExchange` and the request bodies (`CreateProposalRequest`, `TrackProposalRequest`, `SaveDraftRequest`,
`EntityDraftRequest`, `EvaluateRequest`, `ApproveRequest`, `RejectRequest`, `PublishRequest`, `PromoteRequest`,
`RevokeRequest`, `AskBuilderRequest`).
`ProblemCode` gains `builder_step_up_invalid`, `builder_busy`, `registry_validation_failed`, `registry_gate_failed`,
`registry_loosening_not_accepted`, `registry_conflict`, `registry_forbidden`, `registry_not_found`, `registry_quota_exceeded`;
`ProblemDetails` gains `registryCode`, `violations`, `report`, `evalRunId`, `yardstickLoosened`. `AuditFamily` gains `agents`
(a new filter option in "Auditoría"; its event types: `builder.proposal_created`, `proposal_tracked`, `draft_saved`,
`proposal_validated`, `proposal_frozen`, `proposal_reopened`, `proposal_evaluated`, `proposal_approved`, `proposal_rejected`,
`proposal_published`, `alias_promoted`, `release_revoked`, `question_asked`, `answered`).

## 10. Checked against a real agent-core (2026-10-04, registry and one chat message)

With agent-core's local e2e stack (`agentcore serve --registry-api`, Postgres, the platform's public keys) and the platform's
real adapters over its HTTP API: creating a proposal, writing a draft (a version bump of `disputas`), validating, freezing,
stale-`rev` conflict, `reopen`, reading aliases, releases, versions, entities and a release diff all work and parse;
`approve` or `promote` without step-up is `step_up_required`, with a good code the registry's own state rules answer
(`illegal_transition`: not evaluated yet); `evaluate` is `404 not_found` (no suite, §8); an unknown proposal is `404`; the
audit shows the operations. The builder chat answered (`201`) as a `builder` signed with the identity key. Not exercised live:
a passing evaluation, approval, publication, promotion and revocation (they need an `eval_suite`), and a chat that creates a
proposal. They are covered by the double, which applies the same authorization.

## 11. Checked against the real stack (2026-10-05, agent-core 5e3fef9, contract 1.4.0)

Lucía, "Proponer un agente" for "Cobro indebido", in a browser on the local stack (screenshots `B-*`):

1. The sheet opens on a new run: the builder's own question (`¿Qué agente quieres modificar? (por ejemplo: disputas)`)
   and the request form (Agente `cobros`, Objetivo 193 of 200 characters).
2. "Enviar al constructor": `cobros` is accepted as the agent (`Cuéntame qué cambio quieres en ese agente.`, `awaiting:
   slot`), then the goal is sent.
3. agent-core creates the proposal (`cobros`, the goal as title, `origin: builder_chat`, `constructor-bot`), then its
   `put_draft` is refused (`invalid_args`, see §8) and the run hands over. The sheet offers "Abrir propuesta" (found in
   agent-core's list); the proposal is a draft with no changes.
4. Propuestas lists it, and two earlier orphan proposals of the builder, as "Del registro".
5. The same in Portuguese (her UI language `pt-BR`): the builder asks and hands over in Portuguese, the proposal is
   created and offered.

