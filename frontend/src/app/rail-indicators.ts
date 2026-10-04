import { useMemo } from 'react'
import { useLockedAccountsCount } from '@/features/admin/core'
import { useAvailabilityPresence, useToReplyCount } from '@/features/cases/core'
import { useQueuedCasesCount } from '@/features/supervision/core'
import { presenceFor, type RailIndicators, type RailPresence, type RoleId } from './roles'
import { useSession } from './session'

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
  // "Casos, 2 pendientes": her cases Por responder (slice 6 §4.4). Also keeps her
  // `inbox:<id>` topic subscribed on every analyst screen (Inicio and Casos).
  const { user } = useSession()
  const toReply = useToReplyCount({ enabled: role === 'analyst', staffId: user?.id ?? null })
  return useMemo(() => {
    const indicators: RailIndicators = {}
    if (queued) indicators.queuedCases = { count: queued }
    if (locked) indicators.lockedAccounts = { count: locked }
    if (toReply) indicators.toReplyCases = { count: toReply }
    return indicators
  }, [queued, locked, toReply])
}

/** The presence dot on the rail avatar: the analyst's availability (slice 6 §4.4). */
export function useRailPresence(role: RoleId): RailPresence | null {
  const status = useAvailabilityPresence({ enabled: role === 'analyst' })
  return useMemo(() => presenceFor(status), [status])
}
