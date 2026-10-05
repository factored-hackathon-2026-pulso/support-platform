# Slice 25 · Agent catalog: names to show and results per agent (ADR 0009 §3)

**Status:** implemented (2026-10-05) on `feat/agent-catalog-and-results`. Platform data only; works with or without agent-core.

## REST

| Method · path | Roles | Success | Problems |
|---|---|---|---|
| `GET /api/v1/ai/agents` (new) | analyst, supervisor | 200 `AiAgents` | 401, 403 |
| `PUT /api/v1/supervision/ai/stages/{caseType}/agent/name` (new) | supervisor | 200 `CaseTypeStage` | 401, 403, 404 `not_found` (no agent / `none`), `assistant_disabled`, 422 |

```ts
AiAgents  { available: boolean; agents: AgentRow[] }       // available false: AI off, agents empty
AgentRow  { agentId: string; displayName: string; caseType: CaseType | null;
            results: { sessions; active; resolved; handedToPeople } }
CaseTypeStage gains agentName: string | null               // Supervisión's name, null = humanize agentId
RenameAgentRequest { name: string /* 1-80, trimmed */ }
```

- One row per agent that serves a type or has held an assistant session. `displayName` is Supervisión's name, else the id humanized (`disputas` → "Disputas").
- **Results** are counted from the assistant sessions by their last answering agent (`id` before `@`): `resolved` the agent resolved it; `handedToPeople` escalated, ended without a resolution, failed or taken by Supervisión; `active` still open. Whether `agent` holds `id@alias` or `id@version` after a transfer is to be confirmed with agent-core; both read as the id.
- Renaming is audited (`ai.agent_renamed`, family agents, without the name: it is free text) and live on `ai:stages`. Moving a type back clears the name with the agent.
- Persistence: `case_type_maturity.agent_name` (new column). **Delete `backend/cc_platform.db`.**
- Frontend: `pnpm gen:api`; the agents screens can swap "humanize the id" for `displayName` and add the results columns. Pause is the next slice (ADR 0009 §2, needs agent-core).

## Pause (ADR 0009 §2)

Needs agent-core's `POST /v1/registry/agents/{id}/pause|resume` (agent-core PR "pause and resume an agent"): without it the registry answers 404/405 and the call fails as any registry error.

| Method · path | Roles | Request | Success |
|---|---|---|---|
| `POST /api/v1/supervision/ai/stages/{caseType}/agent/pause` | supervisor | `{ stepUpCode, reason? }` | 200 `CaseTypeStage` (`agentPaused: true`) |
| `POST /api/v1/supervision/ai/stages/{caseType}/agent/resume` | supervisor | same | 200 `CaseTypeStage` (`agentPaused: false`) |

- The agent leaves `recepcion`'s directory: new cases do not reach it, open conversations carry on, `prod` is untouched. Her fresh authenticator code, like a promotion (422 `builder_step_up_invalid`, 423 `account_locked`).
- The registry is called first; the type then records it (`ai.agent_paused` / `ai.agent_resumed`, audited, live on `ai:stages`). Repeating the same action is 200 and changes nothing. 404 `not_found`: the type has no agent; `assistant_disabled`: AI off or no agent-core.
- `CaseTypeStage.agentPaused` and `AgentRow.paused` carry the state. Moving a type back clears it with the agent.
- Persistence: `case_type_maturity.agent_paused` (new column, same database reset as above).
