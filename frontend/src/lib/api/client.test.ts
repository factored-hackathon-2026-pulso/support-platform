import { describe, expect, it, vi } from 'vitest'
import { createSessionTokenStore } from '@/lib/session-token'
import { createApiClient, unwrap } from './client'
import { ApiProblem, isApiProblem } from './problem'

function json(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

function setup(token: string | null, respond: (request: Request) => Response | Promise<Response>) {
  const tokenStore = createSessionTokenStore()
  tokenStore.set(token)
  const requests: Request[] = []
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async (request) => {
    requests.push(request)
    return respond(request)
  })
  const client = createApiClient({ baseUrl: 'http://api.test', tokenStore, fetch })
  return { client, tokenStore, requests }
}

const me = {
  staff: {
    id: 'STF-1',
    name: 'Daniela Ríos Medina',
    email: 'daniela.rios@latambank.example',
    roles: ['analyst'],
    level: 'Specialist',
    languages: ['es'],
    team: 'Disputas',
    requiresFourEyes: false,
  },
  session: { id: 'SES-1', expiresAt: '2026-10-02T20:00:00Z' },
}

describe('api client', () => {
  it('sends the bearer token and returns typed data', async () => {
    const { client, requests } = setup('tkn-1', () => json(200, me))
    const result = await unwrap(client.GET('/api/v1/auth/me'))
    expect(result.staff.name).toBe('Daniela Ríos Medina')
    expect(requests[0]?.url).toBe('http://api.test/api/v1/auth/me')
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer tkn-1')
  })

  it('omits the header without a session', async () => {
    const { client, requests } = setup(null, () =>
      json(200, { mfaRequired: true, challengeId: 'CH-1' }),
    )
    await unwrap(client.POST('/api/v1/auth/login', { body: { email: 'a@b.co', password: 'x' } }))
    expect(requests[0]?.headers.has('Authorization')).toBe(false)
  })

  it('ends the session when the current token is rejected', async () => {
    const problem = {
      type: 'about:blank',
      title: 'No autenticado',
      status: 401,
      code: 'unauthenticated',
    }
    const { client, tokenStore } = setup('tkn-1', () =>
      json(401, problem, 'application/problem+json'),
    )
    await expect(unwrap(client.GET('/api/v1/auth/me'))).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
    })
    expect(tokenStore.get()).toBeNull()
  })

  it('keeps a newer token when a stale request comes back 401', async () => {
    let tokenStoreRef: { set: (t: string | null) => void } | null = null
    const { client, tokenStore } = setup('old', () => {
      tokenStoreRef?.set('new')
      return json(401, { title: 'x', status: 401, code: 'unauthenticated' })
    })
    tokenStoreRef = tokenStore
    await expect(unwrap(client.GET('/api/v1/auth/me'))).rejects.toBeInstanceOf(ApiProblem)
    expect(tokenStore.get()).toBe('new')
  })

  it('maps problem+json errors with extensions', async () => {
    const { client } = setup(null, () =>
      json(
        423,
        {
          type: 'about:blank',
          title: 'Cuenta bloqueada',
          status: 423,
          code: 'account_locked',
          unlockAt: '2026-10-02T15:47:00Z',
        },
        'application/problem+json',
      ),
    )
    const error = await unwrap(
      client.POST('/api/v1/auth/login', { body: { email: 'a@b.co', password: 'x' } }),
    ).catch((e: unknown) => e)
    expect(isApiProblem(error, 'account_locked')).toBe(true)
    expect((error as ApiProblem).stringExtension('unlockAt')).toBe('2026-10-02T15:47:00Z')
  })

  it('derives a code from the status when the body is not a problem', async () => {
    const { client } = setup('tkn', () => new Response('Bad gateway', { status: 502 }))
    await expect(unwrap(client.GET('/api/v1/auth/me'))).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_error',
    })
  })

  it('turns network failures into network_error problems', async () => {
    const { client } = setup('tkn', () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(unwrap(client.GET('/api/v1/auth/me'))).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    })
  })
})

describe('ApiProblem', () => {
  it('reads typed extensions defensively', () => {
    const problem = ApiProblem.fromResponse(401, {
      code: 'invalid_credentials',
      remainingAttempts: 3,
      unlockAt: 7,
    })
    expect(problem.numberExtension('remainingAttempts')).toBe(3)
    expect(problem.stringExtension('unlockAt')).toBeNull()
    expect(problem.message).toBeTruthy()
  })
})
