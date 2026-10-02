import { realtimeUrl } from '@/lib/config'
import { RealtimeClient, type WebSocketFactory } from '@/lib/realtime'
import { sessionToken } from '@/lib/session-token'

/**
 * The app's realtime client: authenticates with the session token and ends the
 * session when the server rejects it. Tests pass a fake `createSocket`.
 */
export function createAppRealtimeClient(createSocket?: WebSocketFactory): RealtimeClient {
  return new RealtimeClient({
    url: (token) => realtimeUrl(token),
    getToken: sessionToken.get,
    onAuthError: sessionToken.clear,
    ...(createSocket ? { createSocket } : {}),
  })
}

export const realtimeClient = createAppRealtimeClient()
