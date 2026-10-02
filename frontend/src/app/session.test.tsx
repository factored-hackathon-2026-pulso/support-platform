import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProblem } from '@/lib/api'
import { sessionToken } from '@/lib/session-token'
import { analystStaff } from '@/test/fixtures'
import { createQueryClient } from './query-client'
import { deriveSessionStatus, SessionProvider, useSession } from './session'

/** The app-wide API client uses the global fetch (stubbed in src/test/setup.ts). */
const fetchMock = vi.mocked(globalThis.fetch)

function json(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

function problem(status: number, code: string): Response {
  return json(status, { status, code, title: code }, 'application/problem+json')
}

const meResponse = {
  staff: analystStaff,
  session: { id: 'SES-1', expiresAt: '2026-10-02T23:00:00Z' },
}

/** Requests the API client sent through fetch, in order. */
function sentRequests(): Request[] {
  return fetchMock.mock.calls.map(([input]) => input as Request)
}

function setup({ token }: { token?: string } = {}) {
  const queryClient = createQueryClient()
  if (token) sessionToken.set(token)
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    )
  }
  return { queryClient, ...renderHook(() => useSession(), { wrapper }) }
}

describe('deriveSessionStatus', () => {
  const base = { hasToken: true, hasStaff: false, isFetching: false, error: null }

  it('maps token, staff, fetch and error to a status', () => {
    expect(deriveSessionStatus({ ...base, hasToken: false })).toBe('anonymous')
    expect(deriveSessionStatus({ ...base, hasStaff: true })).toBe('authenticated')
    expect(deriveSessionStatus({ ...base, isFetching: true })).toBe('loading')
    expect(deriveSessionStatus(base)).toBe('loading')
  })

  it('treats transient failures as an error and rejected tokens as signed out', () => {
    expect(deriveSessionStatus({ ...base, error: ApiProblem.fromResponse(503, {}) })).toBe('error')
    expect(deriveSessionStatus({ ...base, error: ApiProblem.network(new TypeError('x')) })).toBe(
      'error',
    )
    expect(deriveSessionStatus({ ...base, error: ApiProblem.fromResponse(403, {}) })).toBe(
      'anonymous',
    )
    // Retrying after an error shows the spinner again.
    expect(
      deriveSessionStatus({
        ...base,
        isFetching: true,
        error: ApiProblem.fromResponse(503, {}),
      }),
    ).toBe('loading')
  })
})

describe('SessionProvider', () => {
  it('is anonymous without a token and never calls the API', () => {
    const { result } = setup()
    expect(result.current.status).toBe('anonymous')
    expect(result.current.user).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores a stored token with GET /auth/me: loading → authenticated', async () => {
    fetchMock.mockResolvedValue(json(200, meResponse))
    const { result } = setup({ token: 'tkn-restore' })
    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.user?.initials).toBe('DR')
    expect(result.current.hasRole('analyst')).toBe(true)
    expect(result.current.hasRole('admin')).toBe(false)
    const [me] = sentRequests()
    expect(new URL(me?.url ?? '').pathname).toBe('/api/v1/auth/me')
    expect(me?.headers.get('Authorization')).toBe('Bearer tkn-restore')
  })

  it('keeps the token on a 5xx from /me, reports an error and recovers on retry', async () => {
    fetchMock.mockResolvedValueOnce(problem(503, 'service_unavailable'))
    const { result } = setup({ token: 'tkn-outage' })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(sessionToken.get()).toBe('tkn-outage')

    fetchMock.mockResolvedValueOnce(json(200, meResponse))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(sessionToken.get()).toBe('tkn-outage')
  })

  it('keeps the token when the API is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = setup({ token: 'tkn-offline' })
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(sessionToken.get()).toBe('tkn-offline')
  })

  it('drops a token that /me rejects with a 4xx', async () => {
    fetchMock.mockResolvedValueOnce(problem(403, 'forbidden'))
    const { result } = setup({ token: 'tkn-forbidden' })
    await waitFor(() => expect(sessionToken.get()).toBeNull())
    expect(result.current.status).toBe('anonymous')
  })

  it('clears every cached response when the token goes away', () => {
    const { result, queryClient } = setup()
    act(() => result.current.signIn('tkn-1', analystStaff))
    expect(result.current.status).toBe('authenticated')
    queryClient.setQueryData(['cases', 'list'], [{ id: 'CASE-1' }])

    act(() => sessionToken.clear())
    expect(result.current.status).toBe('anonymous')
    expect(queryClient.getQueryData(['cases', 'list'])).toBeUndefined()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it('signs out: POST /auth/logout carries the old token, then the token is gone', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const { result } = setup()
    act(() => result.current.signIn('tkn-out', analystStaff))

    act(() => result.current.signOut())
    expect(sessionToken.get()).toBeNull()
    expect(result.current.status).toBe('anonymous')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [logout] = sentRequests()
    expect(logout?.method).toBe('POST')
    expect(new URL(logout?.url ?? '').pathname).toBe('/api/v1/auth/logout')
    expect(logout?.headers.get('Authorization')).toBe('Bearer tkn-out')
  })

  it('signs out locally even when the logout call fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = setup()
    act(() => result.current.signIn('tkn-x', analystStaff))
    act(() => result.current.signOut())
    expect(sessionToken.get()).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })
})
