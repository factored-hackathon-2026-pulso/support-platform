# Improvement engine announcement (ADR 0007)

Hand-over for the frontend and for the engine's author. Backend only: no screen was built.

## Endpoint

`POST /api/v1/internal/builder/proposals/announce` · `Authorization: Bearer <CC_INTERNAL_SERVICE_TOKEN>` · not in `openapi.json`.

Request (camelCase, unknown fields rejected):

| Field | Rule |
|---|---|
| `proposalId` | agent-core's proposal id, 1-64 characters. Must exist in the registry with `origin=auto_detect`. |
| `title` | 1-120 characters. |
| `problem` | 1-600 characters. |
| `evidence` | 1-600 characters. |
| `expectedEffect` | 1-400 characters. |
| `evidenceLinks` | 0-8 distinct case ids (`CASE-…`). |

Free text must not contain an email address or a run of 9 or more digits (personal data).

Response `200`: the proposal summary, the same shape as `GET /builder/proposals` items (`proposalId`, `agentId`, `title`, `origin: "auto_detect"`, `state`, `source: "engine"`, `registeredBy: "engine"`, …). A replay returns the same body.

Errors: `401` missing or wrong token; `404` token not configured, AI switched off, or the registry does not know the proposal; `422` bad payload, personal data, or an origin other than `auto_detect`; `502/503` agent-core unavailable (retry: the call is idempotent).

## What happens

1. The proposal joins `GET /builder/proposals` (`source: "engine"`), audited once (`builder.proposal_tracked`, actor `system/engine`).
2. Every active Supervisión person gets a notification (once per proposal).
3. Nothing is approved or published.

## Notification (for the bell and the Agentes screen)

`GET /me/notifications` items of `kind: "improvement_proposed"` (role `supervisor`, `caseId` null) carry:

```json
"improvement": {
  "proposalId": "…", "agentId": "disputas", "title": "…", "problem": "…",
  "evidence": "…", "expectedEffect": "…", "evidenceLinks": ["CASE-…"]
}
```

Also pushed as `notification.created` on the person's `staff:<id>` topic. Render the strings as plain text. Suggested template: "Nueva propuesta de mejora para {agentId}: {title}"; the target is the proposal in Supervisión > Agentes, and each evidence link opens `/supervision/cases/{id}`.
