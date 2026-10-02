/**
 * THE boundary between the SPA and the platform API.
 *
 * - Only this module imports `openapi-fetch` and the OpenAPI types, which are
 *   generated from `backend/openapi.json` by `pnpm gen:api` (`pnpm check:api`
 *   fails when they are stale).
 * - Attaches `Authorization: Bearer <token>` from the session token store.
 * - A 401 on an authenticated request clears the session: the route guards then
 *   send the user back to /login.
 * - `unwrap()` turns `{ data, error }` into data or a thrown `ApiProblem`.
 *
 * Features call it from their `api.ts` only (tests mock that module).
 */
import createClient, { type Client, type Middleware } from 'openapi-fetch'
import { API_BASE_URL } from '@/lib/config'
import { sessionToken, type SessionTokenStore } from '@/lib/session-token'
import { ApiProblem } from './problem'
import type { components, paths } from './schema.gen'

/** Schemas of the API contract: `Schemas['StaffOut']`, `Schemas['ProblemDetails']`… */
export type Schemas = components['schemas']
export type ApiPaths = paths
export type ApiClient = Client<paths>

export interface CreateApiClientOptions {
  baseUrl?: string
  tokenStore?: Pick<SessionTokenStore, 'get' | 'clear'>
  /** Custom fetch (tests). */
  fetch?: (input: Request) => Promise<Response>
}

/** Middleware: bearer token + "session expired" handling. */
export function authMiddleware(tokenStore: Pick<SessionTokenStore, 'get' | 'clear'>): Middleware {
  return {
    onRequest({ request }) {
      const token = tokenStore.get()
      if (token) request.headers.set('Authorization', `Bearer ${token}`)
      return request
    },
    onResponse({ request, response }) {
      // Only a rejected *current* token ends the session: a 401 from /auth/login is a
      // wrong password, and a late 401 for an old token must not log out a new session.
      const sent = request.headers.get('Authorization')
      const current = tokenStore.get()
      if (response.status === 401 && sent && current && sent === `Bearer ${current}`) {
        tokenStore.clear()
      }
      return response
    },
  }
}

export function createApiClient({
  baseUrl = API_BASE_URL,
  tokenStore = sessionToken,
  fetch,
}: CreateApiClientOptions = {}): ApiClient {
  const client = createClient<paths>({
    baseUrl,
    headers: { Accept: 'application/json, application/problem+json' },
    ...(fetch ? { fetch } : {}),
  })
  client.use(authMiddleware(tokenStore))
  return client
}

/** App-wide client. */
export const api: ApiClient = createApiClient()

type FetchResult<T> = { data?: T; error?: unknown; response: Response }

/**
 * Await an openapi-fetch call and return its data, or throw an `ApiProblem`
 * (problem+json errors, unexpected bodies and network failures alike).
 *
 * @example
 * const staff = await unwrap(api.GET('/api/v1/auth/me', { signal }))
 */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
  let result: FetchResult<T>
  try {
    result = await call
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw ApiProblem.network(error)
  }
  const { data, error, response } = result
  if (!response.ok || error !== undefined) throw ApiProblem.fromResponse(response.status, error)
  return data as T
}
