import { useMutation, useQueryClient } from '@tanstack/react-query'
import { caseKeys } from '@/features/cases'
import type { ApiProblem } from '@/lib/api'
import { closeCase, conversationKeys, conversationMutationKeys } from '../api'
import type { CaseDetail, CloseCaseRequest } from '../types'

/** POST /close: stores the fresh detail and refreshes the inbox and the transcript (closing notice). */
export function useCloseCase(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<CaseDetail, ApiProblem, CloseCaseRequest>({
    mutationKey: conversationMutationKeys.close(caseId),
    mutationFn: (body) => closeCase(caseId, body),
    onSuccess: (detail) => {
      queryClient.setQueryData(conversationKeys.detail(caseId), detail)
      void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId) })
      void queryClient.invalidateQueries({ queryKey: caseKeys.inboxes() })
    },
  })
}
