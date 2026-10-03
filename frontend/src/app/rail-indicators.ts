import { useMemo } from 'react'
import { useLockedAccountsCount } from '@/features/admin/core'
import { useQueuedCasesCount } from '@/features/supervision/core'
import type { RailIndicators, RoleId } from './roles'

/**
 * Live badges and dots of the rail for the current role.
 *
 * Composition point between the rail (components/layout) and the features that
 * own the numbers. Each feature exposes a count hook from its `core.ts` (never
 * its `index.ts`: the rail is always loaded and must not pull in the screens),
 * kept fresh by its realtime handlers, and this hook maps it to a `RailIndicatorKey`.
 * Every feature hook is called unconditionally with `enabled: role === '…'`, so
 * only the visible role fetches (Felipe in the analyst role fetches nothing).
 *
 * No count means no badge: the rail never shows a made-up number.
 */
export function useRailIndicators(role: RoleId): RailIndicators {
  // "Equipo y colas, 3 pendientes": cases waiting in the language queues (slice 3 §8.1).
  const queued = useQueuedCasesCount({ enabled: role === 'supervisor' })
  // "Usuarios y roles, 1 pendiente": accounts locked now (slice 4 §10.1).
  const locked = useLockedAccountsCount({ enabled: role === 'admin' })
  return useMemo(() => {
    const indicators: RailIndicators = {}
    if (queued) indicators.queuedCases = { count: queued }
    if (locked) indicators.lockedAccounts = { count: locked }
    return indicators
  }, [queued, locked])
}
