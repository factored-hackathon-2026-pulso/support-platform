# Signals for the improvement engine (ADR 0007, additive)

What the platform adds so the engine can learn from real interactions. Everything here is additive: no existing field, route or event changes meaning. There are no migrations: **delete `backend/cc_platform.db` once** (it also covers slices 21/22 and the announce): `assistant_sessions.agent_release` and `copilot_suggestions.release` are new columns.

## Events (payload keys added; ids, enums and counters only, never a text)

| Event | New key | Meaning |
|---|---|---|
| `assistant.turn_answered` | `release` | agent release the run started on (null if unknown). |
| `copilot.suggestion_ready`, `copilot.suggestion_none` | `release` | release that answered. |
| `copilot.suggestion_decided` | `turn_id` | the turn the analyst sent when she used or edited the draft (`TRN-…`, the join with `turn.created`); null for `discarded`, `ignored` and the escalation decision. |
| `copilot.suggestion_decided` | `agent`, `release` | copied from the suggestion, so acceptance and edit distance can be sliced by agent and release without reading `copilot_suggestions`. |

Not changed: `copilot.answered` (the Q&A thread) and `assistant.ended` carry no release yet (the thread does not store one).

## Route: which real cases sit in a cell

`GET /api/v1/internal/evidence/cases` · `Authorization: Bearer <CC_INTERNAL_SERVICE_TOKEN>` (same secret and 404-when-unset as the announce) · not in `openapi.json`.

Query (all optional, combined with AND): `caseType`, `channel`, `language`, `priority`, `closeReason` (the cases' own enum values), `openedFrom` (inclusive), `openedBefore` (exclusive), `limit` (1-8, default 8).

Response `200` (nothing else leaves):

```json
{ "suppressed": false, "matched": 37, "caseIds": ["CASE-…", "…"] }
```

- k-anonymity: a cell with fewer than `CC_EVIDENCE_MIN_CELL` (default 10, minimum 2) cases answers `{"suppressed": true, "matched": null, "caseIds": []}`: no count, no ids.
- The sample is the newest `limit` cases by `opened_at` (ties by id): deterministic and bounded by the announce's 8 evidence links. Case ids are real ones, so the supervisor can open `/supervision/cases/{id}` (the supervisor view is read-only and audited).
- `401` wrong or missing token; `404` token not configured; `422` an unknown enum value or a `limit` outside 1-8.
- Read-only: it reads `cases` ids and dimensions, never turns, customers or free text.

How the engine uses it: for each finding's cell, map its dimensions to these parameters, call the route and send the returned ids as `evidenceLinks` of the announce. A suppressed answer means "no links" (aggregate only).
