# Slice 9 contract · supervision v2 ("Colas", "Equipo", "Escalados")

**Status:** implemented (2026-10-04). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-04.

**Scope.** Supervision reorganized around the canvas boards SuColas, SuTeam, SuEscalados,
SuCaso and SuAudit, and the analyst side of escalations (Workspace views escalar, escalado,
respondido):

1. **Navigation.** Rail items Colas (badge: cases nobody holds), Equipo, Escalados (badge: open
   escalations), Auditoría. `/supervision` lands on `/supervision/queues`. No team tabs anywhere:
   the team is a filter option.
2. **Colas.** The language queues with their figures; the selected one lists **every** open case
   of that language (who holds it, status, how long it has been open, the first response). No
   manual "Asignar": assignment is automatic (rule 3). A row opens the case view.
3. **Equipo.** One table of every analyst; one "Filtros" dropdown (Estado, Idioma, Equipo); the
   analyst sheet; the redesigned reassign dialog.
4. **Escalations** (new), grounded only in the dataset's `was_escalated` (yes/no): a motive and
   what supervision did. No escalation types, amounts, limits, levels or deadlines.
5. **Gender-neutral roles:** "Supervisión" (never "Supervisora"); the admin users list gets a
   search + "Filtros" dropdown, "Nuevo usuario" and language pill toggles. Invitations by email are
   part 4 (not here).

