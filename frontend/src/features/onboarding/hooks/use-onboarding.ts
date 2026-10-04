import { useMutation, useQuery } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import {
  activateInvitation,
  checkInvitation,
  checkPasswordReset,
  completePasswordReset,
  fetchDevMailbox,
  fetchMeta,
  onboardingKeys,
  onboardingMutationKeys,
  setInvitationPassword,
} from '../api'
import type {
  ActivatedAccount,
  InvitationCheck,
  PasswordResetCheck,
  PasswordResetDone,
  TotpEnrollment,
} from '../types'

/** A link is checked once: no retries (a 410 is final) and no refetch on focus. */
const LINK_QUERY = { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } as const

export function useInvitationCheck(token: string | null) {
  return useQuery<InvitationCheck, ApiProblem>({
    queryKey: onboardingKeys.invitation(token ?? ''),
    queryFn: ({ signal }) => checkInvitation(token ?? '', signal),
    enabled: token !== null,
    ...LINK_QUERY,
  })
}

export function usePasswordResetCheck(token: string | null) {
  return useQuery<PasswordResetCheck, ApiProblem>({
    queryKey: onboardingKeys.passwordReset(token ?? ''),
    queryFn: ({ signal }) => checkPasswordReset(token ?? '', signal),
    enabled: token !== null,
    ...LINK_QUERY,
  })
}

/** Step 1 of the activation. The enrollment (QR, key) stays in the mutation result only. */
export function useSetInvitationPassword(token: string) {
  return useMutation<TotpEnrollment, ApiProblem, string>({
    mutationKey: onboardingMutationKeys.invitationPassword,
    mutationFn: (password) => setInvitationPassword(token, password),
  })
}

export function useActivateInvitation(token: string) {
  return useMutation<ActivatedAccount, ApiProblem, string>({
    mutationKey: onboardingMutationKeys.activate,
    mutationFn: (code) => activateInvitation(token, code),
  })
}

export function useCompletePasswordReset(token: string) {
  return useMutation<PasswordResetDone, ApiProblem, string>({
    mutationKey: onboardingMutationKeys.completeReset,
    mutationFn: (password) => completePasswordReset(token, password),
  })
}

/** `/meta` (cached for the session): whether the dev mailbox is on. */
export function useMeta() {
  return useQuery({
    queryKey: onboardingKeys.meta(),
    queryFn: ({ signal }) => fetchMeta(signal),
    staleTime: Infinity,
    retry: false,
  })
}

/** Whether the backend runs the dev mailbox (false while unknown or on error). */
export function useDevMailboxEnabled(): boolean {
  return useMeta().data?.devMailbox === true
}

export function useDevMailbox(enabled: boolean) {
  return useQuery({
    queryKey: onboardingKeys.devMailbox(),
    queryFn: ({ signal }) => fetchDevMailbox(signal),
    enabled,
  })
}
