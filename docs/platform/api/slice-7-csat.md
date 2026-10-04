# Slice 7 contract · Calificación del cliente (CSAT)

**Status:** implemented (2026-10-03). Final check in `../ENGINEERING_BRIEF.md` §8.
**Date:** 2026-10-03.

**Scope.** After a case closes, its customer can rate the attention once, from the customer
simulator, on the bank's 1–4 scale (`contracts/platform_history.json`, `case_close.csat`), with
an optional comment. Staff see the rating where they already see the closed case: the
read-only footer, the Cerrados card, the ficha ("Este caso" and "Casos anteriores"). Supervision
sees each analyst's 7-day average in "Equipo y colas". The audit logs it, never the comment.

User decision of 2026-10-03 (design boards `Main.dc.html` "cerrado" / "calificado",
`Workspace.dc.html`, the "Calificación 7 días" column): this slice lifts "CSAT surveys" out of
the brief's out-of-scope list. Still people-only: no AI, no sentiment, no automatic surveys by
email or WhatsApp, no averages for analysts.

Read first: `../ENGINEERING_BRIEF.md` (it wins), `slice-2-case-lifecycle.md`,
`slice-3-supervision.md`, `slice-6-analyst-home.md`, `../DATA_MODEL.md`.

---

## 1. Vocabulary

| Score | es (staff and es customers) | pt-BR (customers) | Face (lucide) | Tone |
|---|---|---|---|---|
| 1 | Mal | Ruim | `Frown` | danger |
| 2 | Regular | Regular | `Meh` | warn |
| 3 | Bien | Bom | `Smile` | success (simulator: `app-rate-good`) |
| 4 | Excelente | Excelente | `Laugh` | success (simulator: `app-rate-great`) |

The words live in the frontend (`RATING_SCALE` in `features/cases/model.ts` for staff,
`ratingOptions(language)` in `features/customer-chat/model.ts` for the customer) and in the
audit catalog (`RATING_LABEL`, the same Spanish words). The API carries only the number.

Team-generated: the 7-day window of "Calificación 7 días" (`RATING_WINDOW`, the same 7 days as
Cerrados), the 500-character comment limit, the 50 skipped conversations the simulator
remembers.

## 2. Domain (`domain/cases/rating.py`, `Case.rate`)

- `CaseRating(score, rated_at, comment, key)`: score 1–4; comment trimmed, blank → `None`, at
  most 500 characters; `key` = the request's `Idempotency-Key`.
- `Case.rate(actor, score, comment, at, key)`:
  - only the case's own customer (`ActorRole.CUSTOMER` with `actor_id == customer_id`);
    anyone else → `NotFoundError` (as if the case did not exist);
  - only a **closed** case → else `CaseNotClosedError` (`case_not_closed`, `currentStatus`);
  - only **once** → else `AlreadyRatedError` (`already_rated`);
  - invalid score or comment → `InvalidValueError` (`field: score | comment`);
  - no status transition: the case stays closed and read-only;
  - records **`case.rated`** `{score, comment, analyst_id}`; `analyst_id` = `closure.closed_by_id`
    (the rating counts for whoever closed it).
- A `Case` with a rating and no closure is invalid (`__post_init__`).

## 3. Use case (`RateConversation`, `application/cases/customer_chat.py`)

One Unit of Work inside `retry_on_conflict`, checks in this order:

1. the case is the customer's (else `not_found`, like `GET /customer/conversations/{id}`);
2. the answer is valid (`invalid_value`, before any read);
3. a rating already there **with the same key**: same answer → replay (`replayed: true`); another
   answer → `idempotency_conflict`;
4. a rating already there with another key (or the seed's, without one) → `already_rated`;
5. `Case.rate` (closed check) → save with the case's version CAS → commit (the event lands in
   `event_log` in the same transaction).

**Concurrency.** Two ratings of the same case race on the case's `version`: one commits, the
other's save raises `ConcurrentUpdateError`, re-runs on fresh state and answers `already_rated`
(or a replay when it was the same request retried). Tests: four different keys at once → one
rating, three `already_rated`; four copies of one request → one created, three replays.

## 4. REST API

### 4.1 Endpoint (router `api/routers/customer.py`, tag `customer`)