People-only, as every slice: no AI, no automatic escalation, no routing by escalation.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-3-supervision.md` (everything not changed
here still holds), `slice-8-priority.md`, `../DATA_MODEL.md`.

---

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Escalation model | Its **own aggregate** (`Escalation`, table `escalations`, own `version`), not a field of `Case`. The case keeps a pointer, `open_escalation_id`. | A case may be escalated again after one ends, and supervision lists escalations (open first, then the ones attended today), not cases. "One open per case" lives on the case: every command that opens or ends an escalation also saves the case (it appends a staff banner), so the case's compare-and-set serialises them. |
| States | `open`, `answered`, `taken`, `reassigned`, `withdrawn`, `closed` (the case closed while it was open). | `withdrawn` (the analyst) and `closed` (the case ended) leave "Escalados"; the three attended ones stay in "Atendidos hoy". |
| Who escalates | The case's assignee holding Analista, on an `assigned` or `in_progress` case. | Only she knows why; a queued case has nobody to escalate it. |
| Who takes | `TakeEscalatedCase` = a reassignment to the caller, **only** if she also holds Analista, is active and speaks the case language (rule 3); otherwise `422 analyst_not_eligible` / `language_mismatch`, and the UI does not offer it (`EscalationItem.canTake`). A paused supervisor needs no confirmation (she chose herself; `paused_override` is recorded). | The case must stay with someone who can answer the customer. Lucía (Supervisión only) answers or reassigns; Felipe (Analista + Supervisión, Spanish) may take a Spanish case. |
| Reassigning | `PUT /supervision/cases/{id}/assignee` (unchanged) ends an open escalation as `reassigned`, whichever screen calls it. | The analyst who escalated no longer holds the case. |
| Closing | `CloseCase` ends an open escalation as `closed` (no extra banner). | Nothing left to answer. |
| "Entendido" | Stored (`acknowledged_at`, `escalation.acknowledged`), only by who escalated, only once attended, idempotent. | The answered card must not come back after a reload or on another device. |
| Waiting emphasis | Clock; orange flame after 15 min; filled red flame after 30 min (team-generated, `ESCALATION_WAIT_RISK_MS`, `ESCALATION_WAIT_LONG_MS`). Visual only: no SLA, no deadline. | The dataset has no escalation deadline. |
| "Atendidos hoy" | The API returns the attended ones of the last 24 h (`ATTENDED_WINDOW`, team-generated); the screen keeps the ones resolved today in the viewer's zone. | The server does not know the viewer's day. |
| Notices | A new escalation toasts on every supervision screen except "Escalados" itself (the row arrives live there). The queue notice now says "Ver en la cola" (Colas of that language), never "Asignar". | Assignment is automatic; a persistent toast over the panel hid its actions. |

## 2. Domain (`domain/cases/escalation.py`, `domain/cases/case.py`)

```
open ──▶ withdrawn | answered | taken | reassigned | closed
answered | taken | reassigned ──▶ same + acknowledged_at   ("Entendido", once)
```

- `Escalation.open(escalation_id, case_id, motive, actor, at, creation_key)`: the motive is
  required, trimmed, ≤ 500 (`MAX_ESCALATION_TEXT`); records `escalation.opened`.
- `withdraw`, `answer(note)` (required, ≤ 500), `take`, `mark_reassigned(to_staff_id)`,
  `end_with_case`: any of them on an ended escalation → `EscalationNotOpenError` (409
  `escalation_not_open`, `currentState`).
- `acknowledge(actor, at) -> bool`: only `escalated_by_id`, only `answered | taken |
  reassigned` (else `invalid_transition`), a second time → `False`, no event.
- `Case.escalate(escalation_id)`: closed → `case_closed`; not `assigned | in_progress` →
  `invalid_transition`; another open one → `EscalationOpenError` (409 `escalation_open`,
  `escalationId`). `Case.clear_escalation(id)` when it ends. `CaseSummary.escalated` =
  `open_escalation_id is not None`.
- Id prefix `ESC-`.

Events (entity `escalation`, `entity_id` = `ESC-…`, `case_id` set; all in `CASE_EVENTS`):

| Event | Payload | Audit (family `escalation`) | Changes |
|---|---|---|---|
| `escalation.opened` | `motive`, `analyst_id` | "Escaló el caso a supervisión" | yes |
| `escalation.withdrawn` | `analyst_id` | "Retiró el escalamiento" | yes |
| `escalation.answered` | `note`, `analyst_id` | "Respondió el escalamiento" | yes |
| `escalation.taken` | `previous_analyst_id`, `analyst_id` | "Tomó el caso escalado de {P}" | yes |
| `escalation.reassigned` | `previous_analyst_id`, `analyst_id` | "Reasignó el caso escalado de {P} a {A}" | yes |
| `escalation.closed` | `analyst_id` | "El escalamiento terminó porque se cerró el caso" | yes |
| `escalation.acknowledged` | `analyst_id` | "Leyó lo que hizo supervisión con su escalamiento" | no |

The log shows the actor next to the description ("Daniela Ríos · Escaló el caso a supervisión").
**Redaction:** `escalation.opened.motive` → `motive_length`, `escalation.answered.note` →
`note_length` (`redactedFields`), like message text.

Staff-only banners in the transcript (`routing`, audience `staff`): "{Analista} escaló el caso a
supervisión.", "{Analista} retiró el escalamiento.", "{Supervisión} respondió el escalamiento.",
"{Supervisión} tomó el caso de {Analista}." (plus the usual customer notice "Ahora te atiende
{Nombre}, de nuestro equipo." when the case changes hands).

## 3. Use cases (`application/cases/escalations.py`)

Every command runs in `retry_on_conflict` and re-checks its rules on fresh state.

| Command | Rules, in order |
|---|---|
| `EscalateCase(actor, case_id, {motive, idempotency_key})` | motive valid (422) · the caller is the assignee analyst (`load_case_for(write)`: 404 / 403 `case_not_assigned`) · same `Idempotency-Key` → replay (another case or person → 422) · `Case.escalate` (409 `case_closed` / `invalid_transition` / `escalation_open`) |
| `WithdrawEscalation(actor, case_id, escalation_id)` | assignee (403) · the escalation belongs to the case (404) · open (409 `escalation_not_open`) |
| `AcknowledgeEscalation(actor, case_id, escalation_id)` | read access to the case · who escalated (403 `case_not_assigned`) · attended (409 `invalid_transition`) · idempotent |
| `RespondEscalation(actor, escalation_id, note)` | note valid (422) · exists (404) · open (409) |
| `TakeEscalatedCase(actor, escalation_id)` | exists (404) · case open (409) · escalation open (409) · the caller is an active Analista (422 `analyst_not_eligible`) who speaks the language (422 `language_mismatch`) and does not hold it already (422) · `hand_over(take=True)` |
| `GetEscalationOverview(actor)` | open ones (the longest waiting first) + attended in 24 h (the most recent first); `canTake` per item for the caller; `openCount` |
| `GetLanguageOpenCases(language)` | queued, assigned and in-progress cases of the language (index `ix_cases_language_status`); nobody's first (oldest first), then open-inbox order; `assigneeName` |

`manual_assignment.hand_over` is the one place that moves a case by hand (SetCaseAssignee and
TakeEscalatedCase); it ends an open escalation in the same Unit of Work.

**Races** (tests in `tests/unit/application/test_escalations.py`): two escalations of one case →
one wins, the other `escalation_open`; a withdrawal racing an answer → one ends it, the other
`escalation_not_open`; a customer message, a reply or a reassignment in between → the loser
re-runs on fresh state.

## 4. REST API

| Method · path | Roles | Request | Success | Problems |
|---|---|---|---|---|
| `POST /api/v1/cases/{caseId}/escalations` | analyst | `EscalateRequest {motive}` + `Idempotency-Key` | 201 `EscalationResult` (200 + `Idempotent-Replayed` on replay) | 401, 403, 404, 409 `case_closed` · `invalid_transition` · `escalation_open`, 422 |
| `POST /api/v1/cases/{caseId}/escalations/{escalationId}/withdraw` | analyst | — | 200 `EscalationResult` | 401, 403, 404, 409 `escalation_not_open` |
| `POST /api/v1/cases/{caseId}/escalations/{escalationId}/acknowledge` | analyst | — | 200 `EscalationResult` | 401, 403, 404, 409 `invalid_transition` |
| `GET /api/v1/supervision/escalations` | supervisor | — | 200 `EscalationOverview` | 401, 403 |
| `POST /api/v1/supervision/escalations/{escalationId}/response` | supervisor | `RespondEscalationRequest {note}` | 200 `EscalationResult` | 401, 403, 404, 409, 422 |
| `POST /api/v1/supervision/escalations/{escalationId}/take` | supervisor | — | 200 `EscalationResult` | 401, 403, 404, 409, 422 `analyst_not_eligible` · `language_mismatch` |
| `GET /api/v1/supervision/open-cases?language=es\|pt` | supervisor | — | 200 `LanguageOpenCases` | 401, 403, 422 |

```ts
Escalation { id; caseId; customerName; state: EscalationState; motive; escalatedAt;
  escalatedById; escalatedByName | null; resolvedAt | null; resolvedById | null;
  resolvedByName | null; note | null; reassignedToId | null; reassignedToName | null;
  acknowledgedAt | null }
