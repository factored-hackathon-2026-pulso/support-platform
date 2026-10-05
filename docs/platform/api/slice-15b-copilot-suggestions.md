# Slice 15b · The copilot's suggestions: what to say, what to look at, what to prepare, when to escalate

Contract for ADR 0005. **This is the hand-over for whoever wires the Workspace**: the backend is built and
tested against a scripted agent-core (`tests/unit/application/test_suggestions.py`,
`test_suggestion_process.py`, `tests/unit/domain/test_suggestion.py`,
`tests/unit/infrastructure/test_suggestion_repository.py`, `tests/api/test_copilot_suggestions_api.py`); no
screen was touched. It sits next to slice 15 (`api/slice-15-copilot.md`, the Q&A copilot, unchanged): the Q&A
answers what the analyst asks; a suggestion is what the copilot proposes by itself, from the conversation.

> **Status: the real agent does not exist yet.** The platform side is complete, but agent-core's
> `copiloto-sugerencias` needs agent-core ADR 0026 (a structured `suggestions` output). Until then the feature
> is **off**: leave `CC_COPILOT_SUGGESTIONS_AGENT` unset and every route answers as below ("Without it"). The
> HTTP adapter reads `suggestions` in the shape drafted in that ADR (snake_case); it was never run against a
> real agent-core.

## 1. What it is

A **suggestion** is one agent-core `task` run made *as the analyst* (an `advisor` credential with a 10-minute
delegation on this one customer, so agent-core decides what she may see). The platform sends it the recent turns
and the facts of the case; it answers a **typed list that may be empty**:

| `type` | What it is | What the screen does |
|---|---|---|
| `reply` | A draft for the customer. | The draft above the composer: *Usar* (to the composer), *Editar*, *Descartar*. **Nothing is sent**: she sends it. |
| `tool` | A read worth looking at (a tool of the copilot's catalog). | The "Herramientas" list. *Usar* asks the copilot a predefined question through the Q&A thread (slice 15). |
| `action` | A write **prepared and not executable** (`executable` is always `false`). | Show it as information; she does it the usual way. Running it from the copilot is a later ADR. |
| `escalate` | A recommendation to escalate, from agent-core's rules, with its reason and evidence. | A notice by "Escalar a supervisión"; the dialog opens with `motiveDraft` filled in. She confirms or edits. |

An empty list is a normal answer (`status: "none"`): **show nothing**. Not every message deserves a suggestion
(a greeting does not even reach agent-core; see §5).

Only the case's **assignee analyst** (`403 case_not_assigned` for anyone else, `403 forbidden` for a supervisor:
supervisors hold no customer data). Only while the customer is **linked to the dataset**.

## 2. Endpoints (analyst token)

### `GET /cases/{caseId}/copilot/suggestions/latest` → `LatestCopilotSuggestion`

```json
{ "available": true,
  "suggestion": { "id": "CPS-…", "caseId": "CASE-…", "trigger": "customer_message", "status": "ready",
    "stale": false, "createdAt": "…", "replyDecision": null, "escalationAccepted": false, "failureCode": null,
    "suggestions": [
      { "type": "reply", "text": "…", "citations": ["…"], "language": "es" },
      { "type": "tool", "tool": "leer_movimientos@1", "label": "Movimientos", "why": "…" },
      { "type": "action", "tool": "radicar_pqr@1", "summary": "Radicar una disputa por 120 USD", "executable": false },
      { "type": "escalate", "reasonCode": "policy:…", "evidence": ["…"], "motiveDraft": "…" } ] } }
```

- Call it when the Workspace opens a case, and again on the signal (§4).
- `available: false` (status 200): hide the suggestions (no agent-core, no suggestions agent, or the customer is not
  linked). It is not an error.
- `suggestion: null`: none yet, or its texts expired (they are purged after **24 hours**).
- `status`: `preparing` (on its way), `ready`, `none` (nothing to propose) or `failed` (`failureCode`).
- `stale: true`: the customer wrote after the turns it read. Dim it; offer *Sugerir*.
- `replyDecision`: once the draft was decided (`used`, `edited`, `discarded`, `ignored`) it **leaves**
  `suggestions`; the rest stays until it expires. `escalationAccepted` is true once she escalated with it.

### `POST /cases/{caseId}/copilot/suggestions` + `Idempotency-Key` → `CopilotSuggestion`