| Method · path | Auth | Request | Success | Problems |
|---|---|---|---|---|
| `POST /api/v1/customer/conversations/{caseId}/rating` | customer token | header `Idempotency-Key` (8–64, `[A-Za-z0-9-]`, required) + **`RateConversationRequest`** | 201 **`CustomerConversation`** (with `rating`) · 200 + `Idempotent-Replayed: true` on a replay | 401 `unauthenticated` (no token, or a staff token) · 404 `not_found` (unknown, malformed or someone else's case) · 409 `case_not_closed` (`currentStatus`) · 409 `already_rated` · 409 `idempotency_conflict` · 422 `validation_error` (score outside 1–4, comment > 500, unknown member, missing or short key) |

```ts
RateConversationRequest { score: int /* 1–4 */; comment?: string | null /* trimmed, ≤ 500, blank → null */ }
CaseRating              { score: int; comment: string | null; ratedAt: datetime }
```

### 4.2 New problem codes (`ProblemCode`)

| Code | Status | Default detail |
|---|---|---|
| `case_not_closed` | 409 | Solo se puede calificar una conversación terminada. |
| `already_rated` | 409 | Esta conversación ya tiene una calificación. |

### 4.3 Members added to existing schemas (always present, nullable)

| Schema | Member | Notes |
|---|---|---|
| `CaseSummary` | `rating: CaseRating \| null` | staff: inbox (Cerrados), detail (`CaseDetail.case`), socket `case.updated`; null on open cases |
| `CaseHistoryItem` | `rating: CaseRating \| null` | "Casos anteriores": "Calificó: Excelente" |
| `CustomerConversation` | `rating: CaseRating \| null` | the customer's own rating (the simulator stops asking); also in `conversation.updated` |
| `TeamAnalyst` | `recentRatings: RatingStats` | supervision |
| `RatingStats` (new) | `{ count: int; average: number \| null }` | ratings of the cases she **closed** with `closedAt` in the last 7 days; `average` unrounded, null when `count = 0` |

The comment travels in `CaseSummary` so the read-only footer updates in place from
`case.updated` (no detail refetch).

### 4.4 Read model of "Calificación 7 días"

`CaseRepository.rating_totals_by_closer(closed_since)` → `{closed_by_id: RatingTotals(count,
score_sum)}`: one grouped query (`WHERE closed_by_id IS NOT NULL AND closed_at >= :since AND
rating_score IS NOT NULL GROUP BY closed_by_id`, index `ix_cases_closer_closed`), SQL and memory
adapters, both covered by the same tests. `GetTeamOverview` runs it once per request.

## 5. Persistence

On the case aggregate (flattened, like the closure): `rating_score`, `rating_comment`,
`rated_at`, `rating_key` (see `../DATA_MODEL.md`). No migration: delete
`backend/cc_platform.db` after updating (the app fails fast with `OutdatedSchemaError`).

## 6. Realtime (existing projectors, no new envelope type)

| Event | Envelope · topic |
|---|---|
| `case.rated` | `case.updated` (`CaseSummary` with `rating`) → `case:<id>` and `inbox:<assignee>` (+ `inbox.counts`) |
| `case.rated` | `conversation.updated` (`CustomerConversation` with `rating`) → `customer:<customerId>` (actor = that customer) |
| `case.rated` | `team.updated` `{staffIds: [analyst who closed it]}` → `supervision:team` |

## 7. Audit

- Catalog: `case.rated` → family **lifecycle** ("Ciclo del caso", the Casos family), changes
  state, description **"El cliente calificó el caso: Bien"** (the word of the score).
- Privacy: `REDACTED_TEXT["case.rated"] = "comment"`: the audit API never returns the comment;
  the payload keeps `comment_length` and `redactedFields: ["comment"]`; the detail aside says
  "El comentario del cliente no se muestra aquí: está en el caso cerrado."

## 8. Seed (invented)

| Case | Customer | Closed by | Rating |
|---|---|---|---|
| 104 | Patricia | Daniela (T−2d) | 4 · "Muy clara la explicación del plazo, gracias." |
| 106 | Héctor | Daniela (T−3h) | 3 |
| 110 | Patricia | Julián (T−20d, outside the window) | 3 |
| 105 | Claudia | Daniela | none (the simulator asks her) |

So Daniela's "Calificación 7 días" starts at 3,5 (2) and Julián's at "—".

## 9. Frontend

### 9.1 Customer simulator (`features/customer-chat`)

- `surveyState(conversation, skipped)`: `ask` while the **current** conversation is closed,
  unrated and not skipped; `rated` once rated; else `none`. A new conversation (written after
  the close) never asks for the old one.
- `RatingSurvey` replaces the composer (and the "Esta conversación terminó…" note and the
  chips): title "¿Cómo te atendió {agentName}?" / "Como foi o atendimento de {agentName}?"
  (`nuestro equipo` / `nossa equipe` without a name, also the form's accessible name), four face
  cards (native radios in a fieldset "Califica la atención", one Tab stop, arrows pick, focus ring
  on the card), the optional comment once a face is picked (≤ 500), "Ahora no" and "Enviar"
  (`aria-disabled` until a face; pressing it then says "Elige una opción para enviar." and
  focuses the first face). One `Idempotency-Key` per survey, reused on retries.
- After sending: the thanks pill "¡Gracias! Calificaste: Excelente" / "Obrigado! Você avaliou:
  Excelente" with the face, inside an always-mounted `<output>` (announced), and the composer
  returns with the focus in it. "Ahora no" stores the case id in sessionStorage
  (`cc.customer.rating-skipped`) and also returns the composer.
- Failures: network / other → an inline alert in the customer's language; `already_rated`,
  `case_not_closed`, `not_found` → refetch the conversation (the survey follows the server).
- `api.rateConversation(caseId, body, idempotencyKey)`, `useRateConversation`,
  `useSkippedRatings`.

### 9.2 Analyst (`features/cases`, `features/conversation`)

- `RATING_SCALE`, `ratingOption`, `ratingFact`, `ratedByCustomerLabel`, `ratedShortLabel`
  (cases model, public in `core.ts`) and `RatingBadge` (pill with the face).
- Cerrados card: the face alone, icon-only fact with tooltip "Bien" and accessible text
  "Calificación: Bien" (a secondary fact); nothing when unrated.
- Closed footer (Workspace): after the reason, time and note, the pill **"El cliente calificó:
  Bien"** with the face and the comment in quotes (“…”). Live from `case.updated`.
- Ficha › "Este caso": row **"Calificación"** (face icon) on closed cases only: the face pill, or
  "Sin calificar" (closed tone).
- Ficha › "Casos anteriores": a fact "[face] Calificó: Excelente" on rated rows.
- No averages anywhere for analysts.

### 9.3 Supervision (`features/supervision`, minimal by decision: the screens are redesigned next)

- "Analistas" table: column **"Calificación 7 días"** (header tooltip "Promedio de
  calificaciones de clientes, escala 1 a 4, últimos 7 días"): face of the rounded average,
  average with one decimal and a comma ("3,6"), count muted "(9)", tooltip and accessible text
  "Promedio 3,6 de 4 en 9 casos calificados"; tone < 2,5 danger, < 3 warn, else success; "—"
  (accessible "Sin calificaciones en los últimos 7 días") when none.
- The analyst sheet adds the same figure as a fifth stat.

### 9.4 Audit

`redactionNote(event)` adds the comment note (§7).

## 10. Tests

- Backend: `tests/unit/domain/test_case_rating.py` (rules, comment, invariants),
  `tests/unit/application/test_rate_conversation.py` (rules, replay, idempotency conflict,
  already rated, not found, both adapters; the 7-day figures and their window; races with a
  yielding Unit of Work), `tests/api/test_rating_api.py` (201/200 replay, 409s, 404, 401 for
  staff tokens, 422s, staff read sides, supervision figures, audit text and redaction, the three
  socket fan-outs validated against the REST schemas); shape tests updated
  (`test_cases_api.py`, `test_openapi.py`).
- Frontend: model tests (customer-chat survey, cases rating vocabulary, conversation rows and
  footer, supervision cell, audit note), `RatingSurvey.test.tsx` (every state: survey, picked
  with comment, sent, skipped and remembered, rated, open, pt-BR, live update, retry with the
  same key, `already_rated`), CaseListPanel / ConversationPane / CustomerFile /
  CaseHistorySheet / team route render tests.
- e2e: `chat.spec.ts` › "the customer rates the closed conversation and the analyst sees it
  (slice 7)": close → the survey in the simulator → "Excelente" + comment → the thanks → live
  footer pill, card face and ficha row in the Workspace → a reload never asks again. The
  simulator page object answers "Ahora no" before writing to a closed, unrated conversation.

## 11. Known gaps

- The simulator only offers the survey for the **current** conversation; past conversations can
  be rated through the API but not from the simulator.
- No rating reminder, expiry or edit: once rated it is final; skipped is per browser tab
  (sessionStorage), not on the server.
- "Calificación 7 días" counts by `closed_at` (when the case closed), not by when it was rated.
- Supervision shows only the per-analyst figure (no team average, no trend): the screens are
  being redesigned next.
- Schema change without migrations: delete `backend/cc_platform.db`.
