# Event catalog and signals for the improvement engine (ADR 0007, additive)

**Catalog version: 1.3.0** (`EVENT_CATALOG_VERSION` in `backend/src/cc_platform/domain/shared/events.py`).

What the platform emits, so the improvement engine can learn from real interactions: every event type with its payload, the signals the engine reads, and the route that names real cases in an aggregate cell. This is the **emitting side** only: admitting types in the engine's exporter and re-pinning its digests is the engine team's.

Rules every change keeps:

- **Additive.** No event type, key or route changes meaning. A new key is nullable and defaults to `null`, so a reader written for an older version keeps working. Removing or renaming a key, or changing what a value means, is a new `schema_version` of that type.
- **Aggregate-friendly.** Ids, enum values, codes, counters, flags and times. The keys that carry someone's words or a person's name are marked **free text** in the catalog below (the full list is in §3); none of the engine signals of §2 has one.
- **No PII in the signals.** No names, no contact data, no message text, no amounts. Customer and staff appear as ids only.

## 1. The row and the versions

Each event is one row of the append-only `event_log` (never updated or deleted):

| Column | Type | What |
|---|---|---|
| `sequence` | integer | total arrival order (the export cursor) |
| `event_id` | string | `EVT-…`, unique |
| `event_type` | string | the type (the tables below) |
| `entity`, `entity_id` | string | what it happened to (`case`/`CASE-…`, `copilot`/`CPS-…`, `case_type`/`undue_charge`, …) |
| `case_id` | string or null | the related case |
| `actor_role`, `actor_id` | string | `customer`, `analyst`, `supervisor`, `admin`, `assistant` or `system`, and its id (for `assistant` the id is the agent that acted, `id@alias`, so the assistant's own events are attributable to it) |
| `event_time`, `ingested_at` | date-time | when it happened and when it was stored (UTC) |
| `payload` | object | the keys in the catalog, plus `schema_version` |

- **`schema_version`** (integer) is in every payload written since 1.3.0: the version of that type's payload (the `v` column of §3). Every type starts at `1` in 1.3.0; it goes up when that type's payload changes. A row written before 1.3.0 has no `schema_version`: read it as the pre-1.3.0 shape (the same keys minus those the changelog says were added).
- **The catalog version** (`1.3.0`) is the version of this document as a whole: it goes up when a type, a key or a `schema_version` changes. Minor for additions, major for a removal or a change of meaning.

## 2. The engine signals

The types the engine reads to measure the AI (all ids, closed values and counters). The actor is in the row's envelope.

### Copilot suggestions (ADR 0005; `entity` `copilot`, `entity_id` the suggestion `CPS-…`, `case_id` set)

The funnel of one suggestion: `requested` → `ready` or `none` (or `failed`) → `shown` → per subject `decided` → or, when nothing of it was used, `ignored`.

| Event | When | Payload (besides `schema_version`) |
|---|---|---|
| `copilot.suggestion_ready` | agent-core proposed something. | `analyst_id`, `agent` (`id@alias`), `kinds` (subset of `reply`, `tool`, `action`, `escalate`), `count` (kept, at most 3), `truncated` (more was proposed than kept), `run_id`, `trace_id`, `release` (the agent release that answered; null if unknown). |
| `copilot.suggestion_none` | agent-core answered that there was nothing to propose (a normal answer). | `analyst_id`, `agent`, `run_id`, `trace_id`, `release`. |
| `copilot.suggestion_shown` | **new in 1.3.0.** The analyst's screen showed a `ready` suggestion (the draft above the composer, the recommendation to escalate or "Herramientas"). Once per suggestion. | `analyst_id`, `agent`, `kinds` (what was still on it then), `count`, `stale` (the customer had written after the turns it read), `release`. |
| `copilot.suggestion_decided` | The analyst decided about one subject of it. | `subject`: `reply` or `escalation`. `decision`: for `reply` `used` (sent as is), `edited` (sent changed), `discarded` ("Descartar"), `ignored` (nobody decided: a newer suggestion replaced it, the case closed or it expired; actor `system`); for `escalation` `accepted` (she escalated with it) or `dismissed` ("Ahora no"; **new in 1.3.0**). `edit_distance_permille` (0-1000, `edited` only), `turn_id` (the `TRN-…` she sent, `used`/`edited` only), `agent`, `release`, `reason_code` (**new in 1.3.0**: for `escalation`, agent-core's code for why it recommended escalating, such as `policy:fraude`; a value that does not look like a code is recorded as `unrecognized`; null for `reply`). |
| `copilot.suggestion_ignored` | **new in 1.3.0.** A `ready` suggestion left her screen and nothing of it was used: no draft used, edited or discarded, no recommendation accepted or dismissed, no tool used. Once per suggestion. Actor `system`. | `analyst_id`, `agent`, `cause` (`replaced`: a newer suggestion; `case_closed`; `expired`: 24 hours passed), `kinds` (what it proposed), `shown` (whether `copilot.suggestion_shown` was recorded for it), `release`. |
| `copilot.tool_used` | The analyst used a `tool` it proposed ("Usar" in Herramientas). | `tool` (agent-core's tool id, `leer_movimientos@1`). |
| `copilot.item_decided` | Per-item feedback: she dismissed a `tool`, or used or dismissed an `action` or the `escalate` recommendation, from the suggestion's `…/items` route (slice 24). Using a `tool` is `copilot.tool_used`, not this. | `item` (`tool`, `action`, `escalate`), `ref` (the tool or action id; empty for `escalate`), `decision` (`used`, `dismissed`). |

`copilot.suggestion_requested` (`analyst_id`, `trigger`: `customer_message`, `manual`, `handover`; `based_on_sequence`) and `copilot.suggestion_failed` (`analyst_id`, `failure_code`) complete the funnel.

### Copilot Q&A and the assistant

| Event | Payload keys the engine reads |
|---|---|
| `copilot.answered` (`entity_id` the thread) | `question_id`, `agent`, `run_id`, `trace_id`, `status`, `messages`, `release` (**new in 1.3.0**: the agent release of the run that answered; null if unknown). |
| `assistant.turn_answered` (`entity_id` the session `AST-…`) | `agent`, `run_id`, `awaiting`, `status`, `outcome`, `trace_id`, `messages`, `release`. |
| `assistant.ended` | `result` (`resolved`, `escalated`, `ended`, `failed`, `released`), `handoff_ref` (set for `escalated`), `code` (why it ended or failed), `release` (**new in 1.3.0**: the release the session's run started on; null if unknown). |

### Handoff quality (**new in 1.3.0**)

| Event | When | Payload |
|---|---|---|
| `case.handoff_rated` (`entity` `case`, `entity_id` the case, actor the analyst) | She closed a case the assistant handed to her and answered "¿Te sirvió el traspaso del asistente?". Once per case; only when the case has an assistant handoff. Recorded with the close itself (it does not depend on agent-core). | `handoff_ref` (agent-core's handoff id), `quality` (`useful`, `incomplete`, `unnecessary`), `reasked` (only with `incomplete`, possibly empty: what she had to ask the customer again, a subset of `identity`, `amount`, `merchant`, `date`, `product`, `reason`, `other`, in that order), `release` (the assistant's release; null if unknown). |

The `reasked` list follows what the assistant's handoff packet collects for a dispute: who the customer is, the transaction's amount, merchant and date, the product, and why they claim. The same quality is still sent to agent-core (`POST …/handoffs/{ref}/resolution`, unchanged); `reasked` is not.

### Case types and the AI (ADR 0006)

| Event | Payload |
|---|---|
| `case.type_changed` (`entity` `case`) | `from`, `to`: `none`, `unrecognized_charge`, `undue_charge`, `app_issue`, `branch_service`, `service_quality`, `virtual_card`. |
| `ai.stage_advanced` (`entity` `case_type`, `entity_id` the type, no `case_id`; actor `system`) | `case_type`, `from_stage`, `to_stage` (0-3). |
| `ai.stage_moved_back` (actor Supervisión) | `case_type`, `from_stage`, `to_stage`, `agent_cleared`. |
| `ai.agent_ready` | `case_type`. |
| `ai.agent_activated` | `case_type`, `agent_id` (agent-core's agent id, null if unknown). |
| `ai.agent_renamed` | `case_type`, `agent_id`. The new name is free text and is not in the payload (ADR 0009). |
| `ai.agent_paused`, `ai.agent_resumed` | `case_type`, `agent_id`: Supervisión paused or resumed the agent of a type; while paused the cases of that type are not routed to it (ADR 0009). |
| `platform.ai_toggled` (`entity` `platform`) | `enabled`. |

## 3. The full catalog

Generated from the event classes (`uv run python -m cc_platform.scripts.event_catalog` rewrites it; `--check` and a test fail when it is stale or an emitted type is missing).

<!-- event-catalog:begin (generated by cc_platform.scripts.event_catalog) -->

Catalog version **1.3.0**: 98 event types. Every payload also carries `schema_version` (integer, the version in the `v` column). Types: `string` (an id, an enum value or a code unless marked **free text**), `integer`, `boolean`, `date-time` (ISO-8601 UTC, `Z`), `string[]`, `object`. **free text** marks a key that carries someone's words or a person's name: a consumer that must not read text drops it.

#### `ai.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `ai.agent_activated` | `case_type` | 1 | `case_type`: string<br>`agent_id`: string or null |
| `ai.agent_avatar_chosen` | `agent` | 1 | `agent_id`: string<br>`avatar`: string |
| `ai.agent_avatar_set` | `case_type` | 1 | `case_type`: string<br>`agent_id`: string<br>`avatar`: string |
| `ai.agent_paused` | `case_type` | 1 | `case_type`: string<br>`agent_id`: string |
| `ai.agent_ready` | `case_type` | 1 | `case_type`: string |
| `ai.agent_renamed` | `case_type` | 1 | `case_type`: string<br>`agent_id`: string |
| `ai.agent_resumed` | `case_type` | 1 | `case_type`: string<br>`agent_id`: string |
| `ai.stage_advanced` | `case_type` | 1 | `case_type`: string<br>`from_stage`: integer<br>`to_stage`: integer |
| `ai.stage_moved_back` | `case_type` | 1 | `case_type`: string<br>`from_stage`: integer<br>`to_stage`: integer<br>`agent_cleared`: boolean |

#### `assistant.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `assistant.ended` | `assistant` | 1 | `result`: string<br>`handoff_ref`: string or null<br>`code`: string or null<br>`release`: string or null |
| `assistant.input_queued` | `assistant` | 1 | `kind`: string<br>`answer`: string or null **free text** |
| `assistant.session_started` | `assistant` | 1 | `customer_id`: string<br>`agent`: string |
| `assistant.step_up_rejected` | `assistant` | 1 | `attempts`: integer |
| `assistant.step_up_verified` | `assistant` | 1 | `simulated`: boolean |
| `assistant.turn_answered` | `assistant` | 1 | `agent`: string or null<br>`run_id`: string or null<br>`awaiting`: string<br>`status`: string<br>`outcome`: string or null<br>`trace_id`: string<br>`messages`: integer<br>`release`: string or null |

#### `auth.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `auth.account_locked` | `staff` | 1 | `locked_until`: date-time<br>`failed_attempts`: integer |
| `auth.login_failed` | `staff` | 1 | `factor`: string<br>`failed_attempts`: integer<br>`remaining_attempts`: integer |
| `auth.mfa_challenge_issued` | `mfa_challenge` | 1 | `staff_id`: string<br>`expires_at`: date-time |
| `auth.mfa_failed` | `mfa_challenge` | 1 | `staff_id`: string<br>`attempts`: integer<br>`remaining_attempts`: integer |
| `auth.password_accepted` | `staff` | 1 | (no keys) |
| `auth.session_ended` | `staff_session` | 1 | `staff_id`: string<br>`reason`: string |
| `auth.session_started` | `staff_session` | 1 | `staff_id`: string<br>`mfa_method`: string<br>`expires_at`: date-time |

#### `builder.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `builder.alias_promoted` | `builder` | 1 | `alias`: string<br>`release_id`: string<br>`before`: string or null<br>`reason_length`: integer<br>`step_up`: boolean |
| `builder.answered` | `builder` | 1 | `question_id`: string<br>`agent`: string<br>`run_id`: string or null<br>`trace_id`: string<br>`status`: string<br>`messages`: integer |
| `builder.draft_saved` | `builder` | 1 | `agent_id`: string<br>`rev`: integer<br>`changes`: integer<br>`kinds`: string[] |
| `builder.proposal_approved` | `builder` | 1 | `agent_id`: string<br>`candidate_hash`: string<br>`yardstick_loosened`: integer<br>`step_up`: boolean |
| `builder.proposal_created` | `builder` | 1 | `agent_id`: string<br>`origin`: string<br>`base_release_id`: string or null |
| `builder.proposal_evaluated` | `builder` | 1 | `agent_id`: string<br>`suite_id`: string<br>`verdict`: string<br>`items`: integer<br>`items_failed`: integer |
| `builder.proposal_frozen` | `builder` | 1 | `agent_id`: string<br>`candidate_hash`: string<br>`new_versions`: integer |
| `builder.proposal_published` | `builder` | 1 | `agent_id`: string<br>`release_id`: string<br>`step_up`: boolean |
| `builder.proposal_rejected` | `builder` | 1 | `agent_id`: string<br>`reason_length`: integer<br>`step_up`: boolean<br>`reason_code`: string or null |
| `builder.proposal_reopened` | `builder` | 1 | `agent_id`: string<br>`rev`: integer |
| `builder.proposal_tracked` | `builder` | 1 | `agent_id`: string<br>`source`: string |
| `builder.proposal_validated` | `builder` | 1 | `agent_id`: string<br>`violations`: integer<br>`candidate_hash`: string or null |
| `builder.question_asked` | `builder` | 1 | `question_id`: string<br>`question_length`: integer |
| `builder.release_revoked` | `builder` | 1 | `agent_id`: string<br>`reason_length`: integer<br>`step_up`: boolean |

#### `call.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `call.answered` | `call` | 1 | `answered_by_role`: string<br>`analyst_id`: string<br>`ring_seconds`: integer |
| `call.ended` | `call` | 1 | `end_reason`: string<br>`ended_by_role`: string<br>`analyst_id`: string or null<br>`answered`: boolean<br>`duration_seconds`: integer or null<br>`hold_seconds`: integer |
| `call.held` | `call` | 1 | `analyst_id`: string |
| `call.mute_changed` | `call` | 1 | `muted`: boolean<br>`analyst_id`: string |
| `call.resumed` | `call` | 1 | `analyst_id`: string<br>`hold_seconds`: integer |
| `call.started` | `call` | 1 | `direction`: string<br>`customer_id`: string<br>`analyst_id`: string or null<br>`reason`: string or null **free text** |

#### `case.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `case.assigned` | `case` | 1 | `assignment_id`: string<br>`assigned_analyst_id`: string<br>`previous_analyst_id`: string or null<br>`reason`: string<br>`policy_rule_id`: string or null<br>`open_cases_at_assignment`: integer<br>`strategy`: string<br>`waited_seconds`: integer or null<br>`paused_override`: boolean |
| `case.assistant_released` | `case` | 1 | `reason`: string<br>`handoff_ref`: string or null<br>`sla_due_at`: date-time |
| `case.assistant_started` | `case` | 1 | `assistant_session_id`: string<br>`agent`: string |
| `case.closed` | `case` | 1 | `closed_at`: date-time<br>`closed_by_role`: string<br>`closed_by_id`: string<br>`reason`: string<br>`note`: string or null **free text** |
| `case.first_responded` | `case` | 1 | `first_response_at`: date-time<br>`response_seconds`: integer<br>`sla_due_at`: date-time<br>`sla_met`: boolean |
| `case.handoff_rated` | `case` | 1 | `handoff_ref`: string<br>`quality`: string<br>`reasked`: string[]<br>`release`: string or null |
| `case.opened` | `case` | 1 | `customer_id`: string<br>`channel`: string<br>`language`: string<br>`priority`: string<br>`sla_due_at`: date-time<br>`previous_case_id`: string or null |
| `case.priority_changed` | `case` | 1 | `from`: string<br>`to`: string |
| `case.queued` | `case` | 1 | `queue_label`: string<br>`reason_code`: string<br>`language`: string<br>`policy_rule_id`: string or null |
| `case.rated` | `case` | 1 | `score`: integer<br>`comment`: string or null **free text**<br>`analyst_id`: string |
| `case.read` | `case` | 1 | `staff_id`: string<br>`read_sequence`: integer |
| `case.status_changed` | `case` | 1 | `from_status`: string<br>`to_status`: string<br>`reason`: string |
| `case.type_changed` | `case` | 1 | `from`: string<br>`to`: string |
| `case.viewed` | `case` | 1 | `viewer_id`: string<br>`access`: string<br>`case_status`: string<br>`assigned_analyst_id`: string or null |

#### `copilot.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `copilot.answered` | `copilot` | 1 | `question_id`: string<br>`agent`: string<br>`run_id`: string or null<br>`trace_id`: string<br>`status`: string<br>`messages`: integer<br>`release`: string or null |
| `copilot.item_decided` | `copilot` | 1 | `item`: string<br>`ref`: string<br>`decision`: string |
| `copilot.query_asked` | `copilot` | 1 | `question_id`: string<br>`question_length`: integer |
| `copilot.suggestion_decided` | `copilot` | 1 | `subject`: string<br>`decision`: string<br>`edit_distance_permille`: integer or null<br>`turn_id`: string or null<br>`agent`: string or null<br>`release`: string or null<br>`reason_code`: string or null |
| `copilot.suggestion_failed` | `copilot` | 1 | `analyst_id`: string<br>`failure_code`: string |
| `copilot.suggestion_ignored` | `copilot` | 1 | `analyst_id`: string<br>`agent`: string<br>`cause`: string<br>`kinds`: string[]<br>`shown`: boolean<br>`release`: string or null |
| `copilot.suggestion_none` | `copilot` | 1 | `analyst_id`: string<br>`agent`: string<br>`run_id`: string or null<br>`trace_id`: string<br>`release`: string or null |
| `copilot.suggestion_ready` | `copilot` | 1 | `analyst_id`: string<br>`agent`: string<br>`kinds`: string[]<br>`count`: integer<br>`truncated`: boolean<br>`run_id`: string or null<br>`trace_id`: string<br>`release`: string or null |
| `copilot.suggestion_requested` | `copilot` | 1 | `analyst_id`: string<br>`trigger`: string<br>`based_on_sequence`: integer |
| `copilot.suggestion_shown` | `copilot` | 1 | `analyst_id`: string<br>`agent`: string<br>`kinds`: string[]<br>`count`: integer<br>`stale`: boolean<br>`release`: string or null |
| `copilot.tool_used` | `copilot` | 1 | `tool`: string |

#### `customer.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `customer.session_started` | `customer` | 1 | `session_id`: string<br>`channel`: string |

#### `escalation.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `escalation.acknowledged` | `escalation` | 1 | `analyst_id`: string |
| `escalation.answered` | `escalation` | 1 | `note`: string **free text**<br>`analyst_id`: string |
| `escalation.closed` | `escalation` | 1 | `analyst_id`: string |
| `escalation.opened` | `escalation` | 1 | `motive`: string **free text**<br>`analyst_id`: string |
| `escalation.reassigned` | `escalation` | 1 | `previous_analyst_id`: string<br>`analyst_id`: string |
| `escalation.taken` | `escalation` | 1 | `previous_analyst_id`: string<br>`analyst_id`: string |
| `escalation.withdrawn` | `escalation` | 1 | `analyst_id`: string |

#### `platform.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `platform.ai_toggled` | `platform` | 1 | `enabled`: boolean |

#### `staff.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `staff.account_unlocked` | `staff` | 1 | `was_locked`: boolean<br>`failed_attempts`: integer |
| `staff.availability_changed` | `staff` | 1 | `from_status`: string<br>`to_status`: string<br>`reason`: string (omitted when null) |
| `staff.created` | `staff` | 1 | `name`: string **free text**<br>`roles`: string[]<br>`languages`: string[]<br>`team_id`: string<br>`team_name`: string **free text** |
| `staff.deactivated` | `staff` | 1 | `revoked_sessions`: integer |
| `staff.invitation_accepted` | `staff` | 1 | `invitation_id`: string |
| `staff.invitation_cancelled` | `staff` | 1 | `invitation_id`: string |
| `staff.invitation_resent` | `staff` | 1 | `invitation_id`: string<br>`expires_at`: date-time<br>`resend_count`: integer |
| `staff.invitation_sent` | `staff` | 1 | `invitation_id`: string<br>`expires_at`: date-time |
| `staff.languages_changed` | `staff` | 1 | `from_languages`: string[]<br>`to_languages`: string[]<br>`added`: string[]<br>`removed`: string[] |
| `staff.mfa_enrolled` | `staff` | 1 | `method`: string |
| `staff.password_reset` | `staff` | 1 | `cleared_lock`: boolean |
| `staff.password_reset_link_sent` | `staff` | 1 | `reset_id`: string<br>`expires_at`: date-time<br>`revoked_sessions`: integer<br>`cleared_lock`: boolean |
| `staff.profile_updated` | `staff` | 1 | `changed_fields`: string[]<br>`from_name`: string **free text**<br>`to_name`: string **free text** |
| `staff.reactivated` | `staff` | 1 | (no keys) |
| `staff.roles_changed` | `staff` | 1 | `from_roles`: string[]<br>`to_roles`: string[]<br>`added`: string[]<br>`removed`: string[] |
| `staff.team_changed` | `staff` | 1 | `from_team_id`: string<br>`from_team_name`: string **free text**<br>`to_team_id`: string<br>`to_team_name`: string **free text** |
| `staff.ui_language_changed` | `staff` | 1 | `from_language`: string<br>`to_language`: string |

#### `team.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `team.created` | `team` | 1 | `name`: string **free text** |
| `team.deactivated` | `team` | 1 | `name`: string **free text** |
| `team.reactivated` | `team` | 1 | `name`: string **free text** |
| `team.renamed` | `team` | 1 | `from_name`: string **free text**<br>`to_name`: string **free text** |

#### `turn.*`

| Event | Entity | v | Payload |
|---|---|---|---|
| `turn.created` | `turn` | 1 | `sequence`: integer<br>`kind`: string<br>`audience`: string<br>`author_role`: string<br>`author_id`: string or null<br>`text`: string **free text**<br>`language`: string<br>`client_message_id`: string or null<br>`subject`: string (omitted when null) **free text**<br>`staff_line`: object (omitted when null) **free text** |

<!-- event-catalog:end -->

## 4. Route: which real cases sit in a cell

`GET /api/v1/internal/evidence/cases` · `Authorization: Bearer <CC_INTERNAL_SERVICE_TOKEN>` (same secret and 404-when-unset as the announce) · not in `openapi.json`. Unchanged in 1.3.0.

Query (all optional, combined with AND): `caseType`, `channel`, `language`, `priority`, `closeReason` (the cases' own enum values), `openedFrom` (inclusive), `openedBefore` (exclusive), `limit` (1-8, default 8).

Response `200` (nothing else leaves):

```json
{ "suppressed": false, "matched": 37, "caseIds": ["CASE-…", "…"] }
```

- k-anonymity: a cell with fewer than `CC_EVIDENCE_MIN_CELL` (default 10, minimum 2) cases answers `{"suppressed": true, "matched": null, "caseIds": []}`: no count, no ids.
- The sample is the newest `limit` cases by `opened_at` (ties by id): deterministic and bounded by the announce's 8 evidence links. Case ids are real ones, so the supervisor can open `/supervision/cases/{id}` (the supervisor view is read-only and audited).
- `401` wrong or missing token; `404` token not configured; `422` an unknown enum value or a `limit` outside 1-8.
- Read-only: it reads `cases` ids and dimensions, never turns, customers or free text.

How the engine uses it: for each finding's cell, map its dimensions to these parameters, call the route and send the returned ids as `evidenceLinks` of the announce. A suppressed answer means "no links" (aggregate only).

## 5. Changelog

### 1.3.0 (2026-10-05)

- `schema_version` (integer, `1` for every type) in every payload; this document versioned as a whole.
- New types: `copilot.suggestion_shown`, `copilot.suggestion_ignored`, `case.handoff_rated`.
- New keys (nullable): `release` on `copilot.answered` and `assistant.ended`; `reason_code` on `copilot.suggestion_decided` (escalation).
- New value: `copilot.suggestion_decided` `decision: dismissed` for `subject: escalation` ("Ahora no").
- Documented free-text keys (§3). New since the exporter's 1.2.0 list: `turn.created.staff_line` (a staff-only line's facts: it can carry an analyst's or the customer's first name), and the staff and team names of `staff.created`, `staff.profile_updated`, `staff.team_changed` and `team.*`.
- No migration: every new value is in `event_log.payload` (JSON).

### Before 1.3.0 (unversioned; PR 27, 2026-10-04)

- `release` on `assistant.turn_answered`, `copilot.suggestion_ready`, `copilot.suggestion_none`.
- `turn_id`, `agent`, `release` on `copilot.suggestion_decided`.
- The evidence route (§4).
