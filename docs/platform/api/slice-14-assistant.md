# Slice 14 · The assistant (agent-core): AI-handled chat, hand-over to people

Contract for ADR 0003. **This is the hand-over document for whoever wires the frontend**: the backend
is done and tested (`tests/unit/application/test_assistant.py`, `tests/unit/domain/test_assistant.py`,
`tests/api/test_assistant_api.py`); no screen was touched. Read §1 to understand the model, §3 and §4
to wire the two apps, §7 for the checklist of what changes in the contract you already generate types
from.

Out of scope here (later slices): the analyst copilot (S15), the agent builder screens (S16),
production hardening (S17), the tool backend (track T, a separate service).

## 1. The model in one page

A customer writes in the chat. If the platform can let the **assistant** (an agent running in
`agent-core`) take the conversation, the case opens in a new state, **`with_assistant`**:

- nobody holds it, it is in **no queue** and in **no analyst inbox**, and **no first-response SLA
  runs**;
- the assistant's replies are ordinary customer-visible turns (`authorRole: "assistant"`);
- when the assistant needs the customer to **confirm** an action or pass a **second factor**, the
  conversation says so (`conversation.assistant`) and the customer answers through two small endpoints;
- it ends in one of five ways:

| How it ends | Case becomes | Customer status | Who gets it |
|---|---|---|---|
| The assistant **resolves** it | `closed` (reason `resolved`, closed by the assistant) | `closed` | nobody; the customer can rate it |
| The assistant **escalates** (it built a handoff packet) | `queued`, then `assigned` | `waiting_agent` → `with_agent` | the language queue, placed like any arrival (rule 3) |
| Its run **ends without resolving** (abstained, cancelled…) | `queued`, then `assigned` | same | same |
| agent-core is **down or refuses**, or the 3rd wrong second-factor code | `queued`, then `assigned` | same | same, with a staff banner saying why |
| The customer **asks for a person**, or **Supervisión takes it** | `queued`, then `assigned` | same | same |

Every hand-over to people resets the first-response SLA (it starts when the case reaches the queue), writes a
staff-only banner (a `routing` turn that says why), and, unless the assistant already said it, a public
notice to the customer. The assistant is **never** a first response, and is never "assigned".

Who is served by the assistant: only a **chat** case (`chat_app`/`chat_web`) of a customer that is
**linked to a dataset customer** (§6) whose **case language** is in `CC_ASSISTANT_LANGUAGES` (default
`es` and `pt`, policy `H1`; a language left out goes straight to people). Anything else behaves exactly as before.

**Calls and emails cannot join an assistant conversation** (nobody would answer them): they answer
`409 assistant_active`. The customer writes in the chat, or asks for a person first (§3.5).

## 2. Turning it on

The platform is people-only unless both are set (they go together):

| Variable | What |
|---|---|
| `CC_AGENT_CORE_URL` | agent-core's runtime URL (`agentcore serve`) |
| `CC_AGENT_KEYS_FILE` | the platform's private signing keys (`python -m cc_platform.scripts.gen_agent_keys`, RUNBOOK §4.1) |
| `CC_ASSISTANT_AGENT` | the agent a conversation starts with, default `recepcion@prod` |
| `CC_ASSISTANT_LANGUAGES` | JSON list of case languages the assistant serves, default `["es", "pt"]` |
| `CC_ASSISTANT_STEP_UP_CODE` | the simulated second-factor code, default `000000` (a development stand-in) |
| `CC_BANK_CUSTOMER_LINKS_FILE` | private JSON `{ "<platform customer id>": "<dataset customer_id>" }`, read at startup |
| `CC_AGENT_CORE_TIMEOUT_SECONDS` | how long one agent call may take, default 60 |

Without them every new route answers `404 assistant_disabled` and the existing flows are unchanged. The
platform schema gained two tables (`assistant_sessions`, `bank_customer_links`): there are still no
migrations, so an existing SQLite file fails fast with `OutdatedSchemaError` (delete `cc_platform.db`).

## 3. The customer's app

All routes are under `/api/v1/customer/…` with the customer token, like the rest of the simulator.

