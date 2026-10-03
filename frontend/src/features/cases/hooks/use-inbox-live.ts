import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { useRealtimeClient, useRealtimeStatus } from '@/lib/realtime'
import { availabilityKeys, caseKeys } from '../api'
import { assignedToastCopy } from '../model'
import { readCaseSummary } from '../realtime'

/** Time on screen of the new-case toast (paused while hovered or focused). */
export const ASSIGNED_TOAST_MS = 6000

/**
 * Live behaviour of the list that needs React (the cache handlers live in
 * realtime.ts):
 * - `case.assigned` → toast "Te llegó un caso nuevo", or "{Nombre} volvió a
 *   escribir" when the case continues a closed one (once per envelope id). The
 *   toast goes away as soon as its case is the selected one or closes, so "Ver
 *   caso" never points at a case already open or closed; no toast for a case
 *   that is already selected;
 * - socket back from `reconnecting` → refetch the inbox and the availability,
 *   since envelopes may have been missed while it was down (contract §5.3).
 */
export function useInboxLive(
  onOpenCase: (caseId: string) => void,
  selectedCaseId: string | null,
): void {
  const client = useRealtimeClient()
  const status = useRealtimeStatus()
  const queryClient = useQueryClient()
  const { toast, dismiss } = useToast()

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
        if (envelope.type !== 'case.assigned' || seen.current.has(envelope.id)) return
        const summary = readCaseSummary(envelope)
        if (!summary) return
        seen.current.add(envelope.id)
        if (summary.id === selected.current) return
        dismissFor(summary.id)
        const toastId = toast({
          ...assignedToastCopy(summary),
          duration: ASSIGNED_TOAST_MS,
          actions: [{ label: 'Ver caso', onClick: () => openCase.current(summary.id) }],
        })
        toasts.current.set(summary.id, toastId)
      }),
    [client, toast, dismissFor],
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
