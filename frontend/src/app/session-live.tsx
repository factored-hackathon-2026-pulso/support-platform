import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { topics, useOnReconnect, useRealtimeClient, useRealtimeSubscription } from '@/lib/realtime'
import { useTranslation } from '@/lib/i18n'
import { platformKeys } from './platform'
import { preferencesKeys } from './preferences'
import { rolesNowCopy } from './roles'
import { sessionKeys, useSession } from './session'

/**
 * Keeps the session in step with administration (slice-4-administration.md
 * §9.3, §10.7), mounted once in `AppProviders` inside the toasts:
 * - subscribes `staff:<me.id>` while signed in (`me.updated` → session cache,
 *   app/session-realtime.ts);
 * - on the socket's access-changed signal (close 4409: her roles changed)
 *   reloads /auth/me;
 * - when her roles change, says so once ("Cambiaron tus roles"). The rail and
 *   the role switcher follow `useSession()`; `RequireRole` sends her home if
 *   the section she is in is gone;
 * - (slice 18) subscribes `platform:settings` (`platform.updated` → the AI switch,
 *   app/platform.ts) and refetches the settings after a reconnect;
 * - (slice 23) `preferences.updated` on `staff:<me.id>` → her UI language
 *   (app/preferences.ts), refetched after a reconnect too.
 */
export function SessionLiveSync() {
  const { user } = useSession()
  const client = useRealtimeClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation('shell')
  useRealtimeSubscription(user ? topics.staff(user.id) : null)
  useRealtimeSubscription(user ? topics.platformSettings() : null)
  useOnReconnect(() => {
    void queryClient.invalidateQueries({ queryKey: platformKeys.settings() })
    void queryClient.invalidateQueries({ queryKey: preferencesKeys.me() })
  }, user !== null)

  useEffect(
    () =>
      client.onAccessChanged(() => {
        void queryClient.invalidateQueries({ queryKey: sessionKeys.me() })
      }),
    [client, queryClient],
  )

  const roles = user ? user.roleIds.join(',') : null
  const previous = useRef<{ id: string; roles: string } | null>(null)
  useEffect(() => {
    if (!user || roles === null) {
      previous.current = null
      return
    }
    const before = previous.current
    previous.current = { id: user.id, roles }
    if (!before || before.id !== user.id || before.roles === roles) return
    toast({ title: t('rolesChanged.title'), description: rolesNowCopy(user.roleIds) })
  }, [user, roles, toast, t])

  return null
}