The **Sugerir** button. Body `{ "trigger": "manual" }` (optional). It **waits for the model** (5-10 s): show
"preparando" and do not block the composer.

- `201` with the suggestion; `status: "none"` with an empty list is a normal answer.
- **Idempotent on the `Idempotency-Key`** (8-64 characters): a retry of a request that has its answer is `200` +
  `Idempotent-Replayed: true` and asks nothing; after a failure the **same key asks again**.
- Errors: `404 assistant_disabled` (no agent-core or no suggestions agent), `409 copilot_unavailable` (customer not
  linked), `409 case_closed`, `409 copilot_busy` (one is being prepared: wait), `503 agent_core_unavailable` / `502
  agent_core_rejected` (with `agentCoreCode`), `403`, `422`. After a 503/502 the suggestion is stored as `failed`:
  offer **Reintentar** with the same key.

### `POST /cases/{caseId}/copilot/suggestions/{suggestionId}/feedback` `{ "decision": "discarded" | "ignored" }`

She dismissed the draft (`discarded`) or left it (`ignored`). Returns the suggestion without the draft. `404` for an id
that is not hers. `used` and `edited` are **not posted** (below).

### What she did with a suggestion: two optional fields

- `POST /cases/{caseId}/turns` accepts **`copilotSuggestionId`**: send it when the reply came from the draft. The
  platform compares what was sent with the draft: identical is `used`; changed is `edited`, with an edit distance
  (0-1000) so the supervisors can measure how much the drafts are changed. An id that is wrong, foreign or already
  decided **never fails the reply**.
- `POST /cases/{caseId}/escalations` accepts **`copilotSuggestionId`**: send it when she escalated through the
  recommendation (recorded as accepted). Same tolerance.

## 3. What to build

