# ADR 0002 · AI UI frameworks and the copilot wire protocol

- Status: **Superseded — AI is out of the platform scope (2026-10-03)**
- Date: 2026-10-02 (superseded 2026-10-03)

> **Superseded.** On 2026-10-03 the product scope was cut to a chat-only support platform:
> support staff and customers talk by chat, and there is no copilot, no AI agent, no tool
> catalog and no automated routing tier. Nothing in this ADR is built or planned. No
> `POST /cases/{caseId}/copilot/runs`, no AG-UI events, no `@ag-ui/client` and no
> `ag-ui-protocol` dependency. The analyst's Workspace has no right-hand panel. The
> `CopilotEngine` port and `application/copilot/` are deleted in slice 2
> (`../api/slice-2-case-lifecycle.md` §1). The text below is kept only as the record of what
> was decided before the cut. Do not implement it. If AI comes back into scope, a new ADR
> must start from the current architecture (`0001-architecture.md`) and must not revive
> this one.
- Scope: analyst copilot panel (Workspace right panel, "Copiloto" tab) and its backend stream. Does **not** cover the analyst ↔ customer chat.
- Related: `ENGINEERING_BRIEF.md` §4.2 (CopilotEngine strategy), §4.4 (realtime, "AG-UI compatible"), §4.6 (extension points).

## Context

We need (a) an analyst copilot panel with human-in-the-loop actions (tool proposals, approvals, identity verification) rendered with **our** design system (Tailwind v4 tokens, `@/components/ui` primitives), not a generic chat widget; (b) no LLM today: the copilot is a deterministic mock behind the `CopilotEngine` port in the FastAPI backend, and the AI team will later plug in Python agents (probably LangGraph); (c) streaming text, tool-call rendering and state sync; (d) the analyst ↔ customer chat is human-to-human over our WebSocket, not an AI chat; (e) minimal lock-in, React 19 + Vite, no Next.js.

The real question is which **contract** sits between the UI and the agent, more than which chat widget to use. Whatever we pick has to keep working when the mock is swapped for a LangGraph agent, without rewriting the panel.

## Options (checked 2026-10-02 against npm/PyPI registries and official docs)

| Option | What it is | Fit for us | Maturity / version | License | Lock-in | Backend requirement | React 19 / Vite |
|---|---|---|---|---|---|---|---|
| **AG-UI protocol** | Open event protocol between agent backends and UIs (~30 event types, SSE or protobuf over HTTP POST) | **High.** It is only a wire contract, so we keep our own UI. LangGraph, CrewAI, Pydantic AI, ADK, Mastra, MS Agent Framework and others emit it natively | **1.0 (stable, frozen schema)**: `@ag-ui/core`/`@ag-ui/client` 1.0.1 (2026-09-29), Python `ag-ui-protocol` 1.0.0 (2026-09-17, deps: pydantic>=2.11 only); `ag-ui-langgraph` 0.0.46 | MIT | Low: an open spec with many independent implementations | Any language. The Python SDK provides models plus an `EventEncoder` (SSE) | Framework-agnostic TS client (`HttpAgent`, rxjs) |
| **CopilotKit** (v2 API + CopilotRuntime) | React hooks/components on top of AG-UI; Node runtime (Hono/Express) | Medium now, high later. Headless hooks (`useAgent`, `useHumanInTheLoop`, `useRenderToolCall`, `useFrontendTool`) are good, but most of the value assumes a real LLM agent | `@copilotkit/react-core` 1.76.0 (2026-10-01, "AG-UI 1.0 for CopilotKit"), very active (~37.7k stars) | MIT (some cloud "Intelligence" features are paid) | Medium. Its UI and hooks are proprietary API, but the transport is AG-UI | Runtime is Node, **or skip it**: `selfManagedAgents={{id: new HttpAgent({url})}}` talks to any AG-UI endpoint directly (no threads/runtime middleware) | Peer `react ^18 \|\| ^19`; works in a SPA. The package is heavy (lit, katex, streamdown, web-inspector, a2ui-renderer…) |
| **assistant-ui** | Headless, Radix-style composable chat primitives | Medium. Good primitives, but it is chat-thread-centric and our panel is a Q&A + tables + proposals surface | `@assistant-ui/react` 0.15.23 (2026-10-02, still 0.x), `@assistant-ui/react-ag-ui` 0.0.63 | MIT | Low–medium. It uses its own runtime abstraction (`ExternalStoreRuntime`) and has an AG-UI adapter | None, via ExternalStoreRuntime or the AG-UI adapter | Peer `react ^18 \|\| ^19` |
| **Vercel AI SDK UI** (`useChat`) | Chat hook plus its own "UI message stream" SSE protocol; tool parts with approval states | Low–medium. Its tool-approval states are good, but it uses its own protocol, so a Python backend has to hand-write that stream | `ai` 7.0.127 / `@ai-sdk/react` 4.0.130 (2026-10-01) | Apache-2.0 | Medium. The wire format belongs to Vercel (`x-vercel-ai-ui-message-stream: v1`), not the agent frameworks | Documented for Python/FastAPI, but by hand | Peer `react ^18 \|\| ~19.0.1 \|\| ~19.1.2 \|\| ^19.2.1` |
| **LangGraph agent-chat-ui / `useStream`** | Reference chat app plus a React hook for LangGraph Agent Server | Low now. It needs a LangGraph server, and agent-chat-ui is a **Next.js** app, not a library | `@langchain/langgraph-sdk` 1.12.0 (2026-09-25); agent-chat-ui MIT | MIT (Agent Server self-host needs a LangSmith license for production) | High. It couples the UI to the LangGraph server API | LangGraph Agent Server (Postgres + Redis) | Hook OK on 19; the app itself requires Next.js |
| OpenAI ChatKit | Embeddable chat widget plus `chatkit-python` server | Low. It is a widget we would theme, not compose, and is tied to the OpenAI Agents SDK | Active; Agent Builder is being shut down 2026-11-30 | Apache-2.0 | High | ChatKitServer (Python) | Has a React binding |
| A2UI (Google) | Declarative generative-UI JSON spec | Not needed. Our copilot renders known components, not agent-designed UIs | v0.9, v1.0 targeted for Q4 2026 | Apache-2.0 | n/a | n/a | Has a React renderer |

