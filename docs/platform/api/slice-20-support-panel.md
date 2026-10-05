# Slice 20 · The analyst's support panel (S15's screens)

**Status:** implemented (2026-10-04) on `feat/ai-support-panel`. Gates in `../ENGINEERING_BRIEF.md` §6.
**Date:** 2026-10-04.

**Scope.** The screens of the copilot whose backend is slice 15 (`slice-15-copilot.md`, the Q&A thread) and slice
15b (`slice-15b-copilot-suggestions.md`, the suggestions): the "Copiloto" and "Herramientas" tabs of the Workspace's
right panel, the copilot's draft above the composer, its recommendation to escalate, and the live signal. Frontend
only: no backend or contract change (`backend/openapi.json` is unchanged).

Read first: `../ENGINEERING_BRIEF.md` (it wins), `../adr/0006-ai-maturity-by-case-type.md`, `../adr/0005-copilot-suggestions.md`,
`slice-15-copilot.md`, `slice-15b-copilot-suggestions.md`, `slice-19-assistant-screens.md` (the tabbed panel this slice
extends), `../../../frontend/ARCHITECTURE.md` (slice 20 section).

Design: the canvas boards `IaWorkspace` views `et1`, `et1Vacio`, `et1Espera`, `et1Error`, `et1Herr`, `et2`,
`et2Resultado`, `et2Cliente`, `et3`, `et3Editar` (`IaAnEtUno*`, `IaAnEtDos*`, `IaAnEtTres*`), the v66 right panel the
user liked (Copiloto / Herramientas / Cliente).

---

## 1. When it shows

- **Only with the AI switch on** (`useAiEnabled()`, slice 18). With it off the Workspace is exactly the slice 6 one:
  no "Apoyo" button, no copilot tab, no draft, no recommendation; `?panel=copilot|tools|handoff` is ignored (the
  panel stays closed) and nothing of the copilot is requested.
- **Only for her own case**: every copilot route is the assignee's (`403` otherwise), so the SPA asks only when
  `case.assignedAnalystId` is her (`useCopilotAccess`).
- **Only what the backend offers**: "Copiloto" while `GET /cases/{id}/copilot` says `available: true`;
  "Herramientas", the draft and the recommendation while `GET …/copilot/suggestions/latest` says `available: true`.
  An error or `available: false` hides them (it is never an error state on screen).
