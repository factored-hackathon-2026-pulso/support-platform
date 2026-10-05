import { useCallback } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useAiEnabled } from '@/app/platform'
import { useCurrentUser } from '@/app/session'
import type { ApiProblem } from '@/lib/api'
import { askCopilot, copilotKeys, copilotMutationKeys, fetchCopilotThread } from '../api'
import { describeAskFailure, mergeExchange, removeAsk, upsertAsk } from '../model'
import type { CopilotAsk, CopilotThread } from '../types'

/** The slice of the case the copilot needs to know whether it may be asked. */
export interface CopilotCase {
  id: string
  assignedAnalystId: string | null
}

/**
 * Whether the copilot may be read for this case: AI on, and she is its assignee (slice 15: anyone
 * else is `403`). Its availability for the customer comes from the API (`available`).
 */
export function useCopilotAccess(summary: CopilotCase | undefined): boolean {
  const me = useCurrentUser()
  const aiEnabled = useAiEnabled()
  return aiEnabled && summary !== undefined && summary.assignedAnalystId === me.id
}

/** GET /cases/{id}/copilot: her thread with the copilot. `available: false` hides it. */
export function useCopilotThread(
  caseId: string,
  enabled: boolean,
): UseQueryResult<CopilotThread, ApiProblem> {
  return useQuery<CopilotThread, ApiProblem>({
    queryKey: copilotKeys.thread(caseId),
    queryFn: ({ signal }) => fetchCopilotThread(caseId, signal),
    enabled,
    retry: (failures, error) => failures < 1 && (error.status >= 500 || error.status === 0),
  })
}

/**
 * Her questions in flight or failed (UI-only cache entry, never fetched): kept in the query
 * cache so a question survives switching tabs or closing the panel while the copilot answers.
 */
export function useCopilotAsks(caseId: string): CopilotAsk[] {
  const queryClient = useQueryClient()
  const key = copilotKeys.asks(caseId)
  const { data } = useQuery<CopilotAsk[]>({
    queryKey: key,
    // Never a request: whatever is in the cache (a refetch must not lose a question).
    queryFn: () => queryClient.getQueryData<CopilotAsk[]>(key) ?? [],
    initialData: [],
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return data
}

function setAsks(
  queryClient: QueryClient,
  caseId: string,
  update: (asks: CopilotAsk[]) => CopilotAsk[],
): void {
  queryClient.setQueryData<CopilotAsk[]>(copilotKeys.asks(caseId), (current) =>
    update(current ?? []),
  )
}

interface AskInput {
  text: string
  clientMessageId: string
}

/**
 * Ask the copilot (slice 15 §2): the question shows at once with "Buscando la respuesta"; the
 * answer goes into the thread, or the question turns failed with "Reintentar", which re-posts the
 * **same** `clientMessageId` (the platform asks again only if the first call got no answer).
 * Questions of one case run one after another (`scope`): the backend answers one at a time.
 */
export function useAskCopilot(caseId: string) {
  const queryClient = useQueryClient()
  const { mutate } = useMutation<unknown, ApiProblem, AskInput>({
    mutationKey: copilotMutationKeys.ask(caseId),
    scope: { id: `copilot-ask:${caseId}` },
    mutationFn: async (input) => {
      try {
        const exchange = await askCopilot(caseId, input)
        queryClient.setQueryData<CopilotThread>(copilotKeys.thread(caseId), (thread) =>
          thread ? mergeExchange(thread, exchange) : thread,
        )
        setAsks(queryClient, caseId, (asks) => removeAsk(asks, input.clientMessageId))
      } catch (error) {
        const failure = describeAskFailure(error)
        setAsks(queryClient, caseId, (asks) =>
          asks.map((ask) =>
            ask.clientMessageId === input.clientMessageId
              ? { ...ask, status: 'failed', error: failure.message, retryable: failure.retryable }
              : ask,
          ),
        )
        throw error
      }
    },
  })

  const ask = useCallback(
    (text: string) => {
      const clientMessageId = crypto.randomUUID()
      setAsks(queryClient, caseId, (asks) =>
        upsertAsk(asks, {
          clientMessageId,
          text,
          createdAt: new Date().toISOString(),
          status: 'asking',
          error: null,
          retryable: true,
        }),
      )
      mutate({ text, clientMessageId })
    },
    [caseId, mutate, queryClient],
  )

  const retry = useCallback(
    (clientMessageId: string) => {
      const current = queryClient
        .getQueryData<CopilotAsk[]>(copilotKeys.asks(caseId))
        ?.find((item) => item.clientMessageId === clientMessageId)
      if (!current) return
      setAsks(queryClient, caseId, (asks) =>
        upsertAsk(asks, { ...current, status: 'asking', error: null }),
      )
      mutate({ text: current.text, clientMessageId })
    },
    [caseId, mutate, queryClient],
  )

  return { ask, retry }
}