## Decision

1. **AG-UI 1.0 is the copilot wire contract, starting now.** The mock backend emits real AG-UI events, so a LangGraph agent wrapped with `ag-ui-langgraph` (or any other AG-UI producer) can replace it without changing the frontend.
2. **We keep our own UI components.** We adopt no chat-UI framework today. The panel is built from `@/components/ui` and a pure reducer. CopilotKit's v2 headless hooks are the first candidate when a real LLM runtime exists (see Migration).
3. **Frontend transport: `@ag-ui/client` `HttpAgent` (pin `~1.0.1`)**, wrapped inside `features/copilot/`. It already handles SSE parsing, event verification, JSON-Patch state, interrupt outcomes (`getRunOutcome`, `buildResumeArray`) and protocol-version checks, which is code we would otherwise write and get wrong. Components never import it. Lazy-load the copilot chunk because the client pulls in rxjs/zod.
4. **Backend: an application-level `CopilotEvent` union whose `type` strings equal AG-UI names.** `ag-ui-protocol` (pin `~=1.0`) is used only in the API/infrastructure adapter, for encoding and validation. Domain and application never import it.
5. **AG-UI is not used for the human chat, identity checks or supervisor approvals.** Those are multi-actor, long-lived domain workflows (30-min approval SLA, four-eyes). They stay on REST + the `/api/v1/ws` envelopes `{type,id,occurredAt,data}`. The copilot can *propose* them, but it never owns them.

## What we implement now

**Endpoint.** `POST /api/v1/cases/{caseId}/copilot/runs`
- Request body: an AG-UI `RunAgentInput` in camelCase. Required: `threadId`, `runId`, `messages`. Optional: `state`, `tools`, `context`, `forwardedProps`, `resume`, `parentRunId`, `protocolVersion`.
- Auth: `Authorization: Bearer <session>`, passed through `HttpAgent({ url, headers })`.
- Response: `text/event-stream`, one `data: {json}\n\n` per event (the Python `EventEncoder` format), camelCase fields.
- One copilot thread per (case, analyst): `threadId = "CPT-…"`.

