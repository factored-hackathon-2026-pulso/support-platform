import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { conversationKeys, fetchCaseDetail } from '../api'
import type { CaseDetail } from '../types'

/**
 * GET /cases/{caseId} (header, customer, "Cómo llegó a ti", closure,
 * capabilities). Shared by the conversation and the "Casos anteriores" sheet
 * through one cache entry; `case.updated` envelopes keep it fresh (realtime.ts).
 * `null` = no case selected.
 */
export function useCaseDetail(caseId: string | null): UseQueryResult<CaseDetail, ApiProblem> {
  return useQuery<CaseDetail, ApiProblem>({
    queryKey: conversationKeys.detail(caseId ?? ''),
    queryFn: ({ signal }) => fetchCaseDetail(caseId ?? '', signal),
    enabled: caseId !== null,
  })
}
