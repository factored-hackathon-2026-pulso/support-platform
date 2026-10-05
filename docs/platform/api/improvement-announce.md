# Improvement engine announcement (ADR 0007)

Hand-over for the frontend and for the engine's author. The notification's bell copy and link are built (es and pt-BR catalogs, `notifications.kinds.improvementProposed*`); the proposal screen is slice 22's.

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
| `caseTypeHint` | Optional. The case type the proposal serves (a `CaseType` value, e.g. `app_issue`). An unknown value or `none` is ignored (never a 422); a known one rides in the notification and the bell opens the proposal with `?type=`, so Activar offers that type. |

Free text must not contain an email address or a run of 9 or more digits (personal data). An email is `x@y.<letters>`: the address must end in an alphabetic label, so an artifact id such as `recepcion@1.0.0` is allowed in the text. The platform never truncates: a `title` over 120 (or any field over its cap) is a `422` and nothing is adopted, so **the engine must cut to these caps before calling**.

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
  "evidence": "…", "expectedEffect": "…", "evidenceLinks": ["CASE-…"],
  "caseTypeHint": "app_issue"   // or null
}
```

Also pushed as `notification.created` on the person's `staff:<id>` topic. Render the strings as plain text. The bell shows "Nueva propuesta de mejora para {agentId}" with `title` as the line, and opens the proposal (`automationProposalPath(proposalId)`, slice 22); each evidence link opens `/supervision/cases/{id}`.

## After slice 22

- The proposal appears in `/supervision/automation/proposals` (source "Del motor de mejora") and its detail page.
- **Done (2026-10-05, P6 of the deploy brief):** the detail page shows the dossier. `GET /api/v1/builder/proposals/{id}/record` (Supervisión and Administración, no agent-core call) returns `improvement` (title, problem, evidence, expected effect, `language: "es"`, `announcedAt`, and `evidenceCases`: each `evidenceLinks` id resolved against the platform's cases, `available: false` when the id names no case here) and the proposal's `history` from the platform's audit. The dossier is read from the `improvement_proposed` notification rows (no schema change); it is lost only if no Supervisión person was active at the announce or retention pruned every copy (the page then says the dossier is missing). Evidence cases link to `/supervision/cases/{id}`. `docs.description` keeps its line breaks, and a published proposal of an agent already in production offers "Pasar a producción" (promote `prod`), not "Activar". The announce carries Spanish only: a Portuguese reader sees the Spanish text with a note; a Portuguese variant needs an additive announce field (engine team's call).
- If a supervisor tracks the proposal first (`source=tracked`), the announce returns the existing row and still notifies once.
- Nothing can be approved until the agent has an `eval_suite` (slice 22 §6).
- Persistence: migration `0003_engine_announce` (applied on start; no database is deleted).
