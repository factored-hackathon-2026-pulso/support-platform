import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui'
import { topics, useRealtimeClient, useRealtimeSubscription } from '@/lib/realtime'
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
 *   the section she is in is gone.
 */
export function SessionLiveSync() {
  const { user } = useSession()
  const client = useRealtimeClient()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  useRealtimeSubscription(user ? topics.staff(user.id) : null)

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
    toast({ title: 'Cambiaron tus roles', description: rolesNowCopy(user.roleIds) })
  }, [user, roles, toast])

  return null
}
