/**
 * Typed API errors. The backend answers errors with RFC 7807
 * `application/problem+json` and a stable `code`; this module turns any failed
 * call (problem body, unexpected body or network failure) into one `ApiProblem`.
 */

import type { Schemas } from './client'

/** Every code the server can answer: generated from `ProblemCode` in the OpenAPI contract. */
export type ServerProblemCode = Schemas['ProblemCode']

/** Client-side codes: no response at all, or a response that is not problem+json. */
export type ClientProblemCode = 'network_error' | 'unexpected_error'

/**
 * Codes the UI branches on. Derived from the contract, so adding or renaming a server
 * code without regenerating `schema.gen.ts` fails `pnpm check:api` / typecheck.
 * Unknown codes are still accepted at runtime (`ProblemCode`).
 */
export type KnownProblemCode = ServerProblemCode | ClientProblemCode

export type ProblemCode = KnownProblemCode | (string & {})

export interface ProblemBody {
  type?: string
  title?: string
  status?: number
  detail?: string | null
  code?: string
  [extension: string]: unknown
}

const GENERIC_MESSAGE = 'No pudimos completar la solicitud. Intenta de nuevo.'
const NETWORK_MESSAGE = 'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function codeFromStatus(status: number): KnownProblemCode {
  if (status === 401) return 'unauthenticated'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422) return 'validation_error'
  if (status === 423) return 'account_locked'
  return 'unexpected_error'
}

export class ApiProblem extends Error {
  readonly status: number
  readonly code: ProblemCode
  readonly title: string
  readonly detail: string | null
  /** Problem extension members (unlockAt, remainingAttempts…). */
  readonly extensions: Readonly<Record<string, unknown>>

  constructor(init: {
    status: number
    code: ProblemCode
    title?: string
    detail?: string | null
    extensions?: Record<string, unknown>
  }) {
    super(init.detail || init.title || GENERIC_MESSAGE)
    this.name = 'ApiProblem'
    this.status = init.status
    this.code = init.code
    this.title = init.title ?? GENERIC_MESSAGE
    this.detail = init.detail ?? null
    this.extensions = init.extensions ?? {}
  }

  /** Build from a failed HTTP response and its parsed body (any shape). */
  static fromResponse(status: number, body: unknown): ApiProblem {
    if (!isRecord(body)) return new ApiProblem({ status, code: codeFromStatus(status) })
    const {
      type: _type,
      title,
      status: _status,
      detail,
      code,
      instance: _instance,
      ...extensions
    } = body as ProblemBody
    return new ApiProblem({
      status,
      code: typeof code === 'string' && code ? code : codeFromStatus(status),
      title: typeof title === 'string' ? title : undefined,
      detail: typeof detail === 'string' ? detail : null,
      extensions,
    })
  }

  /** The request never reached the server (DNS, CORS, offline, aborted). */
  static network(cause?: unknown): ApiProblem {
    const problem = new ApiProblem({ status: 0, code: 'network_error', title: NETWORK_MESSAGE })
    if (cause !== undefined) Object.defineProperty(problem, 'cause', { value: cause })
    return problem
  }

  /** Read a string extension member (e.g. `unlockAt`). */
  stringExtension(name: string): string | null {
    const value = this.extensions[name]
    return typeof value === 'string' ? value : null
  }

  /** Read a numeric extension member (e.g. `remainingAttempts`). */
  numberExtension(name: string): number | null {
    const value = this.extensions[name]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
}

export function isApiProblem(error: unknown, code?: ProblemCode): error is ApiProblem {
  return error instanceof ApiProblem && (code === undefined || error.code === code)
}