- **The stage gate is one value** (for S21): `CopilotMode = 'answer' | 'tools' | 'drafts'` (ADR 0005's `copilot_mode`,
  ADR 0006's stages 1-3) and `copilotSurfaces(mode)` → `{ copilot, tools, draft }`. The Workspace computes
  `copilotMode` once (S20: `FULL_COPILOT_MODE` = `drafts` with AI on, `null` with it off) and passes it to the panel
  and to the conversation (`ConversationPane copilotMode`). S21 replaces that one line with the case type's stage;
  no screen changes. The recommendation to escalate shows at every mode (it comes from rules, ADR 0005 §4).

## 2. The right panel ("Apoyo del caso")

Tabs, in this order, each only when it applies: **Traspaso** (a case the assistant handed over, slice 19) ·
**Copiloto** · **Herramientas** · **Cliente** (the ficha). URL `?panel=handoff | copilot | tools | customer`
(`WorkspacePanel`, `parsePanel`); `?panel=customer` keeps working, a `?previous=` link still opens Cliente, and a URL
naming a tab the case does not have shows the first one.

- **"Apoyo"** (new, header, AI on; IaWorkspace's button, lucide `PanelRight`, title "Copiloto, herramientas y
  cliente", `aria-expanded`): opens the panel at Copiloto (or its first tab) and closes it. The customer's name still
  opens it at Cliente. The focus goes back to whichever opened it.
- `TabbedSidePanel` gained `SidePanelTab.layout: 'scroll' | 'fill'`: "Copiloto" fills the tab (its own scroll, the box
  pinned at the bottom).

### Copiloto (`CopilotPanel`)

| State | What it shows |
|---|---|
| always | A quiet line on top: [eye] "Consulta y calcula con los datos de Natalia. No hace cambios ni le escribe al cliente." |
| empty | "Pregúntale sobre Natalia", "Responde en unos segundos con lo que puedes ver de este cliente.", "Ejemplos": three starter questions (products, movements, previous complaints: what the dataset holds about a customer) that **only fill the box** and focus it. |
| thread | "Preguntas al copiloto": her question (right, grey bubble, time), then every answer under it (agent-core may answer a conclusion and a follow-up question: both show). |
| asking | "Buscando la respuesta: suele tardar unos segundos." (spinner, a status region mounted with the tab); the box is read-only with `aria-disabled` (not `disabled`, so the focus stays). One question at a time. |
| failed | Under the question: [alert] the reason and **"Reintentar"**, which re-posts the **same** `clientMessageId` (`Idempotency-Key`), so the copilot is never asked twice. |
| unanswered | A stored question without an answer (the copilot said nothing, or a call failed before a reload): "Sin respuesta del copiloto" + "Preguntar de nuevo" (a new question). |
| closed case | The thread stays readable; the box is read-only and says "El caso está cerrado: el copiloto ya no responde."; no starters. |

Box: "Pregúntale al copiloto", Enter asks, Shift + Enter adds a line, "Preguntar" (`aria-disabled` when empty or
busy), "Solo tú ves estas preguntas." and "N/2000". Failure copy (`describeAskFailure`):

| Code | Copy | Retry |
|---|---|---|
| `copilot_busy` | El copiloto todavía responde tu pregunta anterior. Reintenta en unos segundos. | yes |
| `agent_core_unavailable`, `agent_core_rejected`, 5xx | No se pudo responder. Inténtalo de nuevo. | yes |
| network | No hay conexión. Inténtalo de nuevo. | yes |
| `case_closed` | El caso se cerró: el copiloto ya no responde. | no |
| `copilot_unavailable` | El copiloto no tiene datos de este cliente. | no |
| `assistant_disabled` | El copiloto no está disponible ahora. | no |
| `case_not_assigned`, `forbidden` | Este caso ya no está a tu nombre. | no |
| `validation_error`, `invalid_value` | La pregunta puede tener hasta 2.000 caracteres. | no |

Questions in flight live in the query cache (`copilotKeys.asks`, UI-only, never fetched), so a question survives
switching tab or closing the panel while the copilot answers; the answer is merged into the thread cache
(`mergeExchange`). The server stores a question before it calls the copilot, so a question in flight or failed is also
in the thread without an answer: the session's entry stands for it (same text), never both (`copilotTurns`).

### Herramientas (`ToolsPanel`)

- Top: [puzzle] "Lo que el copiloto propone mirar en este caso." and **"Sugerir"** (`POST …/copilot/suggestions`,
  one `Idempotency-Key` per attempt, the same key on "Reintentar" after a 5xx/network failure; `copilot_busy` reads
  the newest again). Hidden on a closed case.
- A status region: "Preparando sugerencias: suele tardar unos segundos." (`status: preparing` or her request in
  flight), "El cliente escribió después de esta sugerencia. Pide otra con Sugerir." (`stale`; the lists dim),
  "El copiloto no pudo preparar la última sugerencia." (`failed`), or the failure of "Sugerir" with "Reintentar".
- **Para consultar** (`tool` items): the label, its `why`, the tool id (mono), and **"Usar"** (named "Usar
  {label}"). Usar asks the copilot a predefined question through her thread (ADR 0005 §3): `Consulta {label} ({tool})
  para este cliente y dime qué encontraste.` While it answers: "Consultando"; then "Consultada" and the answer on the
  card with "Ver en Copiloto". The result is found again from the thread (`toolResult`), so it survives a reload.
  Footer: "Solo consultan: ninguna hace cambios en la cuenta. Cada uso queda en la auditoría."
- **Preparadas, sin ejecutar** (`action` items, `executable: false`): a dashed card with the pill [info] "Solo
  información", the summary and the tool id, **no button**; footer "El copiloto no las ejecuta. Si corresponde,
  hazlo tú por el flujo de siempre."
- Empty (no suggestion, `none`, or nothing of these kinds): "Todavía no hay herramientas para este caso", "Aparecen
  cuando el copiloto ve algo que vale la pena consultar. Mientras tanto, pregúntale en Copiloto o pídele una
  sugerencia." + "Ir a Copiloto".

## 3. In the conversation

### The draft above the composer (`CopilotDraft`, `drafts` mode)

Shown above the chat composer (not for a call or an email) of her open case while the newest suggestion has a `reply`
nobody decided:

- "Borrador del copiloto" ([wand], accent) · "Revísalo antes de usarlo", the text, "Lo propone con lo que leyó del
  caso.", and **Descartar** · **Editar** · **Usar** (pale blue card, `assistant-bubble` + `accent-border`). Stale:
  "El cliente escribió después de este borrador." and dimmed.
- **Usar** puts the text in the composer and focuses "Enviar"; **Editar** puts it there and focuses the box (caret at
  the end). If she had written something, the draft goes after her text (never lost). The bar gives way to a line:
  "Borrador del copiloto en el cuadro: revísalo y envíalo" / "Editando el borrador del copiloto". **Nothing is sent
  for her**: she presses "Enviar".
- The reply she sends then carries **`copilotSuggestionId`** (`POST /cases/{id}/turns`); the backend derives `used`
  (same text) or `edited` (with the edit distance). A retry of a failed send carries it again. Clearing the box drops
  the link; a reply of her own carries no id. After the send the newest suggestion is read again (the draft left it).
- **Descartar** posts `{ decision: "discarded" }` (`…/suggestions/{id}/feedback`), optimistic; a failure puts the
  draft back and toasts "No se descartó el borrador".
- `preparing`: a quiet status line "El copiloto está leyendo el caso".

### The recommendation to escalate (`EscalationSuggestion`)

When the newest suggestion has an `escalate` item she has not accepted and she may escalate (`canEscalate`): a warm
card under the header "El copiloto recomienda escalar a supervisión", the reason (`escalationReason`: `policy:x` →
"Una política lo pide: X", `rule:x` → "Una regla del copiloto lo pide: X") and "En qué se basa" (the evidence), with
**"Revisar y escalar"** and "Ahora no" (hides it for that suggestion in this view; the API has no feedback for it).
"Revisar y escalar" opens the existing **"Escalar a supervisión"** dialog with `motiveDraft` filled in and the line
"El copiloto sugirió este motivo. Revísalo antes de escalar."; she edits or confirms, and the escalation carries
**`copilotSuggestionId`** (recorded as accepted). The usual "Escalar a supervisión" button never carries it.

## 4. Live

`copilot.suggestion_updated` on `inbox:<staffId>` (the Workspace already follows it) → `registerCopilotRealtime`
invalidates the newest suggestion of that case when it is cached (the signal carries only the id and status; the
content is read over REST). A customer's `turn.created` does the same (the suggestion becomes `stale`). After a
reconnect the open case reads it again (`useOnReconnect`).

## 5. Code (`frontend/src/features/copilot`, new)

`api.ts` (`copilotKeys`: `thread`, `asks`, `latest`; the five calls), `types.ts`, `model.ts` (pure, `model.test.ts`:
`CopilotMode` / `copilotSurfaces`, `copilotTurns`, `mergeExchange`, `describeAskFailure`, `suggestionView`,
`toolQuestion` / `toolResult`, `escalationReason`, `describeSuggestFailure`, `composerTextWithDraft`, the copy),
`hooks/use-copilot.ts` (`useCopilotAccess`, `useCopilotThread`, `useCopilotAsks`, `useAskCopilot`),
`hooks/use-suggestions.ts` (`useLatestSuggestion`, `useRequestSuggestion`, `useDiscardDraft`), `realtime.ts`,
`components/` (`CopilotPanel`, `ToolsPanel`, `CopilotDraft`, `EscalationSuggestion`), `core.ts` (keys, realtime,
gating) and `index.ts`. Dependency direction: `workspace` → `conversation` → `copilot` (copilot imports no feature).
`conversation`: `escalateCase(…, copilotSuggestionId)`, `useSendMessage().send(text, { copilotSuggestionId })`,
`PendingMessage.copilotSuggestionId`, `Composer` focus handle, `EscalateCaseDialog suggestion`, `CaseHeader
supportPanel`, `ConversationPane copilotMode / supportPanel`, `SUPPORT_PANEL_TRIGGER_ID`.

## 6. Tests

- Unit: `copilot/model.test.ts`, `copilot/realtime.test.ts`, `workspace/url.test.ts` (copilot and tools),
  `app/realtime-handlers.test.ts`.
- Component (mocked API): `copilot/components/CopilotPanel.test.tsx` (the quiet line and starters that only fill the
  box; asking with the box read-only and two answers; "Reintentar" with the same id; a closed case),
  `ToolsPanel.test.tsx` (tools and actions as information only; "Usar" asks the predefined question and shows the
  answer; "Sugerir" and its retry with the same key; preparing and stale; the empty state; closed),
  `conversation/components/Copilot.test.tsx` (the draft: Usar, Editar, a reply of her own, Descartar, AI off and
  `tools` mode; the recommendation: reason and evidence, the prefilled dialog and `copilotSuggestionId`, "Ahora no",
  not escalatable), `routes/analyst/workspace.test.tsx` (tab order, "Apoyo", `?panel=customer|tools`, unavailable
  copilot, AI off).
- e2e: `ai.spec.ts` now also checks that, without agent-core (the e2e backend), there is no Copiloto / Herramientas
  tab and no draft, and that "Apoyo" follows the switch live. The copilot's own flows need agent-core, so they are
  covered by the component tests.

**Manual smoke check (read-only)** against the local stack (`../stack`: platform `origin/main` on 8100 + a real
agent-core), `GET` only: Sebastián's three open cases (customers not linked) answer `available: false` for both the
thread and the suggestions; his closed cases of the linked customers answer the thread `available: true`, and one
thread holds a real exchange: one question with **two** answers (the conclusion, then "¿Qué necesitas saber o hacer
con este cliente?"), ~4 s apart from the question, which `copilotTurns` groups under the question. Every
`…/suggestions/latest` answered `{ available: false, suggestion: null }`: the stack runs without
`CC_COPILOT_SUGGESTIONS_AGENT` (agent-core's `copiloto-sugerencias` does not exist yet), so Herramientas, the draft
and the recommendation were only exercised against mocks.

## 7. Known gaps

- **No real suggestions yet**: agent-core's suggestions agent (its ADR 0026) is not there; every suggestion surface
  is built on the contract and tested with mocks.
- **No feedback per tool or action.** The feedback endpoint is about the draft only (`discarded | ignored`): a
  `tool` "used" is a Q&A question (audited as `copilot.query_asked`, not tied to the suggestion), a dismissed tool or
  action has nowhere to go, and neither does "Ahora no" on the recommendation. The maturity signals of S21 will need
  `POST …/feedback` per item (e.g. `{ item, decision: used | dismissed }`): noted for the AI team, not built.
- **`ignored` is never posted by the SPA**: the backend marks an undecided draft `ignored` when a newer suggestion
  replaces it.
- **The thread does not expose a question's `clientMessageId`** (it is stored). After a reload, a question whose call
  failed cannot be retried with its id: it shows as "Sin respuesta del copiloto" with "Preguntar de nuevo" (a new
  question). Exposing `clientMessageId` on `CopilotMessage` would close it.
- **No "Fuente" under an answer** (IaWorkspace shows one): the copilot answers in text and names its source in its
  own words; there is no structured source.
- **The draft is offered for chat only** (not above the email reply or the call's lines).
- The tool id is shown as agent-core's key (`leer_movimientos@1`); the label is the copilot's own.
- The stage per case type (which surfaces each type gets, the stage bars) is S21.