### 3.1 What changed in what you already read

`GET /customer/conversation`, the `POST …/turns` answer and every `conversation.updated` envelope now
carry `conversation.assistant` (always present, `null` unless `status` is `with_assistant`):

```json
{
  "caseId": "CASE-…", "status": "with_assistant", "agentName": "Asistente virtual",
  "assistant": {
    "working": false,
    "confirmation": { "summary": "Radicar una disputa por 120 USD", "token": "tok-1", "expiresAt": "2026-10-04T15:05:00Z" },
    "stepUp": null
  }
}
```

- `status: "with_assistant"` is new (`CustomerConversationStatus`). Here **"agent" keeps meaning a person**
  (`with_agent`); the assistant has its own value. `agentName` is `"Asistente virtual"` (localised to the
  case language) while the assistant holds the case.
- `assistant.working` is `true` while an answer is on its way: show "escribiendo…". It is `false` when the
  assistant waits for the customer (a message, a confirmation or a second factor).
- At most one of `confirmation` and `stepUp` is set.
- Turns: `authorRole: "assistant"` (new in `CustomerTurnAuthor`), `authorName: "Asistente virtual"`. The
  agent's internal id (`recepcion@1.0.0`) never reaches a customer, over REST or the socket.

### 3.2 Writing

`POST /customer/conversation/turns` is unchanged. The first message of a new case opens it in the
assistant's hands (`caseCreated: true`, `conversation.status: "with_assistant"`). **The answer is not in
the response**: the model takes seconds. It arrives as a `turn.created` envelope on `customer:<id>` (§5) and
by `GET /customer/conversation?afterSequence=…`. Several messages in a burst are answered in order, one at a
time.

### 3.3 Confirmation

When `assistant.confirmation` is set, show `summary` with Yes / No (and `expiresAt`):

`POST /customer/conversation/confirmation` `{ "token": "<confirmation.token>", "answer": "yes" | "no" }`
→ `200` the conversation (now `assistant.working: true`, `confirmation: null`). The assistant's reply
arrives as a turn. A "Confirmaste la acción." / "Cancelaste la acción." notice is added to the transcript.

Errors: `409 confirmation_not_pending` (wrong or already-answered token), `409 confirmation_expired`
(ask the customer to start over), `409 assistant_not_active` (people have it now), `409 assistant_busy`.

### 3.4 Second factor ("step-up")

When `assistant.stepUp` is set (`{ reason, simulated }`), show a code prompt. **`simulated: true` means the
code is a development stand-in** (`CC_ASSISTANT_STEP_UP_CODE`, default `000000`): label it as such.

`POST /customer/conversation/step-up` `{ "code": "000000" }` → `200` the conversation. The assistant then
resumes the interrupted request by itself (its reply arrives as a turn). A wrong code is
`422 invalid_step_up_code` with `remainingAttempts`; **the third wrong code hands the case to people**
(`remainingAttempts: 0`; refetch the conversation: `status` is `waiting_agent`). `409 step_up_not_pending`
when none is asked.

### 3.5 Ask for a person

`POST /customer/conversation/human` (no body) → `200` the conversation with `status: "waiting_agent"` (or
`with_agent` at once if an analyst was available). Offer it permanently while `status` is
`with_assistant`, and when a call or an email answers `assistant_active`.

### 3.6 After it ends

`closed` conversations behave as before: the rating survey (slice 7) works on an assistant-resolved case, and
the next message opens a new case linked to this one (which starts with the assistant again). A hand-over to
people is seen by the customer as `status: "waiting_agent"` then `"with_agent"` with the analyst's first name;
earlier assistant turns stay in the transcript.

## 4. Staff screens

### 4.1 Analyst

- A case that came from an assistant escalation arrives in the inbox like any new case (status `assigned`,
  "Nuevos"). Its assignment reason is **`assistant_handoff`** (new `AssignmentReason`; the "Cómo llegó a ti"
  row: "Asignado a … tras el traspaso del asistente"). The notification is the usual "asignado" one.
