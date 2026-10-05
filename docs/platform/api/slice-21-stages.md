# Slice 21 · The AI stages per case type

**Status:** implemented (2026-10-04) on `feat/ai-stages`. Gates in `../ENGINEERING_BRIEF.md` §6.
**Date:** 2026-10-04.

**Scope.** ADR 0006 §1 and §4 made real: each case type has a stage, measured from what the platform records
and moved by a **team rule**; a case's copilot mode is its type's stage; the Workspace shows the stage under the
case header; Supervisión can move a type back. Plus the Inicio summary of the assistant (IaHomeTurno) and the
minimum tool feedback the stage 2 signal needs. Everything is additive and behind the AI switch.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `../adr/0006-ai-maturity-by-case-type.md` (the model),
`../adr/0005-copilot-suggestions.md`, `slice-15b-copilot-suggestions.md`, `slice-18-ai-foundation.md`,
`slice-20-support-panel.md` (the `copilotMode` this slice sets), `../../../frontend/ARCHITECTURE.md` (slice 21).

Design: `IaWorkspace` (the stage strip: case type, three bars, one line; views `et0`…`et3`), `IaAutomatizacion`
view `tipo` (signals and thresholds: the values of the team rule), `IaHomeTurno` (Inicio with the assistant).

---

## 1. The model

| Stage | What the analyst gets for a case of the type | `copilotMode` |
|---|---|---|
| 0 · people only | No copilot. | `null` |
| 1 · she asks | "Copiloto" (the Q&A thread, slice 15). | `answer` |
| 2 · it proposes tools | + "Herramientas" (the `tool` / `action` suggestions) and the automatic suggestions. | `tools` |
| 3 · it shadows | + the draft above the composer (the `reply` suggestion). | `drafts` |
| agent `ready` | Stage 3, and the system proposes an agent to Supervisión (slice 22 builds that screen). | `drafts` |
| agent `active` | An agent serves the type (the assistant hands over what it cannot resolve). | `drafts` |

- **"Sin tipo" does not mature**: a case without a type gets stage 0 (no copilot) and no strip. Decided so
  that the copilot's help is earned per kind of case (the canvas shows no AI for an untyped case); it is also
  the nudge to classify. The "Cliente" and "Traspaso" tabs do not depend on the stage.
- **The escalation recommendation** (slice 20) still shows wherever the copilot shows and a suggestion carries
  it; since automatic suggestions are made only from stage 2 (§4), in practice it appears from stage 2.
- **ADR 0005's per-type `copilot_mode` did not exist in the AI team's backend** (it was "all on by default",
  ADR 0005 §6, never built). This slice is it: the platform computes the mode per type and exposes it
  (`GET /ai/stages` → `copilotMode`); nothing was duplicated.

## 2. Signals and the team rule

`CaseTypeMaturity` (`domain/ai/maturity.py`, table `case_type_maturity`, one row per type, absent = stage 0)
holds the stage, the agent status, the signals **counted since the type reached its current stage** (each
stage is earned with its own evidence; a type moved back earns it again from zero), when each stage was reached
and the last change.

Signals come only from what the platform records (`MaturityProjector`, a bus subscriber, only while AI is on):

| Signal | Source | Counted |
|---|---|---|
| cases resolved | `case.closed` with reason `resolved` | when a case of the type closes (with the type it has then) |
| cases with questions to the copilot | `copilot.query_asked` of that case (event log) | when it closes |
| cases where tools were proposed / one was used | `copilot.suggestion_ready` with kind `tool` / `copilot.tool_used` (new, §3) | when it closes |
| drafts sent as is (or with minor changes) / edited / discarded | `copilot.suggestion_decided` (`subject: reply`) | when decided; the last N in a window; `ignored` not counted |

**The rule** (`StageRule`, **team-generated example thresholds**, not learned from data; configurable with
`CC_STAGE_*`; the API returns it as `rule` so a screen can show it as "Regla del equipo (ejemplo)"):

