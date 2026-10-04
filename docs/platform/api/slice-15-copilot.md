# Slice 15 · The analyst's copilot (agent-core)

Contract for ADR 0003. Like slice 14, the backend is done and tested (`tests/unit/application/test_copilot.py`,
`tests/unit/domain/test_copilot.py`, `tests/api/test_copilot_api.py`) and no screen was touched: this is the
hand-over for whoever wires the Workspace panel. The assistant (slice 14) talks to the **customer**; the
copilot talks to the **analyst** about a case she holds.

## 1. What it is

The copilot is an agent-core agent (`copiloto-asesor`) that **reads and calculates**: it answers the analyst's
questions about the customer and suggests what to look up. It **never acts** (no tool that writes, no action
catalog, ADR 0003 §6). It runs **as the analyst**: the platform signs an `advisor` credential for her and a
10-minute delegation on this one customer, so agent-core decides what she may see (PII in clear or masked).

- One **thread per (case, analyst)**; it survives a reload (`GET`) and keeps the newest 200 messages.
- Only the case's **assignee analyst** (she needs the Analista role): anyone else is `403 case_not_assigned`,
  a supervisor `403 forbidden` (a supervisor holds no customer data, by agent-core's own rule).
- Only while the case is **open** (`409 case_closed` for a new question; a thread stays readable) and the
  customer is **linked to the dataset** (`409 copilot_unavailable`).
- Without agent-core (`CC_AGENT_CORE_URL` unset) the panel simply is not available (below).

Configuration: `CC_COPILOT_AGENT` (default `copiloto-asesor@prod`); the rest is slice 14's (§2 there).

## 2. Endpoints (analyst token)

### `GET /cases/{caseId}/copilot` → `CopilotThread`

```json
{ "caseId": "CASE-…", "available": true,
  "messages": [
    { "id": "CPM-…", "role": "analyst", "text": "¿Cuánto debe en la tarjeta?", "createdAt": "…", "answers": null },
    { "id": "CPM-…", "role": "copilot", "text": "Debe 1.342,80 USD…", "createdAt": "…", "answers": "CPM-… (the question)" }
  ] }
```

`available: false` (empty `messages`, **status 200**) while agent-core is not configured or the customer is not
linked: **hide the panel**, it is not an error. Call it when the Workspace opens a case.

### `POST /cases/{caseId}/copilot/messages` `{ "text", "clientMessageId" }` + `Idempotency-Key` → `CopilotExchange`

```json
{ "question": { …CopilotMessage }, "answers": [ { …CopilotMessage } ], "replayed": false }
```

- **It waits for the model** (typically 5-10 s; up to `CC_AGENT_CORE_TIMEOUT_SECONDS`): show a spinner and
  disable the box meanwhile. The answer is in the response; there is no socket for it (the thread is the
  analyst's alone and the copilot events never reach a socket).
- `text`: 1-2000 characters (`422` otherwise). `answers` has one or more messages (agent-core may send a
  conclusion and then a follow-up question, like "¿Qué necesitas saber?"); it can be empty if the copilot said
  nothing.
- **Idempotent on `clientMessageId`** (= `Idempotency-Key`, like the chat): the same text again answers
  `200` + `Idempotent-Replayed: true` with the stored answer and **does not ask twice**; another text with that
  id is `409 idempotency_conflict`.
- **A question is stored before the call.** If the call fails (`503 agent_core_unavailable`, `502
  agent_core_rejected` with `agentCoreCode`), the question stays in the thread without an answer: **ask
  again with the same `clientMessageId`** and the platform repeats the call (agent-core de-duplicates it);
  that answer is `201`, not a replay. Show the failed question with a "Reintentar" action.
- Errors: `404 assistant_disabled` (no agent-core), `409 copilot_unavailable`, `409 copilot_busy` (the copilot is
  still answering a previous question of this thread: wait), `409 case_closed`, `403`, `422`.

## 3. What to build

- A right-hand panel in the Workspace conversation (suggested "Copiloto"), opened on demand, visible only when
  `available`. The thread as a small chat; the box sends one question at a time.
- **"Suggested tools"**: agent-core's copilot answers in text today (what to look up, in its own words). There
  is **no structured list of suggested tools** in its output yet, so the panel shows the answer as text. When
  agent-core adds one, it is a new field in `CopilotExchange` (compatible). Nothing here executes anything.
- The answer can carry customer data rendered for the analyst's permissions: treat it like the "Ficha del
  cliente" (do not log it, do not paste it into the customer chat automatically).

## 4. How it works (for maintainers)

- `CopilotThread` (`domain/ai/copilot.py`, table `copilot_threads`, unique `(case_id, analyst_id)`): agent-core's
  session and run, the messages as a JSON list, a run counter that gives each run its idempotency key
  (`<thread id>.<n>`). Events: `copilot.query_asked` (question length only) and `copilot.answered` (ids, trace id,
  status): in the audit, **never** the text, and silent on sockets.
- `AskCopilot`: (1) one Unit of Work stores the question and mints the credential; (2) the call to agent-core
  with no transaction open; (3) another Unit of Work stores the answer. A run agent-core closed (`run_closed`)
  or that ended with its answer is replaced by another in a new session, keeping the thread.
- The first question starts the run (`POST /v1/runs` with the analyst's credential, language of the case); the
  rest are turns on the same session with `channel: "workspace"`.

## 5. Contract changes (checklist for the frontend)

After merging run `pnpm gen:api`. New: `CopilotThread`, `CopilotMessage`, `CopilotExchange`,
`AskCopilotRequest`; `ProblemCode`: `copilot_unavailable`, `copilot_busy`. New audit event types
`copilot.query_asked`, `copilot.answered` (family `conversation`, actor `analyst` / `system`).

## 6. Known gaps

- The answers are only as good as agent-core's tools and prompt: with the demo doubles of its local stack
  (`ALLOW_DEMO=1`) the copilot often answers that the data "contains PII" and asks what to do. The platform side
  works (credential, delegation, session, replay); useful answers need the real tool service (track T) and a
  real field classification.
- Listening to the conversation in live (copilot mode b) does not exist in agent-core (a turn of observation).
  Only the analyst's own questions.
- Single process, like the rest: a call lost with its process leaves the question without an answer; asking
  again with the same `clientMessageId` recovers it.