**Persistence and audit.** `GET /api/v1/cases/{caseId}/copilot/thread` returns the persisted messages, and the run also opens with `MESSAGES_SNAPSHOT` so a reload restores the panel. Every question and answer is also a domain event (`copilot.question_asked`, `copilot.answered`, `copilot.tool_proposed`) on the bus and in the event log. The SSE stream is a view; the event log is the record.

**Events the mock emits.** Exact enum values, verified in `ag_ui._generated.models.EventType`, ag-ui-protocol 1.0.0:

| Need | AG-UI events |
|---|---|
| Run lifecycle | `RUN_STARTED` (`threadId`, `runId`, `protocolVersion:"1.0"`), `RUN_FINISHED` (`outcome`: `{type:"success"}` or `{type:"interrupt", interrupts:[…]}`), `RUN_ERROR` (`message`, `code`) |
| Progress label ("Buscando en movimientos…") | `STEP_STARTED` / `STEP_FINISHED` (`stepName`) |
| Streaming answer text | `TEXT_MESSAGE_START` (`messageId`, `role:"assistant"`), `TEXT_MESSAGE_CONTENT` (`messageId`, `delta`), `TEXT_MESSAGE_END` |
| Answer table + "Fuente: …" (canvas: table with header, short source line) | `ACTIVITY_SNAPSHOT` (`messageId`, `activityType:"answer_table"`, `content:{title, columns, rows, source}`, `replace:true`). This is typed data that our own `<CopilotAnswerTable>` renders. It is not markdown. |
| Tool proposal (e.g. "Bloquear tarjeta") | `TOOL_CALL_START` (`toolCallId`, `toolCallName` = our tool id, `parentMessageId`), `TOOL_CALL_ARGS` (`delta`, JSON fragment), `TOOL_CALL_END`, then `RUN_FINISHED` with `outcome.type:"interrupt"`, `interrupts:[{id, reason:"tool_call", toolCallId, message, responseSchema}]` |
| Result of an executed tool | `TOOL_CALL_RESULT` (`messageId`, `toolCallId`, `content`, `role:"tool"`) is emitted on the resume run, built from the **verified** `tool_call` record (Rule 9) |
| Panel state ("Tu equipo pregunta esto seguido…" nudges, pending proposals) | `STATE_SNAPSHOT` at run start, `STATE_DELTA` (RFC 6902 JSON Patch) when it changes |
| Reload | `MESSAGES_SNAPSHOT` |

We do not emit these yet (the reducer ignores them safely): `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_CHUNK`, `REASONING_*`, `SUBAGENT_*`, `ACTIVITY_DELTA`, `RAW`, `CUSTOM`. `CUSTOM` is reserved for things AG-UI cannot express, and must be documented if used.

**Human-in-the-loop flow (tool proposal).**
1. The run ends with an interrupt (`reason:"tool_call"`).
2. The panel shows the proposal card with our permission badges.
3. **Aprobar** calls the normal tools use case (`POST /api/v1/cases/{caseId}/tool-calls`). That use case enforces RBAC, policy, identity checks and supervisor approval, exactly as for a tool the analyst picks manually. The copilot never executes anything itself. If identity verification or supervisor approval is required, those domain flows run as usual over REST/WS.
4. The panel then starts a new run on the same `threadId` with `resume:[{interruptId, status:"resolved", payload:{toolCallRecordId}}]`, or `status:"cancelled"` on **Descartar**.
5. The backend re-reads the record by id (it never trusts payload contents) and emits `TOOL_CALL_RESULT`.
6. Spec rules we enforce: one resume must address every open interrupt; resumes are idempotent per `(threadId, interruptId, status, payload)`; a resume after `expiresAt` produces `RUN_ERROR`.

**Code layout.**
- Backend:
  - `application/copilot/ports.py`: `CopilotEngine.run(ctx) -> AsyncIterator[CopilotEvent]`.
  - `application/copilot/events.py`: frozen dataclasses for the subset above, with `type` strings equal to AG-UI's.
  - `infrastructure/copilot/mock_engine.py`: deterministic answers from the customer read model, with sources.
  - `api/copilot/agui_adapter.py`: maps `CopilotEvent` to `ag_ui.core` models, uses `EventEncoder`, and returns `StreamingResponse`.
  - **Contract test:** every `CopilotEvent` the mock produces validates as an `ag_ui.core` model, and the stream obeys start/content/end ordering.
