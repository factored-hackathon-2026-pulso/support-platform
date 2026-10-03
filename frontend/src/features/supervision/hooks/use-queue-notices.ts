import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { ROLES } from '@/app/roles'
import { useToast } from '@/components/ui'
import { readCaseSummary } from '@/features/cases'
import { topics, useRealtimeClient, useRealtimeSubscription } from '@/lib/realtime'
import { queuedNoticeCopy, toTeamSearch } from '../model'

/** Where "Asignar" of the notice goes: the team screen with the assign dialog open. */
export function assignFromTeamPath(caseId: string): string {
  const search = toTeamSearch({
    team: null,
    activity: 'connected',
    analystId: null,
    assignCaseId: caseId,
  })
  return `${ROLES.supervisor.home}?${search.toString()}`
}

/**
 * The supervisor notice (SuAvisoNueva, contract §8.7), on every supervision
 * screen: when a case enters a queue (`queue.case_queued`, once per envelope id)
 * a toast "Un caso espera en la cola en …" with "Asignar" (team screen with the
 * dialog open) and "Más tarde". It stays until one is chosen.
 */
export function useQueueNotices(): void {
  const client = useRealtimeClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  useRealtimeSubscription(topics.supervisionQueues())

  const go = useRef(navigate)
  useEffect(() => {
    go.current = navigate
  }, [navigate])

  const seen = useRef(new Set<string>())
  useEffect(
    () =>
      client.onEnvelope((envelope) => {
        if (envelope.type !== 'queue.case_queued' || seen.current.has(envelope.id)) return
        const summary = readCaseSummary(envelope)
        if (!summary) return
        seen.current.add(envelope.id)
        toast({
          ...queuedNoticeCopy(summary),
          duration: null,
          actions: [
            { label: 'Asignar', onClick: () => void go.current(assignFromTeamPath(summary.id)) },
            { label: 'Más tarde', onClick: () => undefined },
          ],
        })
      }),
    [client, toast],
  )
}
