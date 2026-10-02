import {
  createEnvelopeHandlerRegistry,
  type EnvelopeHandlerRegistry,
  type RealtimeRegistration,
} from '@/lib/realtime'

/**
 * Every feature that turns realtime envelopes into cache updates, in one list.
 *
 * This is the single composition point for realtime handlers: a feature exports a
 * `RealtimeRegistration` from its `index.ts` (e.g. `registerCasesRealtime`) and is
 * added here. Registration is explicit (no import side effects), so handlers are in
 * place before the socket connects, whatever lazy screen the user opens first.
 * Keep the registration modules light (query keys + handlers only): this list is
 * part of the main bundle.
 */
export const FEATURE_REALTIME_REGISTRATIONS: readonly RealtimeRegistration[] = [
  // registerCasesRealtime, (slice 1: turn.created, case.updated, case.assigned)
]

/** Builds a fresh registry with every feature's handlers (one per AppProviders). */
export function createAppEnvelopeHandlers(
  registrations: readonly RealtimeRegistration[] = FEATURE_REALTIME_REGISTRATIONS,
): EnvelopeHandlerRegistry {
  const registry = createEnvelopeHandlerRegistry()
  for (const register of registrations) register(registry)
  return registry
}
