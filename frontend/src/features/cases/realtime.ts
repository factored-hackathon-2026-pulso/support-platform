/**
 * Inbox realtime (contract §5.2–§5.3, §7.1): envelope → TanStack Query cache.
 * Registered in `app/realtime-handlers.ts`. Keep this module light (keys +
 * handlers only): it is part of the main bundle.
 *
 * Every handler is idempotent: the same envelope can arrive twice after a
 * reconnect, and the freshness guards (`version`, `computedAt`) make a late or
 * repeated payload a no-op.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { availabilityKeys, caseKeys } from './api'
import { isNewerCounts, patchInbox } from './model'
import type { Availability, CaseSummary, InboxCounts, InboxResponse, InboxStatus } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `CaseSummary` payload of `case.updated` / `case.assigned`, or null when it is
 * malformed. The one reader of this payload: the conversation feature uses it too.
 */
export function readCaseSummary(envelope: RealtimeEnvelope): CaseSummary | null {
  const payload = envelopePayload(envelope)
  if (!payload || typeof payload.id !== 'string' || typeof payload.version !== 'number') return null
  return payload as unknown as CaseSummary
}

function readCounts(envelope: RealtimeEnvelope): InboxCounts | null {
  const payload = envelopePayload(envelope)
  if (!payload || typeof payload.all !== 'number' || typeof payload.computedAt !== 'string')
    return null
  return payload as unknown as InboxCounts
}

function readAvailability(envelope: RealtimeEnvelope): Availability | null {
  const payload = envelopePayload(envelope)
  if (!payload || typeof payload.status !== 'string' || typeof payload.since !== 'string')
    return null
  return payload as unknown as Availability
}

/** Filter of a cached inbox query (`caseKeys.inbox({ status, q })`). */
function inboxFilterOf(queryKey: QueryKey): InboxStatus | null {
  const params = queryKey[2]
  return isRecord(params) && typeof params.status === 'string'
    ? (params.status as InboxStatus)
    : null
}

/**
 * A fresh `CaseSummary` → every cached inbox: patch the card in place when it
 * is newer (instant feedback) and refetch an inbox only when the case may
 * enter, leave or move in it (`patchInbox`); counters come with
 * `inbox.counts`. A plain new message or read cursor therefore costs no
 * request. Also used by the conversation with the summary a command returns,
 * so the pushed `case.updated` of the same version is then a no-op.
 */
export function applyCaseSummaryToInboxes(queryClient: QueryClient, summary: CaseSummary): void {
  const cached = queryClient.getQueriesData<InboxResponse>({ queryKey: caseKeys.inboxes() })
  for (const [queryKey, inbox] of cached) {
    // No data yet (first fetch in flight): refetch so it cannot miss this change.
    const patch = inbox
      ? patchInbox(inbox, inboxFilterOf(queryKey), summary)
      : { inbox, refetch: true }
    if (patch.inbox && patch.inbox !== inbox) writeInbox(queryClient, queryKey, patch.inbox)
    if (patch.refetch) void queryClient.invalidateQueries({ queryKey, exact: true })
  }
}

/**
 * Writes a patched inbox into the cache without losing a pending refetch.
 * `setQueryData` marks a query fresh and clears `isInvalidated` (TanStack v5),
 * so an inbox invalidated while its filter was off screen (a new case must
 * enter "Todos" while the analyst looks at "Cerrados") would come back from the
 * next `inbox.counts` or card patch with the new counters but without the case,
 * and stay that way for `staleTime`. Re-mark it: no request now (an active
 * query is already refetching), the refetch runs when the filter is shown.
 */
function writeInbox(queryClient: QueryClient, queryKey: QueryKey, inbox: InboxResponse): void {
  const pending = queryClient.getQueryState(queryKey)?.isInvalidated ?? false
  queryClient.setQueryData(queryKey, inbox)
  if (pending) void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
}

/**
 * `case.updated` / `case.assigned` / `case.unassigned` (the client already drops
 * repeated envelopes). `case.unassigned` reaches the previous assignee after a
 * reassignment: its `assignedAnalystId` changed, so her inboxes refetch and the
 * case leaves them.
 */
function applyCaseSummary(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const summary = readCaseSummary(envelope)
  if (summary) applyCaseSummaryToInboxes(queryClient, summary)
}

/** `inbox.counts`: the counters of every cached inbox, when not older than the cache. */
function applyCounts(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const counts = readCounts(envelope)
  if (!counts) return
  const cached = queryClient.getQueriesData<InboxResponse>({ queryKey: caseKeys.inboxes() })
  for (const [queryKey, inbox] of cached) {
    if (inbox && isNewerCounts(counts, inbox.counts))
      writeInbox(queryClient, queryKey, { ...inbox, counts })
  }
}

/** `availability.updated` (e.g. changed from another tab). */
function applyAvailability(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const availability = readAvailability(envelope)
  if (availability) queryClient.setQueryData(availabilityKeys.me(), availability)
}

export const registerCasesRealtime: RealtimeRegistration = (registry) => {
  registry.register('case.updated', applyCaseSummary)
  registry.register('case.assigned', applyCaseSummary)
  registry.register('case.unassigned', applyCaseSummary)
  registry.register('inbox.counts', applyCounts)
  registry.register('availability.updated', applyAvailability)
}
