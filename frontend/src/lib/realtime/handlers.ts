/**
 * Envelope → TanStack Query cache bridge.
 *
 * Features register one handler per event type they care about, e.g.
 * `turn.created` appends the turn to the case conversation query; `case.updated`
 * patches the case list. The registry is the only place that maps server events
 * to cache keys, so components never deal with WebSocket messages.
 *
 * There is no module-level registry: the app builds one at its composition root
 * (`app/realtime-handlers.ts`) by calling every feature's `RealtimeRegistration`
 * explicitly, before the socket connects. Handlers therefore exist whatever
 * screen (lazy route chunk) the user opened first, and tests build their own.
 *
 * Handlers must be idempotent: after a reconnect the same envelope id can
 * arrive twice.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { RealtimeEnvelope, RealtimeEventType } from './types'

export type EnvelopeHandler = (envelope: RealtimeEnvelope, queryClient: QueryClient) => void

export interface EnvelopeHandlerRegistry {
  /** Adds a handler for an event type. Returns a function that removes it. */
  register(type: RealtimeEventType, handler: EnvelopeHandler): () => void
  /** Runs every handler registered for `envelope.type`. Returns how many ran. */
  dispatch(envelope: RealtimeEnvelope, queryClient: QueryClient): number
}

/**
 * What a feature exports (from its `index.ts`) to plug its handlers in:
 * `export const registerCasesRealtime: RealtimeRegistration = (registry) => { … }`.
 */
export type RealtimeRegistration = (registry: EnvelopeHandlerRegistry) => void

export function createEnvelopeHandlerRegistry(): EnvelopeHandlerRegistry {
  const handlers = new Map<string, Set<EnvelopeHandler>>()
  return {
    register(type, handler) {
      const set = handlers.get(type) ?? new Set<EnvelopeHandler>()
      set.add(handler)
      handlers.set(type, set)
      return () => {
        set.delete(handler)
        if (set.size === 0) handlers.delete(type)
      }
    },
    dispatch(envelope, queryClient) {
      const set = handlers.get(envelope.type)
      if (!set) return 0
      for (const handler of set) {
        try {
          handler(envelope, queryClient)
        } catch (error) {
          // One broken handler must not stop the others nor the socket.
          console.error(`[realtime] handler for "${envelope.type}" failed`, error)
        }
      }
      return set.size
    },
  }
}