- **The draft above the composer** (the design's `dr` states): *Usar* puts it in the composer and keeps the id so the
  reply carries `copilotSuggestionId`; *Editar* is the same with focus; *Descartar* posts the feedback.
- **"Preparando"** and **"Desactualizada"** states (not in the design yet), and the **Sugerir** button.
- **The recommendation to escalate** (not in the design yet): a notice with the reason and the evidence, and the
  escalation dialog pre-filled with `motiveDraft` and marked as suggested; sending it carries `copilotSuggestionId`.
- The "Herramientas" list from the `tool` items; *Usar* sends the predefined question to `POST …/copilot/messages`.
- `action` items as information only (no button that runs them).
- Treat the text like the "Ficha del cliente": do not log it, do not send it to the customer automatically.

## 4. Realtime

Automatic suggestions (§5) are made in the background and announced on the analyst's own `inbox:<staffId>` topic:

```json
{ "type": "copilot.suggestion_updated", "id": "<event id>",
  "data": { "entity": "copilot", "entityId": "CPS-…", "caseId": "CASE-…", "actor": {…},
            "payload": { "suggestionId": "CPS-…", "status": "preparing | ready | none | failed" } } }
```

It carries **the id and the status only**: read the content with `GET …/latest`. Sent for `preparing` (automatic ones
only: her own request is waiting for its response), `ready`, `none` and `failed`. Dedupe on `(type, id)`; a socket only
signals.

## 5. When a suggestion is made

- **She asks** (*Sugerir*): always.
- **On its own** (`CC_COPILOT_SUGGESTIONS_AUTO`, default on): when the customer writes, and when a case reaches her
  (a hand-over from the assistant, a queue assignment or a reassignment; not an outbound call).
  - **Coalesced**: a burst of messages makes one (it waits `CC_COPILOT_SUGGESTIONS_COALESCE_SECONDS`, 3 s, for the last
    one); a message that arrives while the model works asks for one more round, once.
  - **Skipped quietly**: a greeting, thanks or "ok" ("hola", "gracias", "bom dia"…); a case nobody holds or the assistant
    holds; nothing new since the last one; one made less than 10 s ago; a customer not linked.
  - **A greeting that chases is not a greeting**: "hola?" after 5 minutes of waiting, or while the first response is
    overdue, does get a suggestion. "sí" and "no" are never skipped.
  - A failure is stored (`failed`) and never raised: she can press *Sugerir*.
- A new suggestion replaces the previous one: a draft nobody decided becomes `ignored`.
- Best effort: a suggestion lost with the process is not recovered (there is no sweep, unlike the assistant).

## 6. What is kept, and for how long

`copilot_suggestions` keeps **types, tool ids, a hash of the draft, her decision and the edit distance**. The texts (the
draft, a motive, evidence, an action's summary) live there **only until the draft is decided (the draft) or 24 hours
pass (everything)**; then they are purged (`CC_COPILOT_SUGGESTIONS_PURGE_SECONDS`, every 10 minutes). The audit
(`copilot.suggestion_requested | ready | none | failed | decided`, family `conversation`) carries ids, kinds, counters and
decisions, **never a text**.

## 7. Configuration

| Variable | Default | What |
|---|---|---|
| `CC_COPILOT_SUGGESTIONS_AGENT` | unset | The agent that makes suggestions (`id@alias`). **Unset = the feature does not exist** (every route answers as "Without it"). Needs agent-core configured (slice 14 §2). |
| `CC_COPILOT_SUGGESTIONS_AUTO` | `true` | Suggest on its own (a customer message, a case reaching an analyst). `false`: only *Sugerir*. |
| `CC_COPILOT_SUGGESTIONS_COALESCE_SECONDS` | `3` | The wait that turns a burst of messages into one suggestion. |
| `CC_COPILOT_SUGGESTIONS_PURGE_SECONDS` | `600` | How often the texts older than 24 hours are purged; 0 turns it off. |

**Without it** (no agent-core, or no suggestions agent): `GET …/latest` answers `200 { "available": false,
"suggestion": null }`; the others, `404 assistant_disabled`. The platform schema gained the table
`copilot_suggestions`: there are still no migrations, so an existing SQLite file fails fast with
`OutdatedSchemaError` (delete `cc_platform.db`).

## 8. How it works (for maintainers)

- `CopilotSuggestion` (`domain/ai/suggestion.py`, table `copilot_suggestions`): one agent-core run; the typed items, the
  decisions and the purge. The events carry ids and enums only.
- `SuggestionService` (`application/ai/suggestions.py`) is the shared engine. **Prepare** (a short Unit of Work stores the
  suggestion as `preparing` and builds the input), **produce** (agent-core with no transaction open: `POST /v1/runs` with
  `input`, run key = the suggestion id, so agent-core de-duplicates a retry) and **store** (another short one). The
  manual request answers errors; the automatic one swallows them.
- The input (`build_input`): `idioma`, `canal`, `prioridad`, `sla` (`respondida | vencido | en_riesgo | a_tiempo`),
  `motivo_llegada` (the assignment reason), `espera_del_cliente_segundos`, `sugerencia_anterior` (what happened to the last
  draft, so the agent does not repeat a discarded one) and `turnos`: the last 12 spoken turns (chat, email, call lines;
  banners and notes excluded) as `{rol: cliente | analista | asistente, texto, hora}`. The customer's words are untrusted
  text for agent-core.
- `SuggestionProcess` (a bus subscriber on `TurnCreated` and `CaseAssigned`) and `SuggestionSignal` (the inbox signal):
  `application/ai/suggestion_process.py`. The cheap filter is `application/ai/suggestion_filter.py`.
- `PurgeSuggestionDrafts` runs on a `PeriodicTask` (`Container.suggestion_purge`).

## 9. Contract changes (checklist for the frontend)

After merging run `pnpm gen:api`. New: the three routes above; `CopilotSuggestion`, `LatestCopilotSuggestion`,
`SuggestionReply`, `SuggestionTool`, `SuggestionAction`, `SuggestionEscalation`, `RequestSuggestionRequest`,
`SuggestionFeedbackRequest`; `copilotSuggestionId` (optional) on `PostAnalystTurnRequest` and `EscalateRequest`. New audit
event types `copilot.suggestion_requested | ready | none | failed | decided`. New realtime envelope
`copilot.suggestion_updated`.

## 10. Known gaps

- **No real agent yet** (see the status at the top): agent-core ADR 0026 and the `copiloto-sugerencias` agent, its
  policies and its `eval_suite`. Nothing here was measured with a real model: the quality of the suggestions is unknown.
- The `tool` items are not tied to a "used" signal yet (*Usar* goes through the Q&A thread); the maturity signals of the
  "Automatización" design (tools used or ignored per case type) need a case type, which `Case` does not have.
- Turns longer than 1000 characters are cut in the input; only the last 12 spoken turns are sent.
- Single process, like the rest: the coalescing and the "one more round" live in memory.
- The edit distance is a character-level similarity, not a semantic one.
