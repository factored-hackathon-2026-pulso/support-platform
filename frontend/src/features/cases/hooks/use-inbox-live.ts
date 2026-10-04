import { useQueryClient } from '@tanstack/react-query'
import { useOnReconnect } from '@/lib/realtime'
import { availabilityKeys, caseKeys } from '../api'

/**
 * Live behaviour of the list that needs React (the cache handlers live in realtime.ts): when
 * the socket comes back from `reconnecting`, refetch the inbox and the availability, since
 * envelopes may have been missed while it was down (contract §5.3).
 *
 * Slice 10: the toasts of a new, reassigned or escalated case come from the notification
 * stream (`features/notifications`), on every screen of the role, not from this list.
 */
export function useInboxLive(): void {
  const queryClient = useQueryClient()
  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: caseKeys.inboxes() })
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.me() })
  })
}
