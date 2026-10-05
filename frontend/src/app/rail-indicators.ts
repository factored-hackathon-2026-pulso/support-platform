import { useMemo } from 'react'
import { useActiveLocale } from '@/lib/i18n'
import { useLockedAccountsCount } from '@/features/admin/core'
import { useAvailabilityPresence, useToReplyCount } from '@/features/cases/core'
import { agentProposalCount, useAiStages } from '@/features/copilot/core'
import { useOpenEscalationsCount, useQueuedCasesCount } from '@/features/supervision/core'
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
  // "Colas, 3 sin asignar": open cases nobody holds yet (slice 9; slice 3 §8.1).
  const queued = useQueuedCasesCount({ enabled: role === 'supervisor' })
  // "Escalados, 2 abiertos": open escalations to supervision (slice 9).
  const escalations = useOpenEscalationsCount({ enabled: role === 'supervisor' })
  // "Usuarios y roles, 1 pendiente": accounts locked now (slice 4 §10.1).
  const locked = useLockedAccountsCount({ enabled: role === 'admin' })
  // "Casos, 2 pendientes": her cases Por responder (slice 6 §4.4). Also keeps her
  // `inbox:<id>` topic subscribed on every analyst screen (Inicio and Casos).
  const { user } = useSession()
  const toReply = useToReplyCount({ enabled: role === 'analyst', staffId: user?.id ?? null })
  // "Automatización, con novedades": a case type is ready for an agent (slice 22). The stages
  // are read only while AI is on (the item is hidden otherwise).
  const stages = useAiStages({ enabled: role === 'supervisor' })
  const proposals = agentProposalCount(stages.data)
  return useMemo(() => {
    const indicators: RailIndicators = {}
    if (queued) indicators.queuedCases = { count: queued, noun: 'queued' }
    if (escalations) indicators.openEscalations = { count: escalations, noun: 'escalations' }
    if (locked) indicators.lockedAccounts = { count: locked }
    if (toReply) indicators.toReplyCases = { count: toReply }
    if (proposals) indicators.agentProposals = { dot: true }
    return indicators
  }, [queued, escalations, locked, toReply, proposals])
}

/** The presence dot on the rail avatar: the analyst's availability (slice 6 §4.4). */
export function useRailPresence(role: RoleId): RailPresence | null {
  const status = useAvailabilityPresence({ enabled: role === 'analyst' })
  const locale = useActiveLocale() // the dot's label follows the UI language
  return useMemo(() => presenceFor(status, locale), [status, locale])
}
