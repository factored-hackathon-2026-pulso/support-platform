import { useMutation, useQueryClient } from '@tanstack/react-query'
import { applyCaseSummaryToInboxes, caseKeys } from '@/features/cases'
import type { ApiProblem } from '@/lib/api'
import { closeCase, conversationKeys, conversationMutationKeys } from '../api'
import type { CaseDetail, CloseCaseRequest } from '../types'

/**
 * POST /close (contract §9.5): stores the returned detail (closed, read-only),
 * moves the card out of the open inboxes and into Cerrados, refreshes the
 * counters (they change) and the transcript (the closing notice).
 */
export function useCloseCase(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<CaseDetail, ApiProblem, CloseCaseRequest>({
    mutationKey: conversationMutationKeys.close(caseId),
    mutationFn: (body) => closeCase(caseId, body),
    onSuccess: (detail) => {
      queryClient.setQueryData(conversationKeys.detail(caseId), detail)
      applyCaseSummaryToInboxes(queryClient, detail.case)
      void queryClient.invalidateQueries({ queryKey: caseKeys.inboxes() })
      void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId) })
    },
  })
}
