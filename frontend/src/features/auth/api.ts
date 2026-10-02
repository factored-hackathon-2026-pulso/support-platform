/**
 * Auth calls (brief §4.5). The only module of the feature that talks to the
 * API client; tests mock it with `vi.mock('@/features/auth/api')`.
 */
import { api, unwrap, type Schemas } from '@/lib/api'

export type LoginRequest = Schemas['LoginRequest']
export type LoginResponse = Schemas['LoginResponse']
export type MfaRequest = Schemas['MfaRequest']
export type SessionResponse = Schemas['SessionResponse']

export const authMutationKeys = {
  login: ['auth', 'login'] as const,
  mfa: ['auth', 'mfa'] as const,
}

/** Step 1: email + password → MFA challenge. Throws ApiProblem (invalid_credentials, account_locked). */
export function login(body: LoginRequest): Promise<LoginResponse> {
  return unwrap(api.POST('/api/v1/auth/login', { body }))
}

/** Step 2: challenge + 6-digit code → session token + staff. Throws ApiProblem (mfa_invalid, mfa_challenge_invalid). */
export function verifyMfa(body: MfaRequest): Promise<SessionResponse> {
  return unwrap(api.POST('/api/v1/auth/mfa', { body }))
}
