import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { useOnReconnect } from '@/lib/realtime'
import { fetchHome, homeKeys } from '../api'
import type { AnalystHome } from '../types'

/**
 * Safety net for what no envelope reaches an analyst with (other analysts'
 * availability, the queues): the home refetches every minute while on screen.
 */
export const HOME_REFETCH_MS = 60_000

/** GET /me/home, refreshed by her envelopes (realtime.ts), every 60 s and after a reconnect. */
export function useHome(): UseQueryResult<AnalystHome, ApiProblem> {
  const queryClient = useQueryClient()
  useOnReconnect(() => void queryClient.invalidateQueries({ queryKey: homeKeys.all }))
  return useQuery<AnalystHome, ApiProblem>({
    queryKey: homeKeys.me(),
    queryFn: ({ signal }) => fetchHome(signal),
    refetchInterval: HOME_REFETCH_MS,
  })
}
