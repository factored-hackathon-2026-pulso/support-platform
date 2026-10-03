/**
 * Conversation realtime (slice-2-case-lifecycle.md §7): staff envelopes on
 * `case:<id>` → the case detail and turns caches. Registered in
 * `app/realtime-handlers.ts`; keep this module light (keys + handlers only).
 *
 * Handlers are idempotent: turns merge by id, summaries apply only when their
 * `version` is newer, so a repeated or late envelope is a no-op.
 */
import type { QueryClient } from '@tanstack/react-query'
import { readCaseSummary } from '@/features/cases'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { conversationKeys } from './api'
import { applySummary, hasSequenceGap, mergeTurns, needsDetailRefetch } from './model'
import type { CaseDetail, TranscriptCache, Turn } from './types'

/** Staff `Turn` payload (the customer socket has its own registry and shape). */
export function readTurn(envelope: RealtimeEnvelope): Turn | null {
  const payload = envelopePayload(envelope)
  if (
    !payload ||
    typeof payload.id !== 'string' ||
    typeof payload.caseId !== 'string' ||
    typeof payload.sequence !== 'number'
  )
    return null
  return payload as unknown as Turn
}

/**
 * `turn.created`: merge into the open transcript. A turn that skips sequence
 * numbers means we missed some (socket down, or committed before the first
 * fetch): the turns query refetches, and its query function catches up with
 * `?afterSequence=` (see `useCaseTurns`), which brings this turn too.
 */
function applyTurn(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const turn = readTurn(envelope)
  if (!turn) return
  const key = conversationKeys.turns(turn.caseId)
  const cache = queryClient.getQueryData<TranscriptCache>(key)
  if (!cache) return // Nobody has this case open: the first fetch will bring it.
  if (hasSequenceGap(cache, turn)) {
    void queryClient.invalidateQueries({ queryKey: key, exact: true })
    return
  }
  queryClient.setQueryData<TranscriptCache>(key, (current) =>
    current ? mergeTurns(current, [turn]) : current,
  )
}

/** `case.updated` / `case.assigned`: newer summary → detail cache; status change → refetch. */
function applyCase(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const summary = readCaseSummary(envelope)
  if (!summary) return
  const key = conversationKeys.detail(summary.id)
  const detail = queryClient.getQueryData<CaseDetail>(key)
  if (!detail) return
  const refetch = needsDetailRefetch(detail, summary)
  queryClient.setQueryData<CaseDetail>(key, (current) =>
    current ? applySummary(current, summary) : current,
  )
  if (refetch) void queryClient.invalidateQueries({ queryKey: key, exact: true })
}

export const registerConversationRealtime: RealtimeRegistration = (registry) => {
  registry.register('turn.created', applyTurn)
  registry.register('case.updated', applyCase)
  registry.register('case.assigned', applyCase)
}
