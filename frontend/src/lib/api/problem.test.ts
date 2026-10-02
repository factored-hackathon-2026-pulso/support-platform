import { describe, expect, it } from 'vitest'
import { ApiProblem, type KnownProblemCode, type ServerProblemCode } from './problem'

describe('ApiProblem.fromResponse', () => {
  it('keeps the server code of a problem body', () => {
    const problem = ApiProblem.fromResponse(409, {
      type: 'urn:cc-platform:problem:concurrent_update',
      title: 'Concurrent update',
      status: 409,
      code: 'concurrent_update',
      detail: 'Alguien más actualizó este registro al mismo tiempo. Vuelve a intentarlo.',
    })
    expect(problem.code).toBe('concurrent_update')
    expect(problem.detail).toContain('Vuelve a intentarlo')
  })

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation_error'],
    [423, 'account_locked'],
    [502, 'unexpected_error'],
  ] as const)('derives a code from status %i when the body is not a problem', (status, code) => {
    expect(ApiProblem.fromResponse(status, 'proxy error page').code).toBe(code)
  })

  it('types server codes from the OpenAPI contract', () => {
    const fromContract: ServerProblemCode[] = [
      'account_locked',
      'concurrent_update',
      'invalid_topic',
    ]
    const known: KnownProblemCode[] = [...fromContract, 'network_error', 'unexpected_error']
    expect(known).toHaveLength(5)
  })
})
