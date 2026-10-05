import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { roleFromPath } from '@/app/roles'
import { useToast } from '@/components/ui'
import { useTranslation } from '@/lib/i18n'
import { envelopePayload, useRealtimeClient } from '@/lib/realtime'
import {
  NOTIFICATION_NAVIGATION,
  isOnScreen,
  notificationCopy,
  readNotificationCreated,
  shouldToast,
} from '../model'
import type { Notification } from '../types'
import { useReadNotification } from './use-notifications'

/** Time on screen of a notification toast (paused while hovered or focused). */
export const NOTIFICATION_TOAST_MS = 8000

/**
 * The live toasts of the notification stream (slice 10), mounted once in the staff shell so
 * they fire on every screen of the role (Inicio included), never only on one screen:
 *
 * - `notification.created` → a toast with the same title and line as the bell, the primary
 *   action (opens it and marks it read) and "Más tarde" (dismisses the toast; the
 *   notification stays unread in the bell). Only on the screens of its role, and not when
 *   the screen already shows it (`shouldToast`).
 * - the screen comes to show a toasted notification (she opened the case another way) → the
 *   toast goes and the notification is read;
 * - it was read elsewhere (the bell, another tab) → the toast goes.
 *
 * Confirmations of her own actions are not notifications: they keep their plain toasts.
 */
export function useNotificationToasts(unreadIds: ReadonlySet<string> | null): void {
  const client = useRealtimeClient()
  const { toast, dismiss } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const read = useReadNotification()
  const { t } = useTranslation('notifications')

  const latest = useRef({ location, navigate, read, t })
  useEffect(() => {
    latest.current = { location, navigate, read, t }
  })

  /** Notification id → the toast showing it, with the notification. */
  const shown = useRef(new Map<string, { toastId: number; notification: Notification }>())

  useEffect(
    () =>
      client.onEnvelope((envelope) => {
        if (envelope.type !== 'notification.created') return
        const payload = readNotificationCreated(envelopePayload(envelope))
        if (!payload) return
        const { notification } = payload
        const current = latest.current.location
        const role = roleFromPath(current.pathname)
        if (shown.current.has(notification.id) || !shouldToast(notification, role, current)) {
          return
        }
        const copy = notificationCopy(notification, Date.now())
        const toastId = toast({
          title: copy.title,
          description: copy.detail,
          duration: NOTIFICATION_TOAST_MS,
          actions: [
            {
              label: copy.action,
              onClick: () => {
                shown.current.delete(notification.id)
                latest.current.read(notification)
                void latest.current.navigate(copy.href, { state: NOTIFICATION_NAVIGATION })
              },
            },
            {
              label: latest.current.t('toast.later'),
              variant: 'secondary',
              onClick: () => void shown.current.delete(notification.id),
            },
          ],
        })
        shown.current.set(notification.id, { toastId, notification })
      }),
    [client, toast],
  )

  // The screen now shows it (the case was opened from the list, the bell…): read it.
  useEffect(() => {
    for (const [id, { toastId, notification }] of shown.current) {
      if (!isOnScreen(notification, location)) continue
      shown.current.delete(id)
      dismiss(toastId)
      latest.current.read(notification)
    }
  }, [location, dismiss])

  // Read elsewhere: the toast has nothing left to say.
  useEffect(() => {
    if (!unreadIds) return
    for (const [id, { toastId }] of shown.current) {
      if (unreadIds.has(id)) continue
      shown.current.delete(id)
      dismiss(toastId)
    }
  }, [unreadIds, dismiss])
}
