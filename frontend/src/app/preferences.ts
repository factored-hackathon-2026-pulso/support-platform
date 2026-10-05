/**
 * The signed-in person's own preferences (slice-23-i18n.md §2): today the UI language.
 *
 * - The value arrives with GET /auth/me (`preferences`): the session query writes it here
 *   (`primePreferences`), so normally nothing else is fetched. After a sign-in (the MFA answer
 *   has no preferences) this query reads GET /me/preferences once.
 * - It stays live: `preferences.updated` on `staff:<id>` (SessionLiveSync subscribes) replaces
 *   it, so every open tab of hers switches language; a reconnect refetches it.
 * - `UiLanguageSync` applies it: the i18n language (no reload) and the stored choice, which the
 *   sign-in screens use next time (`lib/i18n/locale`).
 * - `useSetUiLanguage` changes it from the account menu: optimistic, rolled back with a toast.
 *
 * Keep this module light: it is part of the main bundle.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { api, unwrap, type Schemas } from '@/lib/api'
import { changeLocale, i18n, isAppLocale, storeLocale, type AppLocale } from '@/lib/i18n'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { sessionToken } from '@/lib/session-token'

export type Preferences = Schemas['Preferences']

export const preferencesKeys = {
  all: ['preferences'] as const,
  me: () => [...preferencesKeys.all, 'me'] as const,
}

export async function fetchPreferences(signal?: AbortSignal): Promise<Preferences> {
  return unwrap(api.GET('/api/v1/me/preferences', { signal }))
}

export async function updatePreferences(uiLanguage: AppLocale): Promise<Preferences> {
  return unwrap(api.PUT('/api/v1/me/preferences', { body: { uiLanguage } }))
}

/** The session's /auth/me answer carries the preferences: keep them (no second request). */
export function primePreferences(queryClient: QueryClient, preferences: Preferences): void {
  queryClient.setQueryData(preferencesKeys.me(), preferences)
}

/**
 * Her preferences, or `undefined` while unknown (signed out, loading, error). Like the
 * platform settings, it reads the token store, not `useSession` (the session primes it).
 */
export function usePreferences(): Preferences | undefined {
  const token = useSyncExternalStore(sessionToken.subscribe, sessionToken.get, sessionToken.get)
  const query = useQuery({
    queryKey: preferencesKeys.me(),
    queryFn: ({ signal }) => fetchPreferences(signal),
    enabled: token !== null,
    staleTime: Infinity,
  })
  return token !== null ? query.data : undefined
}

/**
 * Applies her UI language whenever it is known or changes (sign-in, another tab, the menu):
 * the app switches without a reload and the sign-in screens remember it. Signing out keeps
 * the language on screen. Mounted once in `AppProviders`.
 */
export function UiLanguageSync() {
  const uiLanguage = usePreferences()?.uiLanguage
  useEffect(() => {
    if (!isAppLocale(uiLanguage)) return
    storeLocale(uiLanguage)
    void changeLocale(uiLanguage)
  }, [uiLanguage])
  return null
}

/** Change her UI language (account menu): at once, saved on her profile, undone on failure. */
export function useSetUiLanguage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation({
    mutationKey: [...preferencesKeys.all, 'set'],
    mutationFn: updatePreferences,
    onMutate: async (uiLanguage) => {
      await queryClient.cancelQueries({ queryKey: preferencesKeys.me() })
      const previous = queryClient.getQueryData<Preferences>(preferencesKeys.me())
      queryClient.setQueryData<Preferences>(preferencesKeys.me(), { ...previous, uiLanguage })
      return { previous }
    },
    onSuccess: (preferences) => primePreferences(queryClient, preferences),
    onError: (_error, _uiLanguage, context) => {
      const previous = context?.previous
      if (previous) primePreferences(queryClient, previous)
      // Said in the language the app goes back to.
      const lng = previous ? { lng: previous.uiLanguage } : {}
      toast({
        title: i18n.t('shell:accountMenu.languageFailed', lng),
        description: i18n.t('shell:accountMenu.languageFailedDetail', lng),
        politeness: 'alert',
      })
    },
  })
  return { setUiLanguage: mutation.mutate, isPending: mutation.isPending }
}

/** The `Preferences` payload of `preferences.updated`, or null when malformed. */
export function readPreferences(envelope: RealtimeEnvelope): Preferences | null {
  const payload = envelopePayload(envelope)
  if (!payload || !isAppLocale(payload.uiLanguage)) return null
  return { uiLanguage: payload.uiLanguage }
}

function applyPreferences(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const preferences = readPreferences(envelope)
  if (preferences) primePreferences(queryClient, preferences)
}

export const registerPreferencesRealtime: RealtimeRegistration = (registry) => {
  registry.register('preferences.updated', applyPreferences)
}
