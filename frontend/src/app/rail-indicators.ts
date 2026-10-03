import { useMemo } from 'react'
import { useQueuedCasesCount } from '@/features/supervision'
import type { RailIndicators, RoleId } from './roles'

/**
 * Live badges and dots of the rail for the current role.
 *
 * Composition point between the rail (components/layout) and the features that
 * own the numbers. Each feature exposes a count hook from its `index.ts`, kept
 * fresh by its realtime handlers, and this hook maps it to a `RailIndicatorKey`.
 * Every feature hook is called unconditionally with `enabled: role === '…'`, so
 * only the visible role fetches (Felipe in the analyst role fetches nothing).
 *
 * No count means no badge: the rail never shows a made-up number.
 */
export function useRailIndicators(role: RoleId): RailIndicators {
  // "Equipo y colas, 3 pendientes": cases waiting in the language queues (slice 3 §8.1).
  const queued = useQueuedCasesCount({ enabled: role === 'supervisor' })
  return useMemo(() => (queued ? { queuedCases: { count: queued } } : {}), [queued])
}
