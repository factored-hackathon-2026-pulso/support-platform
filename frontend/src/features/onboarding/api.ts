/**
 * Onboarding calls (part 4): the public invitation and password-reset links, the dev
 * mailbox and `/meta`. No session: the link's token travels in the JSON body, never
 * in an API URL. The only module of the feature that talks to the API client; tests
 * mock it with `vi.mock('@/features/onboarding/api')`.
 */
import { api, unwrap } from '@/lib/api'
import type {
  ActivatedAccount,
  DevMailbox,
  InvitationCheck,
  MetaResponse,
  PasswordResetCheck,
  PasswordResetDone,
  TotpEnrollment,
} from './types'

export const onboardingKeys = {
  all: ['onboarding'] as const,
  invitation: (token: string) => ['onboarding', 'invitation', token] as const,
  passwordReset: (token: string) => ['onboarding', 'password-reset', token] as const,
  meta: () => ['onboarding', 'meta'] as const,
  devMailbox: () => ['onboarding', 'dev-mailbox'] as const,
}

export const onboardingMutationKeys = {
  invitationPassword: ['onboarding', 'invitation', 'password'] as const,
  activate: ['onboarding', 'invitation', 'activate'] as const,
  completeReset: ['onboarding', 'password-reset', 'complete'] as const,
}

/** Is the invitation link usable, and whom does it invite? 410 `link_invalid` otherwise. */
export function checkInvitation(token: string, signal?: AbortSignal): Promise<InvitationCheck> {
  return unwrap(api.POST('/api/v1/onboarding/invitations/check', { body: { token }, signal }))
}

/** Step 1: her password (policy checked again on the server); returns her TOTP setup. */
export function setInvitationPassword(token: string, password: string): Promise<TotpEnrollment> {
  return unwrap(api.POST('/api/v1/onboarding/invitations/password', { body: { token, password } }))
}

/** Step 2: the first 6-digit code of her app activates the account. */
export function activateInvitation(token: string, code: string): Promise<ActivatedAccount> {
  return unwrap(api.POST('/api/v1/onboarding/invitations/activate', { body: { token, code } }))
}

export function checkPasswordReset(
  token: string,
  signal?: AbortSignal,
): Promise<PasswordResetCheck> {
  return unwrap(api.POST('/api/v1/onboarding/password-resets/check', { body: { token }, signal }))
}

export function completePasswordReset(token: string, password: string): Promise<PasswordResetDone> {
  return unwrap(
    api.POST('/api/v1/onboarding/password-resets/complete', { body: { token, password } }),
  )
}

/** GET /meta: build info, and whether the dev mailbox is on (never in production). */
export function fetchMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return unwrap(api.GET('/api/v1/meta', { signal }))
}

/** GET /dev/mailbox (404 unless the backend runs with the dev mailbox on). */
export function fetchDevMailbox(signal?: AbortSignal): Promise<DevMailbox> {
  return unwrap(api.GET('/api/v1/dev/mailbox', { params: { query: { limit: 20 } }, signal }))
}
