import { useCallback } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/features/conversation'
import type { ApiProblem } from '@/lib/api'
import { setCaseAssignee, supervisionKeys, supervisionMutationKeys } from '../api'
import type { AssignmentResult, SetAssigneeRequest } from '../types'

/**
 * PUT /supervision/cases/{caseId}/assignee ("Reasignar"; slice 3 §8.6). On success the
 * case detail (capabilities, assignment, the banner in the transcript), the team, the
 * queues, "Colas" and "Escalados" (a reassignment ends an open escalation, slice 9) are
 * refetched: patching the detail with the returned summary is not enough.
 */
export function useSetAssignee(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<AssignmentResult, ApiProblem, SetAssigneeRequest>({
    mutationKey: supervisionMutationKeys.assign(caseId),
    mutationFn: (body) => setCaseAssignee(caseId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(caseId) })
      void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId) })
      void queryClient.invalidateQueries({ queryKey: supervisionKeys.team() })
      void queryClient.invalidateQueries({ queryKey: supervisionKeys.queues() })
      void queryClient.invalidateQueries({ queryKey: supervisionKeys.openCases() })
      void queryClient.invalidateQueries({ queryKey: supervisionKeys.escalations() })
    },
  })
}

/**
 * Whether a PUT …/assignee of this case is in flight (from any dialog). While it
 * is, the screen keeps the dialog open even if the overviews briefly lose the
 * case (the queues refetch lands before the team's): closing it then would drop
 * the `mutate` callbacks that report the result and clear `?reassign=`.
 */
export function useIsAssigning(caseId: string | null): boolean {
  const count = useIsMutating({
    mutationKey: supervisionMutationKeys.assign(caseId ?? ''),
    exact: true,
  })
  return caseId !== null && count > 0
}

/** After a failure that may mean stale data (`assignment_changed`, `case_closed`…). */
export function useRefetchAssignmentData(caseId: string | null) {
  const queryClient = useQueryClient()
  return useCallback(
    (scope: 'all' | 'team' = 'all') => {
      void queryClient.invalidateQueries({ queryKey: supervisionKeys.team() })
      if (scope === 'team') return
      void queryClient.invalidateQueries({ queryKey: supervisionKeys.queues() })
      if (caseId) void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(caseId) })
    },
    [queryClient, caseId],
  )
}
