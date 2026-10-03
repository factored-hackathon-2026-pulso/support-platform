import { use, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
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

/**
 * Runs `callback` when the socket comes back from `reconnecting` to `open`:
 * envelopes may have been missed while it was down, so callers refetch what the
 * missed events would have patched. The latest `callback` is used (no need to
 * memoize it); nothing runs while `enabled` is false.
 */
export function useOnReconnect(callback: () => void, enabled = true): void {
  const status = useRealtimeStatus()
  const previous = useRef(status)
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })
  useEffect(() => {
    if (enabled && previous.current === 'reconnecting' && status === 'open') latest.current()
    previous.current = status
  }, [status, enabled])
}
