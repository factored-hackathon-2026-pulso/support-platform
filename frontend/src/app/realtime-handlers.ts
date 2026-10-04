import { registerAdminRealtime } from '@/features/admin/core'
import { registerCasesRealtime } from '@/features/cases/core'
import { registerConversationRealtime } from '@/features/conversation/core'
import { registerHomeRealtime } from '@/features/home/core'
import { registerSupervisionRealtime } from '@/features/supervision/core'
import {
  createEnvelopeHandlerRegistry,
  type EnvelopeHandlerRegistry,
  type RealtimeRegistration,
} from '@/lib/realtime'
import { registerSessionRealtime } from './session-realtime'

/**
 * Every feature that turns staff realtime envelopes into cache updates, in one list.
 *
 * This is the single composition point for realtime handlers: a feature exports a
 * `RealtimeRegistration` from its `core.ts` (e.g. `registerCasesRealtime`) and is
 * added here. Registration is explicit (no import side effects), so handlers are in
 * place before the socket connects, whatever lazy screen the user opens first.
 * This list is part of the main bundle, so it imports `core.ts`, never a feature's
 * `index.ts` (which re-exports the screens); architecture.test.ts enforces both.
 *
 * The customer simulator (/cliente) is not here: it runs its own socket with the
 * customer token and its own registry (`features/customer-chat`), so customer
 * envelopes never reach these handlers and vice versa.
 */
export const FEATURE_REALTIME_REGISTRATIONS: readonly RealtimeRegistration[] = [
  registerCasesRealtime, // case.updated, case.assigned, case.unassigned, inbox.counts, availability.updated → inbox
  registerConversationRealtime, // turn.created, case.updated, case.assigned → open case
  registerHomeRealtime, // her inbox, availability and queue signals → "Inicio" (throttled refetch)
  registerSupervisionRealtime, // queue.updated, queue.case_queued, team.updated → team and queues
  registerAdminRealtime, // directory.updated → users and teams
  registerSessionRealtime, // me.updated → the signed-in staff member (roles, team, name)
]

/** Builds a fresh registry with every feature's handlers (one per AppProviders). */
export function createAppEnvelopeHandlers(
  registrations: readonly RealtimeRegistration[] = FEATURE_REALTIME_REGISTRATIONS,
): EnvelopeHandlerRegistry {
  const registry = createEnvelopeHandlerRegistry()
  for (const register of registrations) register(registry)
  return registry
}
