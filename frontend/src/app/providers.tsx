import { useState, type ReactNode } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import { RealtimeProvider, type EnvelopeHandlerRegistry, type RealtimeClient } from '@/lib/realtime'
import { queryClient as defaultQueryClient } from './query-client'
import { realtimeClient as defaultRealtimeClient } from './realtime'
import { createAppEnvelopeHandlers } from './realtime-handlers'
import { SessionProvider, useSession, useSessionToken } from './session'
import { SessionLiveSync } from './session-live'

export interface AppProvidersProps {
  children: ReactNode
  /** Inject a fresh client in tests. */
  queryClient?: QueryClient
  /** Inject a client with a fake socket in tests. */
  realtimeClient?: RealtimeClient
  /** Envelope → cache handlers. Default: every feature's (app/realtime-handlers.ts). */
  envelopeHandlers?: EnvelopeHandlerRegistry
}

/** Connects the realtime socket only while the session is authenticated. */
function SessionRealtime({
  client,
  handlers,
  children,
}: {
  client: RealtimeClient
  handlers: EnvelopeHandlerRegistry
  children: ReactNode
}) {
  const { status } = useSession()
  const token = useSessionToken()
  return (
    <RealtimeProvider
      client={client}
      handlers={handlers}
      token={status === 'authenticated' ? token : null}
    >
      {children}
    </RealtimeProvider>
  )
}

/** Global providers. The router sits inside them (see main.tsx). */
export function AppProviders({
  children,
  queryClient = defaultQueryClient,
  realtimeClient = defaultRealtimeClient,
  envelopeHandlers,
}: AppProvidersProps) {
  // Built once per provider tree (never a module singleton), before the socket connects.
  const [handlers] = useState(() => envelopeHandlers ?? createAppEnvelopeHandlers())
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <SessionRealtime client={realtimeClient} handlers={handlers}>
          <ToastProvider>
            <SessionLiveSync />
            {children}
          </ToastProvider>
        </SessionRealtime>
      </SessionProvider>
    </QueryClientProvider>
  )
}
