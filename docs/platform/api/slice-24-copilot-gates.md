# Slice 24 · Server-side copilot stage gates, per-item feedback and the assistant as actor

**Status:** implemented (2026-10-05) on `feat/assistant-actor-and-mode-gate`. Closes three gaps the
support-platform team listed for the AI side (slice 21 §10 and the demo notes).

## 1. The server enforces the stage

Until now the SPA hid what a case type's stage did not offer; the API answered anyway. With
`CC_STAGE_GATES_SUGGESTIONS=true` (default) the server now refuses it too:

| Route | Needs | Below it |
|---|---|---|
| `GET /cases/{id}/copilot` (thread) | stage 1+ (`answer`) | 200 `available: false` |
| `POST /cases/{id}/copilot/messages` (Q&A) | stage 1+ | 409 `copilot_unavailable` |
| `POST /cases/{id}/copilot/suggestions` ("Sugerir") | stage 2+ (`tools`) | 409 `copilot_unavailable` |
| `GET /cases/{id}/copilot/suggestions/latest` | stage 2+ | 200 `available: false` |

A case with no type is stage 0, so none of them. `CC_STAGE_GATES_SUGGESTIONS=false` turns every gate
off (development aid for the suggestions agent). No frontend change: the SPA already hides these.

## 2. Feedback per item

`POST /api/v1/cases/{caseId}/copilot/suggestions/{suggestionId}/items` (analyst, assignee) → 204.

```ts
ItemDecisionRequest { item: 'tool' | 'action' | 'escalate'; ref?: string; decision: 'used' | 'dismissed' }
```

`ref` is the item's `tool` (empty for `escalate`). A used `tool` records `copilot.tool_used` (the
stage 2 signal, as `…/tools`); every other combination records the new `copilot.item_decided`
`{item, ref, decision}`. Both are audited ("Decidió sobre una recomendación del copiloto") and the
suggestion aggregate is unchanged. 404 `not_found` if it is not her `ready` suggestion or it holds no
such item; 404 `assistant_disabled` with AI off. `…/tools` stays as it was. The reply and the
accepted escalation keep deriving from the reply and the escalation (slice 15b).

## 3. The assistant is the actor

`AssistantSession` recorded `assistant.started`, `assistant.turn_answered` and `assistant.ended` as the
platform (`ActorRef.system()`); ADR 0003 and slice 14 say `assistant` (`actor_id` = the agent). They
now carry `ActorRole.ASSISTANT` with the serving agent (`id@alias`). The audit therefore shows the
assistant, not "Plataforma", for those events; the audit `actorKind=system` filter no longer lists them.

## 4. Not in this slice

Telling the suggestions agent the stage (`input.modo_copiloto`) needs agent-core's ADR 0026 agent
(in progress). Frontend: run `pnpm gen:api` for `ItemDecisionRequest`.
