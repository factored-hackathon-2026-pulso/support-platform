/**
 * Conversation calls (docs/platform/api/slice-2-case-lifecycle.md §5.1): case
 * detail, turns, analyst replies, read cursor, close, the customer's other
 * cases ("Casos anteriores") and (slice 8) the priority. The only module of the feature that
 * talks to the API client; tests mock it with `vi.mock('@/features/conversation/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  CaseDetail,
  CaseHistory,
  CasePriorityResult,
  CaseSummary,
  ChangePriorityRequest,
  CloseCaseRequest,
  EscalationResult,
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
  priority: (caseId: string) => ['conversation', caseId, 'priority'] as const,
  escalate: (caseId: string) => ['conversation', caseId, 'escalate'] as const,
  withdrawEscalation: (caseId: string) => ['conversation', caseId, 'escalation-withdraw'] as const,
  acknowledgeEscalation: (caseId: string) =>
    ['conversation', caseId, 'escalation-acknowledge'] as const,
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

/**
 * PUT /cases/{caseId}/priority (slice 8): the assignee or supervision. The same level is a
 * no-op (`changed: false`); a stale `expectedVersion` is `version_conflict` with `current`.
 */
export async function changeCasePriority(
  caseId: string,
  body: ChangePriorityRequest,
): Promise<CasePriorityResult> {
  return unwrap(api.PUT('/api/v1/cases/{caseId}/priority', { params: { path: { caseId } }, body }))
}

/**
 * POST /cases/{caseId}/escalations (slice 9): the assignee asks supervision for help with a
 * required motive. `idempotencyKey`: one per open dialog, so a retry replays the escalation
 * it created instead of failing with `escalation_open`.
 */
export async function escalateCase(
  caseId: string,
  motive: string,
  idempotencyKey: string,
): Promise<EscalationResult> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/escalations', {
      params: { path: { caseId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: { motive },
    }),
  )
}

/** POST /cases/{caseId}/escalations/{escalationId}/withdraw: the assignee, while it is open. */
export async function withdrawEscalation(
  caseId: string,
  escalationId: string,
): Promise<EscalationResult> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/escalations/{escalationId}/withdraw', {
      params: { path: { caseId, escalationId } },
    }),
  )
}

/** POST …/acknowledge ("Entendido"): who escalated read what supervision did. Idempotent. */
export async function acknowledgeEscalation(
  caseId: string,
  escalationId: string,
): Promise<EscalationResult> {
  return unwrap(
    api.POST('/api/v1/cases/{caseId}/escalations/{escalationId}/acknowledge', {
      params: { path: { caseId, escalationId } },
    }),
  )
}
