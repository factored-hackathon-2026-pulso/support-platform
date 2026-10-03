import { registerCasesRealtime } from '@/features/cases'
import { registerConversationRealtime } from '@/features/conversation'
import { registerSupervisionRealtime } from '@/features/supervision'
import {
  createEnvelopeHandlerRegistry,
  type EnvelopeHandlerRegistry,
  type RealtimeRegistration,
} from '@/lib/realtime'

/**
 * Every feature that turns staff realtime envelopes into cache updates, in one list.
 *
 * This is the single composition point for realtime handlers: a feature exports a
 * `RealtimeRegistration` from its `index.ts` (e.g. `registerCasesRealtime`) and is
 * added here. Registration is explicit (no import side effects), so handlers are in
 * place before the socket connects, whatever lazy screen the user opens first.
 * Keep the registration modules light (query keys + handlers only): this list is
 * part of the main bundle.
 *
 * The customer simulator (/cliente) is not here: it runs its own socket with the
 * customer token and its own registry (`features/customer-chat`), so customer
 * envelopes never reach these handlers and vice versa.
 */
export const FEATURE_REALTIME_REGISTRATIONS: readonly RealtimeRegistration[] = [
  registerCasesRealtime, // case.updated, case.assigned, case.unassigned, inbox.counts, availability.updated → inbox
  registerConversationRealtime, // turn.created, case.updated, case.assigned → open case
  registerSupervisionRealtime, // queue.updated, queue.case_queued, team.updated → team and queues
]

/** Builds a fresh registry with every feature's handlers (one per AppProviders). */
export function createAppEnvelopeHandlers(
  registrations: readonly RealtimeRegistration[] = FEATURE_REALTIME_REGISTRATIONS,
): EnvelopeHandlerRegistry {
  const registry = createEnvelopeHandlerRegistry()
  for (const register of registrations) register(registry)
  return registry
}
