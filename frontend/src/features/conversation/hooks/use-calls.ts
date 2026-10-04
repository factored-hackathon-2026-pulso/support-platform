import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { applyCaseSummaryToInboxes } from '@/features/cases/core'
import type { ApiProblem } from '@/lib/api'
import {
  commandCall,
  conversationKeys,
  conversationMutationKeys,
  fetchCalls,
  muteCall,
  startCall,
  type CallCommand,
} from '../api'
import { applyCallToDetail, upsertCall } from '../channels'
import { applySummary } from '../model'
import type { Call, CallList, CallResponse, CaseDetail } from '../types'

/**
 * A call that changed (a command's answer; `call.updated` does the same in realtime.ts) → the
 * calls list and the detail's active call. Idempotent: only a newer version replaces it.
 */
export function storeCall(queryClient: QueryClient, call: Call): void {
  queryClient.setQueryData<CallList>(conversationKeys.calls(call.caseId), (list) =>
    list ? upsertCall(list, call) : list,
  )
  queryClient.setQueryData<CaseDetail>(conversationKeys.detail(call.caseId), (detail) =>
    detail ? applyCallToDetail(detail, call) : detail,
  )
}

/**
 * A command's answer: the call, then the case (status, `activeCallId`, first response). Holding,
 * resuming and hanging up also wrote a system line: the transcript catches up. A call that
 * started or ended changes what the analyst may do (call, close): the detail refetches then.
 */
export function storeCallResult(queryClient: QueryClient, result: CallResponse): void {
  const caseId = result.call.caseId
  const before = queryClient.getQueryData<CaseDetail>(conversationKeys.detail(caseId))
  storeCall(queryClient, result.call)
  queryClient.setQueryData<CaseDetail>(conversationKeys.detail(caseId), (detail) =>
    detail ? applySummary(detail, result.case) : detail,
  )
  applyCaseSummaryToInboxes(queryClient, result.case)
  void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(caseId), exact: true })
  if ((before?.case.activeCallId ?? null) !== (result.case.activeCallId ?? null)) {
    void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(caseId), exact: true })
  }
}

/** GET /cases/{caseId}/calls (most recent first), only where a call matters. */
export function useCaseCalls(caseId: string, enabled: boolean) {
  return useQuery<CallList, ApiProblem>({
    queryKey: conversationKeys.calls(caseId),
    queryFn: ({ signal }) => fetchCalls(caseId, signal),
    enabled,
  })
}

export type CallAction = CallCommand | { muted: boolean }

/** "Contestar", "Poner en espera", "Retomar", "Silenciar", "Colgar" on one call. */
export function useCallCommand(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<CallResponse, ApiProblem, { callId: string; action: CallAction }>({
    mutationKey: conversationMutationKeys.call(caseId),
    scope: { id: `call:${caseId}` },
    mutationFn: ({ callId, action }) =>
      typeof action === 'string'
        ? commandCall(caseId, callId, action)
        : muteCall(caseId, callId, action.muted),
    onSuccess: (result) => storeCallResult(queryClient, result),
  })
}

/** "Llamar al cliente": one `Idempotency-Key` per open dialog (`key`). */
export function useStartCall(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation<CallResponse, ApiProblem, { reason: string; key: string }>({
    mutationKey: conversationMutationKeys.call(caseId),
    mutationFn: ({ reason, key }) => startCall(caseId, reason, key),
    onSuccess: (result) => {
      queryClient.setQueryData<CallList>(conversationKeys.calls(caseId), (list) =>
        upsertCall(list, result.call),
      )
      storeCallResult(queryClient, result)
    },
  })
}
