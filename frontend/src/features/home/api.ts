/**
 * Home calls (docs/platform/api/slice-6-analyst-home.md §3): the analyst home.
 * The only module of the feature that talks to the API client; tests mock it
 * with `vi.mock('@/features/home/api')`. The inbox and the availability come
 * from the cases feature (same caches as "Casos").
 */
import { api, unwrap } from '@/lib/api'
import type { AnalystHome } from './types'

/** Query keys. */
export const homeKeys = {
  all: ['home'] as const,
  me: () => ['home', 'me'] as const,
}

/** GET /me/home: activity since her previous session and her team's queues now. */
export async function fetchHome(signal?: AbortSignal): Promise<AnalystHome> {
  return unwrap(api.GET('/api/v1/me/home', { signal }))
}