| Step | Default | Origin |
|---|---|---|
| 0 → 1 | 10 cases of the type resolved by people | team-generated (the canvas states none) |
| 1 → 2 | 20 closed cases with questions to the copilot | canvas: "una misma pregunta se repite en 20 casos" (the platform keeps no question text, so it counts cases with questions) |
| 2 → 3 | tools used in ≥ 70 % of the closed cases where they were proposed, once there are ≥ 10 | canvas: "7 de cada 10"; the minimum is team-generated |
| 3 → agent `ready` | ≥ 80 of the last 100 drafts sent as is or with minor changes (edit distance ≤ 150/1000) | canvas: "8 de cada 10 … en 100 casos seguidos"; the minor-change limit is team-generated |

Advancing is automatic, one step at a time, audited (actor `system`) and pushed live. Moving to an active agent
is never automatic (slice 22: Supervisión tests and activates).

| Variable | Default |
|---|---|
| `CC_STAGE_RESOLVED_CASES_TO_ASK` | `10` |
| `CC_STAGE_ASKED_CASES_TO_PROPOSE_TOOLS` | `20` |
| `CC_STAGE_TOOL_USE_PERCENT_TO_SHADOW` | `70` |
| `CC_STAGE_TOOL_CASES_MINIMUM` | `10` |
| `CC_STAGE_DRAFT_WINDOW` | `100` |
| `CC_STAGE_DRAFT_AS_IS_PERCENT_FOR_AGENT` | `80` |
| `CC_STAGE_MINOR_EDIT_PERMILLE` | `150` |
| `CC_STAGE_GATES_SUGGESTIONS` | `true` (§4; `false`: automatic suggestions for every case, a development aid for the suggestions agent) |

## 3. REST

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `GET /api/v1/ai/stages` | analyst, supervisor | — | 200 **`AiStages`** | 401, 403 `forbidden` |
| `POST /api/v1/supervision/ai/stages/{caseType}/move-back` | supervisor | **`MoveStageBackRequest`** | 200 **`MoveStageBackResult`** | 401, 403, 404 `not_found` (`none` or unknown type), `assistant_disabled` (AI off), 409 `invalid_transition` (a higher stage; a type an agent serves), 422 |
| `POST /api/v1/cases/{caseId}/copilot/suggestions/{suggestionId}/tools` | analyst (assignee) | **`ToolUsedRequest`** | 204 | 401, 403 (`forbidden`, `case_not_assigned`), 404 `not_found` (not her suggestion, not `ready`, a tool it did not propose), `assistant_disabled` (AI off), 422 |

```ts
AiStages        { available: boolean /* false: AI off, types empty */; rule: StageRule; types: CaseTypeStage[] }
StageRule       { resolvedCasesToAsk; askedCasesToProposeTools; toolUsePercentToShadow; toolCasesMinimum;
                  draftWindow; draftAsIsPercentForAgent; minorEditPermille }            // all int
CaseTypeStage   { caseType: CaseType /* never none */; stage: 0..3; agent: 'none' | 'ready' | 'active';
                  copilotMode: 'answer' | 'tools' | 'drafts' | null; signals: StageSignals;
                  reached: { stage: 1..3; since: datetime }[]; agentSince: datetime | null;
                  lastChange: { kind: 'advanced' | 'moved_back' | 'agent_ready' | 'agent_active'; at; byName: string | null } | null;
                  version: int }
StageSignals    { closedCases; resolvedCases; askedCases; toolCases; toolUsedCases; drafts; draftsAsIs; draftsEdited; draftsDiscarded }
MoveStageBackRequest { toStage: 0..3 }   // a desired state: the same stage = changed: false; 3 on a `ready` type withdraws the proposal
MoveStageBackResult  { changed: boolean; type: CaseTypeStage }
ToolUsedRequest      { tool: string; decision: 'used' }   // only `used` for now
```

- The stages are **platform data**: they answer with AI on whether or not agent-core is configured (like the case
  type, slice 18). With AI off: `available: false`, the writes 404 `assistant_disabled`.
- Analysts read the same answer as Supervisión (counts only, no customer data).

## 4. What the stage changes on the backend

