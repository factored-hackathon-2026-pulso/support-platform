import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import { fetchQueueOverview, fetchTeamOverview, supervisionKeys } from '../api'
import type { QueueOverview, TeamOverview } from '../types'

/**
 * Safety net for what no event signals (a session that expires, a missed
 * envelope): the overviews refetch every minute while on screen (contract §2.2).
 */
export const OVERVIEW_REFETCH_MS = 60_000

/** GET /supervision/team, kept fresh by `team.updated` (realtime.ts) and every 60 s. */
export function useTeamOverview({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<
  TeamOverview,
  ApiProblem
> {
  return useQuery<TeamOverview, ApiProblem>({
    queryKey: supervisionKeys.team(),
    queryFn: ({ signal }) => fetchTeamOverview(signal),
    refetchInterval: OVERVIEW_REFETCH_MS,
    enabled,
  })
}

/** GET /supervision/queues, kept fresh by `queue.updated` / `queue.case_queued` and every 60 s. */
export function useQueueOverview({ enabled = true }: { enabled?: boolean } = {}): UseQueryResult<
  QueueOverview,
  ApiProblem
> {
  return useQuery<QueueOverview, ApiProblem>({
    queryKey: supervisionKeys.queues(),
    queryFn: ({ signal }) => fetchQueueOverview(signal),
    refetchInterval: OVERVIEW_REFETCH_MS,
    enabled,
  })
}

/**
 * Refetches the given supervision caches when the socket comes back from
 * `reconnecting`: envelopes may have been missed while it was down.
 */
export function useRefetchOnReconnect(keys: readonly (readonly unknown[])[], enabled = true): void {
  const queryClient = useQueryClient()
  useOnReconnect(() => {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey, exact: true })
  }, enabled)
}

/**
 * The rail badge of "Equipo y colas" (contract §8.1, §8.7): how many cases wait
 * in the language queues. Fetches and subscribes to `supervision:queues` only
 * while `enabled` (the Supervisora role is the visible one); otherwise
 * `undefined` and no request.
 */
export function useQueuedCasesCount({ enabled }: { enabled: boolean }): number | undefined {
  useRealtimeSubscription(enabled ? topics.supervisionQueues() : null)
  useRefetchOnReconnect([supervisionKeys.queues()], enabled)
  const query = useQuery<QueueOverview, ApiProblem, number>({
    queryKey: supervisionKeys.queues(),
    queryFn: ({ signal }) => fetchQueueOverview(signal),
    refetchInterval: OVERVIEW_REFETCH_MS,
    select: (overview) => overview.counts.total,
    enabled,
  })
  return enabled ? query.data : undefined
}

/**
 * Live wiring of the team screen: both supervision topics while mounted, and a
 * refetch of both overviews after a reconnect.
 */
export function useSupervisionLive(): void {
  useRealtimeSubscription(topics.supervisionTeam())
  useRealtimeSubscription(topics.supervisionQueues())
  useRefetchOnReconnect([supervisionKeys.team(), supervisionKeys.queues()])
}
