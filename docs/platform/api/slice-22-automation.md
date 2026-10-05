# Slice 22 · Automatización (Supervisión)

**Status:** implemented (2026-10-05) on `feat/ai-automation`. Gates in `../ENGINEERING_BRIEF.md` §6.
**Date:** 2026-10-05.

**Scope.** ADR 0006's last step made visible: Supervisión sees every case type's stage and signals,
opens one (how it matured, the team rule against today's signals, moving it back), and, for a type
the system proposes an agent for, takes that agent from a proposal to an active agent on slice 16's
builder backend (agent-core's registry), with her authenticator code for every decision. Plus the
agents list and detail, the proposals list and the chat with the builder agent. Only with the AI
switch on; nothing shows otherwise.

Read first: `../adr/0006-ai-maturity-by-case-type.md`, `slice-21-stages.md` (the stages API),
`slice-16-agent-builder.md` (the registry flow, the step-up, the chat, §8 gaps),
`../adr/0003-agent-core-integration.md`, `../../../frontend/ARCHITECTURE.md` (slice 22).

Design: `IaAutomatizacion` (views `panorama`, `tipo`, `propuesta`, `prueba`, `activar`, `activado`,
`agentes`, `agente`; boards `IaSuAu*`, `IaEtSenales`, `IaEtPropuesta`, `IaEtPrueba`, `IaEtActivado`,
`IaEtAgente`).

---

## 1. Who and where

- **Supervisión only**, rail item "Automatización" (bot icon, after Escalados), only while the AI
  switch is on; a dot ("Automatización, con novedades") when a type is `ready` for an agent. Turning
  AI off removes the item live and sends an open Automatización screen back to Colas.
- **Administración** does not get the screens: the stages API they are built on (`GET /ai/stages`,
  slice 21) is for analysts and Supervisión, and the move-back and activation are Supervisión's. The
  builder routes themselves still accept Administración (slice 16); a person with both roles uses
  the Supervisión section. "Revocar" (Administración only) is not drawn.
- Routes (English paths, `src/app/paths.ts`):

| Path | Screen |
|---|---|
| `/supervision/automation?type=` | Tipos de caso: the panorama; `?type=` opens a type in the side panel |
| `/supervision/automation/proposals` | Propuestas: every proposal the platform knows, "Seguir" by id |
| `/supervision/automation/proposals/:proposalId?type=` | One proposal; `type` is the case type it is for (what "Activar" serves) |
| `/supervision/automation/agents` | Agentes |
| `/supervision/automation/agents/:agentId` | One agent |

## 2. REST (new or changed in this slice)

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/ai/stages` (changed) | analyst, supervisor | — | 200 `AiStages`; `CaseTypeStage` gains **`agentId`** | as slice 21 |
| `POST /api/v1/supervision/ai/stages/{caseType}/agent` (new) | supervisor | **`ActivateAgentRequest`** | 200 **`ActivateAgentResult`** | 401; 403 `forbidden`; 404 `not_found` (`none`, unknown type), `assistant_disabled` (AI off or no agent-core); 409 `invalid_transition` (not `ready`, or another agent serves it); 422 `validation_error`, `builder_step_up_invalid` (`remainingAttempts`); 423 `account_locked`; `registry_*` (slice 16 §5); 502/503 |
| `POST /api/v1/builder/chat/restart` (new) | supervisor, admin | — | 200 `BuilderThread` (empty) | 401, 403, 404 `assistant_disabled` |

```ts
CaseTypeStage         { …slice 21…; agentId: string | null }   // agent-core's id while `agent: active`
ActivateAgentRequest  { agentId: string /* ^[a-z0-9][a-z0-9_/-]*$ */; releaseId: string; stepUpCode: string }
ActivateAgentResult   { changed: boolean; type: CaseTypeStage; alias: AliasChange | null }
```

**Activation** (`ActivateTypeAgent`, `application/ai/maturity.py`): checks the type first (`ready`;
the agent that already serves it is a no-op, `changed: false`, nothing promoted), then promotes the
agent's **`prod`** alias to `releaseId` through `AgentBuilder.promote` (her fresh code: step-up
credential, audited `builder.alias_promoted`), then records `agent: active` + `agentId` on the type
(`CaseTypeMaturity.activate_agent`, audited `ai.agent_activated` with `agent_id` in the payload,
live `ai.stage_updated` on `ai:stages`). The analyst's stage strip follows by itself ("Con agente").
If the type changed between the check and the record (moved back meanwhile), the alias stays
promoted and the call answers 409: the registry's own event log has the promotion.

**Restart** (`RestartBuilderThread`, `application/ai/builder_chat.py`; `BuilderThread.restart`):
"Nueva conversación" clears her thread (agent-core keeps its transcript) and makes the next message
start another run of `constructor-chat`, whatever state the current run is in (it can end, or wait
on a question she no longer wants to answer). Not audited (the chat's questions are, by size).

No new audit texts and no new server-rendered Spanish: the activation reuses slice 21's
"Activó el agente de {tipo}"; one new domain refusal reads in English ("Another agent already serves
this case type."); the SPA words every refusal from its code.

Persistence: `case_type_maturity.agent_id` (new column). **Delete `backend/cc_platform.db`** (no
migrations; an older database fails with `OutdatedSchemaError`). Seed: "Cargo no reconocido" is
served by `disputas` (agent-core's demo agent for card disputes).

## 3. The proposal flow as built (vs the canvas)

| Canvas view | Built on | Notes |
|---|---|---|
| `panorama` | `GET /ai/stages` | Columns: type (+ dataset category), stage (bars + word), "Lo que mide ahora" (the current stage's signal), **"Cerrados en la etapa"** (the canvas's "Casos hoy" is not something the stages record), action. The ready type on top ("El sistema propone un agente para …"). Footnote: types are the dataset's subcategories, "Tarjeta virtual" team-generated, thresholds "regla del equipo (ejemplo)". Live on `ai:stages`. |
| `tipo` (drawer) | the same stage | "Cómo maduró" from `reached` and `agentSince`; the drafts bar (stage 3: as is or minor, more changes, discarded); "Umbrales para pasar de etapa": each step of `rule` with "Cumplida", "Hoy: …" (only the current step has a value: signals are counted since the current stage) or "Todavía no", labelled "Regla del equipo (ejemplo)". Footer: "Devolver a una etapa anterior" (slice 21's move-back; for a `ready` type the first option withdraws the proposal) and, for a `ready` type with agent-core, "Proponer un agente". |
| `propuesta` | `GET /builder/proposals/{id}` | **The canvas's "Qué haría / Cuándo pasa a una persona / Un caso de ejemplo" is not what a proposal holds**: the screen shows the draft as the registry has it: "Herramientas que usaría" (the agent entity's `tools_allowed`), "Idiomas" (its `supported_locales`), and each change (kind, id, version, description, rationale, changelog). A stepper Borrador, Lista para probar, Probada, Aprobada, Publicada, Activa. "Siguiente paso" by state: Validar / Preparar para la prueba (draft), Probar / Volver a editar (candidate), Aprobar / Rechazar / Volver a editar (evaluated), Publicar (approved), Activar (published). The draft is not edited here: the builder chat writes it (agent-core's `put_draft` takes whole entities). |
| `prueba` | `POST …/evaluate` | The registry's evaluation, gate item by gate item (metric, Cumple / No cumple, value, floor, before), never a composite score. **Not "50 casos anteriores comparados con el equipo"**: agent-core's evaluation runs its suite's scenarios. The suite is the one the draft brings (`kind: eval_suite`) or the one the base release was evaluated with; none → "Este agente no tiene suite de evaluación" without calling; a 404 on evaluate reads the same; a failed gate (409) is a result: the report and "La propuesta volvió a borrador". |
| (decisions) | `approve`, `reject`, `publish` | A dialog per decision with her code (6 boxes, `stepUpDigits`); a wrong code clears the boxes and says the attempts left; 423 says the account locked. Approve shows the loosened yardstick and asks to accept it. Reject asks a reason. Publish sends one `Idempotency-Key` per dialog (a retry reuses it). |
| `activar` | `POST /supervision/ai/stages/{caseType}/agent` | Summary (Atiende, Idiomas, Empieza, Pasa a una persona, Prueba "Pasó N de M criterios", Versión publicada = the release `staging` points at, checked to be this proposal's), "Revisé el resultado de la prueba", "Activar agente" → her code. Without `?type=` she picks among the `ready` types. |
| `activado` | the stage (`agent: active`, `agentId`) | "El agente X ya atiende Y", "Volver a los tipos de caso", "Ver el agente". |
| `agentes` | stages + proposals + aliases + releases | No catalog in the registry (slice 16 §8): the agents are those serving a type and those proposals are for. Columns: Agente (name from the id + id), Atiende, Estado (En producción, Solo en pruebas, Sin publicar; "Sin datos del registro" without agent-core), Versión (the agent entity's version in the release `prod` points at). **No "Hoy" column**: see §6. |
| `agente` | aliases, releases, `GET /builder/versions/agent/{id}`, the index | Dónde corre (prod and staging with version, release and date), the types it serves, its versions (changelog, date), its proposals. **"Volver a la versión anterior"** (prod back to the release the current one was based on) and **"Pasar a producción"** (prod to what staging holds) are real alias promotions with her code. **No "Pausar"**: the registry has nothing that stops an agent. |

"Proponer un agente" uses **the builder chat** (`constructor-chat`), because it is the only path that
writes a draft a supervisor can read: agent-core's flow `construir` collects the agent (`agente`)
and the goal (`objetivo`), drafts the entities, creates the proposal itself, writes and validates
the draft, and answers. The chat opens with a first message she can edit:
`Agente: cobros. Objetivo: un agente nuevo que atienda los chats de los casos de tipo "Cobro indebido" …`
plus the evidence ("El equipo envía 84 de los últimos 100 borradores …"). It is **Spanish whatever
the UI language**: `constructor-chat` supports `es` only and the platform sends `lang: es`. The
agent id is the type's own once an agent serves it, otherwise a suggestion (`disputas` for "Cargo
no reconocido", agent-core's demo agent; `cobros`, `soporte-app`, `sucursales`, `calidad-servicio`,
`tarjeta-virtual`: **team-generated**). Proposals the answer names are tracked by the backend and
offered as "Abrir propuesta" (the link carries `?type=`); the type panel lists the proposals for
its agent id. Creating an empty proposal (`POST /builder/proposals`) was not used: nobody could
write its draft from the platform.

The proposals list is **ready for the improvement engine** (PR #17, not merged): `source` is read as
text and `engine` reads "Del motor de mejora" (sparkles icon); a row the registry did not answer for
says "Sin confirmar". Nothing depends on that PR.

## 4. Frontend

New feature `features/automation` (public `index.ts`; no `core.ts`: the shell needs nothing from it):

- `api.ts` (every call; `automationKeys`), `types.ts`, `url.ts` (`?type=`).
- Pure, tested: `model.ts` (panorama order, `stageView`, `signalLine`, `maturitySteps`, `ruleLines`,
  `draftBreakdown`, `moveBackOptions`, `agentIdFor`, `agentName`), `proposals.ts` (states, steps,
  sources, `changeView`, `draftTools`, `draftLanguages`, `suiteFor`, `reportView`,
  `describeBuilderFailure`), `agents.ts` (`agentIds`, `agentRunStatus`, `agentRow`,
  `rollbackTarget`, `promotionTarget`), `builder-chat.ts` (`chatEntries`, `newAgentRequest`).
- `hooks/use-automation.ts`: builder status, proposals (refetched on focus), proposal, aliases,
  releases, versions, the proposal steps, activation, track, prod promotion, the chat (one message
  at a time, retry with the same `clientMessageId`, restart).
- Components: `AutomationFrame` (path, title, sections, the chat sheet any screen opens),
  `AutomationGate` (AI unknown → spinner, off → Colas), `TypesScreen`, `TypePanel`,
  `ProposalsScreen`, `ProposalScreen`, `ProposalNextStep`, `EvaluationReport`, `ActivatePanel`,
  `StepUpDialog`, `AgentsScreen`, `AgentScreen`, `BuilderChat`, `StageBars`.
- Shell: `NavItem.ai` (`visibleNav`), `Rail aiEnabled`, the `agentProposals` indicator
  (`agentProposalCount`); `useAiStages({ enabled })` moved to `features/copilot/core`.
- Catalogs `src/locales/{es,pt-BR}/automation.ts`; `shell:nav.automation`.

## 5. Tests

- Backend: `tests/unit/domain/test_maturity.py` (activation with an agent id, the same agent a no-op,
  another refused), `tests/unit/domain/test_builder.py` (restart), `tests/unit/application/test_activate_agent.py`
  (both adapters, the registry double: prod promoted with step-up then the type served, audited;
  a repeat promotes nothing; a type not ready or served by another agent is refused before any
  promotion; a wrong code leaves the type ready; roles; AI off; no registry), `tests/api/test_builder_api.py`
  (the activation route: schema, wrong code, idempotent, `agentId` in the stages, the audit text,
  409, 403, 422; the chat restart starts a new run; both 404 without agent-core).
- Frontend: `model.test.ts`, `proposals.test.ts`, `agents.test.ts`, `builder-chat.test.ts`,
  `url.test.ts`; routes `automation.test.tsx` (panorama, the type panel, move back and its failure,
  live `ai.stage_updated`, "Proponer un agente" through the chat, retry and "Nueva conversación",
  AI off and turned off, pt-BR), `automation-proposal.test.tsx` (draft: validate with violations
  and valid, freeze; no suite; a failed gate; 404 as no suite; approve with a wrong then a good
  code; the loosened yardstick; reject; publish with one key; activate and the done view; choosing
  the type; no agent-core; pt-BR), `automation-agents.test.tsx` (list, detail with rollback, no
  "Pausar", without agent-core, the proposals list with an engine row, tracking, pt-BR);
  `Rail.test.tsx`, `roles.test.ts`.
- e2e (`automation.spec.ts`, no agent-core): Lucía opens Automatización from the rail, reads the
  seeded types ("Cargo no reconocido" served by Disputas), opens a type, moves it back one stage
  (toast, the row follows), Propuestas says the engine is missing, AI off removes the item and
  leaves to Colas, AI on brings it back. `i18n.spec.ts` walks Automação in Portuguese.
- Read-only smoke against the local stack (agent-core `--registry-api` on 8001, the platform on 8100
  from older code), 2026-10-05: `GET /builder/status` (available, step-up 6 digits), `GET
  /builder/proposals` (empty index), `GET /builder/aliases/disputas/prod` and `/staging` (the same
  release), `GET /builder/aliases/recepcion/prod`, `GET /builder/releases/{id}` (entities, agent
  `disputas@1.0.0`, no `evalSuiteRefs`), `GET /builder/versions/agent/disputas` (one version), `GET
  /builder/chat`. Nothing written.

## 6. Known gaps (what the AI team must provide for a real end-to-end activation)

- **An `eval_suite` for the agent** (slice 16 §8): without it `evaluate` is 404 and nothing can be
  approved, published or activated. Locally no agent has one (the stack's `disputas` release has no
  `evalSuiteRefs`). The screen says "Este agente no tiene suite de evaluación".
- **A new agent that serves a type end to end**: `constructor-chat` must be able to draft a whole
  new agent (agent, flow, prompts, the eval suite) from the first message, and **`recepcion` must
  route that type to it** (a second proposal on `recepcion`, or agent-core's routing reading the
  types). Promoting `cobros@prod` alone does not make the assistant use it: the platform always
  starts conversations with `CC_ASSISTANT_AGENT` (`recepcion@prod`). The platform's "Con agente"
  (`agent: active`, `agentId`) is the record of Supervisión's decision and drives the analyst's
  strip; it does not route.
- **Whether `constructor-chat`'s answer names the proposal id** (slice 16 §8, not verified live):
  if not, she uses "Seguir" by id in Propuestas. A list call in the registry
  (`GET /v1/registry/proposals?agent=&state=`) would remove the index.
- **No agent catalog** in the registry: the agents list is derived (types served + proposals). A
  display name per agent would replace the humanized id.
- **"Hoy: resueltos vs pasados a personas" per agent** (the canvas's agent row and detail) is not
  shown. It is derivable in principle (each assistant session's last answering agent, recorded on
  `assistant.turn_answered.agent` and the session, with `assistant.ended.result`), but it needs a
  read model and the AI team to confirm what `agent` holds after a transfer (id, `id@alias` or
  `id@version`). The seed has no assistant sessions, so the demo would show zeros.
- **No "Pausar"**: the registry cannot stop an agent; revoke needs `admin` and is refused while
  `prod` points at the release. Pausing would need agent-core support (or `recepcion` to stop
  routing to it). Deactivating the type's agent on the platform alone would be a fake, so it is not
  built (moving such a type back stays refused, as in slice 21).
- **A new version of an agent that already serves a type**: activation is for the first agent of a
  type (the same agent again is a no-op). Its new releases reach `prod` with "Pasar a producción" in
  the agent's page.
- **Rollback target** is the base of the release `prod` points at (the staging release the proposal
  was based on), not a history of `prod`: the registry exposes no alias history read.
- Not exercised live: approve, publish, promote and activation (they need a suite), and a chat that
  creates a proposal (a write).
