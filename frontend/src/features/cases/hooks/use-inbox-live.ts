import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/app/session'
import { useToast } from '@/components/ui'
import { envelopeActor, useOnReconnect, useRealtimeClient } from '@/lib/realtime'
import { availabilityKeys, caseKeys } from '../api'
import { assignedToastCopy, escalationToastCopy, unassignedToastCopy } from '../model'
import { readCaseSummary, readEscalation } from '../realtime'

/** Time on screen of the new-case toast (paused while hovered or focused). */
export const ASSIGNED_TOAST_MS = 6000

/**
 * Live behaviour of the list that needs React (the cache handlers live in
 * realtime.ts):
 * - `case.assigned` → toast "Te llegó un caso nuevo", "{Nombre} volvió a
 *   escribir" when the case continues a closed one, or "Te asignaron un caso"
 *   when a supervisor chose her (once per envelope id). The
 *   toast goes away as soon as its case is the selected one or closes, so "Ver
 *   caso" never points at a case already open or closed; no toast for a case
 *   that is already selected;
 * - `case.unassigned` → toast "Supervisión reasignó un caso" (once per envelope
 *   id; the cache handler drops the case from her lists);
 * - `escalation.updated` of HER escalation (slice 9) → toast "{Nombre} respondió tu
 *   escalamiento" / "{Nombre} tomó tu caso" with "Ver caso" (once per envelope id; a
 *   reassignment keeps only the `case.unassigned` toast);
 * - socket back from `reconnecting` → refetch the inbox and the availability,
 *   since envelopes may have been missed while it was down (contract §5.3).
 */
export function useInboxLive(
  onOpenCase: (caseId: string) => void,
  selectedCaseId: string | null,
): void {
  const client = useRealtimeClient()
  const queryClient = useQueryClient()
  const { toast, dismiss } = useToast()
  const meId = useSession().user?.id ?? null
  const me = useRef(meId)
  useEffect(() => {
    me.current = meId
  }, [meId])

  const openCase = useRef(onOpenCase)
  useEffect(() => {
    openCase.current = onOpenCase
  }, [onOpenCase])

  /** Case id → id of its assignment toast still (maybe) on screen. */
  const toasts = useRef(new Map<string, number>())
  const dismissFor = useCallback(
    (caseId: string) => {
      const toastId = toasts.current.get(caseId)
      if (toastId === undefined) return
      toasts.current.delete(caseId)
      dismiss(toastId)
    },
    [dismiss],
  )

  const selected = useRef(selectedCaseId)
  useEffect(() => {
    selected.current = selectedCaseId
    if (selectedCaseId) dismissFor(selectedCaseId)
  }, [selectedCaseId, dismissFor])

  const seen = useRef(new Set<string>())
  useEffect(
    () =>
      client.onEnvelope((envelope) => {
        if (envelope.type === 'case.updated') {
          const summary = readCaseSummary(envelope)
          if (summary?.status === 'closed') dismissFor(summary.id)
          return
        }
        if (envelope.type === 'escalation.updated') {
          if (seen.current.has(envelope.id) || !me.current) return
          const escalation = readEscalation(envelope)
          const copy = escalation ? escalationToastCopy(escalation, me.current) : null
          if (!escalation || !copy) return
          seen.current.add(envelope.id)
          toast({
            ...copy,
            duration: ASSIGNED_TOAST_MS,
            actions:
              escalation.caseId === selected.current
                ? undefined
                : [{ label: 'Ver caso', onClick: () => openCase.current(escalation.caseId) }],
          })
          return
        }
        if (envelope.type === 'case.unassigned') {
          if (seen.current.has(envelope.id)) return
          const summary = readCaseSummary(envelope)
          if (!summary) return
          seen.current.add(envelope.id)
          dismissFor(summary.id)
          toast({ ...unassignedToastCopy(summary), duration: ASSIGNED_TOAST_MS })
          return
        }
        if (envelope.type !== 'case.assigned' || seen.current.has(envelope.id)) return
        const summary = readCaseSummary(envelope)
        if (!summary) return
        seen.current.add(envelope.id)
        if (summary.id === selected.current) return
        dismissFor(summary.id)
        const fromSupervisor = envelopeActor(envelope)?.role === 'supervisor'
        const toastId = toast({
          ...assignedToastCopy(summary, { fromSupervisor }),
          duration: ASSIGNED_TOAST_MS,
          actions: [{ label: 'Ver caso', onClick: () => openCase.current(summary.id) }],
        })
        toasts.current.set(summary.id, toastId)
      }),
    [client, toast, dismissFor],
  )

  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: caseKeys.inboxes() })
    void queryClient.invalidateQueries({ queryKey: availabilityKeys.me() })
  })
}
