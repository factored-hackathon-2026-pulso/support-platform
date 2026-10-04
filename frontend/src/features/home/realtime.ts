/**
 * Home realtime (docs/platform/api/slice-6-analyst-home.md §4.6): envelopes the
 * analyst already receives → refetch of "Inicio". Registered in
 * `app/realtime-handlers.ts`; keep this module light (keys + handlers only): it
 * is part of the main bundle.
 *
 * Sockets only signal: the home is a server read model (activity since her
 * previous session, her team's queues), so every signal refetches it, at most
 * once per window (leading + trailing, throttle state per registry). The
 * analyst follows only her own `inbox:<id>` (her cases, `inbox.counts`,
 * `availability.updated`); `queue.*` reach someone who also holds the
 * Supervisión role and has a supervision screen open. No topic is added for
 * analysts: the team snapshot also refetches every 60 s (hooks/use-home.ts).
 * The tiles and "Lo primero" read the inbox cache, which the cases handlers patch.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { RealtimeEventType, RealtimeRegistration } from '@/lib/realtime'
import { homeKeys } from './api'

/** At most one home refetch per window; the last signal is never lost. */
export const HOME_REFETCH_THROTTLE_MS = 2000

/** The envelopes that may change what "Inicio" shows. */
export const HOME_SIGNALS: readonly RealtimeEventType[] = [
  'case.assigned',
  'case.unassigned',
  'case.updated',
  'inbox.counts',
  'availability.updated',
  'queue.updated',
  'queue.case_queued',
]

export const registerHomeRealtime: RealtimeRegistration = (registry) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: QueryClient | null = null

  const refetch = (queryClient: QueryClient) =>
    void queryClient.invalidateQueries({ queryKey: homeKeys.all })

  const closeWindow = () => {
    const queryClient = pending
    pending = null
    if (!queryClient) {
      timer = null
      return
    }
    refetch(queryClient)
    timer = setTimeout(closeWindow, HOME_REFETCH_THROTTLE_MS)
  }

  const signal = (_envelope: unknown, queryClient: QueryClient) => {
    if (timer !== null) {
      pending = queryClient
      return
    }
    refetch(queryClient)
    timer = setTimeout(closeWindow, HOME_REFETCH_THROTTLE_MS)
  }

  for (const type of HOME_SIGNALS) registry.register(type, signal)
}