EscalationResult { escalation: Escalation; case: CaseSummary }
EscalationItem { escalation; case: CaseSummary; assigneeName | null; canTake: boolean }
EscalationOverview { items: EscalationItem[]; openCount: int; serverTime }
LanguageOpenCases { language; label; cases: OpenCaseRow[]; serverTime }
OpenCaseRow { case: CaseSummary; assigneeName | null }
```

Added members: `CaseSummary.escalated`, `CaseCapabilities.canEscalate`, `CaseDetail.escalation`
(the latest escalation, any state, or null), `LanguageQueue.openCases` / `openAtRisk`.
New problem codes: `escalation_open` (409, `escalationId`), `escalation_not_open` (409,
`currentState`). Role label in copy and audit descriptions: "Supervisión".

## 5. Realtime

| Event | Envelopes |
|---|---|
| every `escalation.*` | `case.updated` (`CaseSummary.escalated`) → `case:<id>` + `inbox:<assignee>` (+ `inbox.counts`); **`escalation.updated`** (`Escalation`) → `case:<id>`, `inbox:<who escalated>` and **`supervision:escalations`** (one envelope, supervisors only on the new topic) |
| every `escalation.*` but `acknowledged` | `team.updated` `{staffIds: [assignee]}` → `supervision:team` (the "Escalado" marker) |
| a reassignment / take | unchanged slice 3 envelopes (`case.assigned`, `case.unassigned`, `conversation.updated`, the notice) |

Never to the customer. The SPA: `supervision:escalations` feeds the rail badge and "Escalados";
"Colas" refetches on `queue.updated`, `queue.case_queued` and the throttled `team.updated`; the
analyst's conversation patches `detail.escalation` and refetches; her Casos screen toasts "{Nombre}
respondió tu escalamiento" / "{Nombre} tomó tu caso" once per envelope (a reassignment keeps the
existing "Supervisión reasignó un caso").

## 6. Frontend

- **Primitives:** `FilterMenu` + `FilterChips` (+ `filter-selection.ts`: `toggleFilter`,
  `activeFilterChips`, `countSelected`): one "Filtros" button, a panel of checkbox groups with
  counts, "Limpiar filtros" / "Listo", chips "Quitar filtro X"; Escape and a click outside close it.
  `StatusShape` gains `up` (Escalado) and `forward` (Reasignado). Rail indicators accept a `noun`
  ("Colas, 3 sin asignar", "Escalados, 2 abiertos").
- **cases (core):** `ESCALATED_MARKER`, `ESCALATION_STATE`, `escalationWaitFact`,
  `isAttendedEscalation`, `MAX_ESCALATION_TEXT`, `readEscalation`; the Casos card shows
  "Escalado".
- **conversation:** "Escalar a supervisión" (before "Cerrar caso"), `EscalateCaseDialog` (required
  motive, counter, "Lo ve el equipo. El cliente no.", "El caso sigue contigo mientras supervisión
  responde…"), `EscalationCard` (open: motive one line + "Ver más", time since, "Retirar
  escalamiento"; attended: who and what, the note, "Entendido"; supervision mode: the open one
  read-only). Supervision footer/arrival copy without " · " ("Sin asignar: le llega
  automáticamente…").
- **supervision:** `QueuesScreen`, `TeamScreen` (one table, filters, sheet), `ReassignDialog`
  (search, only speakers, 3 suggestions / 6 results, "+N más", "Incluir a quienes están en pausa o
  desconectados", presence dots, "Pasarlo aunque esté en pausa", "El cliente verá"),
  `EscalationsScreen` + `EscalationPanel` (Responder / Tomar el caso / Reasignar), the case view
  without "Asignar" and with the "Escalado" marker, `useSupervisionNotices`. The old queue column,
  the team pills and `AssignCaseDialog` are gone.
- **audit:** "Tipo" gains "Escalamientos" (`?type=escalation`); redaction notes for the motive
  and the answer; role badge "Supervisión".
- **admin:** search + "Filtros" (Rol, Estado, Equipo, Idioma with faceted counts) + chips,
  multi-value URL (`?role=&status=&team=&language=`, comma-separated), "Nuevo usuario" with the
  user-plus icon, language pill toggles.

Routes: `/supervision/queues?language=&status=&priority=&analyst=` (landing),
`/supervision/team?status=&language=&team=&analyst=&reassign=`,
`/supervision/escalations?escalation=&reassign=`, `/supervision/cases/:caseId?previous=&reassign=`, `/supervision/audit`.

## 7. Seed

Neutral invented motives (no amounts in the motive, no types): Daniela's 101 (open, T−6m: "La
clienta pide hablar con supervisión: no reconoce un retiro en cajero y no quiere esperar el proceso
normal."), Julián's 113 (open, T−21m: "Problema con la app al hacer una transferencia…"), Daniela's
107 answered by Lucía (T−35m, not acknowledged: Daniela sees the card), Paula's 114 ("Pregunta por
una comisión que no sé explicar.") ended as `reassigned` when Lucía passed it to Julián.

## 8. Tests

Backend: `tests/unit/domain/test_escalation.py`, `tests/unit/application/test_escalations.py`
(both adapters: who may, one open per case, replay, withdraw, respond, take, reassign and close end
it, acknowledge, overview order and `canTake`, two races), `tests/api/test_escalations_api.py`
(RBAC 401/403 on every route, problems, audit redaction, realtime fan-out validated against the
schemas, `supervision:escalations` refused to analysts, "Colas"), seed and shape updates.
Frontend: `FilterMenu.test.tsx`, cases/supervision/audit/admin/conversation model tests, route
tests for Colas, Equipo, Escalados, the case view and the analyst escalation UI, realtime tests.
E2E: `supervision.spec.ts` (Colas and drain; a reassignment with only speakers in the dialog; an
analyst escalates, supervision answers from Escalados and she sees it live).

## 9. Known gaps

- No migration: delete `backend/cc_platform.db` (new table and column).
- No notification center (the canvas bell): notices are toasts only.
- Escalations do not route or prioritise anything; "Atendidos hoy" depends on the viewer's day
  over a 24 h server window.
- Taking a case is offered only to a supervisor who is also an active Analista and speaks the
  language; others answer or reassign.
- The admin "Equipos" screen keeps its status pills (not part of this slice); invitations by
  email are part 4.
