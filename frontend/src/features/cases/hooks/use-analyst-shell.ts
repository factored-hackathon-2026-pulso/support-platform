import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import { availabilityKeys, caseKeys, fetchAvailability, fetchInbox } from '../api'
import type { Availability, AvailabilityStatus, InboxResponse } from '../types'

/** The default inbox (open cases, no search): the same cache entry as the Casos list. */
const DEFAULT_INBOX = { status: null, q: '' } as const

/**
 * Live data the analyst shell needs on every analyst screen (slice 6 §4.4): her
 * `inbox:<id>` topic stays subscribed while the Analista role is the visible one
 * (Inicio and Casos both follow it), and both caches refetch after a reconnect.
 * Returns the "Por responder" count behind the rail badge of "Casos";
 * `undefined` (and no request) while `enabled` is false.
 */
export function useToReplyCount({
  enabled,
  staffId,
}: {
  enabled: boolean
  staffId: string | null
}): number | undefined {
  const queryClient = useQueryClient()
  useRealtimeSubscription(enabled && staffId ? topics.inbox(staffId) : null)
  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: caseKeys.inboxes() })
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.me() })
  }, enabled)
  const query = useQuery<InboxResponse, ApiProblem, number>({
    queryKey: caseKeys.inbox(DEFAULT_INBOX),
    queryFn: ({ signal }) => fetchInbox(DEFAULT_INBOX, signal),
    select: (inbox) => inbox.counts.toReply,
    enabled,
  })
  return enabled ? query.data : undefined
}

/**
 * Her availability for the presence dot on the rail avatar (same cache as the
 * Casos control and Inicio; `availability.updated` keeps it fresh).
 */
export function useAvailabilityPresence({
  enabled,
}: {
  enabled: boolean
}): AvailabilityStatus | undefined {
  const query = useQuery<Availability, ApiProblem, AvailabilityStatus>({
    queryKey: availabilityKeys.me(),
    queryFn: ({ signal }) => fetchAvailability(signal),
    select: (availability) => availability.status,
    enabled,
  })
  return enabled ? query.data : undefined
}
