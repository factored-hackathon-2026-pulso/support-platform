/**
 * Conversation calls (docs/platform/api/slice-2-case-lifecycle.md §5.1): case
 * detail, turns, analyst replies, read cursor, close and the customer's other
 * cases ("Casos anteriores"). The only module of the feature that
 * talks to the API client; tests mock it with `vi.mock('@/features/conversation/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  CaseDetail,
  CaseHistory,
  CaseSummary,
  CloseCaseRequest,
  PostAnalystTurnRequest,
  PostTurnResponse,
  TurnPage,
} from './types'

/** Query keys (frozen by the contract §9.7). */
export const conversationKeys = {
  all: ['conversation'] as const,
  detail: (caseId: string) => ['conversation', caseId, 'detail'] as const,
  turns: (caseId: string) => ['conversation', caseId, 'turns'] as const,
  history: (caseId: string) => ['conversation', caseId, 'history'] as const,
}

export const conversationMutationKeys = {
  send: (caseId: string) => ['conversation', caseId, 'send'] as const,
  read: (caseId: string) => ['conversation', caseId, 'read'] as const,
  close: (caseId: string) => ['conversation', caseId, 'close'] as const,
}

/** GET /cases/{caseId}: case, customer, assignment ("Cómo llegó a ti"), closure, capabilities. */
export async function fetchCaseDetail(caseId: string, signal?: AbortSignal): Promise<CaseDetail> {
  return unwrap(api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } }, signal }))
}

export interface TurnsQuery {
  /** Opaque cursor from `olderCursor`: the page before it. */
  cursor?: string
  /** Catch-up: turns with `sequence > afterSequence`. Exclusive with `cursor`. */
  afterSequence?: number
  /** 1–200 (server default 50). */
  limit?: number
}

/** GET /cases/{caseId}/turns. No params → latest page (ascending sequence). */
export async function fetchTurns(
  caseId: string,
  query: TurnsQuery = {},
  signal?: AbortSignal,
): Promise<TurnPage> {
  return unwrap(
    api.GET('/api/v1/cases/{caseId}/turns', {
      params: { path: { caseId }, query: { ...query } },
      signal,
    }),
  )
}

/**
 * POST /cases/{caseId}/turns. `Idempotency-Key` = `clientMessageId`: re-posting the
 * same message after a failure replays the original turn (200) instead of a duplicate.
 */
export async function postAnalystTurn(
  caseId: string,
  body: PostAnalystTurnRequest,
): Promise<PostTurnResponse> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/turns', {
      params: { path: { caseId }, header: { 'Idempotency-Key': body.clientMessageId } },
      body,
    }),
  )
}

/** POST /cases/{caseId}/read: monotonic read cursor; `assigned → in_progress`. */
export async function markCaseRead(caseId: string, upToSequence: number): Promise<CaseSummary> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/read', {
      params: { path: { caseId } },
      body: { upToSequence },
    }),
  )
}

/** POST /cases/{caseId}/close: `{ reason, note }` (the customer only gets the closing notice). */
export async function closeCase(caseId: string, body: CloseCaseRequest): Promise<CaseDetail> {
  return unwrap(api.POST('/api/v1/cases/{caseId}/close', { params: { path: { caseId } }, body }))
}

/**
 * GET /cases/{caseId}/history: the customer's **other** cases (any status),
 * newest first, at most 20 (`total` is the full count). With read access to
 * `caseId`, every listed case is readable through GET /cases/{id} and /turns.
 */
export async function fetchCaseHistory(caseId: string, signal?: AbortSignal): Promise<CaseHistory> {
  return unwrap(api.GET('/api/v1/cases/{caseId}/history', { params: { path: { caseId } }, signal }))
}