- **Automatic suggestions** (ADR 0005's `SuggestionProcess`) are made only for a case whose type is at stage 2 or
  more: `WhileTypeProposes` wraps the process in the composition root (their code is unchanged). A manual
  "Sugerir" and the Q&A routes are **not** gated server-side: the SPA does not show them below their stage
  (gap §9).
- **Tool feedback**: "Usar" in Herramientas posts `…/tools` `{ tool, decision: "used" }` → `copilot.tool_used`
  (entity `copilot`, entity id the suggestion, `case_id` set). It is a platform-side event next to the
  suggestion; the `CopilotSuggestion` aggregate is not changed.

## 5. Realtime and audit

| Event | Envelope · topic |
|---|---|
| `ai.stage_advanced`, `ai.stage_moved_back`, `ai.agent_ready`, `ai.agent_activated` | `ai.stage_updated` `{caseType}` (a signal: read `GET /ai/stages`) → **`ai:stages`** (new; analysts and supervisors, never customers) |
| `copilot.tool_used` | none (silent, like every copilot event) |

Audit (family **agents**, "Agentes e IA" in the SPA; all change state): "Subió Cobro indebido a la etapa 3: el
copiloto propone respuestas" (system), "Devolvió Problema con app a la etapa 1: el copiloto responde"
(Supervisión), "Retiró la propuesta de agente de Cobro indebido", "Propuso un agente para Cobro indebido"
(system), "Activó el agente de Cargo no reconocido". `copilot.tool_used`: family conversation, "Usó una
herramienta que propuso el copiloto". Payloads: the type and the stages only.

## 6. Inicio with the assistant (IaHomeTurno)

`GET /me/home` gains `assistant: { resolved, handedToYou, withAssistantNow } | null` (null with AI off), all in
her languages: conversations the assistant resolved since `since` (`assistant.ended` `resolved`), cases it handed
over that went to her since `since`, and the open conversations it holds now. `HomeActivityKind` gains
`assigned_by_assistant` ("El asistente te lo pasó"). **Bug fixed on the way**: an `assistant_handoff`
assignment had no activity kind and made `GET /me/home` fail (500) for an analyst who received a hand-over.

SPA: with AI on, a first line in "Mientras no estabas": [bot] "Asistente virtual" + "Resolvió 9 conversaciones de
tus idiomas y te pasó 1" (only when it did something), and "Con el asistente ahora N" in "Tu equipo ahora".

## 7. Seed (sample values, consistent with the canvas story)

Each type climbs through the domain with the rule (so the audit holds the steps on the story's dates), then keeps
sample signals for its current stage (`infrastructure/seed/maturity.py`):

| Type | Stage | Sample signals |
|---|---|---|
| Tarjeta virtual (team-generated) | 0 | 2 cases resolved |
| Atención en sucursal | 1 (since T−40d) | questions in 3 of 10 closed cases |
| Calidad de servicio | 1 (since T−27d) | questions in 7 of 10 |
| Problema con app | 2 (since T−12d) | tools used in 6 of 10 |
| Cobro indebido | 3 (T−61d, T−32d, T−19d) and ready for an agent (T−2h) | 84 of the last 100 drafts sent as is |
| Cargo no reconocido | 3, agent active since T−6d (Lucía) | — |

Seeded cases close into these counts (e.g. 104 counts as a resolved Cobro indebido). Delete
`backend/cc_platform.db` (new table, no migrations).

## 8. Frontend

- `features/copilot`: `stages.ts` (pure: `copilotModeOf`, `stageOfType`, `stageStrip`, `STAGE_TEXT`),
  `hooks/use-stages.ts` (`useAiStages`: enabled with AI on, subscribes `ai:stages`, refetches on reconnect),
  `components/StageStrip.tsx`, `api.ts` (`fetchAiStages`, `recordToolUsed`, `copilotKeys.stages`),
  `realtime.ts` (`ai.stage_updated` → read the stages again). `FULL_COPILOT_MODE` is gone.
- Workspace: `copilotMode = copilotModeOf(stages, case.caseType)` (the case detail query it already shares with
  the conversation); unknown stages read as no copilot, so nothing flashes. `ConversationPane stageStrip`
  renders it under the header (never in supervision).
- The strip (IaWorkspace): [tag] the type (sr "Tipo de caso: "), three 12×4 bars (accent-strong up to the
  stage, all three for an agent), [bot] for an agent, one quiet line: "Etapa 2 de 3: el copiloto propone
  herramientas"; "Etapa 0 de 3: lo resuelve el equipo; el copiloto todavía no aprende de este tipo"; "Con
  agente: el asistente virtual atiende este tipo y te pasa lo que no resuelve". Only for a typed case, AI on.
- Herramientas: "Usar" also posts the tool feedback (best effort; a failure never shows).
- Also in this slice (lead's request): the "Traspaso" tab shows a nested fact value as a readable list (keys
  humanized, one line per item, "y N más" past 8), never raw JSON (`valueLines`, `handoff.ts`).

## 9. Tests

- Backend: `tests/unit/domain/test_maturity.py` (each step of the rule, the window, resets, moving back,
  the agent), `tests/unit/application/test_maturity.py` (both adapters: the seed story, a closed case moving its
  type up with an audited system event, untyped cases, the drafts window, moving back, the tool feedback, AI
  off, the suggestions gate), `tests/api/test_ai_stages_api.py` (roles, schema, move back with audit and live
  `ai:stages`, rules, the tool route, AI off, customers cannot follow), `tests/unit/application/test_home_assistant.py`
  (the hand-over row, the summary, AI off). Adjusted: the builder audit test (the agents family also holds the
  seeded stage events), the suggestion process tests (`stage_gates_suggestions=False`: untyped cases), the audit
  catalog test, the topic list, the home API keys.
- Frontend: `stages.test.ts`, `StageStrip.test.tsx`, `realtime.test.ts`, `ToolsPanel.test.tsx` (the feedback),
  `Copilot.test.tsx` (draft at stage 3, none at 1 and 0), `routes/analyst/workspace.test.tsx` (stage 3: every
  surface and the strip; stage 1: only Copiloto; stage 0 and "Sin tipo"; agent; nothing before the stages or with
  AI off), `routes/analyst/home.test.tsx`, `home/model.test.ts`, `Handoff.test.tsx` / `handoff.test.ts`.
- e2e (`ai.spec.ts`): an analyst classifies a case: none → no strip; "Cobro indebido" → "Etapa 3 de 3…" (no draft
  without agent-core); "Problema con app" → its stage, then Supervisión moves it back and the strip follows live;
  "Sin tipo" → no strip. The draft of a stage-3 type needs agent-core: component tests.

## 10. Known gaps (and what the AI team should own)

- **Server-side enforcement of the mode** on the manual routes (Q&A, "Sugerir", feedback): today the SPA hides
  them below their stage; `SuggestionService` / `AskCopilot` could read `copilot_mode_for` and answer
  `available: false`. AI team.
- **Stage-aware suggestions**: at stage 2 the agent still drafts a `reply` (the SPA hides it). Sending the mode
  in the suggestion `input` (e.g. `modo_copiloto`) would let agent-core skip drafting. AI team (agent-core ADR 0026).
- **Per-item feedback** beyond "used": a dismissed tool, an action, "Ahora no" on the recommendation have no
  endpoint. `ToolUsedRequest.decision` is an enum ready for `dismissed`. Ideally it moves into ADR 0005's feedback
  (`POST …/feedback { item, decision }`) and the suggestion aggregate. AI team.
- **"The same question repeats in 20 cases"** (canvas) is approximated by "cases with questions": the platform
  keeps no question text. Clustering questions belongs to agent-core.
- **Signal aggregation** lives in the platform (counters on the aggregate, fed by events). If agent-core is to
  own it (ADR 0006 §4), the port is `MaturityProjector`'s input; nothing in the screens changes.
- Counters are a projection, not rebuilt from the log (the seed's sample values are not derivable). A rebuild
  command would replay `case.closed` and `copilot.suggestion_decided`.
- A case counts with the type it has **when it closes**; reclassifying a closed case is not possible anyway.
- Cases resolved while AI is off do not count (the projector runs only with AI on).
- Supervisión's screen for the stages (panorama, signals, thresholds labelled "Regla del equipo (ejemplo)", move
  back) is slice 22; this slice ships its API. Slice 22 adds `CaseTypeStage.agentId` and the activation
  (`POST /supervision/ai/stages/{caseType}/agent`): `api/slice-22-automation.md`.
- No migrations: delete `backend/cc_platform.db`.
