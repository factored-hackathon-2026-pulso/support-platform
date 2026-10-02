import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeClient } from './client'
import { RealtimeContext } from './context'
import type { EnvelopeHandlerRegistry } from './handlers'

export interface RealtimeProviderProps {
  client: RealtimeClient
  handlers: EnvelopeHandlerRegistry
  /** Connect only while this is a non-empty token; changing it reconnects. */
  token: string | null
  children: ReactNode
}

/**
 * Connects the realtime client while there is a session token and applies every
 * envelope to the TanStack Query cache through the handler registry.
 */
export function RealtimeProvider({ client, handlers, token, children }: RealtimeProviderProps) {
  const queryClient = useQueryClient()

  useEffect(
    () => client.onEnvelope((envelope) => handlers.dispatch(envelope, queryClient)),
    [client, handlers, queryClient],
  )

  useEffect(() => {
    if (!token) return
    client.connect()
    return () => client.disconnect()
  }, [client, token])

  return <RealtimeContext value={client}>{children}</RealtimeContext>
}
