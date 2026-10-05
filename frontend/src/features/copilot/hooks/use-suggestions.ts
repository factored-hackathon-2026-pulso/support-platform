import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import type { ApiProblem } from '@/lib/api'
import { useOnReconnect } from '@/lib/realtime'
import {
  copilotKeys,
  copilotMutationKeys,
  fetchLatestSuggestion,
  requestSuggestion,
  sendSuggestionFeedback,
} from '../api'
import { describeSuggestFailure } from '../model'
import type { CopilotSuggestion, LatestCopilotSuggestion } from '../types'

/**
 * GET …/copilot/suggestions/latest (slice 15b): read when the case opens, again on
 * `copilot.suggestion_updated` (realtime.ts) and after a reconnect. Shared by the draft above the
 * composer, the escalation notice and "Herramientas" (one cache entry).
 */
export function useLatestSuggestion(
  caseId: string,
  enabled: boolean,
): UseQueryResult<LatestCopilotSuggestion, ApiProblem> {
  const queryClient = useQueryClient()
  useOnReconnect(
    () => void queryClient.invalidateQueries({ queryKey: copilotKeys.latest(caseId) }),
    enabled,
  )
  return useQuery<LatestCopilotSuggestion, ApiProblem>({
    queryKey: copilotKeys.latest(caseId),
    queryFn: ({ signal }) => fetchLatestSuggestion(caseId, signal),
    enabled,
    retry: (failures, error) => failures < 1 && (error.status >= 500 || error.status === 0),
  })
}

function newKey(): string {
  return crypto.randomUUID()
}

/**
 * "Sugerir" (POST …/copilot/suggestions): the answer replaces the newest suggestion. One
 * `Idempotency-Key` per attempt; after a failure that can be retried the same key asks again
 * (slice 15b §2). `copilot_busy` means one is on its way: the newest is read again.
 */
export function useRequestSuggestion(caseId: string) {
  const queryClient = useQueryClient()
  const key = useRef<string | null>(null)
  return useMutation<CopilotSuggestion, ApiProblem, void>({
    mutationKey: copilotMutationKeys.suggest(caseId),
    mutationFn: () => {
      key.current ??= newKey()
      return requestSuggestion(caseId, key.current)
    },
    onSuccess: (suggestion) => {
      key.current = null
      queryClient.setQueryData<LatestCopilotSuggestion>(copilotKeys.latest(caseId), {
        available: true,
        suggestion,
      })
    },
    onError: (error) => {
      if (!describeSuggestFailure(error).retry) key.current = null
      void queryClient.invalidateQueries({ queryKey: copilotKeys.latest(caseId) })
    },
  })
}

/**
 * "Descartar" on the draft: optimistic (the draft goes away at once), then the feedback
 * (`discarded`); a failure puts it back and says so in a toast.
 */
export function useDiscardDraft(caseId: string) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const key = copilotKeys.latest(caseId)
  return useMutation<
    CopilotSuggestion,
    ApiProblem,
    string,
    { previous: LatestCopilotSuggestion | undefined }
  >({
    mutationKey: copilotMutationKeys.feedback(caseId),
    mutationFn: (suggestionId) => sendSuggestionFeedback(caseId, suggestionId, 'discarded'),
    onMutate: async (suggestionId) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const previous = queryClient.getQueryData<LatestCopilotSuggestion>(key)
      queryClient.setQueryData<LatestCopilotSuggestion>(key, (current) =>
        current?.suggestion?.id === suggestionId
          ? { ...current, suggestion: { ...current.suggestion, replyDecision: 'discarded' } }
          : current,
      )
      return { previous }
    },
    onSuccess: (suggestion) =>
      queryClient.setQueryData<LatestCopilotSuggestion>(key, (current) =>
        current?.suggestion?.id === suggestion.id ? { ...current, suggestion } : current,
      ),
    onError: (_error, _id, context) => {
      if (context) queryClient.setQueryData(key, context.previous)
      toast({
        title: 'No se descartó el borrador',
        description: 'Inténtalo de nuevo en un momento.',
        politeness: 'alert',
      })
    },
  })
}
