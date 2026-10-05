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
  "evidence": "…", "expectedEffect": "…", "evidenceLinks": ["CASE-…"]
}
```

Also pushed as `notification.created` on the person's `staff:<id>` topic. Render the strings as plain text. The bell shows "Nueva propuesta de mejora para {agentId}" with `title` as the line, and opens the proposal (`automationProposalPath(proposalId)`, slice 22); each evidence link opens `/supervision/cases/{id}`.

## After slice 22

- The proposal appears in `/supervision/automation/proposals` (source "Del motor de mejora") and its detail page. That page shows only the registry's `docs` fields (`description`, `rationale`, `changelog`); the `improvement` dossier lives only in the notification. Asked of the SPA team: show it on the page for `source=engine`, render `docs.description` preserving line breaks, and offer "Pasar a producción" instead of "Activar" for an existing agent.
- If a supervisor tracks the proposal first (`source=tracked`), the announce returns the existing row and still notifies once.
- Nothing can be approved until the agent has an `eval_suite` (slice 22 §6).
- Persistence: migration `0003_engine_announce` (applied on start; no database is deleted).
