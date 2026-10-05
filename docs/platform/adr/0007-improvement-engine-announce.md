# ADR 0007 · The improvement engine announces its proposals to the platform

- Status: **Accepted** (backend built in this change; the Agentes screen and the bell template are the frontend team's).
- Date: 2026-10-04
- Scope: `backend/` (one internal route, one notification kind, two small persistence changes) and the hand-over for the frontend (`api/improvement-announce.md`).
- Related: ADR 0003 §7 (the human gate stays), slice 16 (`api/slice-16-agent-builder.md`), slice 10 (notifications).

## Context

An external improvement engine detects problems, creates a proposal in agent-core's registry with `origin=auto_detect` (`ProposalOrigin.AUTO_DETECT`) and needs a supervisor to see and decide it here. Every `/builder/*` route needs a human staff session, and the platform's proposals list is an index fed only by what people do (`POST /builder/proposals/track`), so an engine proposal never reached a supervisor.

## Decision

1. **One service route**, `POST /api/v1/internal/builder/proposals/announce`, next to `/internal/grants/{ref}`: same shared secret (`CC_INTERNAL_SERVICE_TOKEN`, constant-time compare, unset = 404, missing or wrong = 401), absent from the OpenAPI document.
2. **It adopts, never decides.** It reuses `AgentBuilder.adopt` (the logic behind `track`): the registry confirms the proposal (a `constructor`-only read as the service identity `engine`), the platform adds it to the list once and audits `builder.proposal_tracked` once, with `source=engine` and actor `system/engine`. Only a proposal with `origin=auto_detect` is accepted (422 otherwise). Approve, reject, publish, promote and revoke still need a supervisor with a fresh authenticator code.
3. **It notifies Supervisión.** A new kind `improvement_proposed` goes to every active Supervisión person, with the proposal id, the agent id and the engine's dossier summary (title, problem, evidence, expected effect, evidence links). Its idempotency key is the proposal id, so a replay never notifies twice.
4. **Bounded, personal-data-free text.** Title 120, problem 600, evidence 600, expected effect 400 characters, at most 8 evidence links, each a platform case id (`CASE-…`, never a URL). An email address is `x@y.<letters>` (so an artifact id like `recepcion@1.0.0` is fine). A text with an email address or a run of 9 or more digits is refused (422) and nothing is adopted. The platform relays the text, it never interprets it; the SPA must render it as plain text.
5. **Idempotent, first dossier wins.** The key is `proposalId`. A replay returns the same summary and changes nothing, even with a different dossier.

## Consequences

- `builder_proposals.registered_by` no longer references `staff` (an engine proposal has no staff member; the value is `engine`) and `source` gains `engine`. `notifications` gains `proposal_id`, `agent_id` and `improvement` (JSON). The database is created from `tables.py` (as in earlier slices): an older database must be recreated; one recreate covers this change and slice 22's `case_type_maturity.agent_id`.
- The notification schema gains one nullable member, `improvement`; `caseId` is null for the new kind. The SPA drops kinds it does not know, so nothing breaks before its template exists.
- The registry (agent-core) must accept the service identity `engine` as a `constructor` to read the proposal (ADR 0018 on its side); the in-memory registry double already does.
- No telemetry stack is added to the platform.
