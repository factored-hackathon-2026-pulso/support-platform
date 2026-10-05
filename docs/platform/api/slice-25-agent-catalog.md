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
