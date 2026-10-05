# ADR 0005 · Copilot suggestions: what to say, which tool, what to prepare, when to escalate

- Status: **Accepted in principle; the platform backend is built** (2026-10-04) against a scripted agent-core (contract: `api/slice-15b-copilot-suggestions.md`). Decisions taken by the user the same day (review in `factored/revision-copiloto-y-casos-de-uso.md`). The real agent needs agent-core ADR 0026 and was never run: until then the feature is off (`CC_COPILOT_SUGGESTIONS_AGENT` unset).
- Date: 2026-10-04
- Scope: `backend/` (contract, persistence, signals, audit) and the hand-over for the frontend.
- Related: ADR 0003 §6 (the copilot suggests and consults), slice 15 (`api/slice-15-copilot.md`, the Q&A copilot, unchanged), design `IaWorkspace` (stages et1–et3). In `agent-core`: ADR 0019, ADR 0026.

## Context

The copilot of slice 15 only answers the analyst's questions, and it never sees the conversation between the analyst and the customer (that lives here; agent-core only holds its own runs' transcripts). The design wants it to propose a reply, the tools to look at, and, now, an action to prepare and a recommendation to escalate.

## Decision

1. **One run per suggestion (agent-core ADR 0026).** The platform starts a `task` run of `copiloto-sugerencias` as the analyst (advisor credential and a 10-minute delegation, as slice 15) and sends the recent turns and case facts as `input`. No session, no memory in agent-core: the platform stays the single source of truth of the conversation. A turn of observation is not used.
2. **Typed list, possibly empty.** The answer is `suggestions: []` of `reply`, `tool`, `action` or `escalate` (§3). Empty means "nothing to propose" and the screen shows nothing.
3. **Nothing is sent or executed on its own.** A `reply` goes to the composer and the analyst sends it. A `tool` is a read: *Usar* asks the copilot a predefined question (slice 15 thread), which answers in text with its source. An `action` is a **prepared write that is not executable in this stage**: the screen shows it and the analyst does it through the usual flow; running it from the copilot (`confirm → act → verify`) is a later ADR that amends ADR 0003 §6 and agent-core ADR 0019 §7. An `escalate` only **recommends**: it opens the existing escalation dialog with the motive filled in, and the analyst confirms or edits.
4. **Escalation comes from rules, not from the model** (agent-core ADR 0026 §5): asks for a supervisor, suspected fraud above a threshold, overdue SLA with critical priority, the assistant's hand-over reason. (A "third contact in 7 days" rule is **not** part of this stage: the platform does not send that fact and nothing depends on it; counting contacts is a future improvement, 2026-10-05.) The recommendation always carries its reason and evidence so the analyst can disagree.
5. **Not every message deserves a suggestion.** Two layers: a cheap filter here before calling agent-core (greetings, thanks, "ok", one or two words, the analyst's own messages; it also looks at the wait time and the SLA, so a "hola?" after 20 minutes is not a greeting) and the agent's own `sin_sugerencia` branch. Bursts are coalesced (about 3 s) and rate-limited per case. The filter's drops are recorded too, to calibrate them.
6. **Staging as a switch, not an automatic ladder.** `copilot_mode` per case type (`answer | tools | drafts`), all on by default (demo). The design's stages (answer → tools → drafts) become the values of that switch; computing them from signals is the "Automatización" work, later.
7. **What is stored: hashes and distances, not text.** For each suggestion: types, tool ids, a hash of the reply, and after the analyst's decision the status (`used | edited | discarded | ignored`) and an edit distance between the draft and what she sent. To compute the distance the draft text is kept **only until the decision or 24 hours, whichever comes first**, then purged; the audit never holds it (as every copilot event today). Open: whether a longer, permissioned retention is wanted for review.
8. **The input is flat; nothing is sent as null** (decision of 2026-10-05, after agent-core's gap analysis): agent-core's `input_schema` takes scalars and one flat list and answers 422 to an undeclared slot or a null, so the platform sends `sla_estado` and `sla_minutos_restantes` instead of an `sla` object, `sugerencia_borrador` and `sugerencia_escalacion_aceptada` instead of `sugerencia_anterior`, and **omits** what does not apply. The `assistant_session_id` of the case's assistant goes along as **traceability** (the platform sets it; it is not memory: decision 1 holds). A contract test validates the input against the agent's schema when agent-core's fixtures are present.
9. **At most 3 suggestions, and the cut is visible.** Not 8: the screen has room for a draft, a recommendation and one more. The platform keeps one `reply` and one `escalate` at most, fills the rest in the order agent-core gave and drops the others; `truncated: true` (and the same flag and the count in `copilot.suggestion_ready`, never text) says that something real was left out or cut to its limit. Empty or unknown items are not a cut.
10. **`tool.label` is the platform's.** agent-core sends `tool`, `args` and `why` (ADR 0026), no label: a local catalog maps the tool to a readable name, and a tool not in it shows its own name. `args` are not read (nothing is run).
11. **Case type is optional and comes later.** `Case` has none today. When added: `recepcion` sets it on arrival, mapped to the dataset's `complaint.subcategory`; the analyst can correct it. Cases without it (calls, emails) still work. Not part of the first delivery.

## 3. Contract (draft; camelCase on the wire)

```json
CopilotSuggestion {
  "id": "CPS-…", "caseId": "CASE-…", "trigger": "customer_message | manual | handover",
  "status": "preparing | ready | none | failed", "stale": false, "createdAt": "…",
  "truncated": false,
  "suggestions": [
    { "type": "reply",    "text": "…", "citations": ["…"], "language": "es" },
    { "type": "tool",     "tool": "leer_movimientos@1", "label": "Movimientos", "why": "…" },
    { "type": "action",   "tool": "radicar_pqr@1", "summary": "Radicar una disputa por 120 USD", "executable": false },
    { "type": "escalate", "reasonCode": "policy:…", "evidence": ["…"], "motiveDraft": "…" }
  ]
}
```

Endpoints (analyst token; same rules as slice 15: the case's assignee, open case, customer linked, `404 assistant_disabled` without agent-core):

- `POST /cases/{caseId}/copilot/suggestions` `{ "trigger": "manual" }` + `Idempotency-Key` → `CopilotSuggestion`. Waits for the model (5–10 s). `status: "none"` with an empty list is a normal answer.
- `GET /cases/{caseId}/copilot/suggestions/latest` → `{ "available": bool, "suggestion": CopilotSuggestion | null }`; `stale: true` once the customer wrote again; `suggestion: null` once its texts expired.
- `POST /cases/{caseId}/copilot/suggestions/{id}/feedback` `{ "decision": "discarded" | "ignored" }`. `used` and `edited` are not posted: they are derived when the analyst sends a turn with `copilotSuggestionId` (the platform compares the sent text with the draft).
- `POST /cases/{caseId}/turns` and `POST /cases/{caseId}/escalations` accept an optional `copilotSuggestionId`.
- Automatic suggestions (on a customer message or a case reaching an analyst) are made in the background and announced with a signal on the analyst's own `inbox:<staffId>` topic, `copilot.suggestion_updated`, carrying **only the suggestion id and its status** (`preparing | ready | none | failed`); the content is read over REST (slice 15's rule: copilot content never travels on a socket). Built: `api/slice-15b-copilot-suggestions.md` is the contract.
- Errors: those of slice 15, plus `409 copilot_busy` while one is being prepared for that case.

## Audit and signals

`copilot.suggestion_requested | ready | none | failed | decided` in family `conversation`, actor `analyst` / `system`: ids, types, counters, status; never text. The same records feed the maturity signals of the design (suggestion used / edited / discarded / ignored, escalation recommended / accepted / ignored, tools shown / used), without storing content.

## Phasing

| Phase | Scope |
|---|---|
| 0 | This ADR, agent-core ADR 0026, the contract. |
| 1 | agent-core: `suggest`, `copiloto-sugerencias`, policies, evaluation suite. |
| 2 | Here: endpoints, persistence, cheap filter, signals, audit, fake runtime. Can start in parallel with 1. |
| 3 | Frontend: draft over the composer, tools tab, "Sugerir", stale and preparing states, escalation recommendation. |
| 4 | Case type, `copilot_mode` computed from signals, "Automatización". |
| 5 | Executing actions with the analyst's confirmation (own ADR). |

## Consequences

- The copilot becomes proactive without a turn of observation; each suggestion costs a full agent-core run, so coalescing and the cheap filter matter.
- The design needs four additions: a "preparing" and a "stale" state, the **Sugerir** button, the escalation recommendation with its reason, and the escalation dialog pre-filled and marked as suggested.
- Supervisors see none of this (they hold no customer data, agent-core ADR 0019).
- A prepared `action` is information, not permission; the analyst's write access is unchanged.

## Open points

1. Whether each analyst can turn automatic suggestions off (suggested: yes, a preference, default on).
2. Retention beyond 24 hours of the draft text, if reviews are wanted.
3. Thresholds and the list of rules for the escalation policy (needs the supervisors' input).
4. Which actions may be prepared first (today only `radicar_pqr` exists).
5. Where the case type comes from, once it is built.
