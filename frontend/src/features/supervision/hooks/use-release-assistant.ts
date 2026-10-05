import { useMutation, useQueryClient } from '@tanstack/react-query'
import { conversationKeys } from '@/features/conversation'
import type { ApiProblem } from '@/lib/api'
import { releaseFromAssistant, supervisionKeys, supervisionMutationKeys } from '../api'
import type { CaseSummary } from '../types'

/**
 * "Tomar el caso" (slice 19): the case leaves the assistant for its language queue. Success and
 * failure both refetch "Colas", the queues and the case (`assistant_not_active` means it already
 * left the assistant: the fresh rows say where it is now).
 */
export function useReleaseFromAssistant(caseId: string) {
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.openCases() })
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.queues() })
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.team() })
    void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(caseId) })
    void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId) })
  }
  return useMutation<CaseSummary, ApiProblem, void>({
    mutationKey: supervisionMutationKeys.release(caseId),
    mutationFn: () => releaseFromAssistant(caseId),
    onSettled: refresh,
  })
}
