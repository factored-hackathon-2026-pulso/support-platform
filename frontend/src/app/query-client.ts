import { QueryClient } from '@tanstack/react-query'
import { isApiProblem } from '@/lib/api'

/** Retry only what can succeed on a second try: network failures and 5xx, never 4xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false
  if (isApiProblem(error)) return error.status === 0 || error.status >= 500
  return true
}

/**
 * TanStack Query defaults:
 * - data stays fresh 30 s; the realtime channel pushes changes into the cache,
 * - up to two retries for transient failures (none in tests, none for mutations),
 * - no refetch on window focus (avoids flicker while an analyst types).
 */
export function createQueryClient(): QueryClient {
  const isTest = import.meta.env.MODE === 'test'
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: isTest ? false : shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export const queryClient = createQueryClient()
