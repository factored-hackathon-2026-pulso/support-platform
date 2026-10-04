import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { applyCaseSummaryToInboxes } from '@/features/cases'
import { conversationKeys } from '@/features/conversation'
import type { ApiProblem } from '@/lib/api'
import {
  fetchLastTurns,
  respondEscalation,
  supervisionKeys,
  supervisionMutationKeys,
  takeEscalatedCase,
} from '../api'
import type { EscalationResult, TurnPage } from '../types'

/** How many of the latest messages the "Escalados" panel shows. */
export const LAST_TURNS_LIMIT = 6

/** The latest messages of a case for the "Escalados" panel (read-only, staff view). */
export function useLastTurns(caseId: string | null): UseQueryResult<TurnPage, ApiProblem> {
  return useQuery<TurnPage, ApiProblem>({
    queryKey: supervisionKeys.lastTurns(caseId ?? ''),
    queryFn: ({ signal }) => fetchLastTurns(caseId ?? '', LAST_TURNS_LIMIT, signal),
    enabled: caseId !== null,
  })
}

/** After answering or taking: the list, the case (detail, transcript) and the team move. */
function useAfterEscalationAction() {
  const queryClient = useQueryClient()
  return (result: EscalationResult) => {
    applyCaseSummaryToInboxes(queryClient, result.case)
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.escalations() })
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.lastTurns(result.case.id) })
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.team() })
    void queryClient.invalidateQueries({ queryKey: supervisionKeys.openCases() })
    void queryClient.invalidateQueries({ queryKey: conversationKeys.detail(result.case.id) })
    void queryClient.invalidateQueries({ queryKey: conversationKeys.turns(result.case.id) })
  }
}

/** POST /supervision/escalations/{id}/response (a required note). */
export function useRespondEscalation(escalationId: string) {
  const after = useAfterEscalationAction()
  return useMutation<EscalationResult, ApiProblem, string>({
    mutationKey: supervisionMutationKeys.respond(escalationId),
    mutationFn: (note) => respondEscalation(escalationId, note),
    onSuccess: after,
  })
}

/** POST /supervision/escalations/{id}/take (a supervisor who also holds Analista). */
export function useTakeEscalatedCase(escalationId: string) {
  const after = useAfterEscalationAction()
  return useMutation<EscalationResult, ApiProblem, void>({
    mutationKey: supervisionMutationKeys.take(escalationId),
    mutationFn: () => takeEscalatedCase(escalationId),
    onSuccess: after,
  })
}