- Frontend:
  - `features/copilot/api.ts`: `createCopilotAgent(caseId, token)` returns an `HttpAgent`.
  - `hooks/useCopilotRun.ts`: `runAgent(params, { onEvent })` dispatches into the reducer.
  - `model.ts`: pure `reduceCopilotEvent(state, event)` producing a view model (messages, answer tables, proposals, open interrupts, step label, error), unit-tested with event fixtures.
  - `components/`: `CopilotPanel`, `CopilotMessage`, `CopilotAnswerTable`, `ToolProposalCard`, `CopilotNudge`, built only from `@/components/ui` and tokens.
  - Tests mock `api.ts`; they never touch a real SSE stream.

## Migration path

1. **LLM arrives (AI team).** Either implement `CopilotEngine` in-process (a LangGraph graph adapted to `CopilotEvent`), or add a `RemoteAgUiCopilotEngine` that POSTs `RunAgentInput` to an AG-UI endpoint (e.g. `ag-ui-langgraph`'s FastAPI endpoint) and re-parses the events into `CopilotEvent`. Either way our API stays the single front door (auth, audit, Rule 9 checks). With LangGraph, enable structured interrupt outcomes (`emitInterruptOutcome`). No frontend change is needed.
2. **Richer agent UX needed** (frontend tools, generative tool UIs, multi-agent). Evaluate CopilotKit v2 **headless** (`@copilotkit/react-core/v2/headless`) with `selfManagedAgents={{ copilot: createCopilotAgent(…) }}`. The same `HttpAgent` is reused, no CopilotRuntime is needed, and our components become render props of `useRenderToolCall` / `useHumanInTheLoop`. Re-check bundle size and React/Vite compatibility at that point. assistant-ui + `react-ag-ui` is the fallback if we ever need a full thread UI.
3. **Automated tiers visible to supervisors** (watching an AI agent work a case): reuse the same AG-UI stream for read-only observation. Customer-facing agent turns still go through the domain turn/tool use cases, never directly to the UI.

## Consequences

- Positive:
  - The protocol, not a widget, is the contract, so it works with any 2026 agent framework.
  - Design-system fidelity is fully ours.
  - The mock exercises streaming, tool proposals, interrupts and state sync end to end before any LLM exists.
- Negative:
  - We write and maintain the panel components and the reducer ourselves (small: one reducer plus ~5 components).
  - `@ag-ui/client` brings rxjs/zod into the copilot chunk.
  - Two realtime transports: SSE per copilot run, plus the WebSocket for domain envelopes. This is deliberate, because they have different lifecycles.
- Risks:
  - AG-UI just reached 1.0. Pin `~1.0` and keep the contract test, which fails loudly if an upgrade changes any event shape.
  - `ACTIVITY_*` and interrupts are newer parts of the spec, so check client support before upgrades.

## Sources

- AG-UI events: https://docs.ag-ui.com/concepts/events · interrupts: https://docs.ag-ui.com/concepts/interrupts · architecture/transports: https://docs.ag-ui.com/concepts/architecture · types: https://docs.ag-ui.com/sdk/js/core/types · Python encoder: https://docs.ag-ui.com/sdk/python/encoder/overview · releases: https://github.com/ag-ui-protocol/ag-ui/releases · enum verified in the `ag-ui-protocol` 1.0.0 wheel (https://pypi.org/project/ag-ui-protocol/)
- CopilotKit releases: https://github.com/CopilotKit/CopilotKit/releases · self-managed agents: https://docs.copilotkit.ai/llamaindex/backend/self-managed-agents · docs: https://docs.copilotkit.ai/
- assistant-ui runtimes: https://www.assistant-ui.com/docs/runtimes/pick-a-runtime · https://www.assistant-ui.com/docs/runtimes/custom/external-store
- AI SDK: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage · https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
- LangGraph: https://docs.langchain.com/langsmith/use-stream-react · https://docs.langchain.com/langsmith/deployment · https://github.com/langchain-ai/agent-chat-ui · https://pypi.org/project/ag-ui-langgraph/
- ChatKit: https://developers.openai.com/api/docs/guides/chatkit · A2UI: https://developers.googleblog.com/a2ui-v0-9-generative-ui/
- Versions, licenses and peer deps: npm registry (`registry.npmjs.org/<pkg>`) and PyPI JSON API, queried 2026-10-02.
