# Slice 12 contract · simulated channels: phone and email (backend)

**Status:** implemented in the backend (2026-10-04); no frontend yet.
**Date:** 2026-10-04.

**Scope.** Cases are no longer chat only. A customer can **call** the bank or **email** it, and an
analyst can **call a customer back** or **answer by email**. Everything is **simulated**: there is
no telephony, no mail server and no AI. The platform keeps the call's state, its times and a
transcript written by the people on the line, and an email thread per case. People-only, as every
slice.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-2-case-lifecycle.md` (the case life cycle,
still true), `slice-8-priority.md` (first-response SLA), `slice-9-supervision-v2.md` (escalations),
`../DATA_MODEL.md`. The OpenAPI document (`backend/openapi.json`) is the exact contract; this page
explains it.

---

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| Channel values | `CaseChannel` = `chat_app`, `chat_web`, `phone_inbound`, `phone_outbound`, `email` (renamed from `app_chat`/`web_chat`). It records **how the case opened**. | One vocabulary for the five ways a case starts. |
| One open case per customer | Unchanged. A call or an email from a customer with an open case **joins that case**, whatever its channel (the case keeps its channel). Only with no open case does the contact open a new one with its own channel (`phone_inbound`, `email`), linked to the previous closed case. | The one-open-case slot is the core invariant; a customer who writes and then calls is one conversation. |
| `phone_outbound` | The channel of a case an analyst **opened herself to call the customer back** (assignment reason `outbound_call`). Only the seed creates one in this slice (Claudia's follow-up). An outbound call placed **on an open case** (the API) keeps that case's channel. | The request scoped outbound calls to open cases; a "follow up a closed case" endpoint is a documented gap (§9). |
| Calls | Own aggregate `Call` (`CALL-…`, table `calls`), versioned (compare-and-set). States `ringing → in_call ⇄ on_hold → ended`. One active call per case: `cases.active_call_id`. | A case can hold several calls over time; each keeps its times, holds and end. |
| Call transcript | Turns of kind `transcript` in the case (`authorRole` = `customer`, `analyst` or `system`), audience `everyone`. People add lines only while the call is `in_call`; the platform writes a `system` line when the call is held, resumed or ends. The lines of a call are the case's `transcript` turns between its `startedAt` and `endedAt` (one call at a time). | Reuses the case transcript (sequence, realtime, idempotency) instead of a second store. |
| Close with an active call | Refused: **409 `call_in_progress`** (`callId`). Hang up first. | A call never outlives its case; nothing ends a call silently. |
| First response | **Answering a call is a response**: the assignee answering an inbound call, or the customer answering the analyst's outbound call, sets `firstResponseAt` once (`case.first_responded`, actor = the analyst). The first email reply counts like a chat reply. Call lines do not (the answer already did). | Request; the SLA measures when a person first attended the customer. |
| Inbox semantics | Chat messages **and emails** are "messages" for the inbox (last message, unread, Por responder / Esperando). Call lines are not: a finished call does not make a case "Por responder". | Emails are asynchronous like chat; a call is answered live. |
| Mute | A flag on the call (`muted`), changed by the analyst while `in_call` or `on_hold`; it records `call.mute_changed`. | Every state change leaves an event (brief); the five call events of the request plus this one. |
| Email | An email **is a turn** of kind `email` with a `subject` (≤ 200, one line). `in` = from the customer, `out` = from an analyst (derived from the author). The thread is the case's `email` turns in order; its subject is the first email's. | One store, one sequence, one realtime path (`turn.created`); threading is per case. |
| Email reply frame | The platform wraps what the analyst writes: `"Hola, {nombre}:\n\n{texto}\n\nSaludos,\n{Analista}\nLATAM Bank"` (`nombre` = the customer's first name, `Analista` = her full name). Portuguese cases: `"Olá, {nome}:"` / `"Atenciosamente,"`. Subject: `"Re: <thread subject>"` (never `"Re: Re:"`) unless she gives one; required when the case has no email yet (422 `invalid_value`, `field: subject`). The framed text must fit 4000 characters. | Request. |
| Internal notes | Turns of kind `note`, audience `staff`, by the assignee on an open case. Never reach the customer (REST or socket). | Request. |
| Who acts | Staff writes (calls, lines, notes, email replies) are the **case assignee** as Analista (403 `case_not_assigned` otherwise, 403 `forbidden` without the role). Reads (calls list, email thread) follow the case read access (assignee, history access, supervisors). Customers act only on their own calls; anyone else's is 404 like an unknown id. | Same RBAC as the case routes. |
| Idempotency | Starting a call (staff outbound or customer inbound) takes an `Idempotency-Key` (`calls.creation_key`, unique): a retry replays the call (200 + `Idempotent-Replayed: true`). Lines, notes and emails use `clientMessageId` = `Idempotency-Key` like chat turns. | Same conventions as escalations and chat turns. |
| Audit | Call events are in the `conversation` family and change state. The outbound reason and an email's subject are redacted like message text (`reason_length`, `subject_length`). | Privacy policy of slices 3, 7 and 9. |

## 2. Domain

### 2.1 `Call` (`domain/cases/call.py`)

```
Call(id CALL-…, case_id, customer_id, direction inbound|outbound, started_at,
     state ringing|in_call|on_hold|ended, reason (outbound only, ≤ 500),
     analyst_id (outbound: the caller; inbound: who answered), answered_at, ended_at,
     end_reason completed|cancelled|rejected, ended_by_role, muted,
     holds [(started_at, ended_at|null)], creation_key, version)
