/**
 * Runtime configuration read from Vite env variables (see .env.example).
 * Everything that knows the backend location goes through here.
 */

const DEFAULT_API_URL = 'http://localhost:8000'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Base URL of the API server, without the `/api/v1` prefix. Unset: the local
 * API (`http://localhost:8000`). `/` (or empty): the SPA's own origin, as behind
 * CloudFront, where one domain serves the SPA, `/api/*` and the WebSocket.
 */
export const API_BASE_URL = apiBaseUrl(import.meta.env.VITE_API_URL)

export function apiBaseUrl(configured: string | undefined): string {
  if (configured === undefined) return DEFAULT_API_URL
  return trimTrailingSlash(configured.trim())
}

/**
 * WebSocket URL for the realtime channel (`/api/v1/ws?token=`).
 * http → ws and https → wss, so it follows the API origin (the page's own
 * origin when the API is same-origin).
 */
export function realtimeUrl(
  token: string,
  baseUrl: string = API_BASE_URL,
  pageOrigin: string = globalThis.location?.origin ?? '',
): string {
  const httpBase = trimTrailingSlash(baseUrl) || pageOrigin
  const wsBase = httpBase.replace(/^http/i, 'ws')
  return `${wsBase}/api/v1/ws?token=${encodeURIComponent(token)}`
}
