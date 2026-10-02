/**
 * Conversation calls (docs/platform/api/slice-1-cases.md §3): case detail, turns,
 * analyst replies, read cursor and close. The only module of the feature that
 * talks to the API client; tests mock it with `vi.mock('@/features/conversation/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  CaseDetail,
  CaseSummary,
  CloseCaseRequest,
  PostAnalystTurnRequest,
  PostTurnResponse,
  TurnPage,
} from './types'

/** Query keys (frozen by the contract §7.2). */
export const conversationKeys = {
  all: ['conversation'] as const,
  detail: (caseId: string) => ['conversation', caseId, 'detail'] as const,
  turns: (caseId: string) => ['conversation', caseId, 'turns'] as const,
}

export const conversationMutationKeys = {
  send: (caseId: string) => ['conversation', caseId, 'send'] as const,
  read: (caseId: string) => ['conversation', caseId, 'read'] as const,
  close: (caseId: string) => ['conversation', caseId, 'close'] as const,
}

/** GET /cases/{caseId}: case, customer, assignment, "Cómo llegó a ti", capabilities. */
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

/** POST /cases/{caseId}/close. */
export async function closeCase(caseId: string, body: CloseCaseRequest): Promise<CaseDetail> {
  return unwrap(api.POST('/api/v1/cases/{caseId}/close', { params: { path: { caseId } }, body }))
}
