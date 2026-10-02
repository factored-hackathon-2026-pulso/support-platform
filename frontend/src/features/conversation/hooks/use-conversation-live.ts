import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { topics, useRealtimeStatus, useRealtimeSubscription } from '@/lib/realtime'
import { conversationKeys } from '../api'

/**
 * Live wiring of an open case: subscribe to `case:<id>` while mounted (in
 * parallel with the first fetch; the merge dedupes the overlap) and, when the
 * socket comes back from `reconnecting`, refetch the detail and catch up on
 * turns, since envelopes may have been missed meanwhile (contract §5.3).
 */
export function useConversationLive(caseId: string): void {
  useRealtimeSubscription(topics.case(caseId))
  const status = useRealtimeStatus()
  const queryClient = useQueryClient()
  const previous = useRef(status)
  useEffect(() => {
    if (previous.current === 'reconnecting' && status === 'open') {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(caseId) })
      void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId) })
    }
    previous.current = status
  }, [status, caseId, queryClient])
}
