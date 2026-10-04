/**
 * Supervision realtime (slice-3-supervision.md §7, §8.7; slice 9): envelopes of the
 * `supervision:queues`, `supervision:team` and `supervision:escalations` topics → the
 * team, queue, "Colas" (open cases by language) and "Escalados" caches. Registered in
 * `app/realtime-handlers.ts`; keep this module light (keys + handlers only): it is part
 * of the main bundle.
 *
 * Sockets only signal: `team.updated` carries analyst ids, not rows, and
 * `queue.case_queued` one case, so both refetch. `queue.updated` carries the
 * counts, which are patched in place first (the rail badge moves at once).
 * Handlers are idempotent: counts apply only when newer, refetches are safe to repeat.
 */
import type { QueryClient } from '@tanstack/react-query'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { supervisionKeys } from './api'
import type { QueueCounts, QueueOverview } from './types'

/** At most one team refetch per window (contract §8.7); the last signal is never lost. */
export const TEAM_REFETCH_THROTTLE_MS = 2000

/** `QueueCounts` payload of `queue.updated`, or null when malformed. */
export function readQueueCounts(envelope: RealtimeEnvelope): QueueCounts | null {
  const payload = envelopePayload(envelope)
  if (
    !payload ||
    typeof payload.total !== 'number' ||
    typeof payload.computedAt !== 'string' ||
    !Array.isArray(payload.byLanguage)
  )
    return null
  return payload as unknown as QueueCounts
}

/** Counts computed after the cached ones (equal times are not newer: nothing to patch). */
export function isNewerQueueCounts(
  incoming: QueueCounts,
  cached: QueueCounts | undefined,
): boolean {
  if (!cached) return true
  return new Date(incoming.computedAt).getTime() > new Date(cached.computedAt).getTime()
}

/** `queue.updated`: newer counts → the cached overview (badge, header), then refetch the rows. */
function applyQueueCounts(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const counts = readQueueCounts(envelope)
  if (!counts) return
  const key = supervisionKeys.queues()
  const cached = queryClient.getQueryData<QueueOverview>(key)
  if (cached && !isNewerQueueCounts(counts, cached.counts)) return
  if (cached) queryClient.setQueryData<QueueOverview>(key, { ...cached, counts })
  void queryClient.invalidateQueries({ queryKey: key, exact: true })
  void queryClient.invalidateQueries({ queryKey: supervisionKeys.openCases() })
}

/** `queue.case_queued`: a case entered a queue; queues and "Colas" refetch (the notice is a hook). */
function refetchQueues(_envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: supervisionKeys.queues(), exact: true })
  void queryClient.invalidateQueries({ queryKey: supervisionKeys.openCases() })
}

/** `escalation.updated` (slice 9): "Escalados" and its badge refetch. */
function refetchEscalations(_envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: supervisionKeys.escalations(), exact: true })
}

export const registerSupervisionRealtime: RealtimeRegistration = (registry) => {
  // Throttle state lives in this closure: one per registry (per provider tree).
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: QueryClient | null = null

  // The held cases of "Colas" change with the same signals as the team's rows.
  const refetchTeam = (queryClient: QueryClient) => {
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.team(), exact: true })
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.openCases() })
  }

  const closeWindow = () => {
    const queryClient = pending
    pending = null
    if (!queryClient) {
      timer = null
      return
    }
    // Trailing call for the signals that arrived during the window, then a new window.
    refetchTeam(queryClient)
    timer = setTimeout(closeWindow, TEAM_REFETCH_THROTTLE_MS)
  }

  registry.register('queue.updated', applyQueueCounts)
  registry.register('queue.case_queued', refetchQueues)
  registry.register('escalation.updated', refetchEscalations)
  registry.register('team.updated', (_envelope, queryClient) => {
    if (timer !== null) {
      pending = queryClient
      return
    }
    refetchTeam(queryClient)
    timer = setTimeout(closeWindow, TEAM_REFETCH_THROTTLE_MS)
  })
}
