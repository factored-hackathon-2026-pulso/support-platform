/**
 * Runtime configuration read from Vite env variables (see .env.example).
 * Everything that knows the backend location goes through here.
 */

const DEFAULT_API_URL = 'http://localhost:8000'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Base URL of the API server, without the `/api/v1` prefix. */
export const API_BASE_URL = trimTrailingSlash(import.meta.env.VITE_API_URL || DEFAULT_API_URL)

/**
 * WebSocket URL for the realtime channel (`/api/v1/ws?token=`).
 * http → ws and https → wss, so it follows the API origin.
 */
export function realtimeUrl(token: string, baseUrl: string = API_BASE_URL): string {
  const wsBase = trimTrailingSlash(baseUrl).replace(/^http/i, 'ws')
  return `${wsBase}/api/v1/ws?token=${encodeURIComponent(token)}`
}
