import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { caseKeys, fetchInbox, type InboxParams } from '../api'
import type { InboxResponse } from '../types'

/**
 * GET /cases/inbox for a filter + search. `counts` always cover the whole inbox,
 * so switching filters keeps the previous page on screen (no skeleton flash)
 * while the next one loads. Realtime handlers keep it fresh (realtime.ts).
 */
export function useInbox({ status, q }: InboxParams): UseQueryResult<InboxResponse, ApiProblem> {
  return useQuery<InboxResponse, ApiProblem>({
    queryKey: caseKeys.inbox({ status, q }),
    queryFn: ({ signal }) => fetchInbox({ status, q }, signal),
    placeholderData: keepPreviousData,
  })
}
