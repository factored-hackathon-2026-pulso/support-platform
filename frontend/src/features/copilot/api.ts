/**
 * Copilot calls: the analyst's Q&A thread about a case (docs/platform/api/slice-15-copilot.md) and
 * the copilot's suggestions (slice-15b-copilot-suggestions.md). The only module of the feature
 * that talks to the API client; tests mock it with `vi.mock('@/features/copilot/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type { AiStages } from './stages'
import type {
  CopilotExchange,
  CopilotSuggestion,
  CopilotThread,
  LatestCopilotSuggestion,
  SuggestionFeedback,
} from './types'

export const copilotKeys = {
  all: ['copilot'] as const,
  /** GET /cases/{id}/copilot: her thread with the copilot about this case. */
  thread: (caseId: string) => ['copilot', caseId, 'thread'] as const,
  /** UI-only: her questions in flight or failed in this session (never fetched). */
  asks: (caseId: string) => ['copilot', caseId, 'asks'] as const,
  /** GET /cases/{id}/copilot/suggestions/latest. */
  latest: (caseId: string) => ['copilot', caseId, 'latest'] as const,
  /** GET /ai/stages (slice 21): every case type's stage. */
  stages: () => ['copilot', 'stages'] as const,
}

export const copilotMutationKeys = {
  ask: (caseId: string) => ['copilot', caseId, 'ask'] as const,
  suggest: (caseId: string) => ['copilot', caseId, 'suggest'] as const,
  feedback: (caseId: string) => ['copilot', caseId, 'feedback'] as const,
}

/** GET /cases/{caseId}/copilot. `available: false` (200) hides the copilot: not an error. */
export async function fetchCopilotThread(
  caseId: string,
  signal?: AbortSignal,
): Promise<CopilotThread> {
  return unwrap(api.GET('/api/v1/cases/{caseId}/copilot', { params: { path: { caseId } }, signal }))
}

/**
 * POST /cases/{caseId}/copilot/messages. Waits for the model (5-10 s). Idempotent on
 * `clientMessageId` (= `Idempotency-Key`): after a failure the same id asks again.
 */
export async function askCopilot(
  caseId: string,
  body: { text: string; clientMessageId: string },
): Promise<CopilotExchange> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/copilot/messages', {
      params: { path: { caseId }, header: { 'Idempotency-Key': body.clientMessageId } },
      body,
    }),
  )
}

/** GET …/copilot/suggestions/latest. `available: false` hides the suggestions. */
export async function fetchLatestSuggestion(
  caseId: string,
  signal?: AbortSignal,
): Promise<LatestCopilotSuggestion> {
  return unwrap(
    api.GET('/api/v1/cases/{caseId}/copilot/suggestions/latest', {
      params: { path: { caseId } },
      signal,
    }),
  )
}

/**
 * POST …/copilot/suggestions ("Sugerir"). Waits for the model. `idempotencyKey`: one per attempt;
 * after a failure the same key asks again.
 */
export async function requestSuggestion(
  caseId: string,
  idempotencyKey: string,
): Promise<CopilotSuggestion> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/copilot/suggestions', {
      params: { path: { caseId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: { trigger: 'manual' },
    }),
  )
}

/** POST …/suggestions/{id}/feedback: she dismissed the draft (`discarded`) or left it. */
export async function sendSuggestionFeedback(
  caseId: string,
  suggestionId: string,
  decision: SuggestionFeedback,
): Promise<CopilotSuggestion> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/copilot/suggestions/{suggestionId}/feedback', {
      params: { path: { caseId, suggestionId } },
      body: { decision },
    }),
  )
}

/** GET /ai/stages (slice 21). `available: false` (AI off): no stage, no copilot. */
export async function fetchAiStages(signal?: AbortSignal): Promise<AiStages> {
  return unwrap(api.GET('/api/v1/ai/stages', { signal }))
}

/**
 * POST …/suggestions/{id}/tools (slice 21): she used a tool the copilot proposed ("Usar"). A
 * stage signal of the case type; best effort (the caller ignores a failure).
 */
export async function recordToolUsed(
  caseId: string,
  suggestionId: string,
  tool: string,
): Promise<void> {
  await unwrap(
    api.POST('/api/v1/cases/{caseId}/copilot/suggestions/{suggestionId}/tools', {
      params: { path: { caseId, suggestionId } },
      body: { tool, decision: 'used' },
    }),
  )
}
