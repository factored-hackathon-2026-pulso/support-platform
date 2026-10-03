import type { RailIndicators, RoleId } from './roles'

/** Nothing to show: no feature feeds an indicator yet. */
const NO_INDICATORS: RailIndicators = Object.freeze({})

/**
 * Live badges and dots of the rail for the current role.
 *
 * Composition point between the rail (components/layout) and the features that
 * own the numbers. Each feature exposes a count hook from its `index.ts` (e.g.
 * `useQueuedCasesCount({ enabled })` in supervision (slice 3), kept fresh by its realtime
 * handlers) and this hook maps it to a `RailIndicatorKey`. Call every feature hook
 * unconditionally and pass `enabled: role === '…'` so only the visible role fetches.
 *
 * Until a feature exists its key is simply absent: the rail shows no badge rather
 * than a made-up number.
 */
export function useRailIndicators(_role: RoleId): RailIndicators {
  return NO_INDICATORS
}
