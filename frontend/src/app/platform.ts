/**
 * The platform settings the SPA needs (slice-18-ai-foundation.md §2, §5): today the AI switch
 * ("Funciones de IA"). Every AI element of the staff app asks `useAiEnabled()` and renders
 * nothing while it is false, so with the switch off the app is exactly the people-only one.
 *
 * - The value arrives with GET /auth/me (`platform`): the session query writes it here
 *   (`primePlatformSettings`), so normally nothing else is fetched. After a sign-in (the MFA
 *   answer has no settings) this query reads /auth/me once.
 * - It stays live: `platform.updated` on `platform:settings` (SessionLiveSync subscribes)
 *   replaces it, and a reconnect refetches it.
 * - Unknown (loading, error) reads as off: the app never flashes an AI element it may hide.
 *
 * Keep this module light: it is part of the main bundle.
 */
import { useSyncExternalStore } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api, unwrap, type Schemas } from '@/lib/api'
import { envelopePayload, type RealtimeEnvelope, type RealtimeRegistration } from '@/lib/realtime'
import { sessionToken } from '@/lib/session-token'

export type PlatformSettings = Schemas['PlatformSettings']

export const platformKeys = {
  all: ['platform'] as const,
  settings: () => [...platformKeys.all, 'settings'] as const,
}

/** GET /auth/me → its `platform` part (the settings every staff member reads). */
export async function fetchPlatformSettings(signal?: AbortSignal): Promise<PlatformSettings> {
  const { platform } = await unwrap(api.GET('/api/v1/auth/me', { signal }))
  return platform
}

/** The session's /auth/me answer carries the settings: keep them (no second request). */
export function primePlatformSettings(queryClient: QueryClient, settings: PlatformSettings): void {
  queryClient.setQueryData(platformKeys.settings(), settings)
}

/**
 * The settings, or `undefined` while unknown (signed out, loading, error). It reads the token
 * store directly (not `useSession`): the session module primes this cache, so it must not
 * depend on this one.
 */
export function usePlatformSettings(): PlatformSettings | undefined {
  const token = useSyncExternalStore(sessionToken.subscribe, sessionToken.get, sessionToken.get)
  const query = useQuery({
    queryKey: platformKeys.settings(),
    queryFn: ({ signal }) => fetchPlatformSettings(signal),
    enabled: token !== null,
    staleTime: Infinity,
  })
  return token !== null ? query.data : undefined
}

/** Whether the AI functions are on (false while unknown). */
export function useAiEnabled(): boolean {
  return usePlatformSettings()?.aiEnabled === true
}

/** The `PlatformSettings` payload of `platform.updated`, or null when malformed. */
export function readPlatformSettings(envelope: RealtimeEnvelope): PlatformSettings | null {
  const payload = envelopePayload(envelope)
  if (!payload || typeof payload.aiEnabled !== 'boolean') return null
  return { aiEnabled: payload.aiEnabled }
}

function applyPlatform(envelope: RealtimeEnvelope, queryClient: QueryClient): void {
  const settings = readPlatformSettings(envelope)
  if (settings) primePlatformSettings(queryClient, settings)
}

export const registerPlatformRealtime: RealtimeRegistration = (registry) => {
  registry.register('platform.updated', applyPlatform)
}
