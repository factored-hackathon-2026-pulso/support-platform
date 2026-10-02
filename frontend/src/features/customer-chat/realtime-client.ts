import { realtimeUrl } from '@/lib/config'
import { RealtimeClient, type WebSocketFactory } from '@/lib/realtime'
import { customerSessionToken } from '@/lib/session-token'

/**
 * The simulator's own socket: authenticates with the customer token and drops it
 * when the server rejects it (back to the picker). Tests pass a fake `createSocket`.
 */
export function createCustomerRealtimeClient(createSocket?: WebSocketFactory): RealtimeClient {
  return new RealtimeClient({
    url: (token) => realtimeUrl(token),
    getToken: customerSessionToken.get,
    onAuthError: customerSessionToken.clear,
    ...(createSocket ? { createSocket } : {}),
  })
}
