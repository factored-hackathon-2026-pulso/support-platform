import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { supervisionEscalationPath } from '@/app/roles'
import { useToast } from '@/components/ui'
import { readCaseSummary, readEscalation } from '@/features/cases'
import { topics, useRealtimeClient, useRealtimeSubscription } from '@/lib/realtime'
import { escalationNoticeCopy, queuedNoticeCopy, queuesPath } from '../model'

/**
 * The supervision notices, on every supervision screen (canvas notification center):
 *
 * - a case enters a queue (`queue.case_queued`): "Un caso espera en la cola en …" with
 *   "Ver en la cola" (Colas of that language) and "Más tarde". Nobody assigns it by hand:
 *   it reaches the first available speaker on its own.
 * - an analyst escalates a case (`escalation.updated`, state `open`, once per escalation):
 *   "Daniela Ríos escaló un caso", the customer and the motive, with "Revisar" ("Escalados"
 *   with it open) and "Más tarde".
 */
export function useSupervisionNotices({
  escalations = true,
}: {
  /** "Escalados" itself passes false: the new row arrives live there, no toast over it. */
  escalations?: boolean
} = {}): void {
  const client = useRealtimeClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  useRealtimeSubscription(topics.supervisionQueues())
  useRealtimeSubscription(topics.supervisionEscalations())

  const go = useRef(navigate)
  useEffect(() => {
    go.current = navigate
  }, [navigate])

  const seen = useRef(new Set<string>())
  useEffect(
    () =>
      client.onEnvelope((envelope) => {
        if (envelope.type === 'queue.case_queued') {
          if (seen.current.has(envelope.id)) return
          const summary = readCaseSummary(envelope)
          if (!summary) return
          seen.current.add(envelope.id)
          toast({
            ...queuedNoticeCopy(summary),
            duration: null,
            actions: [
              {
                label: 'Ver en la cola',
                onClick: () => void go.current(queuesPath(summary.language)),
              },
              { label: 'Más tarde', onClick: () => undefined },
            ],
          })
          return
        }
        if (envelope.type === 'escalation.updated' && escalations) {
          const escalation = readEscalation(envelope)
          if (!escalation || escalation.state !== 'open') return
          const key = `escalation:${escalation.id}`
          if (seen.current.has(key)) return
          seen.current.add(key)
          toast({
            ...escalationNoticeCopy(escalation),
            duration: null,
            actions: [
              {
                label: 'Revisar',
                onClick: () => void go.current(supervisionEscalationPath(escalation.id)),
              },
              { label: 'Más tarde', onClick: () => undefined },
            ],
          })
        }
      }),
    [client, toast, escalations],
  )
}
