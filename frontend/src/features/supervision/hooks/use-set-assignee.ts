import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/features/conversation'
import type { ApiProblem } from '@/lib/api'
import { setCaseAssignee, supervisionKeys, supervisionMutationKeys } from '../api'
import type { AssignmentResult, SetAssigneeRequest } from '../types'

/**
 * PUT /supervision/cases/{caseId}/assignee (contract §8.6). On success the case
 * detail (capabilities, assignment, the banner in the transcript), the team and
 * the queues are refetched: patching the detail with the returned summary is not
 * enough, the server computes the rest.
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
    },
  })
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
