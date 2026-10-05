import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { topics, useOnReconnect, useRealtimeSubscription } from '@/lib/realtime'
import {
  fetchEscalations,
  fetchOpenCases,
  fetchQueueOverview,
  fetchTeamOverview,
  supervisionKeys,
} from '../api'
import type {
  EscalationOverview,
  Language,
  LanguageOpenCases,
  QueueOverview,
  TeamOverview,
} from '../types'

/**
 * Safety net for what no event signals (a session that expires, a missed
 * envelope): the overviews refetch every minute while on screen (slice 3 §2.2).
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
 * GET /supervision/open-cases?language= ("Colas", slice 9): every open case of one
 * language, kept fresh by the queue and team signals (realtime.ts) and every 60 s.
 */
export function useOpenCases(
  language: Language,
  { enabled = true }: { enabled?: boolean } = {},
): UseQueryResult<LanguageOpenCases, ApiProblem> {
  return useQuery<LanguageOpenCases, ApiProblem>({
    queryKey: supervisionKeys.openCasesOf(language),
    queryFn: ({ signal }) => fetchOpenCases(language, signal),
    refetchInterval: OVERVIEW_REFETCH_MS,
    enabled,
  })
}

/** GET /supervision/escalations ("Escalados", slice 9), kept fresh by `escalation.updated`. */
export function useEscalationOverview({
  enabled = true,
}: { enabled?: boolean } = {}): UseQueryResult<EscalationOverview, ApiProblem> {
  return useQuery<EscalationOverview, ApiProblem>({
    queryKey: supervisionKeys.escalations(),
    queryFn: ({ signal }) => fetchEscalations(signal),
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
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
  }, enabled)
}

/**
 * The rail badge of "Colas" (slice 9): how many open cases nobody holds yet (they wait
 * in the language queues). Fetches and subscribes to `supervision:queues` only while
 * `enabled` (the Supervisión role is the visible one); otherwise `undefined`.
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
 * The rail badge of "Escalados" (slice 9): the open escalations. Subscribes to
 * `supervision:escalations` only while `enabled`.
 */
export function useOpenEscalationsCount({ enabled }: { enabled: boolean }): number | undefined {
  useRealtimeSubscription(enabled ? topics.supervisionEscalations() : null)
  useRefetchOnReconnect([supervisionKeys.escalations()], enabled)
  const query = useQuery<EscalationOverview, ApiProblem, number>({
    queryKey: supervisionKeys.escalations(),
    queryFn: ({ signal }) => fetchEscalations(signal),
    refetchInterval: OVERVIEW_REFETCH_MS,
    select: (overview) => overview.openCount,
    enabled,
  })
  return enabled ? query.data : undefined
}

/**
 * Live wiring of a supervision screen: the team and queue topics while mounted (the
 * escalations topic is kept by the rail badge), and a refetch of every supervision
 * cache after a reconnect.
 */
export function useSupervisionLive(): void {
  useRealtimeSubscription(topics.supervisionTeam())
  useRealtimeSubscription(topics.supervisionQueues())
  useRealtimeSubscription(topics.supervisionEscalations())
  useRefetchOnReconnect([supervisionKeys.all])
}
