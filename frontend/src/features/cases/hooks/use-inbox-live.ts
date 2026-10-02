import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { useRealtimeClient, useRealtimeStatus } from '@/lib/realtime'
import { availabilityKeys, caseKeys } from '../api'
import { readCaseSummary } from '../realtime'

/**
 * Live behaviour of the list that needs React (the cache handlers live in
 * realtime.ts):
 * - `case.assigned` → toast "Te llegó un caso nuevo" (once per envelope id);
 * - socket back from `reconnecting` → refetch the inbox and the availability,
 *   since envelopes may have been missed while it was down (contract §5.3).
 */
export function useInboxLive(onOpenCase: (caseId: string) => void): void {
  const client = useRealtimeClient()
  const status = useRealtimeStatus()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const openCase = useRef(onOpenCase)
  useEffect(() => {
    openCase.current = onOpenCase
  }, [onOpenCase])

  const seen = useRef(new Set<string>())
  useEffect(
    () =>
      client.onEnvelope((envelope) => {
        if (envelope.type !== 'case.assigned' || seen.current.has(envelope.id)) return
        const summary = readCaseSummary(envelope)
        if (!summary) return
        seen.current.add(envelope.id)
        toast({
          title: 'Te llegó un caso nuevo',
          description: summary.customer.displayName,
          duration: 8000,
          actions: [{ label: 'Ver caso', onClick: () => openCase.current(summary.id) }],
        })
      }),
    [client, toast],
  )

  const previous = useRef(status)
  useEffect(() => {
    if (previous.current === 'reconnecting' && status === 'open') {
      void queryClient.invalidateQueries({ queryKey: caseKeys.inboxes() })
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.me() })
    }
    previous.current = status
  }, [status, queryClient])
}
