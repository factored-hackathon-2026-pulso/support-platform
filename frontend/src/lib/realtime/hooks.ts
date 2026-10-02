import { use, useCallback, useEffect, useSyncExternalStore } from 'react'
import type { RealtimeClient } from './client'
import { RealtimeContext } from './context'
import type { ConnectionStatus, RealtimeTopic } from './types'

export function useRealtimeClient(): RealtimeClient {
  const client = use(RealtimeContext)
  if (!client) throw new Error('useRealtimeClient debe usarse dentro de <RealtimeProvider>.')
  return client
}

/** Subscribe to a topic while mounted. Pass `null` to skip (e.g. no case selected). */
export function useRealtimeSubscription(topic: RealtimeTopic | null): void {
  const client = useRealtimeClient()
  useEffect(() => {
    if (!topic) return
    return client.subscribe(topic)
  }, [client, topic])
}

/** Connection state, e.g. to show "Reconectando…" in the Workspace. */
export function useRealtimeStatus(): ConnectionStatus {
  const client = useRealtimeClient()
  const subscribe = useCallback((onChange: () => void) => client.onStatusChange(onChange), [client])
  return useSyncExternalStore(subscribe, () => client.getStatus())
}
