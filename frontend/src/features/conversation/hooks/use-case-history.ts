import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { conversationKeys, fetchCaseHistory } from '../api'
import type { CaseHistory } from '../types'

/**
 * GET /cases/{caseId}/history ("Casos anteriores de este cliente"). Loaded only
 * while the sheet shows its list (`enabled`). Past cases do not change, so no
 * realtime: a new close shows up the next time the sheet opens.
 */
export function useCaseHistory(
  caseId: string,
  enabled = true,
): UseQueryResult<CaseHistory, ApiProblem> {
  return useQuery<CaseHistory, ApiProblem>({
    queryKey: conversationKeys.history(caseId),
    queryFn: ({ signal }) => fetchCaseHistory(caseId, signal),
    enabled,
  })
}
