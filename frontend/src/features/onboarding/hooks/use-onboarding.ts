import { useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ApiProblem } from '@/lib/api'
import { changeLocale, getActiveLocale, isAppLocale, storeLocale } from '@/lib/i18n'
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

/**
 * Slice 23c: a valid link knows her platform language (the one administration chose when it
 * invited her, or her own preference for a reset). The screens switch to it and the sign-in
 * that follows remembers it.
 */
function useLinkLanguage(language: string | undefined) {
  useEffect(() => {
    if (!isAppLocale(language)) return
    storeLocale(language)
    if (getActiveLocale() !== language) void changeLocale(language)
  }, [language])
}

export function useInvitationCheck(token: string | null) {
  const query = useQuery<InvitationCheck, ApiProblem>({
    queryKey: onboardingKeys.invitation(token ?? ''),
    queryFn: ({ signal }) => checkInvitation(token ?? '', signal),
    enabled: token !== null,
    ...LINK_QUERY,
  })
  useLinkLanguage(query.data?.uiLanguage)
  return query
}

export function usePasswordResetCheck(token: string | null) {
  const query = useQuery<PasswordResetCheck, ApiProblem>({
    queryKey: onboardingKeys.passwordReset(token ?? ''),
    queryFn: ({ signal }) => checkPasswordReset(token ?? '', signal),
    enabled: token !== null,
    ...LINK_QUERY,
  })
  useLinkLanguage(query.data?.uiLanguage)
  return query
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