- The transcript shows the assistant's turns with `authorRole: "assistant"`, `authorName:
  "Asistente virtual"` (staff view: Spanish), and staff-only banners (`kind: "routing"`) saying how the case
  left the assistant (escalated with a handoff reference, ended, failed with a code, taken by Supervisión,
  asked for by the customer). The customer's messages written before the hand-over are **unread** for her.
- **Priority**: when the assistant escalates, the case takes the priority agent-core saw in its handoff packet (`low`..`critical`; a stolen card arrives `critical`), set by the system in the background right after the hand-over (`case.priority_changed`, actor `system`). Best effort: if agent-core does not answer, the case keeps priority `none`. The card's priority glyph and the supervisor's menu already show it.
- **The handoff packet**: `GET /cases/{caseId}/handoff` → `{ "packet": { … } }`. Only the case's assignee
  (`403 case_not_assigned` for anyone else, `403 forbidden` without the Analista role) and only when the case
  came from an escalation (`404 handoff_unavailable`). `packet` is agent-core's `HandoffPacket` **as it
  publishes it, snake_case, rendered for her permissions**: `request_summary {text, citations}`,
  `verified_facts`, `claimed_not_verified`, `actions_taken`, `open_questions`, `evidence_refs`,
  `transcript_ref`, `target_queue`, `priority`, `reason_code`, `language`, `handoff_ref`. Show it in the
  "Ficha del cliente" side panel (suggested "Traspaso del asistente"). `503 agent_core_unavailable` /
  `502 agent_core_rejected` (with `agentCoreCode`, `agentCoreStatus`) when agent-core does not answer: show a
  retry, never block the conversation.
- **Labelling the handoff when closing**: `POST /cases/{caseId}/close` takes an optional
  `handoffQuality`: `"useful" | "incomplete" | "unnecessary"`. Only meaningful for a case with a handoff;
  the platform sends it to agent-core in the background (it never fails the close). **Leave it out when you
  don't know**: the platform never guesses a label. Suggested UI: a three-way choice in the close dialog
  only when `GET …/handoff` works.

### 4.2 Supervisión

- **"Colas"** (`GET /supervision/open-cases?language=`) now also lists the assistant's cases: rows with
  `case.status: "with_assistant"` and `assigneeName: null`. They are **not** in `GET /supervision/queues`
  (`cases`, counts, SLA-at-risk) because nobody is waiting for a person. Sort: they come
  last (after the cases nobody holds and the ones an analyst holds); they carry `inboxStatus: null`.
- **Take it from the assistant**: `POST /supervision/cases/{caseId}/assistant/release` (supervisors only) →
  `200` `CaseSummary` (`status: "queued"`, or `assigned` if an analyst was available). `409
  assistant_not_active` when the assistant does not hold it. Suggested button: "Tomar el caso" on those rows.
- Escalated cases show the usual "Colas" row, with the banner in the transcript.
- **Audit** ("Auditoría"): new event types, all with Spanish descriptions, no message text: `case.assistant_started`,
  `case.assistant_released`, `assistant.session_started`, `assistant.turn_answered`, `assistant.input_queued`,
  `assistant.step_up_verified`, `assistant.step_up_rejected`, `assistant.ended`. Actor role `assistant`.

## 5. Realtime

Same socket, same topics, same envelope `{type, id, occurredAt, data}`. Nothing to subscribe to that is new.

| Topic | New or changed envelopes |
|---|---|
| `customer:<customerId>` | `turn.created` for the assistant's replies (`CustomerTurn`, `authorRole: "assistant"`); `conversation.updated` (`CustomerConversation`) after **every** assistant event, so `assistant.working` / `confirmation` / `stepUp` stay current without polling |
| `case:<id>`, `inbox:<staffId>` | `turn.created`, `case.updated` as before; a hand-over sends `case.updated`, then `case.assigned` to the analyst |
| `supervision:queues` | `queue.updated` also when an assistant case opens, is released or resolved (refetch `GET /supervision/open-cases`) |

On a hand-over the customer socket gets, in order: the assistant's last reply, `conversation.updated`
(`status: "waiting_agent"` or `"with_agent"`), the notice turn. Dedupe on `(type, id)` as always. A socket only
signals: `GET /customer/conversation` is the source of truth after a reconnect.

## 6. Linking customers to the dataset

agent-core's customer principal is the **dataset's `customer_id`** (the challenge data in `gold_restricted`),
not the platform's `CUS-…`. The link lives in `bank_customer_links`, filled **at startup** from
`CC_BANK_CUSTOMER_LINKS_FILE` (`{ "CUS-…": "<dataset id>" }`, private, never committed; unknown platform ids are
skipped and counted in the log). An unlinked customer never starts with the assistant. There is no endpoint to
edit links yet.

## 7. What changed in the generated contract (checklist for the frontend)

After merging, run `pnpm install && pnpm gen:api` (`backend/openapi.json` is regenerated and committed, but
`frontend/src/lib/api/schema.gen.ts` is **not**: `pnpm check:api` fails until you do). New enum members that
exhaustive maps (`Record<Enum, …>`, `switch`) must handle:

| Enum | New value |
|---|---|
| `CaseStatus` | `with_assistant` |
| `CustomerConversationStatus` | `with_assistant` |
| `TurnAuthorRole` (staff turns) / `CustomerTurnAuthor` | `assistant` |
| `ActorRole` (audit, `closedBy…`) | `assistant` |
| `AssignmentReason` | `assistant_handoff` |
| `ProblemCode` | `assistant_disabled`, `assistant_not_active`, `assistant_active`, `assistant_busy`, `confirmation_not_pending`, `confirmation_expired`, `step_up_not_pending`, `invalid_step_up_code`, `handoff_unavailable`, `agent_core_unavailable`, `agent_core_rejected` |

New or changed shapes: `CustomerConversation.assistant` (`AssistantState | null`), `AssistantState`,
`AssistantConfirmation`, `AssistantStepUp`, `CaseHandoff`, `CloseCaseRequest.handoffQuality`,
`ProblemDetails.agentCoreCode` / `agentCoreStatus`. New routes: `POST /customer/conversation/confirmation`,
`/step-up`, `/human`; `GET /cases/{caseId}/handoff`; `POST /supervision/cases/{caseId}/assistant/release`.

Things that are easy to get wrong:

- A `with_assistant` case has `inboxStatus: null` and no assignee: it is in **no analyst list**. Do not
  treat "no `inboxStatus`" as "queued": use `status`.
- `CaseSummary.status` for staff can now be `with_assistant` (Supervisión only sees such cases).
- The customer's `closedAt`/`closed` rating flows are unchanged; a case closed by the assistant has
  `closure.closedByName: "Asistente virtual"` and `closedById` equal to the agent reference.
- Customer text never says "Asistente" except what the platform wrote ("Asistente virtual"): the agent writes
  its own words.

## 8. Error codes (new)

| Status | `code` | When |
|---|---|---|
| 404 | `assistant_disabled` | agent-core is not configured |
| 409 | `assistant_not_active` | people already have the case / the session ended |
| 409 | `assistant_active` | a call or email tried to join an assistant conversation |
| 409 | `assistant_busy` | an answer is on its way, or a stale answer was refused |
| 409 | `confirmation_not_pending` / `confirmation_expired` | §3.3 |
| 409 | `step_up_not_pending` | §3.4 |
| 422 | `invalid_step_up_code` | §3.4 (`remainingAttempts`) |
| 404 | `handoff_unavailable` | the case did not come from an assistant escalation |
| 503 | `agent_core_unavailable` | agent-core did not answer (handoff read) |
| 502 | `agent_core_rejected` | agent-core refused (`agentCoreCode`, `agentCoreStatus`) |

## 9. How the backend works (for maintainers)

- `AssistantSession` (`domain/ai/session.py`, table `assistant_sessions`, one per case): agent-core's
  `session_id`/`run_id`, what the agent waits for, and the **input bookkeeping**: exactly one input is *in
  flight* (`claim`, a compare-and-set), a confirmation answer is *queued*, an input that stopped at a
  step-up is *blocked* and resent with the elevated credential and a new `client_turn_id` (`<id>.1`). A
  stale claim (the job died) is taken over after `claim_timeout` (2 min); agent-core de-duplicates by
  `client_turn_id`, and the run's idempotency key is the session id.
- `AssistantTurnProcess` (a bus subscriber like `QueueDrainer`) spawns `AssistantEngine.run_case` on a
  customer message, a queued confirmation or a verified step-up. **No Unit of Work spans a call to
  agent-core**: claim (short UoW) → call → apply (short UoW). Any unexpected error hands the case to people
  and is logged by the background runner.
- Credentials are minted per call by `AgentCredentialIssuer` (Ed25519 JWS, ADR 0003 §2): a `customer`
  principal (`id` = the dataset customer), elevated to `step_up` (simulated) for 15 minutes after a verified
  second factor; an `advisor` principal plus a **10-minute delegation** for the analyst's handoff read and
  resolution (nothing to revoke when the case is reassigned: the grant simply expires).
- The agent's answer becomes `assistant` turns; an empty message is skipped, a long one is cut at 4000
  characters. `awaiting`, the confirmation and the step-up are stored from the answer.
- Hand-over (`AssistantHandover`): `with_assistant → queued` (`case.assistant_released` +
  `case.status_changed`), banners, then `AssignCase.place(reason=assistant_handoff)`: it never jumps its
  language queue.

## 10. Known gaps and decisions

- **Streaming**: agent-core answers request/response; a turn takes as long as the model (up to
  `CC_AGENT_CORE_TIMEOUT_SECONDS`). The UI shows `assistant.working` meanwhile.
- **Single process**: the bus, the realtime hub and the background jobs run in-process (as the rest of the
  platform). A job lost with its process is recovered by a **sweep** (`SweepAssistantSessions`, every
  `CC_ASSISTANT_SWEEP_SECONDS`, 30 s by default): for every active session quiet for 20 s it re-runs the
  (idempotent) job, which takes over a stale claim or resends an unanswered message; agent-core
  de-duplicates by `client_turn_id`.
- **The second factor is simulated** and says so (`simulated`, and `auth.simulated` in the credential).
- **`grant_active`**: the platform now answers it at `GET /api/v1/internal/grants/{grantRef}` (secret
  `CC_INTERNAL_SERVICE_TOKEN`; `{"active": bool}`; a grant is `<case id>:<staff id>`, active while she is an
  active analyst and the assignee of that case, open or closed). agent-core still needs an adapter that
  calls it (its `serve --grant-active module:attr` is a demo double today); the 10-minute TTL bounds the
  risk meanwhile.
- **Tools and data**: the assistant's tools run in agent-core (today demo doubles with `ALLOW_DEMO=1`). The
  real tool service over `gold_restricted` is track T.
- **First-response SLA**: decided that the assistant's reply does not stop it, and it restarts when the case
  reaches people.
- **Language**: only `CC_ASSISTANT_LANGUAGES` (default Spanish and Portuguese) start with the assistant.
- **No customer-facing "which agent"**: after a transfer between agents (`recepcion` → `disputas`) the
  customer sees the same "Asistente virtual".

## 11. Trying it end to end

1. agent-core: `scripts/e2e/setup.ps1` then `serve.ps1` (its README), but with the platform's public keys
   (`gen_agent_keys`, RUNBOOK §4.1) in `.e2e/identity-keys.json` and `.e2e/staff-keys.json`, and
   `serve --port 8001`.
2. A links file, e.g. `{ "CUS-00000000000000000000002001": "<a customer_id of the dataset>" }`.
3. Platform: `CC_AGENT_CORE_URL=http://127.0.0.1:8001 CC_AGENT_KEYS_FILE=… CC_BANK_CUSTOMER_LINKS_FILE=… uv run cc-api`.
4. `/cliente` as Natalia Guzmán (linked, Spanish): she talks to the assistant. An analyst who is available
   receives the case when it escalates.

The backend tests need no agent-core: `InMemoryAgentRuntime` (`infrastructure/ai/memory_runtime.py`) is a
scripted fake, and `tests/assistant_support.py` builds a container around it.
