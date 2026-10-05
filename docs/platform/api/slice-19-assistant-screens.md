# Slice 19 · The assistant in the app (S14's screens)

**Status:** implemented (2026-10-04) on `feat/ai-assistant-screens`. Gates in `../ENGINEERING_BRIEF.md` §6.
**Date:** 2026-10-04.

**Scope.** The screens of the assistant whose backend is slice 14 (`slice-14-assistant.md`): the customer
simulator's conversation with the assistant, the hand-over to people, the analyst's view of an assistant's
case (its turns, "Cómo llegó a ti", the handoff card and the "Traspaso" tab, the handoff label at close),
Supervisión's "Colas" rows and "Tomar el caso", and the audit's name for the assistant. Two backend changes:
turning AI off hands the assistant's open conversations to people (lead decision), and agent-core's default
handoff priority `normal` reads as medium.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `../adr/0006-ai-maturity-by-case-type.md`,
`slice-14-assistant.md` (the contract these screens follow, §3–§8), `slice-18-ai-foundation.md` (the AI
switch), `../../../frontend/ARCHITECTURE.md` (slice 19 section).

Design: the canvas boards `IaSim*` / `IaMain` (simulator), `IaWorkspace` ("iaTraspaso", "iaTraspasoTodo",
"iaTraspasoError", "iaCerrar"), `IaSuColas*`, `IaSuAudit`. The assistant's look everywhere: lucide's stroke
`bot` icon and a pale blue bubble (`assistant-bubble` #eef1fb with `accent-border`); its name is "Asistente
virtual".

---

## 1. The AI switch and the assistant's states

- **AI elements follow the switch** (`useAiEnabled()`, slice 18): the handoff card, the "Traspaso" tab, the
  tabbed right panel, the handoff question at close and the "Con el asistente" filter option render nothing
  with AI off; the Workspace's right panel is then the slice 6 "Ficha del cliente", unchanged.
- **The assistant's conversation states follow the data.** A conversation is `with_assistant` only while AI
  is on: new chats never start with the assistant when it is off (slice 18), and turning it off now hands the
  open ones to people (§5). The controls that let a conversation leave the assistant ("Hablar con una
  persona", "Tomar el caso") are shown whenever the status says the assistant holds it, so neither a customer
  nor Supervisión is ever stuck during the few seconds of the hand-over. Turns the assistant wrote stay in
  every transcript (they are the record) with its name and bubble, whatever the switch says.

## 2. Customer simulator (`features/customer-chat`)

Rules in `assistant.ts` (pure, `assistant.test.ts`); controls in `components/AssistantControls.tsx`; hooks
in `hooks/use-assistant.ts`. Everything inside the phone frame speaks the customer's language (es / pt).

| State (`conversation`) | What the chat shows |
|---|---|
| `with_assistant` | Header: "Te atiende el asistente virtual" + the "Hablar con una persona" pill (always). The assistant's turns on the left, bot icon + "Asistente virtual" above a pale blue bubble. |
| `assistant.working` | "El asistente virtual está escribiendo…" (three dots, static with reduced motion) in an `<output>` mounted with the chat, so it is announced. No suggestion chips. |
| `assistant.confirmation` | "Confirma para seguir" card: the summary, "Vence a las 19:28" (viewer's zone; "Esta confirmación venció." once past), "No" / "Sí" → `POST /customer/conversation/confirmation`. |
| `assistant.stepUp` | "Confirma que eres tú": one 6-digit field ("Código de verificación", digits only), "Verificar" → `POST …/step-up`; a wrong code says "Código incorrecto. Te quedan 2 intentos."; the third hands over (§8 below). While `simulated`: the pill "Código simulado de desarrollo: 000000". agent-core's `reason` is a code (`requires_step_up`), so the prompt uses its own line ("El asistente lo necesita para seguir con lo que pediste."). |
| `waiting_agent` after the assistant | "Te estamos pasando con una persona del equipo…" (the server adds its public notice); then `with_agent`: "Te atiende Daniela, de LATAM Bank". The assistant's turns stay. |
| `closed` by the assistant (`agentName` "Asistente virtual") | The slice 7 survey asks "¿Cómo te atendió el asistente virtual?"; a past block says "Te atendió el asistente virtual". |
| Picker | A customer whose open conversation is `with_assistant`: bot glyph + "Con el asistente virtual". |

Any status can follow any turn (agent-core may resolve, escalate, ask to confirm, then ask for the second
factor, and one customer message can produce several assistant turns): the chat renders whatever
`conversation.updated` / `turn.created` say, with no assumption about order.

**Errors (§8 of slice 14)**, one copy per code in `describeAssistantFailure` (es / pt), shown in the card or
under the button that failed (`role="alert"`):

| Code | Copy (es) | The chat refetches |
|---|---|---|
| `invalid_step_up_code` (`remainingAttempts` > 0) | Código incorrecto. Te quedan N intentos. | no (the prompt stays) |
| `invalid_step_up_code` (0) | Código incorrecto. Te pasamos con una persona del equipo. | yes (now `waiting_agent`) |
| `assistant_not_active` | Una persona del equipo ya tiene tu conversación. | yes |
| `assistant_busy` | El asistente todavía está respondiendo. Inténtalo en un momento. | yes |
| `confirmation_expired` | La confirmación venció. Escribe de nuevo lo que necesitas. | yes |
| `confirmation_not_pending`, `step_up_not_pending` | Eso ya se respondió. | yes |
| `assistant_disabled` | El asistente no está disponible ahora. | yes |
| network | No hay conexión. Inténtalo de nuevo. | no |
| `assistant_active` (a call or an email) | El asistente virtual te está atendiendo por chat. Escríbele por ahí o pide hablar con una persona. + "Hablar con una persona" | — |

The `assistant_active` answer appears where the call starts (the channel picker's "No se pudo llamar"
callout, the call view) and under the email composer, each with "Hablar con una persona".

## 3. Analyst (`features/conversation`, `features/workspace`)

- **Transcript**: `TranscriptVariant` `assistant` (the bank's side, right-aligned, pale blue bubble, bot +
  "Asistente virtual" + time). The routing banners (`kind: routing`, staff-only) already rendered as the
  accent "Nota interna" line; slice 14's texts show there ("El asistente escaló el caso a una persona.",
  "IA desactivada: el caso pasó del asistente a una persona.", …). The handoff's reference (an
  agent-core UUID) stays in the line's facts (`staffLine.params.ref`) but is not shown.
- **"Cómo llegó a ti"** for `assistant_handoff`: [bot] "Tras el traspaso del asistente", [languages] "Hablas
  ES" (+ "Regla 3" in Portuguese). Supervisión's line: "Lo atiende Daniela Ríos: le llegó tras el traspaso
  del asistente"; for a case the assistant holds: "Lo atiende el asistente virtual desde las 10:47" and the
  footer "Lo atiende el asistente virtual. Si lo tomas, pasa a la cola en español.".
- **The handoff** (`handoff.ts`, pure, `handoff.test.ts`): `GET /cases/{id}/handoff` is read once
  (`useCaseHandoff`: AI on, the case's assignee, `assignment.reason === 'assistant_handoff'`; one retry for a
  5xx, `staleTime: Infinity`) and shared by the card, the tab and the close dialog. `readHandoff` reads
  agent-core's snake_case packet defensively (a missing or odd member is an empty section, never a crash)
  and gives Spanish words to its codes: `reason_code` (the `ReasonCode` enum and the `policy:` / `rule:` /
  `interrupt:` prefixes), `priority` (`normal` → medium), action states, fact sources. Fact and slot names
  are agent-core's own keys, humanized ("Charge amount: 120").
- **The card** "El asistente te pasó este caso" (on top of the conversation, open cases, AI on): "Solo el
  equipo", then — because agent-core's `request_summary.text` is often generic ("Una política exigió
  atención humana…") — it leads with "Por qué te lo pasó: …", the priority the assistant saw (glyph + word),
  the queue it suggested and "N datos verificados", and "Ver todo" (opens the tab). States: loading
  skeleton; 502 / 503 / network → "No pudimos traer el traspaso del asistente" + "La conversación sigue
  disponible…" + "Reintentar"; 403 / 404 → nothing. It never blocks the composer.
- **The right panel with AI on** (`TabbedSidePanel`, `components/layout`): `aside` "Apoyo del caso", 400 px,
  tab list "Apoyo": **Traspaso** (only for a handoff case: while it loads, once loaded, or with its retry)
  and **Cliente** (the slice 6 ficha, the same sections). S20 adds Copiloto and Herramientas to the same
  `tabs` array. URL: `?panel=customer | handoff` (`WorkspaceUrlState.panel`, was `customerFile`); a
  `?previous=` link opens Cliente; another case falls back to Cliente; with AI off `?panel=handoff` is
  ignored. The tab "Traspaso": priority, queue, "Solo el equipo", then **Por qué te lo pasó**, **Verificado**,
  **Dice el cliente, sin verificar**, **Lo que hizo el asistente**, **Falta resolver**, **Qué pide** (the
  summary, "En palabras del asistente"), each with its empty line, a neutral callout for a
  `degraded_packet`, and the footer "Lo armó el asistente virtual con su conversación. Revísalo antes de
  responder.".
- **Close**: "¿Te sirvió el traspaso del asistente? (opcional)" — Útil / Incompleto / Innecesario as three
  toggle cards (`aria-pressed`; picking the picked one clears it) with the hint "Se lo enviamos al asistente
  para que mejore. Si no sabes, déjalo sin marcar." Only when the handoff loaded; `handoffQuality` is sent
  only when answered (`toCloseRequest`), never guessed.

## 4. Supervisión (`features/supervision`) and the audit

- **Colas**: a `with_assistant` row (the backend lists them last) reads [bot] "Con el asistente" (the new
  `bot` status glyph, accent), "No corre" (pause, muted; tooltip "No corre mientras lo atiende el
  asistente") under "Primera respuesta", and in "Lo tiene" the bot avatar, "Asistente virtual" and "Tomar el
  caso" (secondary, named "Tomar el caso de {cliente}") → `POST /supervision/cases/{id}/assistant/release`;
  a toast says where it went ("Quedó en la cola en español: le llega a la primera persona disponible." or
  "Ya lo tiene una persona del equipo."); `assistant_not_active` → "El asistente ya no tiene este caso";
  both refetch Colas and the queues. The row still opens the case view. The queue cards count those cases
  apart: "N abiertos" is people's (as `GET /supervision/queues` counts), plus "[bot] N con el asistente";
  with AI on both languages' rows are read so both cards show it. "Filtros" › Estado gains "Con el
  asistente" (AI on only).
- **The supervisor case view**: the assistant's turns and the banners (shared transcript); "Tomar el caso" in
  the header for a case the assistant holds (never "Reasignar").
- **Auditoría**: the actor badge "Asistente virtual" (neutral) with no name next to it (its agent reference
  stays in the detail's "Quién"); the descriptions of the assistant's events come from the backend catalog
  (Spanish, no message text). New one: `case.assistant_released` with reason `ai_disabled`, "El caso pasó a
  una persona porque se apagaron las funciones de IA"; `assistant.ended` `released` now reads "La atención
  del asistente terminó: el caso pasó a una persona" (it also covers a customer's request and AI off).

## 5. Backend

- **AI off hands the assistant's conversations to people** (`application/ai/staff.py`):
  `AiOffHandoverProcess` (a bus subscriber of `platform.ai_toggled`, wired only when agent-core is
  configured) spawns `ReleaseAssistantCasesOnAiOff` in the background when the switch goes off. It reuses
  Supervisión's release path: for every active `AssistantSession`, in its own Unit of Work with
  `retry_on_conflict`, `session.release` + `AssistantHandover.to_people(reason="ai_disabled", actor=system)`:
  `with_assistant → queued`, the SLA starts, the staff banner "IA desactivada: el caso pasó del asistente a
  una persona.", the public notice ("Te paso con una persona del equipo para que siga con tu caso."), and
  `AssignCase.place(reason=assistant_handoff)` (rule 3). A case that left the assistant meanwhile is skipped.
  Turning it on again, or "off" when already off (`changed: false`, no event), releases nothing. Tests:
  `tests/api/test_ai_switch_api.py` (with Daniela available, nobody available, repeated toggles; the
  customer, staff, audit and `POST …/human` → `assistant_not_active` afterwards).
- **`normal` priority** (`application/ai/priority.py`): agent-core sends `normal` when a flow sets no
  priority; it now reads as `medium` (test in `test_assistant.py`).
- No contract change: `backend/openapi.json` is unchanged.

## 6. Tests

- Unit: `customer-chat/assistant.test.ts`, `customer-chat/model.test.ts` (assistant side, status lines,
  survey, byline, picker), `conversation/handoff.test.ts`, `conversation/model.test.ts` (variant, arrival,
  supervision line and footer, `toCloseRequest` with `handoffQuality`), `supervision/model.test.ts`,
  `audit/model.test.ts`, `workspace/url.test.ts`.
- Component (mocked API): `SimulatorAssistant.test.tsx` (turns + typing + "Hablar con una persona" + hand-over
  live, confirmation, expired confirmation, step-up attempts and the third code, `assistant_not_active`, the
  assistant's survey, a call answering `assistant_active`), `Handoff.test.tsx` (bubble and banner, arrival,
  the card's facts and "Ver todo", 503 retry, 404 and AI off show nothing, the close question sent and never
  asked when the handoff did not load, the tab's sections and its retry), `routes/analyst/workspace.test.tsx`
  (tabs with AI on, only "Cliente" without a handoff, AI off ignores `?panel=handoff`),
  `routes/supervision/queues.test.tsx` (the row, the card count, "Tomar el caso" and its failure),
  `routes/supervision/case.test.tsx` (turns, lines, "Tomar el caso").
- e2e: `ai.spec.ts` now also checks the right panel: with AI on the ficha is the "Cliente" tab of "Apoyo del
  caso" (no "Traspaso" for a people case), live back to "Ficha del cliente" with AI off, and tabs again when
  on. The page object's `customerPanel()` matches either name. The assistant's own flows need agent-core
  (Playwright runs the backend without it), so they are covered by the component tests above.

**Manual smoke check (read-only)** against the local stack (`../stack`, platform `origin/main` + a real
agent-core): a real packet from `GET /cases/{id}/handoff` has `agent` as `{id, version}`, `reason_code`
`interrupt:fraude`, `priority` `critical`, `target_queue` `fraude`, empty fact lists and a generic summary in
the customer's language ("Foi acionada uma interrupção que exige atendimento humano…"). `readHandoff` reads
it as "Detectó algo que debe atender una persona" (Fraude), Crítica, cola "Fraude", "Nada verificado", and
the empty lines of each section; the test pins that reason code.

## 7. Known gaps

- **No browser e2e of an assistant conversation, of the AI-off release or of "Colas" rows**: they need a
  `with_assistant` case, which only exists with agent-core (the e2e backend has none, and the release
  process is wired only with agent-core). The backend API tests cover the release with the scripted fake.
- **"Asistente virtual hoy"** (IaSuColas: started / resolved / handed over today) is not built: no endpoint
  gives those figures. Only "con el asistente" (live) is shown, from the rows.
- **The case card's bot fact** ("Llegó del asistente virtual", IaWorkspace) is not built: `CaseSummary` does
  not carry the assignment reason.
- **The simulated code** is shown as `000000`: the API says `simulated` but not the code
  (`CC_ASSISTANT_STEP_UP_CODE` default). A deployment that changes it shows the wrong hint.
- **The picker cannot say who will be served by the assistant** before the first message ("Escribe tu
  mensaje y te atiende el asistente virtual"): the demo list does not say which customers are linked.
- **The audit has no "Asistente virtual" family or "Quién" filter** (IaSuAudit): the backend's families and
  actor kinds are unchanged; the assistant's events stay in their families.
- **Fact names** in the handoff are agent-core's keys, humanized, not translated; the summary is in the
  case language (Portuguese for a Brazilian customer), shown as agent-core wrote it.
- Classifying the case type from the handoff is S21.