```

| From | Command | To | Who | Event |
|---|---|---|---|---|
| — | `start_inbound` | `ringing` | the customer | `call.started` (`direction: inbound`) |
| — | `start_outbound` | `ringing` | the assignee (with a reason) | `call.started` (`direction: outbound`, `reason`) |
| `ringing` | `answer` | `in_call` | inbound: the assignee (she becomes `analyst_id`); outbound: the customer | `call.answered` (`answered_by_role`, `analyst_id`, `ring_seconds`) |
| `in_call` | `hold` | `on_hold` | the analyst (opens a hold interval) | `call.held` |
| `on_hold` | `resume` | `in_call` | the analyst (closes it) | `call.resumed` (`hold_seconds`) |
| `in_call`, `on_hold` | `set_muted` | same | the analyst; same value = no-op | `call.mute_changed` (`muted`) |
| `ringing` | `hang_up` / `reject` | `ended` | the customer on an outbound call → `rejected`; who called → `cancelled` | `call.ended` |
| `in_call`, `on_hold` | `hang_up` | `ended` | either side → `completed` (an open hold is closed) | `call.ended` (`end_reason`, `ended_by_role`, `answered`, `duration_seconds`, `hold_seconds`) |

Anything on an ended call: **409 `call_not_active`** (`currentState: ended`). Any other move:
**409 `invalid_transition`** (`currentState`). Lines (`ensure_talking`) only while `in_call`.
`duration_seconds` = `ended_at − answered_at` (holds included), `null` if never answered.

### 2.2 `Case` additions

- `active_call_id`: set by `start_call` (409 `call_in_progress` if one is active, `case_closed` on a
  closed case), cleared by `end_call`. `close` refuses while it is set.
- `respond_by_call(actor, at)`: the first response through a call.
- `append_turn(..., subject=None)`: `email` turns carry the subject.

### 2.3 Turn kinds

`message`, `routing`, `notice` (unchanged) and `transcript`, `note`, `email`. Invariants: a `note`
is an analyst's and `staff`; an `email` has a subject and a person as author, and reaches the
customer; a `transcript` line reaches the customer; only `email` has a subject.

## 3. REST (all under `/api/v1`, camelCase)

### 3.1 Staff (`tags: channels`)

| Method and path | Body | Answer | Notes |
|---|---|---|---|
| `GET /cases/{caseId}/calls` | — | `CallList {items: Call[], serverTime}` | Most recent first. Analista or Supervisión with read access. |
| `POST /cases/{caseId}/calls` | `StartCallRequest {reason}` + `Idempotency-Key` | 201 `CallResponse {call, case}` (200 replay) | Outbound. Open assigned case, no active call (409 `call_in_progress`), else 409 `case_closed` / `invalid_transition`. A `new` case moves to `in_progress`. |
| `POST /cases/{caseId}/calls/{callId}/answer` | — | `CallResponse` | Inbound ringing call. First response. An outbound call: 409 `invalid_transition`. |
| `POST /cases/{caseId}/calls/{callId}/hold` | — | `CallResponse` | `in_call → on_hold`, `system` line "Llamada en espera." |
| `POST /cases/{caseId}/calls/{callId}/resume` | — | `CallResponse` | `on_hold → in_call`, `system` line "La llamada continúa." |
| `POST /cases/{caseId}/calls/{callId}/mute` | `MuteCallRequest {muted}` | `CallResponse` | Same value = nothing happens. |
| `POST /cases/{caseId}/calls/{callId}/hangup` | — | `CallResponse` | Ends it; `system` line "La llamada terminó." (or "…sin respuesta."). |
| `POST /cases/{caseId}/calls/{callId}/transcript` | `CallLineRequest {text, clientMessageId}` + `Idempotency-Key` | 201 `PostTurnResponse {turn, case}` | Only `in_call`. |
| `POST /cases/{caseId}/notes` | `NoteRequest {text, clientMessageId}` + `Idempotency-Key` | 201 `PostTurnResponse` | `note` turn, staff only. Open assigned case. |
| `GET /cases/{caseId}/emails` | — | `EmailThread {caseId, subject, items: EmailMessage[]}` | Oldest first, ≤ 200. |
| `POST /cases/{caseId}/emails` | `EmailReplyRequest {body, subject?, clientMessageId}` + `Idempotency-Key` | 201 `EmailReplyResponse {email, case}` | Framed (§1). First reply = first response. |

Schemas: `Call {id, caseId, version, direction, state, reason, analystId, analystName, startedAt,
answeredAt, endedAt, endReason, endedByRole, muted, holds: HoldInterval[], holdSeconds,
durationSeconds}`; `EmailMessage {id (turn id), caseId, sequence, direction in|out, subject, body,
authorRole, authorId, authorName, createdAt, clientMessageId}`.

Changed schemas: `CaseSummary.activeCallId`; `CaseDetail.activeCall` (`Call | null`);
`CaseCapabilities.canCall` (assignee, open, no active call), `canEmail`, `canAddNote`;
`Turn.subject`; `TurnKind` + `transcript`, `note`, `email`; `AssignmentReason` + `outbound_call`;
`CaseChannel` (§1); `CreateCustomerSessionRequest.channel` is `chat_app | chat_web`.

### 3.2 Customer simulator (`tags: customer`, customer token)

| Method and path | Body | Answer | Notes |
|---|---|---|---|
| `GET /customer/call` | — | `CustomerCallState {call: CustomerCall \| null}` | The active call of the current conversation, else its latest call. |
| `POST /customer/calls` | `Idempotency-Key` | 201 `CustomerCallResponse {call, conversation, caseCreated}` (200 replay) | Joins the open case or opens one (`phone_inbound`), assigned like a chat or queued. 409 `call_in_progress` if the open case has one. |
| `POST /customer/calls/{callId}/answer` | — | `CustomerCallResponse` | Outbound only (an inbound call: 409 `invalid_transition`). |
| `POST /customer/calls/{callId}/reject` | — | `CustomerCallResponse` | Outbound ringing → `rejected`. |
| `POST /customer/calls/{callId}/hangup` | — | `CustomerCallResponse` | Any active call (inbound ringing → `cancelled`). |
| `POST /customer/calls/{callId}/transcript` | `CallLineRequest` + `Idempotency-Key` | 201 `CustomerCallLineResponse {turn, call}` | Only `in_call`. |
| `GET /customer/emails` | — | `CustomerEmailThread {caseId, subject, items: CustomerEmail[]}` | The current conversation's thread. |
| `POST /customer/emails` | `SendEmailRequest {subject, body, clientMessageId}` + `Idempotency-Key` | 201 `SendEmailResponse {email, conversation, caseCreated}` | Joins the open case or opens one (`email`). |

`CustomerCall {id, caseId, direction, state, agentName (first name), startedAt, answeredAt,
endedAt, endReason, onHold, durationSeconds}`: never the reason nor staff ids.
`CustomerTurn.kind` is `message | notice | transcript | email`, with `subject` on emails.

### 3.3 Problem codes

New: **409 `call_in_progress`** (`callId`), **409 `call_not_active`** (`currentState`). Reused:
`case_not_assigned`, `forbidden`, `not_found`, `case_closed`, `invalid_transition`
(`currentState`), `idempotency_conflict`, `invalid_value`, `validation_error`.

## 4. Realtime

| Envelope | Topics | Payload |
|---|---|---|
| `call.updated` | `case:<id>`, `inbox:<assignee>` (and `inbox:<analyst on the line>` if another) | `Call` |
| `call.updated` | `customer:<cus>` | `CustomerCall` (actor id hidden unless the customer acted) |
| `case.updated` (+ `inbox.counts`) | as before, after every `call.*` event | `CaseSummary` (`activeCallId`, status, `firstResponseAt`) |
| `turn.created` | `case:<id>` (every kind), `customer:<cus>` (`everyone` turns only) | `Turn` / `CustomerTurn`: transcript lines and emails reach both; notes only staff |

Envelope `id` = the source event id; clients dedupe on `(type, id)` as before.

## 5. Event log and audit (Spanish, gender-neutral, next to the actor)

| Event | Payload | "Qué hizo" |
|---|---|---|
| `call.started` | `direction`, `customer_id`, `analyst_id`, `reason` (redacted → `reason_length`) | inbound: "Llamó a la línea de atención"; outbound: "Llamó a {cliente}" |
| `call.answered` | `answered_by_role`, `analyst_id`, `ring_seconds` | "Atendió la llamada" / "Contestó la llamada" |
| `call.held` | `analyst_id` | "Puso la llamada en espera" |
| `call.resumed` | `analyst_id`, `hold_seconds` | "Retomó la llamada" |
| `call.mute_changed` | `muted`, `analyst_id` | "Silenció su micrófono" / "Activó su micrófono" |
| `call.ended` | `end_reason`, `ended_by_role`, `analyst_id`, `answered`, `duration_seconds`, `hold_seconds` | "Terminó la llamada · duró N min" / "Rechazó la llamada" / "Colgó antes de que contestaran" |
| `turn.created` | + `subject` on emails (redacted → `subject_length`) | transcript: "Habló en la llamada" / "Anotó un cambio de la llamada en la transcripción"; note: "Dejó una nota interna para el equipo"; email: "Envió un correo" / "Respondió por correo" |
| `case.opened` | `channel` | "Abrió un caso nuevo por llamada entrante / correo"; "Volvió a llamar y abrió…"; `phone_outbound`: "Abrió un caso de seguimiento para llamar al cliente" |
| `case.assigned` | `reason: outbound_call` | "Se asignó el caso para hacer una llamada de seguimiento" |

Family: every `call.*` is `conversation` and changes state.

## 6. Seed ("Datos de ejemplo")

| Case | Customer | Story |
|---|---|---|
| 115 · `phone_inbound` | Natalia Rendón Úsuga (1013, Medellín, es-CO) | Yesterday: she called; Daniela answered after 20 s (first response), both spoke, Daniela held the call (muted while holding), resumed, hung up after ~4 min, wrote an internal note and closed it (`resolved`). |
| 116 · `phone_outbound`, `previousCaseId` = 105 | Claudia Restrepo Varela (1005) | 20 h ago: Daniela opened a follow-up of Claudia's unanswered chat and called her with a reason; Claudia answered and hung up after ~3 min; closed (`resolved`). |
| 117 · `email` | Ignacio Bustos Lagos (1014, Córdoba, es-AR, voseo) | Last night he emailed ("Cobro duplicado en mi tarjeta"); Daniela answered (framed reply, first response met); he wrote back 9 h ago → Daniela's "Por responder". |

Daniela's inbox is now: Todos 6 · Por responder 3 · Nuevos 2 · Esperando al cliente 1 · Cerrados 5.
Seeded ids: `CALL-000…115`, `CALL-000…116`.

## 7. Concurrency

- Starting and ending a call save the case (`active_call_id`) with its compare-and-set, so a call
  racing a close, or two calls at once, serialise: the loser re-runs on fresh state and gets
  `call_in_progress` or `case_closed`. A case is never closed with an active call.
- Hold, resume and the end also save the case (they write a `system` line); mute saves only the
  call (its own `version`).
- A retried start with the same `Idempotency-Key` racing itself inserts once (`creation_key`
  unique): the loser re-runs and replays.

## 8. Persistence

New table `calls`; new columns `cases.active_call_id`, `turns.subject`. No migrations: a database
created before this slice fails at start (`OutdatedSchemaError`) until `backend/cc_platform.db` is
deleted.

## 9. Known gaps

- No API to open a follow-up case to call a customer whose case is closed (only the seed has one);
  outbound calls go on open cases.
- No ringing timeout ("missed" calls): a call rings until someone answers or hangs up.
- Reassigning a case during a call does not move the call: the new assignee controls it (the
  `analystId` on the line stays who answered).
- Email bodies are plain text, at most 4000 characters with the frame; no attachments, CC or
  real addresses.
- The frontend has no call or email UI yet; it must regenerate its API types (`pnpm gen:api`).
